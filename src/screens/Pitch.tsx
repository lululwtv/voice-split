import { useRef } from "react";
import { ArrowRightIcon, CheckCircleIcon, GithubLogoIcon, QuestionIcon } from "@phosphor-icons/react";
import { HeroSplit } from "../components/HeroSplit";
import { Thread } from "../components/Thread";
import { TypingBubble } from "../components/TypingBubble";
import { createRealEngine, type EngineStatus } from "../engine";

const REPO = "https://github.com/lululwtv/voice-split";
const engineText: Record<EngineStatus, string> = { checking: "Engine…", off: "Engine off", found: "Engine on" };

// These claims describe the working engine, so they stay hidden until it is connected.
const engineConnected = createRealEngine !== null;

const EDRIC = "var(--speaker-1)";
const DOWON = "var(--speaker-2)";
const WEI_MING = "var(--speaker-3)";
const YOUNGJIN = "var(--speaker-4)";

const prices = [
  ["Fireflies.ai", "400-min cap, audio only", "$10–18", "$19–29"],
  ["Otter.ai", "300 min/mo", "$8.33–16.99", "$19.99–30"],
  ["Wispr Flow", "~5k words/wk", "$12–15", "$23–33"],
  ["Fellow", "5 notes, lifetime", "$7–11", "$15–23"],
  ["Circleback", "30-day history", "$15–18", "$25–29"],
];

const others = [
  ["Fireflies", "Closed", "Named IDs learned from labels. Reviewers mention occasional mislabeling."],
  ["Otter", "Closed", "Named speaker IDs are on paid plans."],
  ["Wispr Flow", "Closed", '"Builds no voiceprints." Separation imperfect on a five-person call.'],
  ["Fellow", "Closed", "Tries to identify each voice on a shared mic, then falls back to generic room labels."],
  ["Circleback", "Closed", "Says it distinguishes speakers who join from one device."],
];

function Source({ href, children }: { href: string; children: string }) {
  return <a className="source-link" href={href} target="_blank" rel="noreferrer">{children}</a>;
}

function Room() {
  return (
    <div className="scene-art room">
      <TypingBubble className="at-1" who="Edric" text="Can we ship by Friday?" color={EDRIC} />
      <TypingBubble className="at-2" who="Dowon" text="If the tests pass." color={DOWON} delayMs={1100} />
      <TypingBubble className="at-3" who="Wei Ming" text="I'll own the API migration." color={WEI_MING} delayMs={2000} />
      <TypingBubble className="at-4" who="Youngjin" text="I'll send the notes." color={YOUNGJIN} delayMs={3200} />
      <svg viewBox="0 0 560 330" role="img" aria-label="Edric, Dowon, Wei Ming and Youngjin talk around one table in the same meeting room.">
        <rect x="1" y="1" width="558" height="328" rx="20" className="art-room" />
        <ellipse cx="280" cy="232" rx="250" ry="50" className="art-table" />
        <circle data-thread="voice" cx="70" cy="125" r="15" fill={EDRIC} />
        <circle data-thread="voice" cx="204" cy="125" r="15" fill={DOWON} />
        <circle data-thread="voice" cx="342" cy="125" r="15" fill={WEI_MING} />
        <circle data-thread="voice" cx="479" cy="125" r="15" fill={YOUNGJIN} />
        <text x="24" y="312" className="art-text muted-text">Meeting room</text>
      </svg>
    </div>
  );
}

function SharedMic() {
  const bars = Array.from({ length: 30 }, (_, i) => 8 + 42 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.43)));
  return (
    <div className="scene-art merge">
      <svg viewBox="0 0 560 300" role="img" aria-label="Four colored voices enter one laptop and come out as one grey signal.">
        <rect x="200" y="40" width="160" height="104" rx="8" className="art-solid" />
        <path d="M172 152 H388" className="art-stroke" />
        <text x="280" y="98" textAnchor="middle" className="art-text">1 mic</text>
        <rect data-thread="laptop" x="200" y="40" width="160" height="112" fill="none" />
        {bars.map((h, i) => (
          <rect key={i} x={165 + i * 8} y={235 - h / 2} width="4" height={h} rx="2" className="art-bar" />
        ))}
      </svg>
    </div>
  );
}

function FlatTranscript() {
  return (
    <div className="mock-card">
      <p className="mock-head">AI notes</p>
      <p><strong className="flat">Speaker 1</strong> Can we ship by Friday?</p>
      <p><strong className="flat">Speaker 1</strong> If the tests pass.</p>
      <p className="asked">
        <strong className="flat">Speaker 1</strong> I'll own the API migration.
        <span className="who-said"><QuestionIcon weight="bold" /> Who said this?</span>
      </p>
      <p><strong className="flat">Speaker 1</strong> I'll send the notes.</p>
    </div>
  );
}

function FixedTranscript() {
  return (
    <div className="mock-card">
      <p><strong style={{ color: EDRIC }}>Edric</strong> Can we ship by Friday?</p>
      <p><strong style={{ color: DOWON }}>Dowon</strong> If the tests pass.</p>
      <p className="asked">
        <strong style={{ color: WEI_MING }}>Wei Ming</strong> I'll own the API migration.
        <span className="who-said solved"><CheckCircleIcon weight="fill" /></span>
      </p>
      <p><strong style={{ color: YOUNGJIN }}>Youngjin</strong> I'll send the notes.</p>
    </div>
  );
}

export function Pitch(props: { engine: EngineStatus; onStart: () => void; onSample: () => void }) {
  const root = useRef<HTMLElement>(null);
  const startButtons = (
    <div className="home-actions">
      <button className="btn primary large" onClick={props.onStart}>
        Start meeting <ArrowRightIcon />
      </button>
      <button className="btn large" onClick={props.onSample}>Sample</button>
    </div>
  );

  return (
    <main className="pitch" ref={root}>
      <Thread root={root} />

      <section className="scene">
        <p className="caption">Four people. One room.</p>
        <Room />
      </section>
      <section className="scene">
        <p className="caption">Every voice goes into one laptop. Four voices, one channel.</p>
        <SharedMic />
      </section>
      <section className="scene">
        <p className="caption">Your notetaker hears one speaker. Who owns the action item?</p>
        <FlatTranscript />
      </section>
      <section className="scene" data-thread="split-scene">
        <p className="caption">Enroll each voice once. timbre splits one channel back into people.</p>
        <FixedTranscript />
      </section>

      <section className="pitch-wide"><HeroSplit /></section>

      <section className="pitch-section hero-copy" data-thread="section">
        <h1>timbre</h1>
        <p className="tagline">A trustworthy identity layer for meeting audio.</p>
        <p>One mic, a room full of people. Every line attributed to the right name.</p>
        {startButtons}
      </section>

      <section className="pitch-section" data-thread="section">
        <h2>What it costs today</h2>
        <p>Meeting AI is priced per seat, and free plans come with limits.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Per seat, per month (USD)</th><th scope="col">Free</th><th scope="col">Entry</th><th scope="col">Team / Business</th></tr></thead>
            <tbody>
              {prices.map(([tool, free, entry, team]) => (
                <tr key={tool}><th scope="row">{tool}</th><td>{free}</td><td>{entry}</td><td>{team}</td></tr>
              ))}
              {engineConnected && <tr className="ours"><th scope="row">timbre</th><td>Unlimited</td><td>$0</td><td>$0</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="foot">
          Ranges show annual to monthly billing. A 50-person team on Otter Business annual runs about $12,000 a year.{" "}
          Sources: <Source href="https://www.claap.io/blog/fireflies-pricing">Claap</Source>, <Source href="https://www.activepieces.com/blog/otterai-pricing-2026-free-pro-business-plans.md">Activepieces</Source>, <Source href="https://diyai.io/ai-tools/speech-to-text/wispr-flow-pricing">DIYAI</Source>, <Source href="https://fellow.ai/pricing">Fellow</Source>, <Source href="https://circleback.ai/pricing">Circleback</Source>. Oct 2026.
        </p>
      </section>

      <section className="pitch-section" data-thread="section">
        <h2>How many people rely on it</h2>
        <div className="stats">
          <div><strong>25M+</strong><span>Otter.ai users (<Source href="https://sacra.com/research/otter-at-100m-arr">Sacra, 2025</Source>)</span></div>
          <div><strong>20M+</strong><span>Fireflies users, 500k+ organizations (<Source href="https://finance.yahoo.com/news/fireflies-reaches-1-billion-valuation-150000434.html">company-reported, 2025</Source>)</span></div>
          <div><strong>75%</strong><span>of the Fortune 500 have people using Fireflies (<Source href="https://www.businesswire.com/news/home/20250423372243/en">company-reported, 2025</Source>)</span></div>
        </div>
      </section>

      <section className="pitch-section" data-thread="section">
        <h2>What we uncovered, and what we built</h2>
        <p>Speaker identification is usually two layers stacked: <b>diarization</b> (when the voice changes) and <b>enrollment</b> (matching a voice to a known print). timbre rebuilds them from open parts and aims at the shared mic.</p>
        <ol className="how-steps">
          <li><span>01</span><div><h3>Enroll each voice once</h3><p>Everyone reads one sentence. Resemblyzer turns it into a voice embedding, a numeric fingerprint.</p></div></li>
          <li><span>02</span><div><h3>Transcribe the mixed audio</h3><p>Whisper handles what was said. One laptop mic, everyone in the room, one channel.</p></div></li>
          <li><span>03</span><div><h3>Attribute every line to a name</h3><p>Each segment is matched to the closest enrolled print. The transcript comes out labelled by person, not "Speaker 1."</p></div></li>
        </ol>
      </section>

      <section className="pitch-section demo" data-thread="section">
        <h2>Live demo</h2>
        <p>{engineConnected ? "Record three voices, enroll them, and watch the single channel split into named, colored tracks in real time." : "Enroll the voices in this room, then start the meeting."}</p>
        {startButtons}
      </section>

      <section className="pitch-section" data-thread="section">
        <h2>Where timbre fits</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Tool</th><th scope="col">Code</th><th scope="col">Voice identity, as described publicly</th></tr></thead>
            <tbody>
              {others.map(([tool, code, voice]) => (
                <tr key={tool}><th scope="row">{tool}</th><td>{code}</td><td>{voice}</td></tr>
              ))}
              {engineConnected && <tr className="ours"><th scope="row">timbre</th><td>MIT</td><td>Consent-based enrollment, runs locally, built for the shared mic.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="foot">Sources: <Source href="https://wisprflow.ai/notetaker/otter-vs-fireflies-how-the-ai-notetakers-compare">Wispr Flow's comparison page</Source>, <Source href="https://help.fellow.ai/en/articles/10657637-speaker-identification-for-remote-hybrid-meetings">Fellow</Source>, <Source href="https://circleback.ai/releases/automatic-participant-identification-for-hybrid-meetings">Circleback</Source>.</p>
      </section>

      {engineConnected && (
        <section className="pitch-section" data-thread="section">
          <h2>Before and after</h2>
          <div className="stats two">
            <div><strong>$19.99</strong><span>per seat, per month. Otter Business, about $12,000 a year for 50 people.</span></div>
            <div><strong>$0</strong><span>Open source, runs locally.</span></div>
          </div>
        </section>
      )}

      <section className="pitch-section agents" data-thread="section">
        <p className="eyebrow">Built for agents, not just humans</p>
        <h2>An agent acts without looking. A wrong name becomes a wrong action.</h2>
        <p>When a meeting agent assigns "I'll own the migration" to the wrong person, the task goes to the wrong inbox. timbre tells agents when to trust a name, and when not to.</p>
        <ol className="agent-points">
          <li><h3>Confidence, not guesses</h3><p>Every attribution carries High, Medium, Low or Uncertain. Similarity is never dressed up as a probability.</p></li>
          <li><h3>Unknown over wrong</h3><p>A voice that doesn't clear the bar becomes "Unknown speaker," not the closest name.</p></li>
          <li><h3>Human stays in control</h3><p>Every segment keeps its decision reason and stays editable.</p></li>
        </ol>
        <p className="tagline">The data foundation that meeting-driven agents run on.</p>
      </section>

      <section className="pitch-section" data-thread="section">
        <h2>Not a demo script. A tested system.</h2>
        <div className="stats two">
          <div><strong>85</strong><span>backend tests passing</span></div>
          <div><strong>40</strong><span>frontend tests passing, production build passing</span></div>
        </div>
        <p>Tests cover weak and ambiguous matches, unchecked-speaker competition, unknown-identity persistence, per-meeting isolation, correction persistence and export labels.</p>
        <p className="limit"><b>Honest limit:</b> real-meeting calibration is still pending, and short clips, noise or overlapping speech can still split one person into two identities. We scoped that out to nail single-channel attribution first.</p>
      </section>

      <section className="pitch-section" data-thread="section">
        <span className="sample-tag">Roadmap</span>
        <h2>A meeting shouldn't end as a note</h2>
        <p>Today's discussion becomes tomorrow's team memory: tacit knowledge, written down where people and agents can use it.</p>
        <ol className="memory-flow">
          <li><h3>Decide</h3><p>Who decided what, linked to the line they said it.</p></li>
          <li><h3>Keep current</h3><p>A new decision replaces the old one, so nobody acts on a stale answer.</p></li>
          <li><h3>Publish</h3><p>Reviewed decisions and actions go to Notion or GitHub.</p></li>
          <li><h3>Reuse</h3><p>Agents ask why something was decided, and answer with the source.</p></li>
        </ol>
      </section>

      <section className="pitch-section closing" data-thread="section">
        <h2>Open source</h2>
        <p>The code is public and reusable.</p>
        <p className="foot center">MIT · Resemblyzer (Apache-2.0) · Whisper (MIT)</p>
        <a className="btn primary large repo" data-thread="end" href={REPO} target="_blank" rel="noreferrer">
          <GithubLogoIcon size={18} /> View on GitHub
        </a>
      </section>

      <footer className="home-foot pitch-foot">
        <span>timbre · Built for Autonomous SG 2026 · NUS Hackers</span>
        <span className={`engine-chip ${props.engine}`}><i /> {engineText[props.engine]}</span>
        <a href={REPO} target="_blank" rel="noreferrer"><GithubLogoIcon size={15} /> MIT</a>
      </footer>
    </main>
  );
}
