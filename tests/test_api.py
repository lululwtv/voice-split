import io
import asyncio
import importlib
import re
import sys

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient


def test_failed_window_clears_context_before_next_audio(monkeypatch, tmp_path):
    monkeypatch.setenv("VOICE_SPLIT_DATA_DIR", str(tmp_path))
    server=importlib.import_module("voice_split.server")
    def fail(*args):
        raise RuntimeError("inference failed")
    monkeypatch.setattr(server,"recognize_window",fail)
    async def check():
        room=server.RoomAudio()
        room.context=np.ones(32000,dtype=np.float32)
        room.queue.put_nowait(("device",np.ones(48000,dtype=np.float32),3.,False))
        worker=asyncio.create_task(server.process_room("test",room))
        await asyncio.wait_for(room.queue.join(),timeout=5)
        assert room.context.size==0
        worker.cancel()
        try:
            await worker
        except asyncio.CancelledError:
            pass
    asyncio.run(check())


def test_local_api_and_audio_contract(tmp_path, monkeypatch):
    monkeypatch.setenv("VOICE_SPLIT_DATA_DIR", str(tmp_path))
    sys.modules.pop("voice_split.server", None)
    server = importlib.import_module("voice_split.server")
    monkeypatch.setattr(server.engines, "load", lambda: None)
    monkeypatch.setattr(server.engines, "status", lambda: {"ready": True})
    monkeypatch.setattr(server.engines, "transcribe", lambda samples: [{"start": 0, "end": 3, "text": "Hello meeting"}])
    monkeypatch.setattr(server.engines, "embed", lambda samples: np.array([1., 0., 0.]))
    audio = io.BytesIO()
    samples = (.08 * np.sin(np.arange(48000) * .1)).astype(np.float32)
    sf.write(audio, samples, 16000, format="WAV")
    with TestClient(server.app, base_url="http://localhost") as client:
        import time
        for _ in range(100):
            if not client.get("/api/status").json()["loading"]:
                break
            time.sleep(.01)
        page = client.get("/")
        assert page.status_code == 200
        scripts = re.findall(r'src="(/static/[^\"]+\.js)"', page.text)
        assert scripts, "Build the frontend before running the API tests."
        assert all(client.get(script).status_code == 200 for script in scripts)
        assert client.get("/static/pcm-worklet.js").status_code == 200
        assert client.get("/api/profiles", headers={"Origin": "https://untrusted.example"}).status_code == 403
        assert client.post("/api/rooms", json={"title": "Test room"}, headers={"Host": "untrusted.example"}).status_code == 403
        enrolled = client.post("/api/profiles", data={"name": "Sample speaker"}, files={"file": ("sample.wav", audio.getvalue())})
        assert enrolled.status_code == 200, enrolled.text
        profile = enrolled.json()
        profile_path = tmp_path / "profiles.json"
        before = profile_path.read_bytes()
        replacement_url = "/api/profiles/" + profile["id"]
        assert client.put(replacement_url, files={"file": ("bad.wav", b"invalid")}).status_code == 422
        assert profile_path.read_bytes() == before
        monkeypatch.setattr(server.engines, "embed", lambda samples: np.array([0., 1., 0.]))
        replaced = client.put(replacement_url, files={"file": ("sample.wav", audio.getvalue())})
        assert replaced.status_code == 200, replaced.text
        assert replaced.json() == profile
        assert server.profiles.match(np.array([0., 1., 0.]))["profile_id"] == profile["id"]
        assert server.profiles.match(np.array([1., 0., 0.]))["speaker"] == "Unknown"
        result = client.post("/api/transcribe", files={"file": ("sample.wav", audio.getvalue())})
        assert result.status_code == 200
        assert result.json()["segments"][0]["speaker"] == "Sample speaker"
        assert client.post("/api/transcribe", files={"file": ("bad.wav", b"invalid")}).status_code == 422
        room = client.post("/api/rooms", json={"title": "Weekly sync"}).json()
        assert room["id"] in [item["id"] for item in client.get("/api/rooms").json()]
        assert client.delete("/api/profiles/" + enrolled.json()["id"]).status_code == 200
        assert client.put(replacement_url, files={"file": ("sample.wav", audio.getvalue())}).status_code == 404
        assert client.get("/api/profiles").json() == []
