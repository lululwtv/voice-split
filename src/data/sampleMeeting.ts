import type { Person, Segment, VoiceWindow } from "../types";

export const samplePeople: Person[] = [
  { id: "maya", name: "Maya", role: "room" },
  { id: "weijie", name: "Wei Jie", role: "room" },
  { id: "priya", name: "Priya", role: "room" },
  { id: "alex", name: "Alex", role: "online" },
];

type Line = [
  seconds: number,
  who: string | null,
  text: string,
  extra?: { heardAs?: string | null; overlap?: boolean; alsoHeard?: string },
];

// heardAs is what the simulated engine labels the line, so the sample includes mistakes to correct.
const lines: Line[] = [
  [5, "maya", "Okay, let's start. Alex, can you hear the room all right?"],
  [3, "alex", "Yep, loud and clear. Go ahead."],
  [6, "maya", "Great. Two things today: the launch date and who owns the onboarding emails."],
  [7, "weijie", "On the date, engineering can be ready by the fourteenth if the payment fix lands this week."],
  [6, "priya", "The fourteenth clashes with the partner webinar, so I'd rather move to the sixteenth.", { alsoHeard: "maya" }],
  [2, "weijie", "Sixteenth works for me.", { heardAs: null }],
  [6, "alex", "From the customer side, the sixteenth is fine. Nobody is waiting on the exact day."],
  [4, "maya", "Then let's lock in the sixteenth. Everyone okay with that?"],
  [3, "priya", "Sounds good, and I can tell the partner team.", { overlap: true }],
  [7, "maya", "Next, onboarding emails. Last time they slipped because nobody clearly owned them."],
  [6, "priya", "I'll own the copy, but I need the final screenshots by Tuesday.", { heardAs: "maya" }],
  [5, "weijie", "I can send those on Monday once the staging build is stable."],
  [6, "alex", "Could I review the emails before they go out? I hear the same questions from customers every week."],
  [3, "priya", "Yes, I'll send you a draft on Wednesday."],
  [6, "maya", "Perfect. So: launch on the sixteenth, Priya owns the emails, and Wei Jie sends screenshots Monday."],
  [2, "alex", "Thanks all. Talk soon.", { heardAs: null }],
];

function matchesFor(heardAs: string | null, who: string | null, seed: number) {
  const noise = (i: number) => ((seed * 37 + i * 53) % 17) / 100;
  return samplePeople
    .map((p, i) => {
      const base = p.id === heardAs ? 0.78 : p.id === who ? 0.61 : 0.24;
      return { personId: p.id, score: Math.min(0.92, heardAs === null && p.id === who ? 0.46 + noise(i) / 4 : base + noise(i)) };
    })
    .sort((a, b) => b.score - a.score);
}

export function buildSampleMeeting() {
  const segments: Segment[] = [];
  const windows: VoiceWindow[] = [];
  let t = 1;
  lines.forEach(([seconds, who, text, extra], i) => {
    const start = t;
    const end = t + seconds;
    const heardAs = extra?.heardAs === undefined ? who : extra.heardAs;
    const personId = extra?.overlap ? null : heardAs;
    segments.push({
      id: `s${i + 1}`,
      start,
      end,
      text,
      personId,
      originalPersonId: personId,
      matches: extra?.overlap ? [] : matchesFor(heardAs, who, i + 1),
      overlap: extra?.overlap,
      alsoHeardId: extra?.alsoHeard,
    });
    if (who) windows.push({ start, end, personId: who });
    if (extra?.overlap) windows.push({ start, end, personId: "maya" });
    if (extra?.alsoHeard) windows.push({ start: end - 1.6, end, personId: extra.alsoHeard });
    t = end + 0.6;
  });
  return { people: samplePeople, segments, windows, duration: t };
}
