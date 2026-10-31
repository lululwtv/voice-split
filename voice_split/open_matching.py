"""Open-set meeting attribution. Similarities are evidence, not probabilities."""
import json
import os

import numpy as np

from .profiles import _unit

STRONG_MATCH = .8


class MeetingMatcher:
    def __init__(self, engines, profiles, store):
        self.engines, self.profiles, self.store = engines, profiles, store
        self.model = getattr(engines, "speaker_name", "test-unspecified")
        self.threshold = float(os.getenv("VOICE_SPLIT_OPEN_THRESHOLD", ".55"))
        self.margin = float(os.getenv("VOICE_SPLIT_OPEN_MARGIN", ".08"))
        self.unknown_threshold = float(os.getenv("VOICE_SPLIT_UNKNOWN_THRESHOLD", ".65"))
        if not all(0 <= value <= 1 for value in (self.threshold, self.margin, self.unknown_threshold)):
            raise ValueError("Meeting matching thresholds must be between zero and one.")
        with store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("CREATE TABLE IF NOT EXISTS unknown_voices (room_id TEXT, number INTEGER, vector TEXT, PRIMARY KEY(room_id,number))")
            if "model" not in {row[1] for row in db.execute("PRAGMA table_info(unknown_voices)")}:
                # Every pre-versioned reference was produced by the original ECAPA adapter.
                db.execute("ALTER TABLE unknown_voices ADD COLUMN model TEXT NOT NULL DEFAULT 'speechbrain/spkrec-ecapa-voxceleb'")

    def identify(self, room_id, samples, participant_ids):
        samples = np.asarray(samples)
        if samples.ndim != 1:
            samples = np.empty(0)
        duration = len(samples) / 16000
        threshold = round(min(1., self.threshold + (.05 if duration < .5 else 0)), 6)
        info = dict(reason="embedding_unavailable", confidence="unavailable", speech_seconds=round(duration, 3),
                    candidate=None, candidate_profile_id=None, margin=None, threshold=threshold,
                    min_margin=self.margin, calibrated=False)
        result = dict(speaker="Unknown speaker", profile_id=None, unknown_id=None, score=None,
                      assignment_source="unassigned", identification=info)
        if not len(samples) or not np.isfinite(samples).all() or not np.any(samples):
            return result
        try:
            vector = _unit(self.engines.embed(samples))
        except (ValueError, RuntimeError):
            return result
        # Unchecked saved voices are negative evidence, never named participants.
        saved = self.profiles.list()
        ranked = self.profiles.rank(vector, [p["id"] for p in saved])
        eligible = [p for p in ranked if p["profile_id"] in participant_ids]
        with self.store.connection() as db:
            unknown_scores = self._scores(db, room_id, vector)
        if eligible:
            best = eligible[0]
            rivals = [p["score"] for p in ranked if p["profile_id"] != best["profile_id"]]
            margin = best["score"] - max(rivals) if rivals else None
            info.update(candidate=best["speaker"], candidate_profile_id=best["profile_id"], margin=margin)
            result["score"] = best["score"]
            # A strong saved reference can resolve an earlier unknown identity. A
            # borderline named match must not displace substantially better unknown evidence.
            unknown_wins = (unknown_scores and best["score"] < STRONG_MATCH
                            and unknown_scores[0][0] >= self.unknown_threshold
                            and unknown_scores[0][0] - best["score"] >= self.margin)
            info.update(unknown_similarity=unknown_scores[0][0] if unknown_scores else None)
            if (unknown_scores and threshold <= best["score"] < STRONG_MATCH
                    and unknown_scores[0][0] >= self.unknown_threshold
                    and abs(best["score"] - unknown_scores[0][0]) < self.margin):
                info.update(reason="ambiguous_identity", confidence="low")
                return result
            if best["score"] >= threshold and (margin is None or margin >= self.margin) and not unknown_wins:
                confidence = "high" if duration >= .5 and best["score"] >= STRONG_MATCH and (margin is None or margin >= .15) else "medium" if best["score"] >= threshold + .1 else "low"
                info.update(reason="matched", confidence=confidence)
                result.update(best, assignment_source="automatic")
                return result
            info["reason"] = "unknown_voice_closer" if unknown_wins else "low_similarity" if best["score"] < threshold else "ambiguous"
        else:
            if any(p["id"] in participant_ids for p in saved):
                info["reason"] = "no_compatible_profiles"
                return result
            info["reason"] = "no_participants"
        number, similarity = self._unknown(room_id, vector)
        if number is not None:
            result.update(speaker=f"Unknown speaker {number}", unknown_id=f"unknown-{number}")
        info.update(confidence="low", unknown_similarity=similarity)
        return result

    def _scores(self, db, room_id, vector):
        rows = db.execute("SELECT number,vector FROM unknown_voices WHERE room_id=? AND model=?",
                          (room_id, self.model)).fetchall()
        return sorted([(float(np.clip(np.dot(vector, saved), -1, 1)), number)
                       for number, encoded in rows
                       if len(saved := json.loads(encoded)) == len(vector)], reverse=True)

    def _unknown(self, room_id, vector):
        with self.store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            self.store._require_room(db, room_id)
            rows = db.execute("SELECT number,vector FROM unknown_voices WHERE room_id=? ORDER BY number", (room_id,)).fetchall()
            scores = self._scores(db, room_id, vector)
            if scores and scores[0][0] >= self.unknown_threshold:
                if len(scores) > 1 and scores[0][0] - scores[1][0] < self.margin:
                    return None, scores[0][0]  # Insufficient evidence to distinguish existing unknowns.
                return scores[0][1], scores[0][0]
            if len(rows) >= 64:
                return None, None
            number = max((row[0] for row in rows), default=0) + 1
            db.execute("INSERT INTO unknown_voices (room_id,number,vector,model) VALUES (?,?,?,?)",
                       (room_id, number, json.dumps(vector.tolist()), self.model))
            return number, None
