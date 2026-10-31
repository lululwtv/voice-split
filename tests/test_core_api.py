import asyncio
import importlib
import io
import sys
import time

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient


@pytest.fixture
def core_client(tmp_path, monkeypatch):
    monkeypatch.setenv("VOICE_SPLIT_DATA_DIR", str(tmp_path))
    sys.modules.pop("voice_split.server", None)
    server = importlib.import_module("voice_split.server")
    monkeypatch.setattr(server.engines, "load", lambda: None)
    monkeypatch.setattr(server.engines, "status", lambda: {"ready": True})
    monkeypatch.setattr(server.engines, "transcribe", lambda audio: [
        {"start": 0, "end": .25, "text": "Brief speech", "words": [
            {"start": 0, "end": .25, "word": "Brief speech"}]}])
    monkeypatch.setattr(server.engines, "embed", lambda audio: np.array([.6, .8]))
    first = server.profiles.enroll("Alex", np.array([1., 0.]))
    second = server.profiles.enroll("Sam", np.array([0., 1.]))
    audio = io.BytesIO()
    sf.write(audio, .1 * np.sin(np.arange(16000) * .1), 16000, format="WAV")
    with TestClient(server.app, base_url="http://localhost") as client:
        for _ in range(100):
            if not client.get("/api/status").json()["loading"]:
                break
            time.sleep(.01)
        room = client.post("/api/rooms", json={"title": "Core test"}).json()
        yield client, server, room["id"], first, second, audio.getvalue()


def test_name_unknown_api(core_client):
    client, server, room, _, _, _ = core_client
    for identity in ("one", "two"):
        server.core_meetings.append(room, {"id": identity, "start": 0, "end": 1,
            "text": "Hello", "unknown_id": "u1", "speaker": "Unknown speaker 1"})
    base = f"/api/v2/rooms/{room}"
    url = base + "/segments/one/voice-name"
    assert client.put(url, json={"name": "   ", "expected_revision": 0}).status_code == 422
    result = client.put(url, json={"name": "Jamie", "expected_revision": 0})
    assert result.status_code == 200
    assert [s["speaker"] for s in result.json()["segments"]] == ["Jamie", "Jamie"]
    assert client.put(url, json={"name": "Wrong", "expected_revision": 0}).status_code == 409
    assert client.get(base + "/segments").json() == result.json()
    assert "Jamie" in client.get(base + "/export?format=text").text


def test_summary_persistence_export_staleness_and_failures(core_client, monkeypatch):
    client, server, room, _, _, _ = core_client
    base = f"/api/v2/rooms/{room}"
    summary = {"overview": "Launch discussed.", "actions": [], "decisions": [], "questions": []}
    server.core_meetings.append(room, {"id": "line", "start": 0, "end": 1, "text": "Launch Friday"})
    monkeypatch.setattr(server, "generate_summary", lambda *args: summary)
    assert client.post(base + "/summary").json() == {"summary": summary, "relabelledSinceSummary": False}
    from voice_split.core_rooms import CoreRoomStore
    reopened = CoreRoomStore(server.DATA)
    assert reopened.summary(room, reopened.history(room))["summary"] == summary
    assert client.get(base + "/segments").json()["summary"] == summary
    assert client.get(base + "/export").json()["summary"] == summary
    server.core_meetings.update_automatic(room, "line", {"speaker": "Changed"}, 0)
    assert client.get(base + "/segments").json()["relabelledSinceSummary"] is True
    def fail(*args):
        raise RuntimeError("Anthropic unavailable")
    monkeypatch.setattr(server, "generate_summary", fail)
    assert client.post(base + "/summary").status_code == 503
    assert client.get(base + "/segments").json()["summary"] == summary
    def changed(*args):
        server.core_meetings.update_automatic(room, "line", {"text": "New text"}, 1)
        return summary
    monkeypatch.setattr(server, "generate_summary", changed)
    assert client.post(base + "/summary").status_code == 409
    assert client.post("/api/v2/rooms/missing/summary").status_code == 404


def test_short_match_correction_reload_export_and_conflicts(core_client, monkeypatch):
    client, server, room, first, second, audio = core_client
    monkeypatch.setattr(server.engines, "embed", lambda audio: np.array([.8, .6]))
    base = f"/api/v2/rooms/{room}"
    assert client.get(base + "/participants").json() == {"participant_ids": [], "revision": 0}
    roster = client.put(base + "/participants", json={
        "participant_ids": [first["id"]], "expected_revision": 0})
    assert roster.status_code == 200, roster.text
    result = client.post(base + "/transcribe", files={"file": ("short.wav", audio)})
    assert result.status_code == 200, result.text
    row = result.json()["segments"][0]
    assert row["profile_id"] == first["id"]
    assert row["score"] == pytest.approx(.8)
    assert row["identification"]["confidence"] == "medium"
    url = base + f"/segments/{row['id']}/speaker"
    correction = {"profile_id": second["id"], "expected_revision": 0, "idempotency_key": "edit-1"}
    assert client.patch(url, json=correction).status_code == 422
    assert client.put(base + "/participants", json={"participant_ids": [first["id"], second["id"]],
                                                      "expected_revision": 1}).status_code == 200
    corrected = client.patch(url, json=correction)
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["speaker"] == "Sam"
    assert corrected.json()["assignment_source"] == "manual"
    assert corrected.json()["learning_status"] == "unavailable"
    assert client.patch(url, json=correction).json() == corrected.json()
    server.profiles.enroll("Sam", np.array([0., 1.]))
    assert client.patch(url, json=correction).json() == corrected.json()
    server.profiles.delete(second["id"])
    assert client.patch(url, json=correction).json() == corrected.json()
    assert client.patch(url, json={**correction, "profile_id": first["id"],
                                   "idempotency_key": "stale-edit"}).status_code == 409
    history = client.get(base + "/segments").json()["segments"]
    assert history == [corrected.json()]
    assert client.get(base + "/export?format=json").json()["segments"] == history
    assert "Sam\nBrief speech" in client.get(base + "/export?format=text").text
    assert server.core_meetings.update_automatic(room, row["id"], {"speaker": "Alex"}, 1) is None
    # Corrections and export work even if the inference model goes offline.
    server.load_error = "Model unavailable"
    assert client.patch(url, json={"profile_id": first["id"], "expected_revision": 1,
                                   "idempotency_key": "edit-2"}).status_code == 200
    assert "Alex" in client.get(base + "/export?format=text").text
    assert client.get(base + "/segments", headers={"Origin": "https://untrusted.example"}).status_code == 403


def test_roster_validation_and_cross_room_correction(core_client):
    client, server, room, first, second, audio = core_client
    base = f"/api/v2/rooms/{room}"
    assert client.put(base + "/participants", json={"participant_ids": ["missing"],
                                                      "expected_revision": 0}).status_code == 422
    assert client.put(base + "/participants", json={"participant_ids": [first["id"], first["id"]],
                                                      "expected_revision": 0}).status_code == 422
    assert client.put(base + "/participants", json={"participant_ids": [],
                                                      "expected_revision": 7}).status_code == 409
    row = client.post(base + "/transcribe", files={"file": ("short.wav", audio)}).json()["segments"][0]
    assert row["assignment_source"] == "unassigned"
    other = client.post("/api/rooms", json={"title": "Other"}).json()["id"]
    response = client.patch(f"/api/v2/rooms/{other}/segments/{row['id']}/speaker", json={
        "profile_id": first["id"], "expected_revision": 0, "idempotency_key": "wrong-room"})
    assert response.status_code == 404


def test_unknown_labels_survive_uploads_and_export(core_client, monkeypatch):
    client, server, room, first, second, audio = core_client
    base = f"/api/v2/rooms/{room}"
    # Durable unknown identities now require accumulated speech, not the .25s fixture.
    monkeypatch.setattr(server.engines, "transcribe", lambda samples: [
        {"start": 0, "end": 3, "text": "Longer speech", "words": [
            {"start": 0, "end": 3, "word": "Longer speech"}]}])
    recording = io.BytesIO()
    sf.write(recording, .1 * np.sin(np.arange(48000) * .1), 16000, format="WAV")
    audio = recording.getvalue()
    def upload():
        return client.post(base + "/transcribe", files={"file": ("voice.wav", audio)}).json()["segments"][0]
    one, again = upload(), upload()
    assert one["speaker"] == again["speaker"] == "Unknown speaker 1"
    assert one["profile_id"] is None
    monkeypatch.setattr(server.engines, "embed", lambda audio: np.array([-.8, .6]))
    two = upload()
    assert two["speaker"] == "Unknown speaker 2"
    assert "Unknown speaker 2" in client.get(base + "/export?format=text").text
    client.put(base + "/participants", json={"participant_ids": [first["id"]], "expected_revision": 0})
    fixed = client.patch(base + f"/segments/{one['id']}/speaker", json={
        "profile_id": first["id"], "expected_revision": 0, "idempotency_key": "name-unknown"}).json()
    assert fixed["speaker"] == "Alex" and fixed["unknown_id"] is None


def test_upload_splits_two_speakers_inside_one_asr_row(core_client, monkeypatch):
    client, server, room, first, second, audio = core_client
    base = f"/api/v2/rooms/{room}"
    client.put(base + "/participants", json={"participant_ids": [first["id"], second["id"]],
                                              "expected_revision": 0})
    monkeypatch.setattr(server.engines, "transcribe", lambda samples: [{
        "start": 0, "end": 3, "text": "One two three four", "words": [
            {"start": 0, "end": .5, "word": " One"},
            {"start": .5, "end": 1, "word": " two"},
            {"start": 1, "end": 2, "word": " three"},
            {"start": 2, "end": 3, "word": " four"}]}])
    monkeypatch.setattr(server.engines, "embed", lambda samples: np.array([
        np.count_nonzero(samples > 0), np.count_nonzero(samples < 0)], dtype=float))
    recording = io.BytesIO()
    sf.write(recording, np.concatenate([np.full(16000, .1), np.full(32000, -.1)]),
             16000, format="WAV")
    result = client.post(base + "/transcribe", files={"file": ("turns.wav", recording.getvalue())})
    assert result.status_code == 200, result.text
    rows = result.json()["segments"]
    assert [(row["speaker"], row["text"]) for row in rows] == [("Alex", "One two"), ("Sam", "three four")]
    assert client.get(base + "/segments").json()["segments"] == rows


def test_final_flush_keeps_the_existing_microphone_session(core_client, monkeypatch):
    client, server, room_id, _, _, _ = core_client
    room = server.RoomAudio()
    room.core, room.last_device = True, "microphone"
    session = server.MeetingStream(server.meeting_matcher, room_id)
    room.speaker_session = session
    seen = []
    def recognize(*args, **kwargs):
        seen.append(kwargs["session"])
        return []
    monkeypatch.setattr(server, "recognize_window_ranked", recognize)
    async def flush():
        await room.queue.put((None, np.empty(0), 3., True))
        worker = asyncio.create_task(server.process_room(room_id, room))
        await room.queue.join()
        worker.cancel()
        try:
            await worker
        except asyncio.CancelledError:
            pass
    asyncio.run(flush())
    assert seen == [session]


def test_live_short_matching_and_correction_broadcast(core_client):
    client, server, room, first, second, audio = core_client
    base = f"/api/v2/rooms/{room}"
    client.put(base + "/participants", json={"participant_ids": [first["id"], second["id"]],
                                              "expected_revision": 0})
    with client.websocket_connect("ws://localhost" + base + "/audio?device=test-device", headers={"Origin": "http://localhost"}) as ws:
        assert ws.receive_json()["type"] == "status"
        ws.send_bytes((3000 * np.sin(np.arange(16000) * .1)).astype("<i2").tobytes())
        ws.send_json({"type": "flush", "request_id": "finish-1"})
        while True:
            row = ws.receive_json()
            if row["type"] == "transcript":
                break
        assert row["profile_id"] == second["id"]
        assert ws.receive_json() == {"type": "flushed", "request_id": "finish-1"}
        response = client.patch(base + f"/segments/{row['id']}/speaker", json={
            "profile_id": first["id"], "expected_revision": 0, "idempotency_key": "live-edit"})
        assert response.status_code == 200, response.text
        while True:
            changed = ws.receive_json()
            if changed["type"] == "transcript":
                break
        assert changed["assignment_source"] == "manual"
        assert changed["speaker"] == "Alex"


def test_live_windows_emit_at_one_and_half_seconds_and_extend_same_turn(core_client, monkeypatch):
    client, server, room, first, second, audio = core_client
    monkeypatch.setattr(server.engines, "embed", lambda audio: np.array([.8, .6]))
    base = f"/api/v2/rooms/{room}"
    client.put(base + "/participants", json={"participant_ids": [first["id"]], "expected_revision": 0})
    calls = []

    def transcribe(samples):
        calls.append(len(samples))
        start, end, text = (0, .5, "Hello") if len(calls) == 1 else (.5, 1.1, " again")
        return [{"start": start, "end": end, "text": text,
                 "words": [{"start": start, "end": end, "word": text}]}]

    monkeypatch.setattr(server.engines, "transcribe", transcribe)
    frame = (3000 * np.sin(np.arange(8000) * .1)).astype("<i2").tobytes()
    with client.websocket_connect("ws://localhost" + base + "/audio?device=test", headers={"Origin": "http://localhost"}) as ws:
        assert "1.5 seconds" in ws.receive_json()["message"]
        for _ in range(3):
            ws.send_bytes(frame)
        first_row = ws.receive_json()
        assert first_row["type"] == "transcript"
        assert calls[0] == 24000
        for _ in range(3):
            ws.send_bytes(frame)
        continued = ws.receive_json()
        assert continued["id"] == first_row["id"]
        assert continued["revision"] == 1
        assert continued["text"] == "Hello again"
        assert len(client.get(base + "/segments").json()["segments"]) == 1
