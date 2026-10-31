import { expect, it } from "vitest";
import { toSegment } from "./api";
import { toJson, toMarkdown } from "./export";
import { speakerNotes } from "./stats";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Review } from "../screens/Review";

it("retains separate unknown labels and confidence through mapping and export", () => {
  const segments = [1, 2].map(number => toSegment({
    id: String(number), start: number, end: number + 1, text: "Hello",
    speaker: `Unknown speaker ${number}`, unknown_id: `unknown-${number}`,
    profile_id: null, identification: { confidence: "low" },
  }));
  expect(segments[0].personId).toBeNull();
  expect(segments[0].unknownId).not.toBe(segments[1].unknownId);
  expect(segments[0].confidence).toBe("low");
  const exported = toMarkdown({ title: "Meeting", isSample: false, people: [], segments,
    windows: [], duration: 3, summary: null });
  expect(exported).toContain("Unknown speaker 1");
  expect(exported).toContain("Unknown speaker 2");
  expect(exported).toContain("### Unknown speaker 1");
  expect(exported).toContain("### Unknown speaker 2");
});

it("retains rejected candidate evidence without assigning the candidate", () => {
  const segment = toSegment({ id: "line", start: 0, end: 1, text: "Hello", profile_id: null,
    speaker: "Unknown speaker 1", unknown_id: "unknown-1", score: -.2,
    identification: { confidence: "low", candidate_profile_id: "alice" } });
  expect(segment.personId).toBeNull();
  expect(segment.originalPersonId).toBeNull();
  expect(segment.matches).toEqual([{ personId: "alice", score: -.2 }]);
  const exported = JSON.parse(toJson({ title: "T", isSample: false, people: [], segments: [segment], windows: [], duration: 1, summary: null }));
  expect(exported.segments[0]).toMatchObject({ personId: null, speaker: "Unknown speaker 1", matches: [{ personId: "alice", score: -.2 }] });
});

it("keeps unknown notes separate and a correction moves only the selected line", () => {
  const people = [{ id: "alice", name: "Alice", role: "room" as const }];
  const segments = [1, 2, 1].map((number, index) => toSegment({ id: String(index), start: index, end: index + 1,
    text: `Line ${index}`, speaker: `Unknown speaker ${number}`, unknown_id: `unknown-${number}`, profile_id: null }));
  expect(speakerNotes(people, segments).map((group) => [group.name, group.segments.length])).toEqual([
    ["Alice", 0], ["Unknown speaker 1", 2], ["Unknown speaker 2", 1],
  ]);
  const corrected = segments.map((segment, index) => index === 0 ? { ...segment, personId: "alice", assignment_source: "manual" } : segment);
  expect(speakerNotes(people, corrected).map((group) => [group.name, group.segments.map((segment) => segment.id)])).toEqual([
    ["Alice", ["0"]], ["Unknown speaker 2", ["1"]], ["Unknown speaker 1", ["2"]],
  ]);
});

it("renders separate unknown labels and talk times without an accuracy target", () => {
  const segments = [1, 2].map((number) => toSegment({ id: String(number), start: number, end: number + 1,
    text: "Hello", speaker: `Unknown speaker ${number}`, unknown_id: `unknown-${number}`, profile_id: null,
    identification: { confidence: "low" } }));
  const html = renderToStaticMarkup(createElement(Review, { meeting: { title: "T", isSample: false,
    people: [], segments, windows: [], duration: 3, summary: null }, onChange: () => {} }));
  expect(html.match(/Unknown speaker 1/g)).toHaveLength(2);
  expect(html.match(/Unknown speaker 2/g)).toHaveLength(2);
  expect(html).toContain("Uncertain voice match");
  expect(html).toContain('<p class="big">0</p>');
  expect(html).toContain("Named lines");
  expect(html).toContain("2 unknown");
  expect(html).not.toContain("target 80%");
  expect(html).toContain("Label counts do not measure speaker identification accuracy.");
});
