from types import SimpleNamespace

import numpy as np

from voice_split.profiles import ProfileStore
from voice_split.streaming import recognize_window_ranked
from voice_split.turns import identify_turns


def speakers(tmp_path):
    profiles = ProfileStore(tmp_path)
    ids = [profiles.enroll(name, np.eye(2)[index])["id"]
           for index, name in enumerate(("Alice", "Bob"))]
    calls = []

    def embed(samples):
        calls.append(len(samples))
        return np.array([np.count_nonzero(samples > 0), np.count_nonzero(samples < 0)], dtype=float)

    return profiles, ids, calls, SimpleNamespace(embed=embed)


def row(words):
    return {"start": words[0][0], "end": words[-1][1],
            "words": [{"start": a, "end": b, "word": text} for a, b, text in words]}


def test_mixed_asr_row_splits_at_word_boundary_and_flushes_once(tmp_path):
    profiles, ids, calls, engines = speakers(tmp_path)
    samples = np.concatenate([np.ones(16000), -np.ones(32000)])
    engines.transcribe = lambda audio: [row([(0., .5, "Alice"), (.5, 1., " ends"),
        (1., 1.5, " Bob"), (1.5, 2.2, " starts"), (2.6, 3., " now")])]
    state = SimpleNamespace(context=np.empty(0), emitted_until=0.)
    result = recognize_window_ranked(engines, profiles, state, samples, 0., participant_ids=ids)
    assert [(turn["speaker"], turn["text"]) for turn in result] == [
        ("Alice", "Alice ends"), ("Bob", "Bob starts")]
    assert result[0]["end"] == result[1]["start"] == 1.
    engines.transcribe = lambda audio: [row([(len(audio) / 16000 - .4, len(audio) / 16000, " now")])]
    result += recognize_window_ranked(engines, profiles, state, np.empty(0), 3., True, ids)
    assert [(turn["speaker"], turn["text"]) for turn in result][-1] == ("Bob", "now")
    assert recognize_window_ranked(engines, profiles, state, np.empty(0), 3., True, ids) == []
    assert " ".join(turn["text"] for turn in result) == "Alice ends Bob starts now"


def test_turns_ignore_asr_row_boundaries_and_preserve_returning_speaker(tmp_path):
    profiles, ids, calls, engines = speakers(tmp_path)
    samples = np.concatenate([np.ones(16000), -np.ones(16000), np.ones(16000)])
    rows = [row([(0., .5, "Alice")]), row([(.5, 1., " ends"), (1., 1.5, " Bob"),
        (1.5, 2., " replies"), (2., 2.5, " Alice"), (2.5, 3., " returns")])]
    turns = identify_turns(engines, profiles, samples, rows, ids)
    assert [(turn["speaker"], turn["text"]) for turn in turns] == [
        ("Alice", "Alice ends"), ("Bob", "Bob replies"), ("Alice", "Alice returns")]
    assert all(turn["identification"]["confidence"] == "low" for turn in turns)


def test_probe_calls_are_bounded_by_audio_duration_not_word_count(tmp_path):
    profiles, ids, calls, engines = speakers(tmp_path)
    words = [(index / 100, (index + 1) / 100, " word") for index in range(300)]
    turns = identify_turns(engines, profiles, np.ones(48000), [row(words)], ids)
    assert len(calls) == 6
    assert max(calls) <= 16000
    assert len(turns) == 1
    assert len(turns[0]["text"].split()) == 300


def test_upload_rows_without_words_remain_available(tmp_path):
    profiles, ids, calls, engines = speakers(tmp_path)
    turns = identify_turns(engines, profiles, np.ones(16000),
        [{"start": 0., "end": 1., "text": "Hello"}], ids)
    assert turns[0]["text"] == "Hello"
    assert turns[0]["speaker"] == "Alice"


def test_held_back_tail_keeps_its_speaker_when_next_window_changes(tmp_path):
    profiles, ids, calls, engines = speakers(tmp_path)
    state = SimpleNamespace(context=np.empty(0), emitted_until=0.)
    samples = np.concatenate([np.ones(44800), -np.ones(3200)])
    engines.transcribe = lambda audio: [row([(0., 1., "Alice"), (1., 2., " speaks"),
                                            (2.4, 2.7, " still")])]
    result = recognize_window_ranked(engines, profiles, state, samples, 0., participant_ids=ids)
    engines.transcribe = lambda audio: [row([(0., 1., " speaks"),
        (1.4, 1.7, " still"), (2.1, 2.5, " Bob"), (2.5, 3., " starts")])]
    result += recognize_window_ranked(engines, profiles, state, -np.ones(48000), 3., participant_ids=ids)
    assert [(turn["speaker"], turn["text"]) for turn in result] == [
        ("Alice", "Alice speaks"), ("Alice", "still"), ("Bob", "Bob starts")]
    assert len(state.context) == 32000
