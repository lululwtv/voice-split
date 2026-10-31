import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../lib/api";
import { requestMic, toWav } from "../lib/audio";
import { TestVoice } from "./TestVoice";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], index: 0, refIndex: 0, mounted: false, effects: [] as (() => void | (() => void))[] }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refIndex++] ?? (hooks.refs[hooks.refIndex - 1] = { current: initial }),
  useEffect: (effect: () => void | (() => void)) => { if (!hooks.mounted) hooks.effects.push(effect); },
}));
vi.mock("../lib/api", () => ({ request: vi.fn() }));
vi.mock("../lib/audio", async (original) => ({
  ...await original<typeof import("../lib/audio")>(), requestMic: vi.fn(), toWav: vi.fn(), useLevel: () => 0,
}));
type Element = { type: unknown; props: { children?: unknown; [key: string]: unknown } };
function find(node: unknown, text: string): Element | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, text)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as Element;
  return element.type === "button" && JSON.stringify(element.props.children).includes(text) ? element : find(element.props.children, text);
}
function render(hasProfiles = true) {
  hooks.index = 0; hooks.refIndex = 0;
  const tree = TestVoice({ hasProfiles, onCancel: vi.fn() });
  const cleanups = hooks.effects.splice(0).map((effect) => effect()); hooks.mounted = true;
  return {
    tree,
    click: (text: string) => (find(tree, text)!.props.onClick as () => Promise<void>)(),
    unmount: () => cleanups.forEach((cleanup) => { if (typeof cleanup === "function") cleanup(); }),
  };
}
class Recorder {
  static instances: Recorder[] = [];
  static fail: "constructor" | "start" | null = null;
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: (() => Promise<void>) | null;
  onerror?: () => void;
  constructor() { if (Recorder.fail === "constructor") throw new Error("Unsupported"); Recorder.instances.push(this); }
  start() { if (Recorder.fail === "start") throw new Error("Cannot start"); this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["voice"]) }); return this.onstop?.(); }
}
function microphone() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers();
  hooks.states = []; hooks.refs = []; hooks.effects = []; hooks.mounted = false;
  Recorder.instances = []; Recorder.fail = null; vi.stubGlobal("MediaRecorder", Recorder);
  vi.mocked(toWav).mockResolvedValue(new Blob(["wav"], { type: "audio/wav" }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("voice test", () => {
  it.each([{ speaker: "Maya", profile_id: "maya" }, { speaker: "Unknown", profile_id: null }])("shows $speaker after uploading only a test clip", async (result) => {
    const mic = microphone(); vi.mocked(requestMic).mockResolvedValue(mic.stream);
    vi.mocked(request).mockResolvedValue({ ...result, identification: {} });
    const view = render(); await view.click("Start test");
    await Recorder.instances[0].stop();
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(toWav).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("/api/voice-test", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    const body = vi.mocked(request).mock.calls[0][1]!.body as FormData;
    expect([...body.keys()]).toEqual(["file"]);
    expect(JSON.stringify(render().tree)).toContain(result.speaker);
    view.unmount();
  });
  it("automatically stops at ten seconds", async () => {
    const mic = microphone(); vi.mocked(requestMic).mockResolvedValue(mic.stream);
    vi.mocked(request).mockResolvedValue({ speaker: "Unknown", profile_id: null, identification: {} });
    const view = render(); await view.click("Start test"); await vi.advanceTimersByTimeAsync(10_000);
    expect(Recorder.instances[0].state).toBe("inactive"); expect(request).toHaveBeenCalledOnce(); view.unmount();
  });
  it("releases a late permission grant after leaving", async () => {
    const mic = microphone(); let grant!: (stream: MediaStream) => void;
    vi.mocked(requestMic).mockReturnValue(new Promise((resolve) => { grant = resolve; }));
    const view = render(); const pending = view.click("Start test"); view.unmount(); grant(mic.stream); await pending;
    expect(mic.stop).toHaveBeenCalledOnce(); expect(Recorder.instances).toHaveLength(0);
  });
  it("releases capture on unmount without sending a test", async () => {
    const mic = microphone(); vi.mocked(requestMic).mockResolvedValue(mic.stream);
    const view = render(); await view.click("Start test"); view.unmount();
    expect(mic.stop).toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  });
  it.each(["constructor", "start"] as const)("releases capture after recorder %s fails", async (failure) => {
    const mic = microphone(); vi.mocked(requestMic).mockResolvedValue(mic.stream); Recorder.fail = failure;
    const view = render(); await view.click("Start test"); expect(mic.stop).toHaveBeenCalledOnce();
    expect(JSON.stringify(render().tree)).toContain("Couldn't reach the mic."); view.unmount();
  });
  it("does not upload a failed recording", async () => {
    const mic = microphone(); vi.mocked(requestMic).mockResolvedValue(mic.stream);
    const view = render(); await view.click("Start test"); Recorder.instances[0].onerror?.(); await Recorder.instances[0].stop();
    expect(mic.stop).toHaveBeenCalled(); expect(request).not.toHaveBeenCalled(); view.unmount();
  });
  it("shows API errors and allows retry", async () => {
    const mic = microphone(); vi.mocked(requestMic).mockResolvedValue(mic.stream);
    vi.mocked(request).mockRejectedValue(new Error("No speech detected. Please try again."));
    const view = render(); await view.click("Start test"); await Recorder.instances[0].stop();
    expect(JSON.stringify(render().tree)).toContain("No speech detected");
    expect(find(render().tree, "Start test")!.props.disabled).toBe(false); view.unmount();
  });
  it("explains that a voice must be saved first", () => {
    const view = render(false); expect(find(view.tree, "Start test")!.props.disabled).toBe(true);
    expect(JSON.stringify(view.tree)).toContain("Save a voice first"); view.unmount();
  });
  it.each([
    ["no_profiles", "Save a voice first"],
    ["no_speech", "No speech heard"],
    ["embedding_unavailable", "Couldn't analyze this recording"],
  ])("explains an inconclusive test caused by %s", async (reason, message) => {
    const mic = microphone(); vi.mocked(requestMic).mockResolvedValue(mic.stream);
    vi.mocked(request).mockResolvedValue({ speaker: "Unknown", profile_id: null, identification: { reason } });
    const view = render(); await view.click("Start test"); await Recorder.instances[0].stop();
    expect(JSON.stringify(render().tree)).toContain(message); view.unmount();
  });
  it("does not send audio when navigation happens during conversion", async () => {
    const mic = microphone(); vi.mocked(requestMic).mockResolvedValue(mic.stream);
    let finish!: (blob: Blob) => void;
    vi.mocked(toWav).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = render(); await view.click("Start test"); const pending = Recorder.instances[0].stop();
    view.unmount(); finish(new Blob(["wav"])); await pending;
    expect(request).not.toHaveBeenCalled();
  });
  it("aborts an in-flight check after leaving", async () => {
    const mic = microphone(); vi.mocked(requestMic).mockResolvedValue(mic.stream);
    let finish!: (value: unknown) => void;
    vi.mocked(request).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = render(); await view.click("Start test"); const pending = Recorder.instances[0].stop(); await Promise.resolve();
    const signal = vi.mocked(request).mock.calls[0][1]!.signal!;
    view.unmount(); expect(signal.aborted).toBe(true);
    finish({ speaker: "Maya", profile_id: "maya", identification: {} }); await pending;
    expect(hooks.states[2]).toBe(null);
  });
});
