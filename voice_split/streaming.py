import uuid

import numpy as np
from .identification import identify_speaker
from .turns import identify_turns, identify_meeting_turns


def recognize_window(engines, profiles, state, samples, start, final=False):
    """Re-decode two seconds of context, emitting each stable word only once."""
    return _recognize_window(engines, state, samples, start, final,
                             lambda speech: identify_speaker(engines, profiles, speech))


def recognize_window_ranked(engines, profiles, state, samples, start, final=False, participant_ids=(), matcher=None, session=None):
    prefix = state.context
    audio = np.concatenate([prefix, samples])
    if not len(audio):
        return []
    origin = start - len(prefix) / 16000
    cutoff = start + len(samples) / 16000 - (0 if final else .75)
    stable = []
    emitted_until = state.emitted_until
    last_word = getattr(state, "last_word", None)
    decoded = engines.transcribe(audio)
    for row in decoded:
        # A word mostly before the emitted boundary is a re-decode, even if spelled differently.
        words = [word for word in row.get("words", [])
                 if origin + word["end"] > emitted_until + .02
                 and origin + (word["start"] + word["end"]) / 2 > emitted_until - .15
                 and origin + (word["start"] + word["end"]) / 2 <= cutoff]
        while words and last_word == words[0]["word"].casefold().strip(" .,!?;:\"'") and origin + words[0]["start"] < emitted_until:
            words.pop(0)
        if words:
            stable.append({**row, "words": words})
            emitted_until = max(emitted_until, origin + words[-1]["end"])
            last_word = words[-1]["word"].casefold().strip(" .,!?;:\"'")
    turns = (identify_meeting_turns(engines, profiles, audio, stable, participant_ids, session, origin, decoded)
             if session else identify_turns(engines, profiles, audio, stable, participant_ids, matcher))
    output = [{**turn, "id": uuid.uuid4().hex, "revision": 0,
               "start": max(0, origin + turn["start"]), "end": origin + turn["end"]}
              for turn in turns]
    state.emitted_until = emitted_until
    state.last_word = last_word
    state.context = audio[-32000:].copy()
    return output


def _recognize_window(engines, state, samples, start, final, identify, ranked=False):
    prefix = state.context
    audio = np.concatenate([prefix, samples])
    if not len(audio):
        return []
    origin = start - len(prefix) / 16000
    cutoff = start + len(samples) / 16000 - (0 if final else .75)
    rows = engines.transcribe(audio)
    output = []
    for row in rows:
        words = [word for word in row.get("words", [])
                 if origin + word["end"] > state.emitted_until + .02
                 and origin + (word["start"] + word["end"]) / 2 <= cutoff]
        while words and getattr(state, "last_word", None) == words[0]["word"].casefold().strip(" .,!?;:\"'") and origin + words[0]["start"] < state.emitted_until:
            words.pop(0)
        if not words:
            continue
        text = "".join(word["word"] for word in words).strip()
        if not text:
            continue
        a = max(0, int((words[0]["start"] if ranked else row["start"]) * 16000))
        b = min(len(audio), int((words[-1]["end"] if ranked else row["end"]) * 16000))
        match = identify(audio[a:b])
        end = origin + words[-1]["end"]
        output.append({"id": uuid.uuid4().hex, "start": max(0, origin + words[0]["start"]),
                       "end": end, "text": text, "speaker": match["speaker"], "score": match["score"],
                       "identification": match["identification"]})
        if ranked:
            output[-1].update(profile_id=match["profile_id"],
                              assignment_source=match["assignment_source"], revision=0)
        state.emitted_until = max(state.emitted_until, end)
        state.last_word = words[-1]["word"].casefold().strip(" .,!?;:\"'")
    state.context = audio[-32000:].copy()
    return output
