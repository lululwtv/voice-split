import { useEffect, useState } from "react";

/** Live 0 to 1 loudness of a stream, for meters. */
export function useLevel(stream: MediaStream | null) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream || !stream.getAudioTracks().length) {
      setLevel(0);
      return;
    }
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
      setLevel(Math.min(1, rms * 4));
    }, 80);
    return () => {
      clearInterval(timer);
      void context.close();
    };
  }, [stream]);
  return level;
}

export async function requestMic() {
  // Browser voice processing removes the room's far-side voices, which we need to keep.
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
}

export async function requestMeetingTab() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("no-audio");
  }
  return stream;
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Remembers whether a stream has made any sound since it connected. */
export function useHeardSound(stream: MediaStream | null, level: number) {
  const [heard, setHeard] = useState(false);
  useEffect(() => setHeard(false), [stream]);
  useEffect(() => {
    if (level > 0.04) setHeard(true);
  }, [level]);
  return heard;
}

export function audioErrorMessage(error: unknown, source: "mic" | "tab") {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (message === "no-audio") return 'No sound. Turn on "Also share tab audio".';
  if (name === "NotAllowedError") {
    return source === "mic"
      ? "Mic blocked. Allow it in the address bar."
      : "Sharing cancelled.";
  }
  if (name === "NotFoundError") return "No mic found.";
  return source === "mic" ? "Couldn't reach the mic." : "Couldn't share that tab.";
}
