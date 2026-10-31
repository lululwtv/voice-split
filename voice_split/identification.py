import math

import numpy as np

from .audio import SAMPLE_RATE, validate_speech

MIN_SPEECH_SECONDS = 2
REFERENCE_WINDOW = 3 * SAMPLE_RATE


def evidence_strength(match):
    """Order conservative segment evidence by confidence, then raw similarity."""
    confidence = match.get("identification", {}).get("confidence", "unavailable")
    score = match.get("score")
    return ({"high": 3, "medium": 2, "low": 1}.get(confidence, 0),
            score if score is not None else -1.)


def speech_samples(samples, rows):
    """Select nonoverlapping ASR speech spans, excluding recording padding."""
    spans = []
    for row in rows:
        start, end = row.get("start", 0), row.get("end", 0)
        if not math.isfinite(start) or not math.isfinite(end):
            continue
        a, b = max(0, int(start * SAMPLE_RATE)), min(len(samples), int(end * SAMPLE_RATE))
        if b > a:
            spans.append((a, b))
    merged = []
    for a, b in sorted(spans):
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(b, merged[-1][1]))
        else:
            merged.append((a, b))
    return np.concatenate([samples[a:b] for a,b in merged]) if merged else np.empty(0, dtype=np.float32)


def enrollment_reference(engines, samples):
    validate_speech(samples, min_seconds=MIN_SPEECH_SECONDS)
    rows = engines.transcribe(samples)
    if not rows:
        raise ValueError("No speech was detected. Record a few clear sentences and try again.")
    speech = speech_samples(samples, rows)
    validate_speech(speech, min_seconds=MIN_SPEECH_SECONDS)
    vectors = [engines.embed(speech[start:start+REFERENCE_WINDOW])
               for start in range(0, len(speech), REFERENCE_WINDOW)
               if len(speech[start:start+REFERENCE_WINDOW]) >= MIN_SPEECH_SECONDS * SAMPLE_RATE]
    mean = np.mean(vectors, axis=0)
    norm = float(np.linalg.norm(mean))
    if not np.isfinite(mean).all() or norm < 1e-8:
        raise ValueError("Could not build a consistent voice reference. Record again in a quiet room.")
    return mean / norm


def identify_speaker(engines, profiles, samples):
    duration = len(samples) / SAMPLE_RATE
    base = {"speaker": "Unknown", "score": None,
            "identification": {"reason": "no_profiles", "candidate": None,
                "threshold": profiles.threshold, "min_margin": profiles.margin, "margin": None,
                "speech_seconds": round(duration, 3), "required_seconds": MIN_SPEECH_SECONDS}}
    if not profiles.list():
        return base
    if duration < MIN_SPEECH_SECONDS:
        base["identification"]["reason"] = "insufficient_speech"
        return base
    result = profiles.assess(engines.embed(samples))
    result["identification"].update(speech_seconds=round(duration, 3), required_seconds=MIN_SPEECH_SECONDS)
    return result


def identify_speaker_ranked(engines, profiles, samples, participant_ids):
    """Assign the closest participant; similarity remains uncalibrated evidence."""
    samples = np.asarray(samples)
    participants = tuple(participant_ids)
    result = {"speaker": "Unknown", "profile_id": None, "score": None,
              "assignment_source": "unassigned",
              "identification": {"reason": "no_participants", "confidence": "unavailable",
                  "speech_seconds": round(len(samples) / SAMPLE_RATE, 3) if samples.ndim else 0,
                  "candidate": None, "candidate_profile_id": None, "margin": None}}
    diagnostic = result["identification"]
    if not participants:
        return result
    if samples.ndim != 1 or not np.isfinite(samples).all():
        diagnostic["reason"] = "invalid_audio"
        return result
    if not samples.size or not np.any(samples):
        diagnostic["reason"] = "no_speech"
        return result
    try:
        embedding = engines.embed(samples)
    except (ValueError, RuntimeError) as exc:
        diagnostic.update(reason="embedding_unavailable", detail=str(exc))
        return result
    try:
        candidates = profiles.rank(embedding, participants)
    except ValueError as exc:
        diagnostic.update(reason="embedding_unavailable", detail=str(exc))
        return result
    if not candidates:
        diagnostic["reason"] = "no_compatible_profiles"
        return result
    best = candidates[0]
    result.update(best, assignment_source="automatic")
    diagnostic.update(reason="matched", confidence="low", candidate=best["speaker"],
                      candidate_profile_id=best["profile_id"],
                      margin=best["score"] - candidates[1]["score"] if len(candidates) > 1 else None)
    return result
