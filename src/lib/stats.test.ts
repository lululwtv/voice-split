import { describe, expect, it } from "vitest";
import { buildSampleMeeting } from "../data/sampleMeeting";
import { createSimulatedEngine } from "../engine/simulatedEngine";
import type { Segment } from "../types";
import { toMarkdown } from "./export";
import { formatTime, labelAccuracy, talkTime } from "./stats";

const line = (over: Partial<Segment>): Segment => ({
  id: "x", start: 0, end: 1, text: "", personId: "a", originalPersonId: "a", matches: [], ...over,
});

describe("labelAccuracy", () => {
  it("counts changed and unnamed lines as wrong and ignores overlaps", () => {
    const result = labelAccuracy([
      line({}),
      line({}),
      line({ personId: "b" }),
      line({ personId: null, originalPersonId: null }),
      line({ personId: null, originalPersonId: null, overlap: true }),
    ]);
    expect(result).toEqual({ total: 4, changed: 1, unnamed: 1, percent: 50 });
  });

  it("does not double count a line that was renamed then cleared", () => {
    const result = labelAccuracy([line({ personId: null })]);
    expect(result.percent).toBeLessThanOrEqual(100);
    expect(result.percent).toBeGreaterThanOrEqual(0);
    expect(result.changed + result.unnamed).toBe(1);
  });

  it("handles an empty meeting", () => {
    expect(labelAccuracy([]).percent).toBe(0);
  });
});

describe("sample meeting", () => {
  it("gives every person talk time and formats times", () => {
    const { people, windows } = buildSampleMeeting();
    expect(talkTime(people, windows).every((t) => t.seconds > 0)).toBe(true);
    expect(formatTime(75)).toBe("01:15");
  });

  it("delivers every line then ends when finished early", () => {
    const engine = createSimulatedEngine();
    const types: string[] = [];
    engine.start((e) => types.push(e.type));
    engine.finish();
    expect(types.filter((t) => t === "segment")).toHaveLength(buildSampleMeeting().segments.length);
    expect(types.at(-1)).toBe("ended");
  });

  it("exports labels into markdown", () => {
    const { people, segments, windows, duration } = buildSampleMeeting();
    const md = toMarkdown({ title: "T", isSample: true, people, segments, windows, duration });
    expect(md).toContain("**Maya** [00:01]");
    expect(md).toContain("Sample meeting");
    expect(md).toContain("Overlapping speech");
  });
});
