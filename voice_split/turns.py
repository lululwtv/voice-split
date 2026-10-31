"""Approximate speaker turns from local evidence, independent of ASR rows."""

import math

from .audio import SAMPLE_RATE
from .identification import evidence_strength, identify_speaker_ranked, speech_samples
from .meeting_stream import FORWARD_SECONDS

PROBE_SECONDS = 1.0
PROBE_STRIDE = .5
TURN_GAP = 1.5


def identify_turns(engines, profiles, samples, rows, participant_ids, matcher=None):
    return _identify_turns(engines, profiles, samples, rows, participant_ids, matcher)


def identify_meeting_turns(engines, profiles, samples, rows, participant_ids, session, origin=0, lookahead=None):
    """`lookahead` rows are decoded but not yet emitted; they only extend forward evidence."""
    return _identify_turns(engines, profiles, samples, rows, participant_ids,
                           session=session, origin=origin, lookahead=lookahead)


def _words(rows, duration):
    words = []
    for row in rows:
        for word in row.get("words") or [{"start": row["start"], "end": row["end"],
                                         "word": " " + row.get("text", "")}]:
            start, end = word["start"], word["end"]
            if not math.isfinite(start) or not math.isfinite(end):
                continue
            start, end = max(0., start), min(duration, end)
            if end > start and word["word"].strip():
                words.append({"start": start, "end": end, "word": word["word"]})
    return sorted(words, key=lambda word: (word["start"], word["end"]))


def _forward_speech(words, start):
    """Spans of the next FORWARD_SECONDS of speech from `start`, skipping silence."""
    spans, seconds = [], 0.
    for word in words:
        if word["end"] <= start:
            continue
        spans.append({"start": max(word["start"], start), "end": word["end"]})
        seconds += spans[-1]["end"] - spans[-1]["start"]
        if seconds >= FORWARD_SECONDS:
            break
    return spans


def _identify_turns(engines, profiles, samples, rows, participant_ids, matcher=None, session=None, origin=0,
                    lookahead=None):
    """Return word-aligned turns with sample-relative timestamps and ranked matches.

    One embedding is shared by all words in each occupied half-second bin.
    These short local probes remain low-confidence evidence, not overlap detection.
    Rows lacking word timestamps can only be assigned as an indivisible span.
    """
    duration = len(samples) / SAMPLE_RATE
    words = _words(rows, duration)
    if not words:
        return []
    heard = words if lookahead is None else _words(lookahead, duration)
    lower, upper = words[0]["start"], max(word["end"] for word in words)
    centers = {}
    for word in words:
        midpoint = (word["start"] + word["end"]) / 2
        index = math.floor(midpoint / PROBE_STRIDE)
        total, count = centers.get(index, (0., 0))
        centers[index] = (total + midpoint, count + 1)
    probes, turns = {}, []
    for word in words:
        index = math.floor((word["start"] + word["end"]) / 2 / PROBE_STRIDE)
        if index not in probes:
            if session:
                local = [w for w in words if math.floor((w["start"] + w["end"]) / 2 / PROBE_STRIDE) == index]
                floor = max(-math.inf if session.until is None else session.until - origin,
                            -math.inf if session.source_start is None else session.source_start - origin)
                novel = [{**w, "start": max(w["start"], floor)} for w in local]
                speech = speech_samples(samples, novel)
                # Probe forward from the first novel word so earlier speakers never enter it.
                clip = speech_samples(samples, _forward_speech(heard, novel[0]["start"]))
                probes[index] = session.observe(clip, speech, origin + local[0]["start"],
                                                origin + max(w["end"] for w in local), participant_ids)
            else:
                total, count = centers[index]
                center = total / count
                a = max(lower, center - PROBE_SECONDS / 2)
                b = min(upper, center + PROBE_SECONDS / 2)
                clip = samples[int(a * SAMPLE_RATE):int(b * SAMPLE_RATE)]
                probes[index] = matcher(clip) if matcher else identify_speaker_ranked(engines, profiles, clip, participant_ids)
        match = probes[index]
        previous = turns[-1] if turns else None
        if previous and previous.get("track_id") == match.get("track_id") and previous["profile_id"] == match["profile_id"] and previous["speaker"] == match["speaker"] and word["start"] - previous["end"] <= TURN_GAP:
            previous["end"] = max(previous["end"], word["end"])
            previous["text"] += word["word"]
            # Keep the weakest local evidence instead of implying added confidence.
            if evidence_strength(match) < evidence_strength(previous):
                previous.update(match)
        else:
            turns.append({"start": word["start"], "end": word["end"],
                          "text": word["word"], **match})
    resolved = []
    for turn in turns:
        if (session and not turn.get("profile_id") and not turn.get("unknown_id")
                and turn.get("track_id") in session.resolutions):
            turn.update(session.resolutions[turn["track_id"]])
        previous = resolved[-1] if resolved else None
        identified = turn["profile_id"] or turn.get("unknown_id")
        # Pending words join only their own track; identified words join the same identity.
        if (session and previous and (identified or previous.get("track_id") == turn.get("track_id"))
                and previous["profile_id"] == turn["profile_id"]
                and previous.get("unknown_id") == turn.get("unknown_id")
                and turn["start"] - previous["end"] <= TURN_GAP):
            previous["end"] = max(previous["end"], turn["end"])
            previous["text"] += turn["text"]
        else:
            resolved.append(turn)
    for turn in resolved:
        turn["text"] = turn["text"].strip()
        turn["identification"] = {**turn["identification"],
            "probe_seconds": turn["identification"]["speech_seconds"],
            "speech_seconds": round(turn["end"] - turn["start"], 3)}
    return resolved
