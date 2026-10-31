import json

import numpy as np
import pytest

from voice_split.rooms import MAX_DEVICES, WINDOW_SAMPLES, RoomAudio, RoomStore


def feed(room, device, volume, seconds=3):
    frame = np.full(4000, int(volume * 32767), dtype="<i2").tobytes()
    for _ in range(seconds * 4):
        room.add(device, frame)


def test_room_selects_one_microphone_and_drains_duplicates():
    room = RoomAudio()
    feed(room, "quiet", .1)
    feed(room, "clear", .6)
    device, samples, start = room.take()
    assert device == "clear"
    assert len(samples) == WINDOW_SAMPLES
    assert start == 0
    assert all(len(buffer) == 0 for buffer in room.buffers.values())
    assert room.take() is None


def test_invalid_frames_and_backlog_do_not_mutate_pending_audio():
    room = RoomAudio()
    with pytest.raises(ValueError):
        room.add("device", b"x")
    feed(room, "device", .2)
    for _ in range(8):
        room.queue.put_nowait(None)
    with pytest.raises(ValueError):
        room.take()
    assert len(room.buffers["device"]) == WINDOW_SAMPLES
    assert room.seconds == 0


def test_profiles_are_not_required_for_room_persistence(tmp_path):
    store = RoomStore(tmp_path)
    room = store.create("Planning")
    row = {"id": "segment-a", "speaker": "Unknown", "text": "Hello"}
    store.append(room["id"], row)
    reopened = RoomStore(tmp_path)
    assert reopened.get(room["id"]) == room
    assert reopened.history(room["id"]) == [row]
    assert reopened.history("missing") == []


def test_resume_clock_and_disconnect_tail_are_retained():
    room = RoomAudio(start_seconds=12.5)
    feed(room, "device", .2, seconds=1)
    assert room.take() is None
    device, samples, start = room.take(final=True)
    assert device == "device"
    assert len(samples) == 16000
    assert start == 12.5
    assert room.seconds == 13.5


def test_shorter_windows_emit_early_and_keep_every_sample():
    room = RoomAudio(window_seconds=1.5)
    frame = np.arange(4000, dtype="<i2").tobytes()
    for _ in range(5):
        assert not room.add("mic", frame)
    assert room.add("mic", frame)
    first = room.take()
    assert len(first[1]) == 24000
    assert first[2] == 0
    room.add("mic", frame)
    final = room.take(final=True)
    assert final[2] == 1.5
    assert len(final[1]) == 4000
    assert room.seconds == 1.75
