import { useEffect, useState } from "react";

/** Browser recorders emit WebM/MP4; the local decoder accepts lossless PCM WAV. */
export async function toWav(blob: Blob): Promise<Blob> {
  if (blob.size > 32 * 1024 * 1024) throw new Error("Choose an audio recording under 32 MB.");
  const context = new OfflineAudioContext(1, 1, 16000);
  let audio: AudioBuffer;
  try { audio = await context.decodeAudioData(await blob.arrayBuffer()); }
  catch { throw new Error("Couldn't decode this audio. Try a WAV recording."); }
  if (audio.duration > 60) throw new Error("Trim the recording to 60 seconds before uploading.");
  const buffer = new ArrayBuffer(44 + audio.length * 2);
  const view = new DataView(buffer);
  const word = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  word(0, "RIFF"); view.setUint32(4, 36 + audio.length * 2, true); word(8, "WAVE"); word(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, "data"); view.setUint32(40, audio.length * 2, true);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  for (let i = 0; i < audio.length; i++) {
    const sample = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + channel[i], 0) / channels.length));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

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
