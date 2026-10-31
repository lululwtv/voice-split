import { useState } from "react";
import { ChatTextIcon, FingerprintIcon, ListChecksIcon, TagIcon, WaveformIcon } from "@phosphor-icons/react";

const steps = [
  {
    icon: FingerprintIcon,
    title: "Learn each voice",
    short: "A 10-second clip per person",
    body: "Each person reads one sentence. Resemblyzer turns it into a voiceprint: a list of numbers that describes how that person sounds.",
    limit: "A noisy clip makes a weak voiceprint, and every later match depends on it.",
  },
  {
    icon: WaveformIcon,
    title: "Compare short slices",
    short: "About 1.6 seconds at a time",
    body: "The audio is cut into overlapping slices. Each slice gets its own voiceprint and is matched to the closest person, or marked unknown if nobody is close.",
    limit: "A reply much shorter than a slice can be swallowed by whoever spoke around it.",
  },
  {
    icon: ChatTextIcon,
    title: "Write down the words",
    short: "Timed text from Whisper",
    body: "Whisper turns the audio into text and records when each line starts and ends. Whisper doesn't know who is talking.",
    limit: "Whisper's lines don't always break where the speaker changes.",
  },
  {
    icon: TagIcon,
    title: "Put a name on each line",
    short: "Most time in the line wins",
    body: "For every line, VoiceSplit checks which person holds the most slices in that time span. That person gets the label.",
    limit: "When two people share a line, only one name shows. We flag those lines instead of hiding them.",
  },
  {
    icon: ListChecksIcon,
    title: "Hand you the notes",
    short: "A transcript and per-person notes",
    body: "You get the transcript in order and each person's lines grouped, as Markdown and JSON. You can correct any label.",
    limit: "This version groups what people said. It doesn't write summaries or action items yet.",
  },
];

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const step = steps[active];
  return (
    <main className="page how">
      <h1>How it knows who's talking</h1>
      <p className="lead">
        Paid meeting tools keep this step closed, at around $10 to $30 per user each month. VoiceSplit rebuilds it from open parts you can inspect, and it costs nothing to run.
      </p>
      <ol className="journey">
        {steps.map((s, i) => (
          <li key={s.title}>
            <button aria-pressed={i === active} onClick={() => setActive(i)}>
              <s.icon size={24} />
              <strong>{s.title}</strong>
              <span>{s.short}</span>
            </button>
          </li>
        ))}
      </ol>
      <section className="panel how-detail">
        <div>
          <h2>What happens</h2>
          <p>{step.body}</p>
        </div>
        <div>
          <h2>Where it can go wrong</h2>
          <p>{step.limit}</p>
        </div>
      </section>
      <section className="panel limits">
        <h2>What this version can't do</h2>
        <ul>
          <li><strong>People talking over each other.</strong> Those lines are marked, not separated.</li>
          <li><strong>Voices nobody added.</strong> They appear as "Who is this?" until someone names them.</li>
          <li><strong>Instant captions.</strong> The goal is lines appearing 3 to 5 seconds after they're spoken. We haven't measured this on a real call yet.</li>
        </ul>
      </section>
    </main>
  );
}
