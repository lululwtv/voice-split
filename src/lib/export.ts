import type { Meeting, Segment } from "../types";
import { formatTime } from "./stats";

function speakerName(meeting: Meeting, segment: Segment) {
  if (segment.overlap) return "Overlapping speech";
  return meeting.people.find((p) => p.id === segment.personId)?.name ?? "Unknown";
}

export function toMarkdown(meeting: Meeting) {
  const out = [`# ${meeting.title}`, ""];
  if (meeting.isSample) out.push("> Sample meeting with simulated results.", "");
  out.push("## Transcript", "");
  for (const s of meeting.segments) {
    out.push(`**${speakerName(meeting, s)}** [${formatTime(s.start)}]: ${s.text}`, "");
  }
  out.push("## Notes by speaker", "");
  for (const person of meeting.people) {
    const said = meeting.segments.filter((s) => s.personId === person.id);
    if (!said.length) continue;
    out.push(`### ${person.name}`, "", ...said.map((s) => `- [${formatTime(s.start)}] ${s.text}`), "");
  }
  return out.join("\n");
}

export function toJson(meeting: Meeting) {
  return JSON.stringify(
    {
      title: meeting.title,
      isSample: meeting.isSample,
      duration: meeting.duration,
      people: meeting.people.map(({ id, name, role }) => ({ id, name, role })),
      segments: meeting.segments.map((s) => ({ ...s, speaker: speakerName(meeting, s) })),
      windows: meeting.windows,
    },
    null,
    2,
  );
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
