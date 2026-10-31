import { useEffect, useRef, useState } from "react";
import { ArrowRightIcon, BrowserIcon, CheckCircleIcon, CircleNotchIcon, MicrophoneIcon, PictureInPictureIcon } from "@phosphor-icons/react";
import { SampleNotice } from "../components/SampleNotice";
import { Steps } from "../components/Steps";
import { samplePeople } from "../data/sampleMeeting";

// Nothing here touches a microphone or the engine. These delays only pace the rehearsal.
const RECORD_MS = 2200;
const CONNECT_MS = 700;
const SENTENCE = "Today I'm reading this short passage so the notes can recognise my voice, whether I speak quickly, slowly, or from across the room.";

function SampleMeter() {
  return <span className="meter sample-meter" aria-hidden><span /></span>;
}

export function SampleVoices(props: {
  enrolled: Set<string>;
  onEnroll: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [recording, setRecording] = useState<string[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const record = (ids: string[]) => {
    setRecording((current) => [...current, ...ids]);
    ids.forEach((id, i) => {
      timers.current.push(
        setTimeout(() => {
          props.onEnroll(id);
          setRecording((current) => current.filter((x) => x !== id));
        }, RECORD_MS + i * 500),
      );
    });
  };

  const waiting = samplePeople.filter((p) => !props.enrolled.has(p.id) && !recording.includes(p.id));
  const allDone = props.enrolled.size === samplePeople.length;

  return (
    <main className="page narrow-page">
      <SampleNotice />
      <Steps current={0} />
      <h1 className="step-title">Who's here?</h1>
      <blockquote className="script">{SENTENCE}</blockquote>
      <section className="panel attendee-panel">
        <ul className="sample-voices">
          {samplePeople.map((person, i) => (
            <li key={person.id} style={{ "--who": `var(--speaker-${i + 1})` } as React.CSSProperties}>
              <div>
                <strong>{person.name}</strong>
                <span className="muted">{person.role === "room" ? "In the room" : "Online"}</span>
              </div>
              {props.enrolled.has(person.id) ? (
                <span className="ok-text"><CheckCircleIcon weight="fill" /> Voice saved</span>
              ) : recording.includes(person.id) ? (
                <span className="sample-recording"><SampleMeter /> Recording</span>
              ) : (
                <button className="btn" onClick={() => record([person.id])}>
                  <MicrophoneIcon /> Record
                </button>
              )}
            </li>
          ))}
        </ul>
        {waiting.length > 1 && (
          <button className="btn" onClick={() => record(waiting.map((p) => p.id))}>
            Record everyone
          </button>
        )}
      </section>
      <div className="step-nav">
        <button className="btn" onClick={props.onBack}>Back</button>
        <button className="btn primary" disabled={!allDone} onClick={props.onNext}>
          Continue <ArrowRightIcon />
        </button>
      </div>
    </main>
  );
}

type Link = "idle" | "connecting" | "on";

function SampleSource(props: { icon: React.ReactNode; title: string; state: Link; onConnect: () => void }) {
  return (
    <div className="source">
      {props.icon}
      <div>
        <strong>{props.title}</strong>
        {props.state === "on" && <SampleMeter />}
      </div>
      {props.state === "on" ? (
        <span className="ok heard"><CheckCircleIcon weight="fill" /> Hearing</span>
      ) : props.state === "connecting" ? (
        <span className="ok"><CircleNotchIcon className="spin" /> Connecting</span>
      ) : (
        <button className="btn" onClick={props.onConnect}>Connect</button>
      )}
    </div>
  );
}

export function SampleConnect(props: { onBack: () => void; onStart: () => void }) {
  const [mic, setMic] = useState<Link>("idle");
  const [tab, setTab] = useState<Link>("idle");
  const [consent, setConsent] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const connect = (set: (state: Link) => void) => {
    set("connecting");
    timers.current.push(setTimeout(() => set("on"), CONNECT_MS));
  };

  return (
    <main className="page narrow-page">
      <SampleNotice />
      <Steps current={1} />
      <h1 className="step-title">Connect</h1>
      <section className="panel">
        <SampleSource icon={<MicrophoneIcon size={24} />} title="Room mic" state={mic} onConnect={() => connect(setMic)} />
        <SampleSource icon={<BrowserIcon size={24} />} title="Call tab" state={tab} onConnect={() => connect(setTab)} />
        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          Everyone knows this is transcribed
        </label>
      </section>
      <div className="step-nav">
        <button className="btn" onClick={props.onBack}>Back</button>
        <button className="btn primary large" disabled={mic !== "on" || tab !== "on" || !consent} onClick={props.onStart}>
          <PictureInPictureIcon /> Start
        </button>
      </div>
    </main>
  );
}
