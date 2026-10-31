import { ArrowRightIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { HeroSplit } from "../components/HeroSplit";
import type { EngineStatus } from "../engine";

const engineText: Record<EngineStatus, string> = {
  checking: "Engine…",
  off: "Engine off",
  found: "Engine on",
};

export function Home(props: {
  engine: EngineStatus;
  onStart: () => void;
  onSample: () => void;
}) {
  return (
    <main className="home">
      <HeroSplit />
      <div className="home-bottom">
        <h1>timbre</h1>
        <div className="home-actions">
          <button className="btn primary large" onClick={props.onStart}>
            Start meeting <ArrowRightIcon />
          </button>
          <button className="btn large" onClick={props.onSample}>Sample</button>
        </div>
      </div>
      <footer className="home-foot">
        <span className={`engine-chip ${props.engine}`}><i /> {engineText[props.engine]}</span>
        <a href="https://github.com/lululwtv/voice-split" target="_blank" rel="noreferrer">
          <GithubLogoIcon size={15} /> MIT
        </a>
      </footer>
    </main>
  );
}
