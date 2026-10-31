"""Approximate speaker turns from local evidence, independent of ASR rows."""

import math

from .audio import SAMPLE_RATE
from .identification import evidence_strength, identify_speaker_ranked

PROBE_SECONDS = 1.0
PROBE_STRIDE = .5
TURN_GAP = 1.5


def identify_turns(engines, profiles, samples, rows, participant_ids, matcher=None):
    """Return word-aligned turns with sample-relative timestamps and ranked matches.

    One embedding is shared by all words in each occupied half-second bin.
    These short local probes remain low-confidence evidence, not overlap detection.
    Rows lacking word timestamps can only be assigned as an indivisible span.
    """
    words = []
    duration = len(samples) / SAMPLE_RATE
    for row in rows:
        for word in row.get("words") or [{"start": row["start"], "end": row["end"],
                                         "word": " " + row.get("text", "")}]:
            start, end = word["start"], word["end"]
            if not math.isfinite(start) or not math.isfinite(end):
                continue
            start, end = max(0., start), min(duration, end)
            if end > start and word["word"].strip():
                words.append({"start": start, "end": end, "word": word["word"]})
    if not words:
        return []
    words.sort(key=lambda word: (word["start"], word["end"]))
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
            total, count = centers[index]
            center = total / count
            a = max(lower, center - PROBE_SECONDS / 2)
            b = min(upper, center + PROBE_SECONDS / 2)
            clip = samples[int(a * SAMPLE_RATE):int(b * SAMPLE_RATE)]
            probes[index] = matcher(clip) if matcher else identify_speaker_ranked(engines, profiles, clip, participant_ids)
        match = probes[index]
        previous = turns[-1] if turns else None
        if previous and previous["profile_id"] == match["profile_id"] and previous["speaker"] == match["speaker"] and word["start"] - previous["end"] <= TURN_GAP:
            previous["end"] = max(previous["end"], word["end"])
            previous["text"] += word["word"]
            # Keep the weakest local evidence instead of implying added confidence.
            if evidence_strength(match) < evidence_strength(previous):
                previous.update(match)
        else:
            turns.append({"start": word["start"], "end": word["end"],
                          "text": word["word"], **match})
    for turn in turns:
        turn["text"] = turn["text"].strip()
        turn["identification"] = {**turn["identification"],
            "probe_seconds": turn["identification"]["speech_seconds"],
            "speech_seconds": round(turn["end"] - turn["start"], 3)}
    return turns
