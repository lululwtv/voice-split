import { describe, expect, it } from "vitest";
import { groupTranscriptTurns } from "./transcriptTurns";
import { mergeSegment, toSegment } from "./api";
import { toJson, toMarkdown } from "./export";
import type { Meeting, Segment } from "../types";

const segment = (id: string, patch: Partial<Segment> = {}): Segment => ({
  id, start: Number(id), end: Number(id) + 1, text: `word ${id}`, personId: "alex", originalPersonId: "alex", matches: [], ...patch,
});

describe("readable transcript turns", () => {
  it("grows one paragraph across ASR rows and sentences without changing original records", () => {
    const rows = [segment("0", { text: " I think " }), segment("1", { text: "this works." }), segment("2", { text: "A new sentence." })];
    const turns = groupTranscriptTurns(rows);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ id: "0", start: 0, end: 3, text: "I think this works. A new sentence." });
    expect(turns[0].segments).toEqual(rows);
    expect(turns[0].segments[0]).toBe(rows[0]);
    expect(rows[0].text).toBe(" I think ");
  });

  it("preserves repetitions and joins leading punctuation without adding words", () => {
    const rows = [segment("0", { text: "yes yes" }), segment("1", { text: ", exactly" }), segment("2", { text: "exactly!" })];
    expect(groupTranscriptTurns(rows)[0].text).toBe("yes yes, exactly exactly!");
  });

  it.each([
    { personId: "jamie" }, { overlap: true }, { start: 2.51, end: 4 },
    { start: -1 }, { end: 0.5 }, { start: 0.6 },
    { stream_id: "new-stream" }, { device_id: "new-device" },
  ])("starts a new turn at a speaker, timing, or source boundary: %j", (patch) => {
    expect(groupTranscriptTurns([segment("0"), segment("1", patch)])).toHaveLength(2);
  });

  it("allows a small timestamp overlap and up to 1.5 seconds of silence", () => {
    expect(groupTranscriptTurns([segment("0"), segment("1", { start: .8 })])).toHaveLength(1);
    expect(groupTranscriptTurns([segment("0"), segment("1", { start: 2.5, end: 3 })])).toHaveLength(1);
  });

  it("uses stable unknown identity and source, never a shared generic label", () => {
    const first = segment("0", { personId: null, speakerLabel: "Unknown speaker" });
    const second = segment("1", { personId: null, speakerLabel: "Unknown speaker" });
    expect(groupTranscriptTurns([first, second])).toHaveLength(2);
    expect(groupTranscriptTurns([{ ...first, unknownId: "u1" }, { ...second, unknownId: "u2" }])).toHaveLength(2);
    expect(groupTranscriptTurns([{ ...first, unknownId: "u1" }, { ...second, unknownId: "u1" }])).toHaveLength(1);
    expect(groupTranscriptTurns([{ ...first, unknownId: "u1" }, { ...second, unknownId: "u1", speakerLabel: "New name" }])).toHaveLength(2);
    expect(groupTranscriptTurns([{ ...first, track_id: "t1" }, { ...second, track_id: "t1" }])).toHaveLength(2);
    expect(groupTranscriptTurns([{ ...first, track_id: "t1", stream_id: "s1" }, { ...second, track_id: "t1", stream_id: "s1" }])).toHaveLength(1);
    expect(groupTranscriptTurns([{ ...first, track_id: "t1", stream_id: "s1" }, { ...second, track_id: "t1", stream_id: "s2" }])).toHaveLength(2);
  });

  it("recomputes turns after revision updates while preserving source metadata", () => {
    const first = toSegment({ id: "0", start: 0, end: 1, text: "Hello", profile_id: "alex", track_id: "track", stream_id: "stream", device_id: "device" });
    expect(first).toMatchObject({ track_id: "track", stream_id: "stream", device_id: "device" });
    const rows = [first, segment("1", { track_id: "track", stream_id: "stream", device_id: "device" })];
    expect(groupTranscriptTurns(rows)).toHaveLength(1);
    const revised = mergeSegment(rows, { ...rows[1], personId: "jamie", revision: 1 });
    expect(groupTranscriptTurns(revised)).toHaveLength(2);
    expect(groupTranscriptTurns(mergeSegment(revised, { ...first, personId: "jamie", revision: 1 }))).toHaveLength(1);
  });

  it("uses the same chronological turns in Markdown and notes, with raw JSON intact", () => {
    const rows = [segment("0", { text: "I think" }), segment("1", { text: "this works." }), segment("2", { personId: "jamie", text: "Agreed." }), segment("3", { text: "Next." })];
    const meeting: Meeting = { title: "T", isSample: false, people: [{ id: "alex", name: "Alex", role: "room" }, { id: "jamie", name: "Jamie", role: "room" }], segments: rows, windows: [], duration: 4, summary: null };
    const markdown = toMarkdown(meeting);
    expect(markdown).toContain("**Alex** [00:00]: I think this works.");
    expect(markdown).toContain("- [00:00] I think this works.");
    expect(markdown).toContain("- [00:03] Next.");
    expect(markdown).not.toContain("- [00:00] I think this works. Next.");
    expect(JSON.parse(toJson(meeting)).segments.map((row: Segment) => row.id)).toEqual(["0", "1", "2", "3"]);
    expect(JSON.parse(toJson(meeting)).segments[1].text).toBe("this works.");
  });
});
