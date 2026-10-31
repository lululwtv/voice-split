import type { Person, Segment, Summary, VoiceWindow } from "../types";

export const samplePeople: Person[] = [
  { id: "edric", name: "Edric", role: "room" },
  { id: "dowon", name: "Dowon", role: "room" },
  { id: "weiming", name: "Wei Ming", role: "room" },
  { id: "youngjin", name: "Youngjin", role: "online" },
];

type Line = [
  seconds: number,
  who: string | null,
  text: string,
  extra?: { heardAs?: string | null; overlap?: boolean; alsoHeard?: string },
];

// heardAs is what the simulated engine labels the line, so the sample includes mistakes to correct.
const lines: Line[] = [
  [5, "edric", "Okay, let's start. Youngjin, can you hear the room all right?"],
  [3, "youngjin", "Yep, loud and clear. Go ahead."],
  [6, "edric", "Great. Two things today: the launch date and who owns the onboarding emails."],
  [7, "dowon", "On the date, engineering can be ready by the fourteenth if the payment fix lands this week."],
  [6, "weiming", "The fourteenth clashes with the partner webinar, so I'd rather move to the sixteenth.", { alsoHeard: "edric" }],
  [2, "dowon", "Sixteenth works for me.", { heardAs: null }],
  [6, "youngjin", "From the customer side, the sixteenth is fine. Nobody is waiting on the exact day."],
  [4, "edric", "Then let's lock in the sixteenth. Everyone okay with that?"],
  [3, "weiming", "Sounds good, and I can tell the partner team.", { overlap: true }],
  [7, "edric", "Next, onboarding emails. Last time they slipped because nobody clearly owned them."],
  [6, "weiming", "I'll own the copy, but I need the final screenshots by Tuesday.", { heardAs: "edric" }],
  [5, "dowon", "I can send those on Monday once the staging build is stable."],
  [6, "youngjin", "Could I review the emails before they go out? I hear the same questions from customers every week."],
  [3, "weiming", "Yes, I'll send you a draft on Wednesday."],
  [6, "edric", "Perfect. So: launch on the sixteenth, Wei Ming owns the emails, and Dowon sends screenshots Monday."],
  [2, "youngjin", "Thanks all. Talk soon.", { heardAs: null }],
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
    if (extra?.overlap) windows.push({ start, end, personId: "edric" });
    if (extra?.alsoHeard) windows.push({ start: end - 1.6, end, personId: extra.alsoHeard });
    t = end + 0.6;
  });
  return { people: samplePeople, segments, windows, duration: t };
}

export const sampleSummary: Summary = {
  overview:
    "The team moved the launch to the sixteenth to avoid the partner webinar and made Wei Ming the owner of the onboarding emails.",
  decisions: [
    { text: "Launch on the sixteenth instead of the fourteenth.", sources: ["s5", "s8", "s15"] },
    { text: "Wei Ming owns the onboarding email copy.", sources: ["s11", "s15"] },
  ],
  actions: [
    { text: "Tell the partner team about the new date", ownerId: "weiming", sources: ["s9"] },
    { text: "Send the final screenshots", ownerId: "dowon", due: "Monday", sources: ["s12"] },
    { text: "Send Youngjin a draft of the emails", ownerId: "weiming", due: "Wednesday", sources: ["s14"] },
    { text: "Review the emails before they go out", ownerId: "youngjin", sources: ["s13"] },
  ],
  questions: [{ text: "Will the payment fix land this week? Readiness depended on it.", sources: ["s4"] }],
};
