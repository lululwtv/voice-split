import { useEffect, useRef, useState } from "react";
import { MicrophoneIcon, StopIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { audioErrorMessage, requestMic, stopStream, useLevel } from "../lib/audio";
import type { Person, Role } from "../types";

const SENTENCE = "Today I'm reading this short passage so the notes can recognise my voice, whether I speak quickly, slowly, or from across the room.";
const RECORD_SECONDS = 10;

export function Meter({ level }: { level: number }) {
  return (
    <span className="meter" role="img" aria-label="Sound level">
      <span style={{ transform: `scaleX(${level})` }} />
    </span>
  );
}

export function Enroll({ onAdd, onCancel }: { onAdd: (person: Person) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("room");
  const [clip, setClip] = useState<Blob | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const level = useLevel(stream);
  const clipUrl = useRef("");

  const stop = () => {
    clearInterval(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  useEffect(() => stop, []);

  const setNewClip = (blob: Blob) => {
    if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    clipUrl.current = URL.createObjectURL(blob);
    setClip(blob);
  };

  const record = async () => {
    setError("");
    try {
      const mic = await requestMic();
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(mic);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stopStream(mic);
        setStream(null);
        setNewClip(new Blob(chunks, { type: rec.mimeType }));
      };
      rec.start();
      recorder.current = rec;
      setStream(mic);
      setLeft(RECORD_SECONDS);
      let remaining = RECORD_SECONDS;
      timer.current = setInterval(() => {
        remaining -= 1;
        setLeft(remaining);
        if (remaining <= 0) stop();
      }, 1000);
    } catch (e) {
      setError(audioErrorMessage(e, "mic"));
    }
  };

  return (
    <form
      className="enroll"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !clip) return;
        onAdd({ id: crypto.randomUUID(), name: name.trim(), role, clip });
      }}
    >
      <div className="enroll-fields">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maya" />
        </label>
        <label>
          Joining
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="room">In the room</option>
            <option value="online">Online</option>
          </select>
        </label>
      </div>
      <blockquote className="script">{SENTENCE}</blockquote>
      {stream ? (
        <div className="recording">
          <Meter level={level} />
          <span>{left}s left</span>
          <button type="button" className="btn" onClick={stop}>
            <StopIcon weight="fill" /> Stop
          </button>
        </div>
      ) : (
        <div className="enroll-actions">
          <button type="button" className="btn" onClick={record}>
            <MicrophoneIcon /> {clip ? "Again" : "Record"}
          </button>
          <label className="btn">
            <UploadSimpleIcon /> Upload
            <input
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setNewClip(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      )}
      {clip && !stream && <audio controls src={clipUrl.current} aria-label="Play back the clip" />}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="enroll-submit">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <button className="btn primary" disabled={!name.trim() || !clip || !!stream}>Add</button>
      </div>
    </form>
  );
}
