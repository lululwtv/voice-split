import type { Engine, EngineEvent } from "./types";
import { roomPath, toSegment, type RawSegment } from "../lib/api";

/** Streams the connected sources as mono 16kHz PCM to the local engine. */
export function createLocalEngine(roomId: string, getStreams: () => (MediaStream | null)[]): Engine {
  let emit: (event: EngineEvent) => void = () => {};
  let socket: WebSocket | null = null;
  let context: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let sources: MediaStreamAudioSourceNode[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let active = true;
  let paused = false;
  let finishing = false;
  let completed = false;
  let elapsed = 0;
  let acknowledged: (() => void) | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let finishRequestId: string | undefined;
  let captureEpoch = 0;
  let detached: Promise<void> = Promise.resolve();

  const detach = () => {
    captureEpoch += 1;
    sources.forEach((source) => source.disconnect());
    sources = [];
    const current = node;
    const audio = context;
    node = null;
    context = null;
    detached = (async () => {
      if (current) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 250);
          acknowledged = () => { clearTimeout(timeout); resolve(); };
          current.port.postMessage("flush");
        });
        current.disconnect();
      }
      if (audio && audio.state !== "closed") await audio.close();
    })();
    return detached;
  };
  const capture = async () => {
    await detached;
    if (!active || paused || finishing) return;
    const streams = getStreams().filter((s): s is MediaStream => !!s && s.getAudioTracks().some((t) => t.readyState === "live"));
    if (!streams.length) throw new Error("Connect a microphone or share a tab with audio before listening.");
    const epoch = ++captureEpoch;
    const audio = new AudioContext();
    context = audio;
    await audio.resume();
    await audio.audioWorklet.addModule(`${import.meta.env.BASE_URL}pcm-worklet.js`);
    if (!active || paused || finishing || epoch !== captureEpoch) { if (audio.state !== "closed") await audio.close(); return; }
    const worklet = new AudioWorkletNode(audio, "pcm-capture");
    node = worklet;
    worklet.port.onmessage = ({ data }) => {
      if (data instanceof Int16Array && socket?.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount > 1024 * 1024) { emit({ type: "error", message: "Audio connection is too slow. End and reopen the room to reconnect." }); void detach(); return; }
        socket.send(data.buffer as ArrayBuffer);
      } else if (data?.type === "flushed") acknowledged?.();
    };
    const silent = audio.createGain();
    silent.gain.value = 0;
    worklet.connect(silent).connect(audio.destination);
    sources = streams
      .map((stream) => { const source = audio.createMediaStreamSource(stream); source.connect(worklet); return source; });
    emit({ type: "audio_ready" });
  };
  const complete = () => {
    if (!finishing || !active || completed) return;
    completed = true;
    clearTimeout(finishTimer);
    clearInterval(timer);
    emit({ type: "ended", duration: elapsed });
    emit({ type: "summary_failed" });
  };
  return {
    start(onEvent) {
      emit = onEvent;
      const url = new URL(`${roomPath(roomId)}/audio`, location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("device", crypto.randomUUID());
      socket = new WebSocket(url);
      socket.onopen = () => { if (active) void capture().catch((error: Error) => emit({ type: "audio_error", message: error.message })); };
      socket.onmessage = ({ data }) => {
        if (!active) return;
        const event = JSON.parse(data);
        if (event.type === "transcript") {
          const segment = toSegment(event as RawSegment);
          elapsed = Math.max(elapsed, segment.end);
          emit({ type: "segment", segment });
        } else if (event.type === "flushed" && event.request_id === finishRequestId && finishRequestId !== undefined) complete();
        else if (event.type === "participants") emit({ type: "participants", ids: event.participant_ids });
        else if (event.type === "error") { emit({ type: "error", message: event.message }); void detach(); }
        else if (event.type === "status") emit({ type: "status", delaySeconds: 0 });
      };
      socket.onclose = () => { if (active) { emit({ type: "error", message: "Room disconnected. Transcript is saved; reopen the meeting to continue." }); void detach(); } };
      socket.onerror = () => { if (active) emit({ type: "error", message: "Could not connect to the local engine." }); };
      timer = setInterval(() => {
        if (!paused && !finishing) elapsed += 0.25;
        emit({ type: "activity", levels: {}, elapsed });
      }, 250);
    },
    reconnectAudio() { if (active && !paused && !finishing && socket?.readyState === WebSocket.OPEN) void detach().then(capture).catch((error: Error) => emit({ type: "audio_error", message: error.message })); },
    pause() { paused = true; void detach().then(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "flush", request_id: crypto.randomUUID() })); }); },
    resume() { paused = false; void capture().catch((error: Error) => emit({ type: "audio_error", message: error.message })); },
    finish() {
      if (finishing) return;
      finishing = true;
      void detach().then(() => {
        if (!active) return;
        if (socket?.readyState !== WebSocket.OPEN) { complete(); return; }
        finishRequestId = crypto.randomUUID();
        socket.send(JSON.stringify({ type: "flush", request_id: finishRequestId }));
        finishTimer = setTimeout(() => { emit({ type: "error", message: "Finishing is taking longer than expected. Reopen the saved room to refresh its transcript." }); complete(); }, 90000);
      });
    },
    stop() { active = false; clearInterval(timer); clearTimeout(finishTimer); void detach(); socket?.close(); },
  };
}
