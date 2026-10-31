import { useEffect, useRef, useState } from "react";
import { BrowserIcon, CheckCircleIcon, MicrophoneIcon, PlayIcon, StopIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { audioErrorMessage, requestMeetingTab, requestMic, stopStream, useLevel } from "../lib/audio";
import { loadPeople, removePerson, savePerson } from "../lib/peopleStore";
import type { Person, Role } from "../types";

const SENTENCE = "Today I'm reading this short passage so the notes can recognise my voice, whether I speak quickly, slowly, or from across the room.";
const RECORD_SECONDS = 10;

function Meter({ level }: { level: number }) {
  return (
    <span className="meter" role="img" aria-label="Sound level">
      <span style={{ transform: `scaleX(${level})` }} />
    </span>
  );
}

function Enroll({ onAdd }: { onAdd: (person: Person) => void }) {
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

  useEffect(() => () => {
    clearInterval(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const stop = () => {
    clearInterval(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

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

  const add = () => {
    if (!name.trim() || !clip) return;
    onAdd({ id: crypto.randomUUID(), name: name.trim(), role, clip });
    setName("");
    setClip(null);
  };

  return (
    <form
      className="enroll"
      onSubmit={(e) => {
        e.preventDefault();
        add();
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
            <MicrophoneIcon /> {clip ? "Record again" : "Record 10 seconds"}
          </button>
          <label className="btn">
            <UploadSimpleIcon /> Upload a clip
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
      <button className="btn primary" disabled={!name.trim() || !clip || !!stream}>
        Add person
      </button>
    </form>
  );
}

function Source(props: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  stream: MediaStream | null;
  onConnect: () => void;
  error: string;
}) {
  const level = useLevel(props.stream);
  return (
    <div className="source">
      {props.icon}
      <div>
        <strong>{props.title}</strong>
        {props.stream ? <Meter level={level} /> : <p>{props.hint}</p>}
        {props.error && <p className="error" role="alert">{props.error}</p>}
      </div>
      {props.stream ? (
        <span className="ok"><CheckCircleIcon weight="fill" /> Connected</span>
      ) : (
        <button className="btn" onClick={props.onConnect}>Connect</button>
      )}
    </div>
  );
}

export function Setup(props: {
  mic: MediaStream | null;
  tab: MediaStream | null;
  setMic: (s: MediaStream | null) => void;
  setTab: (s: MediaStream | null) => void;
  onStartSample: () => void;
}) {
  const { mic, tab, setMic, setTab } = props;
  const [people, setPeople] = useState<Person[]>([]);
  const [micError, setMicError] = useState("");
  const [tabError, setTabError] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    loadPeople().then(setPeople).catch(() => setSaveError("Saved voices couldn't be loaded in this browser."));
  }, []);

  const add = async (person: Person) => {
    setPeople((list) => [...list, person]);
    await savePerson(person).catch(() => setSaveError(`${person.name} will be forgotten when you close this page.`));
  };

  const remove = async (id: string) => {
    setPeople((list) => list.filter((p) => p.id !== id));
    await removePerson(id).catch(() => setSaveError("Couldn't delete that voice from this browser."));
  };

  const connectMic = async () => {
    setMicError("");
    try {
      setMic(await requestMic());
    } catch (e) {
      setMicError(audioErrorMessage(e, "mic"));
    }
  };

  const connectTab = async () => {
    setTabError("");
    try {
      const stream = await requestMeetingTab();
      stream.getTracks().forEach((t) => (t.onended = () => setTab(null)));
      setTab(stream);
    } catch (e) {
      setTabError(audioErrorMessage(e, "tab"));
    }
  };

  return (
    <main className="page setup">
      <section className="hero">
        <h1>Know who said what, even on one shared mic.</h1>
        <p>VoiceSplit sits beside your Google Meet and labels every line with the person who said it.</p>
        <button className="btn primary large" onClick={props.onStartSample}>
          <PlayIcon weight="fill" /> Try a sample meeting
        </button>
        <small>Plays a scripted meeting. It doesn't use your microphone.</small>
      </section>

      <section className="panel">
        <h2><span>1</span> Add everyone's voice</h2>
        <p className="lead">Each person only does this once. Voices stay in this browser.</p>
        {people.length > 0 && (
          <ul className="people">
            {people.map((p) => (
              <li key={p.id}>
                <strong>{p.name}</strong>
                <span>{p.role === "room" ? "In the room" : "Online"}</span>
                <button className="icon-btn" aria-label={`Remove ${p.name}`} onClick={() => remove(p.id)}>
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
        {saveError && <p className="error" role="alert">{saveError}</p>}
        <Enroll onAdd={add} />
      </section>

      <section className="panel">
        <h2><span>2</span> Connect your meeting</h2>
        <p className="lead">Works in Chrome. Keep this tab open during the call.</p>
        <Source
          icon={<MicrophoneIcon size={24} />}
          title="Room microphone"
          hint="Hears the people around this laptop."
          stream={mic}
          onConnect={connectMic}
          error={micError}
        />
        <Source
          icon={<BrowserIcon size={24} />}
          title="Google Meet tab"
          hint='Hears people online. Pick the Meet tab and turn on "Also share tab audio".'
          stream={tab}
          onConnect={connectTab}
          error={tabError}
        />
        <div className="engine-note">
          <strong>Live transcription isn't connected yet.</strong>
          <p>The speech engine is still being built. You can test your voices and audio here, and use the sample meeting to see the live view.</p>
        </div>
      </section>
    </main>
  );
}
