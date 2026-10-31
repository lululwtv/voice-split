import type { Person, Segment, VoiceWindow } from "../types";

export function isCorrected(segment: Segment) {
  return segment.assignment_source === undefined
    ? segment.personId !== segment.originalPersonId
    : segment.assignment_source === "manual";
}

/** Share of attributable segments whose engine label the reviewer left alone. Overlaps are out of scope. */
export function labelAccuracy(segments: Segment[]) {
  const scored = segments.filter((s) => !s.overlap);
  const named = (s: Segment) => s.personId !== null || (Boolean(s.unknownId) && s.confidence === "manual");
  const unnamed = scored.filter((s) => !named(s)).length;
  const changed = scored.filter((s) => named(s) && isCorrected(s)).length;
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

/** Group unknown voices by their session identity without assigning a person. */
export function speakerNotes(people: Person[], segments: Segment[]) {
  const groups = people.map((person) => ({
    id: person.id, name: person.name, personId: person.id as string | null,
    segments: segments.filter((segment) => segment.personId === person.id && !segment.overlap),
  }));
  const unknowns = new Map<string, typeof groups[number]>();
  for (const segment of segments) {
    if (segment.personId !== null || segment.overlap) continue;
    const id = segment.unknownId ?? segment.speakerLabel ?? "unknown";
    let group = unknowns.get(id);
    if (!group) {
      group = { id: `unknown:${id}`, name: segment.speakerLabel ?? "Unknown speaker", personId: null, segments: [] };
      unknowns.set(id, group);
    }
    group.segments.push(segment);
  }
  return [...groups, ...unknowns.values()];
}

export function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
