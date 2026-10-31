import json

from .rooms import RoomStore
from .identification import evidence_strength


class ConflictError(ValueError):
    """The requested revision or idempotency key conflicts with saved state."""


class CoreRoomStore(RoomStore):
    def __init__(self, directory):
        super().__init__(directory)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("""CREATE TABLE IF NOT EXISTS room_voice_names (
                room_id TEXT NOT NULL, unknown_id TEXT NOT NULL, name TEXT NOT NULL,
                PRIMARY KEY (room_id, unknown_id))""")
            db.execute("""CREATE TABLE IF NOT EXISTS room_rosters (
                room_id TEXT PRIMARY KEY, participant_ids TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0)""")
            db.execute("""CREATE TABLE IF NOT EXISTS segment_corrections (
                room_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
                request TEXT NOT NULL, response TEXT NOT NULL,
                PRIMARY KEY (room_id, idempotency_key))""")

    @staticmethod
    def _require_room(db, room_id):
        if db.execute("SELECT 1 FROM rooms WHERE id=?", (room_id,)).fetchone() is None:
            raise KeyError(room_id)

    @staticmethod
    def _roster(db, room_id):
        row = db.execute(
            "SELECT participant_ids,revision FROM room_rosters WHERE room_id=?", (room_id,)
        ).fetchone()
        return {"participant_ids": json.loads(row[0]), "revision": row[1]} if row else {
            "participant_ids": [], "revision": 0
        }

    def roster(self, room_id):
        with self.connection() as db:
            self._require_room(db, room_id)
            return self._roster(db, room_id)

    def set_roster(self, room_id, participant_ids, expected_revision):
        if not isinstance(participant_ids, list) or any(
            not isinstance(item, str) or not item.strip() for item in participant_ids
        ):
            raise ValueError("Participant IDs must be nonempty strings.")
        if len(set(participant_ids)) != len(participant_ids):
            raise ValueError("Participant IDs must be unique.")
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            self._require_room(db, room_id)
            current = self._roster(db, room_id)
            if current["revision"] != expected_revision:
                raise ConflictError("The room roster has changed. Reload and retry.")
            result = {"participant_ids": participant_ids, "revision": current["revision"] + 1}
            db.execute(
                "INSERT INTO room_rosters VALUES (?,?,?) ON CONFLICT(room_id) DO UPDATE "
                "SET participant_ids=excluded.participant_ids, revision=excluded.revision",
                (room_id, json.dumps(participant_ids), result["revision"]),
            )
        return result

    @staticmethod
    def _normalize(segment):
        segment.setdefault("revision", 0)
        segment.setdefault("assignment_source", "automatic")
        segment.setdefault("profile_id", None)
        segment.setdefault("learning_status", "unavailable")
        return segment

    def history(self, room_id):
        with self.connection() as db:
            self._require_room(db, room_id)
            rows = db.execute(
                "SELECT payload FROM segments WHERE room_id=? ORDER BY rowid", (room_id,)
            ).fetchall()
        return [self._normalize(json.loads(row[0])) for row in rows]

    def _segment(self, db, room_id, segment_id):
        row = db.execute(
            "SELECT payload FROM segments WHERE room_id=? AND id=?", (room_id, segment_id)
        ).fetchone()
        if row is None:
            raise KeyError(segment_id)
        return self._normalize(json.loads(row[0]))

    def get_segment(self, room_id, segment_id):
        with self.connection() as db:
            self._require_room(db, room_id)
            return self._segment(db, room_id, segment_id)

    def append(self, room_id, segment):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            self._require_room(db, room_id)
            segment = self._apply_voice_name(db, room_id, self._normalize(dict(segment)))
            db.execute("INSERT INTO segments VALUES (?,?,?)", (
                segment["id"], room_id, json.dumps(self._normalize(dict(segment)))
            ))

    def append_live(self, room_id, segment):
        """Extend an automatic live turn atomically; corrections close that turn."""
        incoming = self._normalize(dict(segment))
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            self._require_room(db, room_id)
            incoming = self._apply_voice_name(db, room_id, incoming)
            row = db.execute(
                "SELECT payload FROM segments WHERE room_id=? ORDER BY rowid DESC LIMIT 1",
                (room_id,),
            ).fetchone()
            previous = self._normalize(json.loads(row[0])) if row else None
            if (previous and (incoming.get("profile_id") or incoming.get("unknown_id"))
                    and previous["assignment_source"] == incoming["assignment_source"]
                    and incoming["assignment_source"] in {"automatic", "unassigned"}
                    and previous["profile_id"] == incoming["profile_id"]
                    and previous.get("unknown_id") == incoming.get("unknown_id")
                    and incoming.get("stream_id")
                    and previous.get("stream_id") == incoming["stream_id"]
                    and previous.get("device_id") == incoming.get("device_id")
                    and 0 <= incoming["start"] - previous["end"] <= .8
                    and incoming["end"] - previous["start"] <= 20):
                # Retain the weakest evidence for the combined turn, not an inflated score.
                evidence = min((previous, incoming), key=evidence_strength)
                previous.update(text=previous["text"].rstrip() + " " + incoming["text"].lstrip(),
                                end=incoming["end"], revision=previous["revision"] + 1,
                                score=evidence.get("score"), identification=evidence.get("identification", {}))
                db.execute("UPDATE segments SET payload=? WHERE room_id=? AND id=?",
                           (json.dumps(previous), room_id, previous["id"]))
                return previous
            db.execute("INSERT INTO segments VALUES (?,?,?)",
                       (incoming["id"], room_id, json.dumps(incoming)))
        return incoming

    @staticmethod
    def _apply_voice_name(db, room_id, segment):
        if not segment.get("unknown_id") or segment.get("profile_id"):
            return segment
        row = db.execute("SELECT name FROM room_voice_names WHERE room_id=? AND unknown_id=?",
                         (room_id, segment["unknown_id"])).fetchone()
        if row:
            evidence = segment.get("identification", {})
            original = dict(evidence.get("original", evidence))
            original.setdefault("score", segment.get("score"))
            original.setdefault("unknown_id", segment["unknown_id"])
            original.setdefault("speaker", segment.get("speaker"))
            segment.update(speaker=row[0], assignment_source="manual", score=None,
                           identification={"reason": "manual_voice_name", "confidence": "manual", "original": original})
        return segment

    def name_unknown(self, room_id, segment_id, name, expected_revision):
        name = name.strip()
        if not name or len(name) > 100:
            raise ValueError("Enter a name of 1 to 100 characters.")
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            self._require_room(db, room_id)
            source = self._segment(db, room_id, segment_id)
            if source["revision"] != expected_revision:
                raise ConflictError("The segment has changed. Reload and retry.")
            unknown_id = source.get("unknown_id")
            if not unknown_id or source.get("profile_id"):
                raise ValueError("This line has no distinct unknown voice to name.")
            db.execute("INSERT INTO room_voice_names VALUES (?,?,?) ON CONFLICT(room_id,unknown_id) "
                       "DO UPDATE SET name=excluded.name", (room_id, unknown_id, name))
            changed = []
            for (payload,) in db.execute("SELECT payload FROM segments WHERE room_id=?", (room_id,)).fetchall():
                segment = self._normalize(json.loads(payload))
                if segment.get("unknown_id") != unknown_id or segment.get("profile_id"):
                    continue
                self._apply_voice_name(db, room_id, segment)
                segment["revision"] += 1
                db.execute("UPDATE segments SET payload=? WHERE room_id=? AND id=?",
                           (json.dumps(segment), room_id, segment["id"]))
                changed.append(segment)
        return changed

    @staticmethod
    def _correction_request(segment_id, profile_id, expected_revision, idempotency_key):
        if not isinstance(idempotency_key, str) or not idempotency_key.strip():
            raise ValueError("An idempotency key is required.")
        return json.dumps({"segment_id": segment_id, "profile_id": profile_id,
                           "expected_revision": expected_revision}, sort_keys=True)

    @staticmethod
    def _correction_replay(db, room_id, idempotency_key, request):
        previous = db.execute(
            "SELECT request,response FROM segment_corrections WHERE room_id=? AND idempotency_key=?",
            (room_id, idempotency_key),
        ).fetchone()
        if previous:
            if previous[0] != request:
                raise ConflictError("This idempotency key was used for a different correction.")
            return json.loads(previous[1])
        return None

    def correction_replay(self, room_id, segment_id, profile_id, expected_revision, idempotency_key):
        request = self._correction_request(segment_id, profile_id, expected_revision, idempotency_key)
        with self.connection() as db:
            self._require_room(db, room_id)
            return self._correction_replay(db, room_id, idempotency_key, request)

    def correct(self, room_id, segment_id, profile, expected_revision, idempotency_key):
        if any(not isinstance(profile.get(key), str) or not profile[key].strip() for key in ("id", "name")):
            raise ValueError("A profile ID and name are required.")
        request = self._correction_request(segment_id, profile["id"], expected_revision, idempotency_key)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            self._require_room(db, room_id)
            previous = self._correction_replay(db, room_id, idempotency_key, request)
            if previous is not None:
                return previous
            segment = self._segment(db, room_id, segment_id)
            if segment["revision"] != expected_revision:
                raise ConflictError("The segment has changed. Reload and retry.")
            if profile["id"] not in self._roster(db, room_id)["participant_ids"]:
                raise ValueError("The selected speaker is not in this room's roster.")
            identification = segment.get("identification", {})
            original = dict(identification.get("original", identification))
            original.setdefault("score", segment.get("score"))
            original.setdefault("assigned_profile_id", segment.get("profile_id"))
            original.setdefault("unknown_id", segment.get("unknown_id"))
            original.setdefault("speaker", segment.get("speaker"))
            segment.update(speaker=profile["name"], profile_id=profile["id"], unknown_id=None, score=None,
                           assignment_source="manual", revision=segment["revision"] + 1,
                           learning_status="unavailable", identification={
                               "reason": "manual", "confidence": "manual", "original": original,
                           })
            response = json.dumps(segment)
            db.execute("UPDATE segments SET payload=? WHERE room_id=? AND id=?",
                       (response, room_id, segment_id))
            db.execute("INSERT INTO segment_corrections VALUES (?,?,?,?)",
                       (room_id, idempotency_key, request, response))
        return segment

    def update_automatic(self, room_id, segment_id, patch, expected_revision):
        if set(patch) & {"id", "revision", "assignment_source", "learning_status"}:
            raise ValueError("Automatic updates cannot replace segment identity or control fields.")
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            self._require_room(db, room_id)
            segment = self._segment(db, room_id, segment_id)
            if segment["assignment_source"] == "manual" or segment["revision"] != expected_revision:
                return None
            segment.update(patch)
            segment["revision"] += 1
            db.execute("UPDATE segments SET payload=? WHERE room_id=? AND id=?",
                       (json.dumps(segment), room_id, segment_id))
        return segment
