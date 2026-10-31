import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpeakerSelect } from "../components/people";
import { correctSpeaker, loadMeeting } from "../lib/api";
import type { Meeting, Segment } from "../types";
import { Review } from "./Review";

const hooks = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  ref: null as { current: unknown } | null,
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (initial: unknown) => hooks.ref ?? (hooks.ref = { current: initial }),
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));
vi.mock("../lib/api", async (original) => ({
  ...await original<typeof import("../lib/api")>(),
  correctSpeaker: vi.fn(), loadMeeting: vi.fn(),
}));

const segment: Segment = { id: "line", start: 0, end: 1, text: "Hello", personId: "alex", originalPersonId: "alex", matches: [], revision: 0 };
const meeting = (roomId: string): Meeting => ({ roomId, title: roomId, isSample: false, people: [{ id: "alex", name: "Alex", role: "room" }], segments: [segment], windows: [], duration: 1, summary: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function selectIn(node: unknown): { onChange: (id: string) => Promise<void> } | undefined {
  if (Array.isArray(node)) return node.map(selectIn).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as { type: unknown; props: { children?: unknown } };
  if (element.type === SpeakerSelect) return element.props as unknown as { onChange: (id: string) => Promise<void> };
  return selectIn(element.props.children);
}
function render(roomId: string, onChange: (meeting: Meeting) => void) {
  const view = Review({ meeting: meeting(roomId), onChange });
  const cleanup = hooks.effects.splice(0).map((effect) => effect()).filter((fn): fn is () => void => typeof fn === "function");
  return { select: selectIn(view)!, unmount: () => cleanup.forEach((fn) => fn()) };
}
beforeEach(() => { vi.clearAllMocks(); hooks.effects = []; hooks.ref = null; });

describe("review correction ownership", () => {
  it("ignores a completed correction after leaving review", async () => {
    const patch = deferred<Segment>();
    vi.mocked(correctSpeaker).mockReturnValue(patch.promise);
    const onChange = vi.fn();
    const view = render("old-room", onChange);
    const pending = view.select.onChange("alex");
    view.unmount();
    patch.resolve({ ...segment, revision: 1, assignment_source: "manual" });
    await pending;
    expect(onChange).not.toHaveBeenCalled();
  });
  it("does not replace a newly opened room with an old room's correction", async () => {
    const patch = deferred<Segment>();
    vi.mocked(correctSpeaker).mockReturnValue(patch.promise);
    const onChange = vi.fn();
    const previous = render("old-room", onChange);
    const pending = previous.select.onChange("alex");
    render("new-room", onChange);
    patch.resolve({ ...segment, revision: 1 });
    await pending;
    expect(onChange).not.toHaveBeenCalled();
  });
  it("ignores conflict recovery that finishes after navigation", async () => {
    const reload = deferred<Meeting>();
    vi.mocked(correctSpeaker).mockRejectedValue(new Error("Revision conflict"));
    vi.mocked(loadMeeting).mockReturnValue(reload.promise);
    const onChange = vi.fn();
    const view = render("old-room", onChange);
    const pending = view.select.onChange("alex");
    await Promise.resolve();
    expect(loadMeeting).toHaveBeenCalledOnce();
    view.unmount();
    reload.resolve(meeting("old-room"));
    await pending;
    expect(onChange).not.toHaveBeenCalled();
  });
  it("applies a correction while the same room remains open", async () => {
    vi.mocked(correctSpeaker).mockResolvedValue({ ...segment, revision: 1, assignment_source: "manual" });
    const onChange = vi.fn();
    const view = render("current-room", onChange);
    await view.select.onChange("alex");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ roomId: "current-room", segments: [expect.objectContaining({ revision: 1 })] }));
  });
});
