import importlib
import io
import sys

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient


@pytest.fixture
def voice_test(tmp_path, monkeypatch):
    monkeypatch.setenv("VOICE_SPLIT_DATA_DIR", str(tmp_path))
    sys.modules.pop("voice_split.server", None)
    server = importlib.import_module("voice_split.server")
    monkeypatch.setattr(server, "loading", False)
    monkeypatch.setattr(server.engines, "status", lambda: {"ready": True})
    monkeypatch.setattr(server.engines, "transcribe", lambda audio: [{"start": .5, "end": 2.5}])
    monkeypatch.setattr(server.engines, "embed", lambda audio: np.array([1., 0., 0.]))
    buffer = io.BytesIO()
    sf.write(buffer, .1 * np.sin(np.arange(48000) * .1), 16000, format="WAV")
    client = TestClient(server.app, base_url="http://localhost")
    return server, client, {"file": ("test.wav", buffer.getvalue())}


def test_known_voice_and_unknown_do_not_save_any_data(voice_test, monkeypatch):
    server, client, files = voice_test
    profile = server.profiles.enroll("Alex", np.array([1., 0., 0.]))
    before = (server.DATA / "profiles.json").read_bytes()
    seen = []
    monkeypatch.setattr(server.engines, "embed", lambda audio: seen.append(len(audio)) or np.array([1., 0., 0.]))
    result = client.post("/api/voice-test", files=files).json()
    assert result["speaker"] == "Alex" and result["profile_id"] == profile["id"]
    assert result["identification"]["calibrated"] is False
    assert seen == [32000]  # Only the detected speech, not recording padding.
    assert result["scores"] == [{"profile_id": profile["id"], "speaker": "Alex", "score": 1.0}]
    monkeypatch.setattr(server.engines, "embed", lambda audio: np.array([0., 1., 0.]))
    rejected = client.post("/api/voice-test", files=files).json()
    assert rejected["speaker"] == "Unknown" and rejected["profile_id"] is None
    assert rejected["unknown_id"] is None
    assert rejected["scores"][0]["score"] == 0.0
    assert (server.DATA / "profiles.json").read_bytes() == before
    assert server.meetings.list() == []
    with server.core_meetings.connection() as db:
        assert db.execute("SELECT count(*) FROM unknown_voices").fetchone()[0] == 0


def test_ambiguous_voice_is_unknown(voice_test):
    server, client, files = voice_test
    server.profiles.enroll("Alex", np.array([1., 0., 0.]))
    server.profiles.enroll("Sam", np.array([1., .01, 0.]))
    result = client.post("/api/voice-test", files=files).json()
    assert result["speaker"] == "Unknown"
    assert result["identification"]["reason"] == "ambiguous"
    assert len(result["scores"]) == 2
    assert result["scores"][0]["score"] >= result["scores"][1]["score"]


def test_voice_test_lower_threshold_still_requires_candidate_gap(voice_test, monkeypatch):
    server, client, files = voice_test
    server.profiles.enroll("Alex", np.array([1., 0., 0.]))
    monkeypatch.setattr(server.engines, "embed", lambda audio: np.array([.36, np.sqrt(1 - .36**2), 0.]))
    result = client.post("/api/voice-test", files=files).json()
    assert result["speaker"] == "Alex"
    assert result["identification"]["threshold"] == .35
    server.profiles.enroll("Sam", np.array([1., .01, 0.]))
    assert client.post("/api/voice-test", files=files).json()["speaker"] == "Unknown"


def test_empty_profiles_and_no_speech_return_unknown(voice_test, monkeypatch):
    server, client, files = voice_test
    result = client.post("/api/voice-test", files=files).json()
    assert result["speaker"] == "Unknown"
    assert result["identification"]["reason"] == "no_profiles"
    server.profiles.enroll("Alex", np.array([1., 0., 0.]))
    monkeypatch.setattr(server.engines, "transcribe", lambda audio: [])
    result = client.post("/api/voice-test", files=files).json()
    assert result["speaker"] == "Unknown"
    assert result["identification"]["reason"] == "no_speech"
    assert result["scores"][0]["score"] is None


def test_voice_test_keeps_local_validation(voice_test, monkeypatch):
    server, client, files = voice_test
    assert client.post("/api/voice-test", files={"file": ("bad.wav", b"bad")}).status_code == 422
    assert client.post("/api/voice-test", files=files, headers={"Origin": "https://example.com"}).status_code == 403
    monkeypatch.setattr(server, "loading", True)
    assert client.post("/api/voice-test", files=files).status_code == 503
