import { ArrowRightIcon, PlayIcon, VideoCameraIcon } from "@phosphor-icons/react";
import type { EngineStatus } from "../engine";
import type { Platform } from "./Connect";

const engineText: Record<EngineStatus, string> = {
  checking: "Looking for the speech engine…",
  off: "Speech engine is off. Sample meeting only for now.",
  found: "Speech engine found, but this app isn't connected to it yet.",
};

export function Home(props: {
  engine: EngineStatus;
  onStart: (platform: Platform) => void;
  onSample: () => void;
}) {
  return (
    <main className="page home">
      <h1>Know who said what, even on one shared mic.</h1>
      <p className="home-lead">Timbre floats beside your video call, labels every line with who said it, and writes the summary when you finish.</p>
      <h2>Which call are you joining?</h2>
      <div className="platforms">
        <button onClick={() => props.onStart("meet")}>
          <VideoCameraIcon size={26} />
          <span><strong>Google Meet</strong><small>In a Chrome tab</small></span>
          <ArrowRightIcon />
        </button>
        <button onClick={() => props.onStart("zoom")}>
          <VideoCameraIcon size={26} />
          <span><strong>Zoom</strong><small>In a Chrome tab, not the desktop app</small></span>
          <ArrowRightIcon />
        </button>
      </div>
      <button className="link-btn sample-link" onClick={props.onSample}>
        <PlayIcon weight="fill" /> Or watch a sample meeting first
      </button>
      <p className={`engine-chip ${props.engine}`}><i /> {engineText[props.engine]}</p>
    </main>
  );
}
