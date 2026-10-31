import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestMic } from "../lib/audio";
import { Enroll } from "./Enroll";

const hooks = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[] }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));
vi.mock("../lib/audio", async (original) => ({
  ...await original<typeof import("../lib/audio")>(), requestMic: vi.fn(), useLevel: () => 0,
}));

type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
function find(node: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as Element;
  return predicate(element) ? element : find(element.props.children, predicate);
}
function render() {
  const tree = Enroll({ onAdd: vi.fn(), onCancel: vi.fn() });
  const cleanups = hooks.effects.splice(0).map((effect) => effect());
  const unmount = () => cleanups.forEach((cleanup) => { if (typeof cleanup === "function") cleanup(); });
  const button = find(tree, (element) => element.type === "button" && Array.isArray(element.props.children) && element.props.children.includes("Record sample"))!;
  const upload = find(tree, (element) => element.type === "input" && element.props.type === "file")!;
  return { record: button.props.onClick as () => Promise<void>, upload: upload.props.onChange as (event: unknown) => void, unmount };
}
class Recorder {
  static failure: "constructor" | "start" | null = null;
  static instances: Recorder[] = [];
  state = "inactive";
  mimeType = "audio/webm";
  onstop?: () => void;
  onerror?: () => void;
  constructor() {
    if (Recorder.failure === "constructor") throw new Error("Recorder unsupported");
    Recorder.instances.push(this);
  }
  start() { if (Recorder.failure === "start") throw new Error("Cannot start"); this.state = "recording"; }
  stop() { this.state = "inactive"; queueMicrotask(() => this.onstop?.()); }
}
function microphone() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  return { stream, stop };
}
beforeEach(() => {
  vi.clearAllMocks(); hooks.effects = []; Recorder.failure = null; Recorder.instances = [];
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice-sample");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("voice enrollment microphone lifecycle", () => {
  it("clears the countdown when the recorder stops unexpectedly", async () => {
    vi.useFakeTimers();
    const mic = microphone(); vi.mocked(requestMic).mockResolvedValue(mic.stream);
    const form = render();
    try {
      await form.record();
      await vi.advanceTimersByTimeAsync(20000);
      Recorder.instances[0].stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
      await form.record();
      await vi.advanceTimersByTimeAsync(25000);
      expect(Recorder.instances[1].state).toBe("recording");
    } finally { form.unmount(); vi.useRealTimers(); }
  });
  it("stops a microphone granted after the form was cancelled", async () => {
    const mic = microphone();
    let grant!: (stream: MediaStream) => void;
    vi.mocked(requestMic).mockReturnValue(new Promise((resolve) => { grant = resolve; }));
    const form = render(); const pending = form.record();
    form.unmount(); grant(mic.stream); await pending;
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(Recorder.instances).toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it.each(["constructor", "start"] as const)("releases the granted microphone after recorder %s failure", async (failure) => {
    const mic = microphone(); Recorder.failure = failure;
    vi.mocked(requestMic).mockResolvedValue(mic.stream);
    const form = render(); await form.record();
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    form.unmount();
  });
  it("revokes uploaded preview URLs when cancellation unmounts the form", () => {
    const form = render();
    form.upload({ target: { files: [new Blob(["public fixture"])], value: "sample.wav" } });
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    form.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:voice-sample");
  });
  it("stops active capture on unmount without creating a late preview", async () => {
    const mic = microphone(); vi.mocked(requestMic).mockResolvedValue(mic.stream);
    const form = render(); await form.record();
    expect(Recorder.instances[0].state).toBe("recording");
    form.unmount(); await Promise.resolve();
    expect(Recorder.instances[0].state).toBe("inactive");
    expect(mic.stop).toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
