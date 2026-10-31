import { useEffect, useRef, useState } from "react";
import { MicrophoneIcon, StopIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { audioErrorMessage, requestMic, stopStream, useLevel } from "../lib/audio";
import type { Person, Role } from "../types";

const SENTENCE = "Um, yeah, I see what you mean.\nUh, I mean, we could try something different tomorrow.\nHmm, okay, you know, let’s check the results on Friday.";
const RECORD_SECONDS = 45;

export function Meter({ level }: { level: number }) {
  return (
    <span className="meter" role="img" aria-label="Sound level">
      <span style={{ transform: `scaleX(${level})` }} />
    </span>
  );
}

export function Enroll({ onAdd, onCancel, initialPerson }: { onAdd: (person: Person) => Promise<void>; onCancel?: () => void; initialPerson?: Person }) {
  const [name, setName] = useState(initialPerson?.name ?? "");
  const [role, setRole] = useState<Role>("room");
  const [clip, setClip] = useState<Blob | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const active = useRef(true);
  const microphone = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const level = useLevel(stream);
  const clipUrl = useRef("");

  const stop = () => {
    clearInterval(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      stop(); stopStream(microphone.current);
      if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    };
  }, []);

  const setNewClip = (blob: Blob) => {
    if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    clipUrl.current = URL.createObjectURL(blob);
    setClip(blob);
  };

  const record = async () => {
    if (requestingMic) return;
    setRequestingMic(true);
    setError("");
    try {
      const mic = await requestMic();
      if (!active.current) { stopStream(mic); return; }
      microphone.current = mic;
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(mic);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stopStream(mic);
        microphone.current = null;
        if (!active.current) return;
        setStream(null);
        setNewClip(new Blob(chunks, { type: rec.mimeType }));
      };
      rec.onerror = () => {
        clearInterval(timer.current); stopStream(mic);
        if (active.current) { setStream(null); setError("Recording stopped unexpectedly. Please record again."); }
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
      stopStream(microphone.current); microphone.current = null;
      if (active.current) setError(audioErrorMessage(e, "mic"));
    } finally {
      if (active.current) setRequestingMic(false);
    }
  };

  return (
    <form
      aria-busy={saving}
      className="enroll"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || !clip) return;
        setSaving(true); setError("");
        try { await onAdd({ id: initialPerson?.id ?? crypto.randomUUID(), name: name.trim(), role, clip }); }
        catch (error) { setError((error as Error).message); }
        finally { setSaving(false); }
      }}
    >
      <fieldset disabled={saving} className="enroll-fieldset">
      <div className="enroll-fields">
        <label>
          Name
          <input maxLength={80} disabled={!!initialPerson || saving} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Edric" />
        </label>
        <label>
          Joining
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="room">In the room</option>
            <option value="online">Online</option>
          </select>
        </label>
      </div>
      <p className="muted">Read these three lines naturally, including the fillers, then press Stop. Recording stops automatically at 45 seconds.</p>
      <blockquote className="script" style={{ whiteSpace: "pre-line" }}>{SENTENCE}</blockquote>
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
          <button type="button" className="btn" disabled={requestingMic} onClick={record}>
            <MicrophoneIcon /> {requestingMic ? "Waiting for microphone…" : clip ? "Record again" : "Record sample"}
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
        <button className="btn primary" disabled={saving || !name.trim() || !clip || !!stream}>{saving ? "Saving voice…" : initialPerson ? "Replace saved voice" : "Save voice"}</button>
      </div>
      </fieldset>
    </form>
  );
}
