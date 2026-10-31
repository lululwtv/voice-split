import asyncio
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .audio import decode_audio
from .engines import AudioEngines
from .profiles import ProfileStore
from .rooms import RoomAudio, RoomStore
from .streaming import recognize_window
from .identification import enrollment_reference, identify_speaker, speech_samples
from .turns import identify_turns, identify_meeting_turns
from .streaming import recognize_window_ranked
from .core_rooms import CoreRoomStore, ConflictError
from .open_matching import MeetingMatcher
from .meeting_stream import MeetingStream
from .transcript import transcript_turns
from .summaries import generate_summary

VERSION = "0.3.0"
ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("VOICE_SPLIT_DATA_DIR", Path.home() / ".local/share/voice-split"))
DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
engines = AudioEngines(DATA)
profiles = ProfileStore(DATA)
meetings = RoomStore(DATA)
core_meetings = CoreRoomStore(DATA)
meeting_matcher = MeetingMatcher(engines, profiles, core_meetings)
active_rooms: dict[str, RoomAudio] = {}
loading = True
load_error = None
inference_lock = asyncio.Lock()
logger = logging.getLogger("voice-split")


async def load_models():
    global loading, load_error
    try:
        await asyncio.to_thread(engines.load)
        if not engines.status().get("ready"):
            load_error = "One or more local models failed to load. Check the engine details and restart after fixing the download."
    except Exception as error:
        load_error = str(error)
        logger.exception("Local model startup failed")
    finally:
        loading = False


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(load_models())
    yield
    task.cancel()
    for room in active_rooms.values():
        if room.timer:
            room.timer.cancel()
        if room.worker:
            room.worker.cancel()


app = FastAPI(title="voice-split", version=VERSION, lifespan=lifespan)


def same_origin(origin, host):
    return origin in {f"http://{host}", f"https://{host}"}


@app.middleware("http")
async def protect_local_data(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        from fastapi.responses import JSONResponse
        host = request.headers.get("host", "")
        if host.split(":")[0] not in {"127.0.0.1", "localhost"}:
            return JSONResponse({"detail": "This prototype is accessible through localhost only."}, status_code=403)
        origin = request.headers.get("origin")
        if origin and not same_origin(origin, host):
            return JSONResponse({"detail": "Cross-origin access is not allowed."}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def require_ready():
    if loading or load_error or not engines.status().get("ready"):
        raise HTTPException(503, "Local models are not ready yet. Wait for startup or check engine status.")


async def read_audio(file):
    raw = await file.read(20 * 1024 * 1024 + 1)
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(413, "Audio uploads must be smaller than 20 MB and at most 60 seconds.")
    try:
        return await asyncio.to_thread(decode_audio, raw)
    except (ValueError, RuntimeError) as error:
        raise HTTPException(422, str(error)) from error


def recognize(samples, start=0):
    rows = engines.transcribe(samples)
    result = []
    for row in rows:
        a, b = max(0, int(row["start"] * 16000)), min(len(samples), int(row["end"] * 16000))
        match = identify_speaker(engines, profiles, samples[a:b])
        result.append({"id": uuid.uuid4().hex, "start": start + row["start"], "end": start + row["end"],
                       "text": row["text"], "speaker": match["speaker"], "score": match["score"],
                       "identification": match["identification"]})
    return result


@app.get("/api/status")
def status():
    return {"ready": not loading and not load_error and engines.status().get("ready", False),
            "loading": loading, "error": load_error, "engines": engines.status(), "version": VERSION,
            "speaker_matching": {"profile_threshold": profiles.threshold,
                                 "meeting_threshold": meeting_matcher.threshold}}


@app.get("/api/profiles")
def list_profiles():
    return profiles.list()


def assess_voice(samples):
    """Test one speaker against saved profiles without creating meeting references."""
    participants = [profile["id"] for profile in profiles.list()]
    speech = speech_samples(samples, engines.transcribe(samples)) if participants else np.empty(0)
    result = meeting_matcher.assess_scores(speech, participants)
    if not participants:
        result["identification"]["reason"] = "no_profiles"
    elif not len(speech):
        result["identification"]["reason"] = "no_speech"
    if not result.get("profile_id"):
        result["speaker"] = "Unknown"
    return result


@app.post("/api/voice-test")
async def test_voice(file: UploadFile = File(...)):
    require_ready()
    samples = await read_audio(file)
    async with inference_lock:
        return await asyncio.to_thread(assess_voice, samples)


@app.post("/api/profiles")
async def enroll(name: str = Form(...), file: UploadFile = File(...)):
    require_ready()
    if not name.strip() or len(name.strip()) > 80:
        raise HTTPException(422, "Use a name between 1 and 80 characters.")
    samples = await read_audio(file)
    try:
        async with inference_lock:
            embedding = await asyncio.to_thread(enrollment_reference, engines, samples)
        return profiles.enroll(name, embedding)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@app.put("/api/profiles/{profile_id}")
async def replace_voice(profile_id: str, file: UploadFile = File(...)):
    require_ready()
    if not any(profile["id"] == profile_id for profile in profiles.list()):
        raise HTTPException(404, "Saved voice no longer exists. Refresh and enroll again.")
    samples = await read_audio(file)
    try:
        async with inference_lock:
            embedding = await asyncio.to_thread(enrollment_reference, engines, samples)
        return profiles.replace(profile_id, embedding)
    except KeyError as error:
        raise HTTPException(404, "Saved voice was removed before the replacement finished.") from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@app.delete("/api/profiles/{profile_id}")
def delete_profile(profile_id: str):
    profiles.delete(profile_id)
    return {"deleted": True}


@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...)):
    require_ready()
    samples = await read_audio(file)
    began = time.perf_counter()
    async with inference_lock:
        segments = await asyncio.to_thread(recognize, samples)
    return {"segments": segments, "processing_ms": round((time.perf_counter() - began) * 1000),
            "audio_seconds": len(samples) / 16000}


class NewRoom(BaseModel):
    title: str = Field(default="Untitled meeting", max_length=100)


@app.post("/api/rooms")
def create_room(body: NewRoom):
    return meetings.create(body.title)


@app.get("/api/rooms")
def list_rooms():
    return meetings.list()


def require_room(room_id):
    room = core_meetings.get(room_id)
    if not room:
        raise HTTPException(404, "Meeting not found.")
    return room


class RosterUpdate(BaseModel):
    participant_ids: list[str] = Field(max_length=100)
    expected_revision: int = Field(ge=0)


class SpeakerCorrection(BaseModel):
    profile_id: str = Field(min_length=1, max_length=80)
    expected_revision: int = Field(ge=0)
    idempotency_key: str = Field(min_length=1, max_length=100)


class VoiceName(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    expected_revision: int = Field(ge=0)


@app.put("/api/v2/rooms/{room_id}/segments/{segment_id}/voice-name")
async def name_unknown_voice(room_id: str, segment_id: str, body: VoiceName):
    require_room(room_id)
    try:
        segments = core_meetings.name_unknown(room_id, segment_id, body.name, body.expected_revision)
    except KeyError as error:
        raise HTTPException(404, "Transcript segment not found.") from error
    except ConflictError as error:
        raise HTTPException(409, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    if room := active_rooms.get(f"v2:{room_id}"):
        for segment in segments:
            await broadcast(room, {**segment, "type": "transcript"})
    return {"segments": segments}


@app.get("/api/v2/rooms/{room_id}/participants")
def get_participants(room_id: str):
    require_room(room_id)
    return core_meetings.roster(room_id)


@app.put("/api/v2/rooms/{room_id}/participants")
async def set_participants(room_id: str, body: RosterUpdate):
    require_room(room_id)
    known = {profile["id"] for profile in profiles.list()}
    if not set(body.participant_ids) <= known:
        raise HTTPException(422, "Choose participants with saved voices.")
    try:
        roster = core_meetings.set_roster(room_id, body.participant_ids, body.expected_revision)
    except ConflictError as error:
        raise HTTPException(409, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    if room := active_rooms.get(f"v2:{room_id}"):
        await broadcast(room, {"type": "participants", **roster})
    return roster


@app.get("/api/v2/rooms/{room_id}/segments")
def get_segments(room_id: str):
    require_room(room_id)
    segments = core_meetings.history(room_id)
    return {"segments": segments, **core_meetings.summary(room_id, segments)}


@app.post("/api/v2/rooms/{room_id}/summary")
async def summarize_meeting(room_id: str):
    room = require_room(room_id)
    segments = core_meetings.history(room_id)
    try:
        summary = await asyncio.to_thread(generate_summary, room["title"], segments)
        core_meetings.save_summary(room_id, segments, summary)
    except ConflictError as error:
        raise HTTPException(409, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(503, str(error)) from error
    return {"summary": summary, "relabelledSinceSummary": False}


@app.patch("/api/v2/rooms/{room_id}/segments/{segment_id}/speaker")
async def correct_speaker(room_id: str, segment_id: str, body: SpeakerCorrection):
    require_room(room_id)
    try:
        replay = core_meetings.correction_replay(room_id, segment_id, body.profile_id,
                                                body.expected_revision, body.idempotency_key)
    except ConflictError as error:
        raise HTTPException(409, str(error)) from error
    if replay is not None:
        return replay
    profile = next((item for item in profiles.list() if item["id"] == body.profile_id), None)
    if profile is None:
        raise HTTPException(422, "This saved voice is no longer available.")
    try:
        segment = core_meetings.correct(room_id, segment_id, profile, body.expected_revision, body.idempotency_key)
    except KeyError as error:
        raise HTTPException(404, "Transcript segment not found.") from error
    except ConflictError as error:
        raise HTTPException(409, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    for key in (room_id, f"v2:{room_id}"):
        if room := active_rooms.get(key):
            await broadcast(room, {**segment, "type": "transcript"})
    return segment


@app.get("/api/v2/rooms/{room_id}/export")
def export_meeting(room_id: str, format: str = "json"):
    room = require_room(room_id)
    segments = core_meetings.history(room_id)
    if format == "json":
        return {"room": room, "segments": segments, **core_meetings.summary(room_id, segments)}
    if format == "text":
        def timestamp(seconds):
            value = max(0, int(seconds))
            return f"{value // 60:02d}:{value % 60:02d}"
        lines = [room["title"]]
        for row in transcript_turns(segments):
            lines.append(f"[{timestamp(row.get('start', 0))} – {timestamp(row.get('end', 0))}] "
                         f"{row.get('speaker', 'Unknown')}\n{row['text']}")
        return PlainTextResponse("\n\n".join(lines))
    raise HTTPException(422, "Choose json or text export.")


def recognize_ranked(samples, participant_ids, room_id=None):
    rows = engines.transcribe(samples)
    if room_id:
        session = MeetingStream(meeting_matcher, room_id)
        turns = identify_meeting_turns(engines, profiles, samples, rows, participant_ids, session)
    else:
        turns = identify_turns(engines, profiles, samples, rows, participant_ids)
    return [{"id": uuid.uuid4().hex, "revision": 0, "learning_status": "unavailable", **turn}
            for turn in turns]


def persist_core_segment(room_id, row, *, live=False):
    # A roster can change while inference runs in a worker thread.
    eligible = set(core_meetings.roster(room_id)["participant_ids"]) & {p["id"] for p in profiles.list()}
    if row.get("profile_id") and row["profile_id"] not in eligible:
        row = {**row, "speaker": "Unknown", "profile_id": None, "score": None,
               "assignment_source": "unassigned",
               "identification": {"reason": "roster_changed", "confidence": "unavailable"}}
    event = {"type": "transcript", "room_id": room_id, "learning_status": "unavailable", **row}
    if live:
        return core_meetings.append_live(room_id, event)
    core_meetings.append(room_id, event)
    return core_meetings.get_segment(room_id, event["id"])


@app.post("/api/v2/rooms/{room_id}/transcribe")
async def transcribe_meeting(room_id: str, file: UploadFile = File(...)):
    require_room(room_id)
    require_ready()
    samples = await read_audio(file)
    began = time.perf_counter()
    async with inference_lock:
        roster = core_meetings.roster(room_id)["participant_ids"]
        rows = await asyncio.to_thread(recognize_ranked, samples, roster, room_id)
    events = [persist_core_segment(room_id, row) for row in rows]
    if room := active_rooms.get(f"v2:{room_id}"):
        for event in events:
            await broadcast(room, event)
    return {"segments": events, "processing_ms": round((time.perf_counter() - began) * 1000),
            "audio_seconds": len(samples) / 16000}


async def broadcast(room, event):
    for client in tuple(room.clients):
        try:
            await client.send_json(event)
        except (RuntimeError, WebSocketDisconnect, OSError):
            room.clients.discard(client)


async def process_room(room_id, room):
    while True:
        device, samples, start, final = await room.queue.get()
        try:
            async with inference_lock:
                if getattr(room, "core", False):
                    roster = core_meetings.roster(room_id)["participant_ids"]
                    if not getattr(room, "speaker_session", None) or (device is not None and room.last_device and device != room.last_device):
                        room.speaker_session = MeetingStream(meeting_matcher, room_id)
                        room.speaker_session.source_start = start
                    segments = await asyncio.to_thread(recognize_window_ranked, engines, profiles, room,
                                                       samples, start, final, participant_ids=roster,
                                                       session=room.speaker_session)
                    for track, identity in room.speaker_session.take_resolutions().items():
                        if identity.get("profile_id") and identity["profile_id"] not in {p["id"] for p in profiles.list()}:
                            continue
                        for revised in core_meetings.resolve_track(room_id, room.stream_id, track, identity):
                            await broadcast(room, revised)
                else:
                    segments = await asyncio.to_thread(recognize_window, engines, profiles, room, samples, start, final)
            room.last_device = device or room.last_device
            for row in segments:
                event = {"type": "transcript", "room_id": room_id, "device_id": room.last_device, **row}
                if getattr(room, "core", False):
                    event = persist_core_segment(room_id, {**event, "stream_id": room.stream_id}, live=True)
                else:
                    meetings.append(room_id, event)
                await broadcast(room, event)
        except Exception:
            room.context = np.empty(0, dtype=np.float32)
            room.speaker_session = None
            logger.exception("Room transcription failed")
            await broadcast(room, {"type": "error", "message": "This audio window could not be transcribed. Please retry."})
        finally:
            room.queue.task_done()


async def collect_window(room):
    try:
        await asyncio.sleep(0.12)
        room.take()
    except ValueError as error:
        await broadcast(room, {"type": "error", "message": str(error)})
    finally:
        if room.timer is asyncio.current_task():
            room.timer = None


async def flush_room(room):
    if room.timer:
        room.timer.cancel()
        room.timer = None
    while True:
        try:
            if not room.take(final=True):
                break
        except ValueError:
            await room.queue.join()
    if room.seconds:
        await room.queue.put((None, np.empty(0, dtype=np.float32), room.seconds, True))


@app.websocket("/api/rooms/{room_id}/audio")
async def room_audio(socket: WebSocket, room_id: str, device: str):
    await serve_room_audio(socket, room_id, device)


@app.websocket("/api/v2/rooms/{room_id}/audio")
async def core_room_audio(socket: WebSocket, room_id: str, device: str):
    await serve_room_audio(socket, room_id, device, core=True)


async def serve_room_audio(socket, room_id, device, core=False):
    host = socket.headers.get("host", "")
    if host.split(":")[0] not in {"localhost", "127.0.0.1"} or not same_origin(socket.headers.get("origin"), host):
        await socket.close(code=1008)
        return
    if not meetings.get(room_id) or not device or len(device) > 80:
        await socket.close(code=1008)
        return
    await socket.accept()
    if loading or load_error or not engines.status().get("ready"):
        await socket.send_json({"type": "error", "message": "Wait for local models to finish loading."})
        await socket.close(code=1013)
        return
    key = f"v2:{room_id}" if core else room_id
    store = core_meetings if core else meetings
    if key not in active_rooms:
        history = store.history(room_id)
        active_rooms[key] = RoomAudio(max((row.get("end", 0) for row in history), default=0),
                                     window_seconds=1.5 if core else 3)
        active_rooms[key].core = core
    room = active_rooms[key]
    if len(room.clients) >= 6:
        await socket.close(code=1008)
        return
    if device in room.devices:
        await socket.send_json({"type": "error", "message": "This microphone is already connected. Reload the page to create a new device identity."})
        await socket.close(code=1008)
        return
    room.clients.add(socket)
    room.devices.add(device)
    try:
        if not room.worker or room.worker.done():
            room.worker = asyncio.create_task(process_room(room_id, room))
        for row in store.history(room_id):
            await socket.send_json({**row, "type": "transcript"} if core else row)
        window_seconds = room.window_samples / 16000
        await socket.send_json({"type": "status", "message": f"Connected. Processing audio every {window_seconds:g} seconds; nearby words from the same speaker stay together."})
        while True:
            message = await socket.receive()
            if message["type"] == "websocket.disconnect":
                break
            if message.get("bytes") is not None:
                if room.add(device, message["bytes"]) and not room.timer:
                    room.timer = asyncio.create_task(collect_window(room))
            elif message.get("text"):
                if len(message["text"]) > 1024:
                    raise ValueError("Control messages are too large.")
                import json
                control = json.loads(message["text"])
                if not isinstance(control, dict):
                    raise ValueError("Control messages must be JSON objects.")
                if control.get("type") == "flush":
                    request_id = control.get("request_id")
                    if request_id is not None and (not isinstance(request_id, str) or len(request_id) > 80):
                        raise ValueError("Invalid flush request ID.")
                    await flush_room(room)
                    await socket.send_json({"type": "status", "message": "Audio received. Finishing queued transcription."})
                    if core:
                        await room.queue.join()
                        await socket.send_json({"type": "flushed", "request_id": request_id})
    except (ValueError, WebSocketDisconnect, OSError) as error:
        if isinstance(error, ValueError):
            await socket.send_json({"type": "error", "message": str(error)})
    finally:
        room.clients.discard(socket)
        room.devices.discard(device)
        if len(room.buffers.get(device, [])):
            await flush_room(room)
        elif not room.clients and room.seconds:
            await room.queue.put((None, np.empty(0, dtype=np.float32), room.seconds, True))
        room.buffers.pop(device, None)


@app.get("/")
def home():
    return FileResponse(ROOT / "static/index.html")


app.mount("/static", StaticFiles(directory=ROOT / "static", check_dir=False), name="frontend")
