import { ArrowRightIcon, GithubLogoIcon, PlayIcon } from "@phosphor-icons/react";
import { HeroSplit } from "../components/HeroSplit";
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
    <main className="home">
      <section className="home-intro">
        <h1>Know <em>who</em> said what, even on one shared mic.</h1>
        <div className="home-side">
          <p>Timbre floats beside your video call, labels every line with who said it, and writes the summary when you finish.</p>
          <div className="home-actions">
            <button className="btn primary large" onClick={props.onStart}>
              Start a meeting <ArrowRightIcon />
            </button>
            <button className="btn large ghost" onClick={props.onSample}>
              <PlayIcon weight="fill" /> Watch a sample
            </button>
          </div>
          <small>For calls open in a Chrome tab, like Google Meet or Zoom in the browser. Desktop apps aren't supported.</small>
        </div>
      </section>
      <HeroSplit />
      <footer className="home-foot">
        <span className={`engine-chip ${props.engine}`}><i /> {engineText[props.engine]}</span>
        <a href="https://github.com/lululwtv/voice-split" target="_blank" rel="noreferrer">
          <GithubLogoIcon size={16} /> Open source, MIT license
        </a>
      </footer>
    </main>
  );
}
