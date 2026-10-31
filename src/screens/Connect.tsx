import { useEffect, useState } from "react";
import { BrowserIcon, CheckCircleIcon, InfoIcon, MicrophoneIcon, PictureInPictureIcon } from "@phosphor-icons/react";
import { Meter } from "../components/Enroll";
import { Steps } from "../components/Steps";
import type { EngineStatus } from "../engine";
import { useHeardSound, useLevel } from "../lib/audio";


function Source(props: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  stream: MediaStream | null;
  onConnect: () => void;
  error: string;
}) {
  const level = useLevel(props.stream);
  const heard = useHeardSound(props.stream, level);
  return (
    <div className="source">
      {props.icon}
      <div>
        <strong>{props.title}</strong>
        {props.stream ? <Meter level={level} /> : props.hint && <p>{props.hint}</p>}
        {props.error && <p className="error" role="alert">{props.error}</p>}
      </div>
      {props.stream ? (
        <span className={`ok ${heard ? "heard" : ""}`}><CheckCircleIcon weight="fill" /> {heard ? "Hearing" : "Connected"}</span>
      ) : (
        <button className="btn" onClick={props.onConnect}>{props.error ? "Try again" : "Connect"}</button>
      )}
    </div>
  );
}

export function Connect(props: {
  engine: EngineStatus;
  mic: MediaStream | null;
  tab: MediaStream | null;
  micError: string;
  tabError: string;
  onConnectMic: () => void;
  onConnectTab: () => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const { mic, tab } = props;
  const [consent, setConsent] = useState(false);
  const [wrongBrowser, setWrongBrowser] = useState(false);

  useEffect(() => {
    setWrongBrowser(!navigator.mediaDevices?.getDisplayMedia || !("documentPictureInPicture" in window));
  }, []);

  const ready = !!mic && !!tab && consent;

  return (
    <main className="page narrow-page">
      <Steps current={1} />
      <h1 className="step-title">Connect</h1>
      {wrongBrowser && (
        <p className="notice warn" role="alert"><InfoIcon /> Open in Chrome on a computer.</p>
      )}
      <section className="panel">
        <Source
          icon={<MicrophoneIcon size={24} />}
          title="Room mic"
          stream={mic}
          onConnect={props.onConnectMic}
          error={props.micError}
        />
        <Source
          icon={<BrowserIcon size={24} />}
          title="Call tab"
          hint='Turn on "Also share tab audio"'
          stream={tab}
          onConnect={props.onConnectTab}
          error={props.tabError}
        />
        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          Everyone knows this is transcribed
        </label>
      </section>
      {props.engine !== "found" && <span className="sample-tag">Sample</span>}
      <div className="step-nav">
        <button className="btn" onClick={props.onBack}>Back</button>
        <button className="btn primary large" disabled={!ready} onClick={props.onStart}>
          <PictureInPictureIcon /> Start
        </button>
      </div>
    </main>
  );
}
