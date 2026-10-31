import { ArrowRightIcon, PlayIcon } from "@phosphor-icons/react";
import type { EngineStatus } from "../engine";

const engineText: Record<EngineStatus, string> = {
  checking: "Looking for the speech engine…",
  off: "Speech engine is off. Sample meeting only for now.",
  found: "Speech engine found, but this app isn't connected to it yet.",
};

export function Home(props: {
  engine: EngineStatus;
  onStart: () => void;
  onSample: () => void;
}) {
  return (
    <main className="page home">
      <h1>Know who said what, even on one shared mic.</h1>
      <p className="home-lead">Timbre floats beside your video call, labels every line with who said it, and writes the summary when you finish.</p>
      <button className="btn primary large" onClick={props.onStart}>
        Start a meeting <ArrowRightIcon />
      </button>
      <p className="home-note">Works with calls open in a Chrome tab, like Google Meet or Zoom in the browser. Desktop apps aren't supported.</p>
      <button className="link-btn sample-link" onClick={props.onSample}>
        <PlayIcon weight="fill" /> Or watch a sample meeting first
      </button>
      <p className={`engine-chip ${props.engine}`}><i /> {engineText[props.engine]}</p>
    </main>
  );
}
