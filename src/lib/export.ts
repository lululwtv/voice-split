import type { Meeting, Segment } from "../types";
import { formatTime, speakerNotes } from "./stats";

function speakerName(meeting: Meeting, segment: Segment) {
  if (segment.overlap) return "Overlapping speech";
  return meeting.people.find((p) => p.id === segment.personId)?.name ?? segment.speakerLabel ?? "Unknown";
}

export function summaryToMarkdown(meeting: Meeting) {
  const { summary, people } = meeting;
  if (!summary) return "";
  const out = ["## Summary", "", summary.overview, ""];
  if (summary.decisions.length) out.push("### Decisions", "", ...summary.decisions.map((d) => `- ${d.text}`), "");
  if (summary.actions.length) {
    out.push("### Action items", "");
    for (const a of summary.actions) {
      const owner = people.find((p) => p.id === a.ownerId)?.name ?? "Unassigned";
      out.push(`- [ ] **${owner}:** ${a.text}${a.due ? ` (by ${a.due})` : ""}`);
    }
    out.push("");
  }
  if (summary.questions.length) out.push("### Open questions", "", ...summary.questions.map((q) => `- ${q.text}`), "");
  return out.join("\n");
}

export function toMarkdown(meeting: Meeting) {
  const out = [`# ${meeting.title}`, ""];
  if (meeting.isSample) out.push("> Sample meeting with simulated results.", "");
  if (meeting.summary) out.push(summaryToMarkdown(meeting));
  out.push("## Transcript", "");
  for (const s of meeting.segments) {
    out.push(`**${speakerName(meeting, s)}** [${formatTime(s.start)}]: ${s.text}`, "");
  }
  out.push("## Notes by speaker", "");
  for (const group of speakerNotes(meeting.people, meeting.segments)) {
    if (!group.segments.length) continue;
    out.push(`### ${group.name}`, "", ...group.segments.map((s) => `- [${formatTime(s.start)}] ${s.text}`), "");
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
      summary: meeting.summary,
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
