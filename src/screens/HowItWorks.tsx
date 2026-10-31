import { useState } from "react";
import { ChatTextIcon, FingerprintIcon, ListChecksIcon, TagIcon, WaveformIcon } from "@phosphor-icons/react";

const steps = [
  {
    icon: FingerprintIcon,
    title: "Learn each voice",
    body: "Each person reads one sentence. Resemblyzer turns it into a voiceprint: a list of numbers that describes how that person sounds.",
  },
  {
    icon: WaveformIcon,
    title: "Compare short slices",
    body: "The audio is cut into overlapping slices. Each slice gets its own voiceprint and is matched to the closest person, or marked unknown if nobody is close.",
  },
  {
    icon: ChatTextIcon,
    title: "Write down the words",
    body: "Whisper turns the audio into text and records when each line starts and ends. Whisper doesn't know who is talking.",
  },
  {
    icon: TagIcon,
    title: "Put a name on each line",
    body: "For every line, Timbre checks which person holds the most slices in that time span. That person gets the label.",
  },
  {
    icon: ListChecksIcon,
    title: "Hand you the notes",
    body: "When the meeting ends, a model reads the labelled transcript and writes the decisions and action items. You also get the full transcript and each person's lines, as Markdown and JSON.",
  },
];

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const step = steps[active];
  return (
    <main className="page how">
      <h1>How it knows</h1>
      <ol className="journey">
        {steps.map((s, i) => (
          <li key={s.title}>
            <button aria-pressed={i === active} onClick={() => setActive(i)}>
              <s.icon size={24} />
              <strong>{s.title}</strong>
            </button>
          </li>
        ))}
      </ol>
      <section className="panel how-detail">
        <p>{step.body}</p>
      </section>
      <p className="muted">Not in v1: overlapping speech · instant captions</p>
    </main>
  );
}
