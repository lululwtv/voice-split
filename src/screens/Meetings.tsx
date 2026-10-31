import { ArrowRightIcon } from "@phosphor-icons/react";
import type { EngineStatus } from "../engine";

const engineText: Record<EngineStatus, string> = {
  checking: "Engine…",
  off: "Engine off",
  found: "Engine on",
};

export function Meetings(props: {
  engine: EngineStatus;
  onStart: () => void;
  onRecordVoice: () => void;
  children?: React.ReactNode;
}) {
  return (
    <main className="page narrow-page">
      <h1 className="step-title">Meetings</h1>
      {props.children}
      <div className="meetings-actions">
        <button className="btn large" onClick={props.onRecordVoice}>Record your voice</button>
        <button className="btn primary large" onClick={props.onStart}>
          Start meeting <ArrowRightIcon />
        </button>
      </div>
      <span className={`engine-chip ${props.engine}`}><i /> {engineText[props.engine]}</span>
    </main>
  );
}
