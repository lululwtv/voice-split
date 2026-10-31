import { useState } from "react";
import { ChatTextIcon, FingerprintIcon, ListChecksIcon, TagIcon, WaveformIcon } from "@phosphor-icons/react";

const steps = [
  {
    icon: FingerprintIcon,
    title: "Learn each voice",
    body: "Each person records a short passage. The local speaker model turns it into a saved voice reference. Select the voices attending each meeting.",
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
    body: "The local engine compares voices in short speech turns against this meeting's participants. You can correct a label in the live transcript or review. Corrections are saved with the meeting.",
  },
  {
    icon: ListChecksIcon,
    title: "Hand you the notes",
    body: "The transcript is saved on this machine as you speak. Reopen a meeting to review each person's lines, correct speakers, and export Markdown or JSON. Automatic summaries are not enabled in this local engine.",
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
