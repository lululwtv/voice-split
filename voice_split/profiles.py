"""Local reference embeddings; uploaded recordings are never persisted."""

import json
import os
from pathlib import Path
import tempfile
from threading import RLock
from uuid import uuid4

import numpy as np


def _unit(embedding: np.ndarray) -> np.ndarray:
    vector = np.asarray(embedding, dtype=np.float64)
    if vector.ndim != 1 or not vector.size or not np.isfinite(vector).all():
        raise ValueError("Invalid speaker embedding.")
    length = np.linalg.norm(vector)
    if not np.isfinite(length) or length < 1e-8:
        raise ValueError("Invalid empty speaker embedding.")
    return vector / length


class ProfileStore:
    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "profiles.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.threshold = float(os.getenv("VOICE_SPLIT_MATCH_THRESHOLD", "0.70"))
        self.margin = float(os.getenv("VOICE_SPLIT_MATCH_MARGIN", "0.08"))
        if not 0 <= self.threshold <= 1 or not 0 <= self.margin <= 1:
            raise ValueError("Speaker threshold and margin must be between zero and one.")
        self._lock = RLock()
        self._profiles = json.loads(self.path.read_text()) if self.path.exists() else []
        for profile in self._profiles:
            _unit(profile["vector_sum"])

    @staticmethod
    def _public(profile: dict) -> dict:
        return {key: profile[key] for key in ("id", "name", "samples")}

    def _save(self, profiles: list[dict]) -> None:
        handle, temporary = tempfile.mkstemp(prefix=".profiles-", dir=self.path.parent)
        try:
            with os.fdopen(handle, "w") as stream:
                json.dump(profiles, stream, allow_nan=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        self._profiles = profiles

    def enroll(self, name: str, embedding: np.ndarray) -> dict:
        name = " ".join(name.split())
        if not 1 <= len(name) <= 80 or any(ord(char) < 32 for char in name):
            raise ValueError("Speaker name must contain 1–80 printable characters.")
        vector = _unit(embedding)
        with self._lock:
            profiles = [dict(profile) for profile in self._profiles]
            if profiles and len(profiles[0]["vector_sum"]) != len(vector):
                raise ValueError("Speaker model changed; delete existing profiles and enroll again.")
            profile = next((item for item in profiles if item["name"].casefold() == name.casefold()), None)
            if profile is None:
                profile = {"id": str(uuid4()), "name": name, "samples": 1, "vector_sum": vector.tolist()}
                profiles.append(profile)
            else:
                combined = np.asarray(profile["vector_sum"]) + vector
                _unit(combined)
                profile["vector_sum"] = combined.tolist()
                profile["samples"] += 1
            self._save(profiles)
            return self._public(profile)

    def list(self) -> list[dict]:
        with self._lock:
            return [self._public(profile) for profile in self._profiles]

    def delete(self, profile_id: str) -> bool:
        with self._lock:
            profiles = [profile for profile in self._profiles if profile["id"] != profile_id]
            if len(profiles) == len(self._profiles):
                return False
            self._save(profiles)
            return True

    def match(self, embedding: np.ndarray) -> dict:
        result = self.assess(embedding)
        return {key: result[key] for key in ("speaker", "score", "profile_id")}

    def rank(self, embedding: np.ndarray, participant_ids) -> "list[dict]":
        """Rank compatible participant references by cosine similarity, then ID."""
        vector = _unit(embedding)
        participants = set(participant_ids)
        with self._lock:
            candidates = [
                {"profile_id": profile["id"], "speaker": profile["name"],
                 "score": float(np.clip(np.dot(vector, _unit(profile["vector_sum"])), -1, 1))}
                for profile in self._profiles
                if profile["id"] in participants and len(profile["vector_sum"]) == len(vector)
            ]
        return sorted(candidates, key=lambda candidate: (-candidate["score"], candidate["profile_id"]))

    def replace(self, profile_id: str, embedding: np.ndarray) -> dict:
        vector = _unit(embedding)
        with self._lock:
            profiles = [dict(profile) for profile in self._profiles]
            profile = next((item for item in profiles if item["id"] == profile_id), None)
            if profile is None:
                raise KeyError(profile_id)
            if len(profile["vector_sum"]) != len(vector):
                raise ValueError("Speaker model changed; remove this voice and enroll again.")
            profile.update(vector_sum=vector.tolist(), samples=1)
            self._save(profiles)
            return self._public(profile)

    def assess(self, embedding: np.ndarray) -> dict:
        vector = _unit(embedding)
        with self._lock:
            scores = sorted(
                [(float(np.clip(np.dot(vector, _unit(profile["vector_sum"])), -1, 1)), profile)
                 for profile in self._profiles if len(profile["vector_sum"]) == len(vector)],
                key=lambda item: item[0], reverse=True,
            )
        score = scores[0][0] if scores else 0.0
        ambiguous = len(scores) > 1 and score - scores[1][0] < self.margin
        reason = "no_profiles" if not scores else "below_threshold" if score < self.threshold else "ambiguous" if ambiguous else "matched"
        matched = reason == "matched"
        return {"speaker": scores[0][1]["name"] if matched else "Unknown", "score": score,
                "profile_id": scores[0][1]["id"] if matched else None,
                "identification": {"reason": reason, "candidate": scores[0][1]["name"] if scores else None,
                    "threshold": self.threshold, "min_margin": self.margin,
                    "margin": score - scores[1][0] if len(scores) > 1 else None}}
