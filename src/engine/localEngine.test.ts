import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalEngine } from "./localEngine";
import type { Engine, EngineEvent } from "./types";

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; this.onclose?.(); });
  constructor(readonly url: URL) { Socket.instances.push(this); }
  open() { this.readyState = Socket.OPEN; this.onopen?.(); }
  receive(event: object) { this.onmessage?.({ data: JSON.stringify(event) }); }
}

class Audio {
  static instances: Audio[] = [];
  state = "running";
  destination = {};
  audioWorklet = { addModule: vi.fn(async () => {}) };
  resume = vi.fn(async () => {});
  close = vi.fn(async () => { this.state = "closed"; });
  source = { connect: vi.fn(), disconnect: vi.fn() };
  createMediaStreamSource = vi.fn(() => this.source);
  createGain = () => ({ gain: { value: 1 }, connect: vi.fn() });
  constructor() { Audio.instances.push(this); }
}

class Worklet {
  static instances: Worklet[] = [];
  port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> } = {
    onmessage: null, postMessage: vi.fn(),
  };
  connect = vi.fn((target: unknown) => target);
  disconnect = vi.fn();
  constructor() { Worklet.instances.push(this); }
  receive(data: unknown) { this.port.onmessage?.({ data }); }
}

const engines: Engine[] = [];
const settle = () => vi.advanceTimersByTimeAsync(0);

async function start() {
  const stream = { getAudioTracks: () => [{ readyState: "live" }] } as unknown as MediaStream;
  const engine = createLocalEngine("room/one", () => [stream]);
  engines.push(engine);
  const events: EngineEvent[] = [];
  engine.start((event) => events.push(event));
  const socket = Socket.instances.at(-1)!;
  socket.open();
  await settle();
  return { engine, events, socket, worklet: Worklet.instances.at(-1)!, audio: Audio.instances.at(-1)! };
}

beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  Audio.instances = [];
  Worklet.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("AudioContext", Audio);
  vi.stubGlobal("AudioWorkletNode", Worklet);
  vi.stubGlobal("location", { href: "https://localhost:8765/app", protocol: "https:" });
});

afterEach(async () => {
  engines.splice(0).forEach((engine) => engine.stop());
  Worklet.instances.forEach((worklet) => worklet.receive({ type: "flushed" }));
  await settle();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("local audio engine", () => {
  it("opens the exact room v2 websocket and sends captured PCM", async () => {
    const { socket, worklet, audio } = await start();
    expect(socket.url.protocol).toBe("wss:");
    expect(socket.url.host).toBe("localhost:8765");
    expect(socket.url.pathname).toBe("/api/v2/rooms/room%2Fone/audio");
    expect(socket.url.searchParams.get("device")).toMatch(/^[a-f0-9-]{36}$/);
    expect(audio.createMediaStreamSource).toHaveBeenCalledOnce();
    const pcm = new Int16Array([123, -456]);
    worklet.receive(pcm);
    expect(socket.send).toHaveBeenCalledWith(pcm.buffer);
  });

  it("pauses by sending the final PCM before requesting the server flush", async () => {
    const { engine, socket, worklet, audio } = await start();
    engine.pause();
    expect(worklet.port.postMessage).toHaveBeenCalledWith("flush");
    expect(socket.send).not.toHaveBeenCalled();
    const tail = new Int16Array([7]);
    worklet.receive(tail);
    worklet.receive({ type: "flushed" });
    await settle();
    expect(socket.send.mock.calls[0][0]).toBe(tail.buffer);
    expect(JSON.parse(socket.send.mock.calls[1][0])).toEqual({ type: "flush", request_id: expect.any(String) });
    expect(audio.close).toHaveBeenCalledOnce();
  });

  it("finishes only after pending transcripts and the server flush acknowledgement", async () => {
    const { engine, events, socket, worklet } = await start();
    engine.finish();
    worklet.receive({ type: "flushed" });
    await settle();
    const request = JSON.parse(socket.send.mock.calls.at(-1)![0]);
    expect(request).toEqual({ type: "flush", request_id: expect.any(String) });
    expect(events.some((event) => event.type === "ended")).toBe(false);
    socket.receive({ type: "transcript", id: "tail", start: 1, end: 2.5, text: "Last words", profile_id: "alice", revision: 1 });
    expect(events.at(-1)?.type).toBe("segment");
    expect(events.some((event) => event.type === "ended")).toBe(false);
    socket.receive({ type: "flushed", request_id: request.request_id });
    expect(events.map((event) => event.type)).toEqual(["segment", "ended", "summary_failed"]);
    expect(events.find((event) => event.type === "ended")).toEqual({ type: "ended", duration: 2.5 });
    socket.receive({ type: "flushed", request_id: request.request_id });
    expect(events.filter((event) => event.type === "ended")).toHaveLength(1);
  });

  it("ignores an earlier pause acknowledgement while finishing resumed audio", async () => {
    const { engine, events, socket, worklet } = await start();
    engine.pause();
    worklet.receive({ type: "flushed" });
    await settle();
    const pauseRequest = JSON.parse(socket.send.mock.calls.at(-1)![0]);
    engine.resume();
    await settle();
    engine.finish();
    Worklet.instances.at(-1)!.receive({ type: "flushed" });
    await settle();
    const finishRequest = JSON.parse(socket.send.mock.calls.at(-1)![0]);
    expect(finishRequest.request_id).not.toBe(pauseRequest.request_id);
    socket.receive({ type: "flushed", request_id: pauseRequest.request_id });
    expect(events.some((event) => event.type === "ended")).toBe(false);
    socket.receive({ type: "transcript", id: "resumed", start: 2, end: 3, text: "Resumed tail", revision: 0 });
    socket.receive({ type: "flushed", request_id: finishRequest.request_id });
    expect(events.filter((event) => event.type === "segment")).toHaveLength(1);
    expect(events.filter((event) => event.type === "ended")).toEqual([{ type: "ended", duration: 3 }]);
  });

  it("does not emit late socket or timer events after stop", async () => {
    const { engine, events, socket, worklet } = await start();
    engine.stop();
    const stoppedCount = events.length;
    worklet.receive({ type: "flushed" });
    socket.receive({ type: "transcript", id: "late", start: 0, end: 1, text: "Late" });
    socket.onerror?.();
    socket.onclose?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toHaveLength(stoppedCount);
  });

  it("surfaces backend errors and detaches capture", async () => {
    const { events, socket, worklet, audio } = await start();
    socket.receive({ type: "error", message: "Transcription backlog is full." });
    expect(events.at(-1)).toEqual({ type: "error", message: "Transcription backlog is full." });
    expect(worklet.port.postMessage).toHaveBeenCalledWith("flush");
    worklet.receive({ type: "flushed" });
    await settle();
    expect(audio.close).toHaveBeenCalledOnce();
  });

  it("reports a stalled connection without queuing more PCM", async () => {
    const { events, socket, worklet } = await start();
    socket.bufferedAmount = 1024 * 1024 + 1;
    worklet.receive(new Int16Array([7]));
    expect(socket.send).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("too slow") });
    expect(worklet.port.postMessage).toHaveBeenCalledWith("flush");
  });

  it("reports missing live audio sources instead of appearing to record", async () => {
    const engine = createLocalEngine("room", () => []);
    engines.push(engine);
    const events: EngineEvent[] = [];
    engine.start((event) => events.push(event));
    Socket.instances.at(-1)!.open();
    await settle();
    expect(events).toContainEqual({ type: "error", message: expect.any(String) });
    expect(Audio.instances.every((audio) => audio.createMediaStreamSource.mock.calls.length === 0)).toBe(true);
  });
});
