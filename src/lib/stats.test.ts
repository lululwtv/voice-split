import { describe, expect, it } from "vitest";
import { buildSampleMeeting, sampleSummary } from "../data/sampleMeeting";
import { liveStatus } from "./liveStatus";
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

  it("only cites transcript lines that exist", () => {
    const ids = new Set(buildSampleMeeting().segments.map((s) => s.id));
    const { decisions, actions, questions } = sampleSummary;
    for (const item of [...decisions, ...actions, ...questions]) {
      expect(item.sources.length).toBeGreaterThan(0);
      expect(item.sources.every((id) => ids.has(id))).toBe(true);
    }
  });

  it("exports labels into markdown", () => {
    const { people, segments, windows, duration } = buildSampleMeeting();
    const md = toMarkdown({ title: "T", isSample: true, people, segments, windows, duration, summary: sampleSummary });
    expect(md).toContain("**Wei Jie:** Send the final screenshots (by Monday)");
    expect(md).toContain("**Maya** [00:01]");
    expect(md).toContain("Sample meeting");
    expect(md).toContain("Overlapping speech");
  });
});

describe("liveStatus", () => {
  const base = { paused: false, ended: false, engineLost: false, delaySeconds: 0, silentSeconds: 0 };

  it("listens by default", () => expect(liveStatus(base)).toBe("listening"));
  it("says quiet after a long silence", () => expect(liveStatus({ ...base, silentSeconds: 21 })).toBe("quiet"));
  it("says behind when lines lag", () => expect(liveStatus({ ...base, delaySeconds: 11 })).toBe("behind"));
  it("puts a lost engine above everything but the end", () => {
    expect(liveStatus({ ...base, paused: true, engineLost: true })).toBe("lost");
    expect(liveStatus({ ...base, ended: true, engineLost: true })).toBe("finished");
  });
  it("does not call a paused meeting quiet", () => expect(liveStatus({ ...base, paused: true, silentSeconds: 99 })).toBe("paused"));
});
