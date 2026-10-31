import copy

import pytest

from voice_split.transcript import transcript_turns


def row(text, start, end, **fields):
    return dict(text=text, start=start, end=end, speaker="Alex", profile_id="a",
                stream_id="recording", device_id="mic", **fields)


def test_continuing_speech_ignores_chunk_boundaries_and_keeps_originals():
    rows = [row("I think", 0, 1), row("we should", 1.1, 2), row("try tomorrow", 3, 4), row(".", 4, 4.1)]
    original = copy.deepcopy(rows)
    assert transcript_turns(rows) == [dict(start=0, end=4.1, speaker="Alex", text="I think we should try tomorrow.")]
    assert rows == original


@pytest.mark.parametrize("change", [dict(profile_id="b"), dict(stream_id="other"), dict(device_id="other"),
                                   dict(start=3), dict(start=-.1), dict(end=.8), dict(overlap=True)])
def test_real_boundaries_remain_separate(change):
    second = {**row("Next", 1.1, 2), **change}
    assert len(transcript_turns([row("First", 0, 1), second])) == 2


def test_unknowns_require_actual_shared_identity():
    first = {**row("First", 0, 1), "profile_id": None, "speaker": "Unknown"}
    second = {**first, "start": 1.1, "end": 2, "text": "Second"}
    assert len(transcript_turns([first, second])) == 2
    assert len(transcript_turns([{**first, "unknown_id": "u1"}, {**second, "unknown_id": "u1"}])) == 1
    assert len(transcript_turns([{**first, "unknown_id": "u1"}, {**second, "unknown_id": "u2"}])) == 2
    assert len(transcript_turns([{**first, "track_id": "t"}, {**second, "track_id": "t"}])) == 1
    assert len(transcript_turns([{**first, "track_id": "t"},
                               {**second, "track_id": "t", "speaker": "Updated label"}])) == 2
    assert len(transcript_turns([{**first, "track_id": "t", "stream_id": None},
                               {**second, "track_id": "t", "stream_id": None}])) == 2
