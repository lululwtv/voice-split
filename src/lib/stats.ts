import type { Person, Segment, VoiceWindow } from "../types";

/** Share of attributable segments whose engine label the reviewer left alone. Overlaps are out of scope. */
export function labelAccuracy(segments: Segment[]) {
  const scored = segments.filter((s) => !s.overlap);
  const unnamed = scored.filter((s) => s.personId === null).length;
  const changed = scored.filter((s) => s.personId !== null && s.personId !== s.originalPersonId).length;
  const wrong = changed + unnamed;
  return {
    total: scored.length,
    changed,
    unnamed,
    percent: scored.length ? Math.round(((scored.length - wrong) / scored.length) * 100) : 0,
  };
}

export function talkTime(people: Person[], windows: VoiceWindow[]) {
  return people.map((person) => ({
    person,
    seconds: windows.filter((w) => w.personId === person.id).reduce((sum, w) => sum + w.end - w.start, 0),
  }));
}

export function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
