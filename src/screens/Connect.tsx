import { useEffect, useState } from "react";
import { BrowserIcon, CheckCircleIcon, InfoIcon, MicrophoneIcon, PictureInPictureIcon } from "@phosphor-icons/react";
import { Meter } from "../components/Enroll";
import { Steps } from "../components/Steps";
import type { EngineStatus } from "../engine";
import { useHeardSound, useLevel } from "../lib/audio";

export type Platform = "meet" | "zoom";

const guides: Record<Platform, { name: string; steps: string[] }> = {
  meet: {
    name: "Google Meet",
    steps: ["Join your call in another Chrome tab.", "Press Connect below and open the Chrome tabs list.", 'Pick the Meet tab, turn on "Also share tab audio", then press Share.'],
  },
  zoom: {
    name: "Zoom",
    steps: ['Open the invite link and choose "Join from your browser". The desktop app won\'t work here.', "Press Connect below and open the Chrome tabs list.", 'Pick the Zoom tab, turn on "Also share tab audio", then press Share.'],
  },
};

function Source(props: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  heardText: string;
  waitingText: string;
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
        {props.stream ? (
          <>
            <Meter level={level} />
            <p className={heard ? "heard" : ""}>{heard ? props.heardText : props.waitingText}</p>
          </>
        ) : (
          <p>{props.hint}</p>
        )}
        {props.error && <p className="error" role="alert">{props.error}</p>}
      </div>
      {props.stream ? (
        <span className="ok"><CheckCircleIcon weight="fill" /> Connected</span>
      ) : (
        <button className="btn" onClick={props.onConnect}>{props.error ? "Try again" : "Connect"}</button>
      )}
    </div>
  );
}

export function Connect(props: {
  platform: Platform;
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
  const { platform, mic, tab } = props;
  const guide = guides[platform];
  const [consent, setConsent] = useState(false);
  const [wrongBrowser, setWrongBrowser] = useState(false);

  useEffect(() => {
    setWrongBrowser(!navigator.mediaDevices?.getDisplayMedia || !("documentPictureInPicture" in window));
  }, []);

  const ready = !!mic && !!tab && consent;
  const missing = !mic ? "Connect the room microphone" : !tab ? `Connect the ${guide.name} tab` : !consent ? "Confirm everyone knows" : "";

  return (
    <main className="page narrow-page">
      <Steps current={1} />
      <h1 className="step-title">Connect {guide.name}</h1>
      {wrongBrowser && (
        <p className="notice warn" role="alert"><InfoIcon /> This browser can't hear another tab or float a window. Open Timbre in Chrome on a computer.</p>
      )}
      <section className="panel">
        <ol className="guide">
          {guide.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <Source
          icon={<MicrophoneIcon size={24} />}
          title="Room microphone"
          hint="Hears everyone around this laptop."
          heardText="We can hear the room."
          waitingText="Say something to test it."
          stream={mic}
          onConnect={props.onConnectMic}
          error={props.micError}
        />
        <Source
          icon={<BrowserIcon size={24} />}
          title={`${guide.name} tab`}
          hint="Hears people who joined online."
          heardText="We can hear the call."
          waitingText="No sound yet. That's normal if nobody online is talking."
          stream={tab}
          onConnect={props.onConnectTab}
          error={props.tabError}
        />
        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          Everyone in this meeting knows it's being transcribed.
        </label>
      </section>
      {props.engine !== "found" && (
        <p className="notice"><InfoIcon /> The speech engine is off, so a scripted sample with its own four speakers plays instead of your real call. Your audio connections are still real.</p>
      )}
      <div className="step-nav">
        <button className="btn" onClick={props.onBack}>Back</button>
        <div className="start-wrap">
          {missing && <small>{missing} to continue</small>}
          <button className="btn primary large" disabled={!ready} onClick={props.onStart}>
            <PictureInPictureIcon /> Start and float beside the call
          </button>
        </div>
      </div>
    </main>
  );
}
