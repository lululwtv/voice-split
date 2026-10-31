import asyncio
import json
import sqlite3
import time
import uuid
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000
WINDOW_SAMPLES = 3 * SAMPLE_RATE
MAX_DEVICES = 6


class RoomStore:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "meetings.sqlite3"
        with self.connection() as db:
            db.execute("CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, title TEXT, created REAL)")
            db.execute("CREATE TABLE IF NOT EXISTS segments (id TEXT PRIMARY KEY, room_id TEXT, payload TEXT)")

    def connection(self):
        return sqlite3.connect(self.path)

    def create(self, title: str):
        room = {"id": uuid.uuid4().hex, "title": title.strip() or "Untitled meeting"}
        with self.connection() as db:
            db.execute("INSERT INTO rooms VALUES (?, ?, ?)", (room["id"], room["title"], time.time()))
        return room

    def list(self):
        with self.connection() as db:
            return [{"id": row[0], "title": row[1]} for row in db.execute("SELECT id,title FROM rooms ORDER BY created DESC LIMIT 100")]

    def get(self, room_id):
        with self.connection() as db:
            row = db.execute("SELECT id,title FROM rooms WHERE id=?", (room_id,)).fetchone()
        return {"id": row[0], "title": row[1]} if row else None

    def append(self, room_id, segment):
        with self.connection() as db:
            db.execute("INSERT INTO segments VALUES (?, ?, ?)", (segment["id"], room_id, json.dumps(segment)))

    def history(self, room_id):
        with self.connection() as db:
            rows = db.execute("SELECT payload FROM segments WHERE room_id=? ORDER BY rowid DESC LIMIT 1000", (room_id,)).fetchall()
        return [json.loads(row[0]) for row in reversed(rows)]


class RoomAudio:
    """Select one microphone per coarse window; never sum duplicate room audio."""

    def __init__(self, start_seconds=0.0, *, window_seconds=3):
        self.window_samples = int(window_seconds * SAMPLE_RATE)
        if not 0 < self.window_samples <= WINDOW_SAMPLES:
            raise ValueError("Audio windows must be between zero and three seconds.")
        self.stream_id = uuid.uuid4().hex
        self.buffers: dict[str, np.ndarray] = {}
        self.clients = set()
        self.queue = asyncio.Queue(maxsize=8)
        self.worker = None
        self.timer = None
        self.seconds = start_seconds
        self.devices = set()
        self.context = np.empty(0, dtype=np.float32)
        self.emitted_until = start_seconds
        self.last_device = None

    def add(self, device, payload):
        if len(payload) > SAMPLE_RATE * 2 or len(payload) % 2:
            raise ValueError("Audio frames must be at most one second of signed 16-bit mono PCM at 16 kHz.")
        if device not in self.buffers and len(self.buffers) >= MAX_DEVICES:
            raise ValueError("This local room supports at most six microphones.")
        samples = np.frombuffer(payload, dtype="<i2").astype(np.float32) / 32768
        old = self.buffers.get(device, np.empty(0, dtype=np.float32))
        if len(old) + len(samples) > WINDOW_SAMPLES * 2:
            raise ValueError("Audio is arriving faster than it can be processed. Stop and retry with fewer microphones.")
        self.buffers[device] = np.concatenate([old, samples])
        return any(len(buffer) >= self.window_samples for buffer in self.buffers.values())

    def take(self, final=False):
        candidates = {device: buffer[:self.window_samples] for device, buffer in self.buffers.items()
                      if len(buffer) >= (1 if final else self.window_samples)}
        if not candidates:
            return None
        device = max(candidates, key=lambda name: float(np.mean(candidates[name] ** 2)))
        samples = candidates[device]
        if self.queue.full():
            raise ValueError("Transcription backlog is full. Stop recording and let queued audio finish.")
        start = self.seconds
        self.seconds += len(samples) / SAMPLE_RATE
        for key, buffer in self.buffers.items():
            self.buffers[key] = buffer[min(len(buffer), len(samples)):]
        job = (device, samples, start)
        complete = final and all(not len(buffer) for buffer in self.buffers.values())
        self.queue.put_nowait((*job, complete))
        return job
