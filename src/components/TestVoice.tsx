import { useEffect, useRef, useState } from "react";
import { MicrophoneIcon, StopIcon } from "@phosphor-icons/react";
import { request } from "../lib/api";
import { audioErrorMessage, requestMic, stopStream, toWav, useLevel } from "../lib/audio";
import { Meter } from "./Enroll";

interface VoiceTestResult {
  speaker: string;
  profile_id: string | null;
  identification: { reason?: string };
  scores?: { profile_id: string; speaker: string; score: number | null }[];
}

export function TestVoice({ hasProfiles, onCancel }: { hasProfiles: boolean; onCancel: () => void }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording" | "checking">("idle");
  const [result, setResult] = useState<VoiceTestResult | null>(null);
  const [error, setError] = useState("");
  const active = useRef(true);
  const busy = useRef(false);
  const microphone = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const controller = useRef<AbortController | null>(null);
  const level = useLevel(stream);

  const stop = () => {
    clearTimeout(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      stop(); stopStream(microphone.current);
      controller.current?.abort();
    };
  }, []);

  const record = async () => {
    if (busy.current || !hasProfiles) return;
    busy.current = true;
    setPhase("requesting"); setResult(null); setError("");
    try {
      const mic = await requestMic();
      if (!active.current) { stopStream(mic); return; }
      microphone.current = mic;
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(mic);
      let failed = false;
      rec.ondataavailable = (event) => chunks.push(event.data);
      rec.onerror = () => {
        failed = true; clearTimeout(timer.current); stopStream(mic); microphone.current = null;
        rec.onstop = null;
        if (rec.state === "recording") rec.stop();
        busy.current = false;
        if (active.current) {
          setStream(null); setPhase("idle"); setError("Recording stopped unexpectedly. Please try again.");
        }
      };
      rec.onstop = async () => {
        clearTimeout(timer.current); stopStream(mic); microphone.current = null;
        if (!active.current || failed) return;
        setStream(null); setPhase("checking");
        const abort = new AbortController(); controller.current = abort;
        try {
          const wav = await toWav(new Blob(chunks, { type: rec.mimeType }));
          if (!active.current) return;
          const body = new FormData(); body.append("file", wav, "voice-test.wav");
          const response = await request<VoiceTestResult>("/api/voice-test", { method: "POST", body, signal: abort.signal });
          if (active.current) setResult(response);
        } catch (error) {
          if (active.current) setError(error instanceof Error ? error.message : "Couldn't test this voice. Please try again.");
        } finally {
          busy.current = false;
          if (active.current) setPhase("idle");
        }
      };
      rec.start(); recorder.current = rec;
      setStream(mic); setPhase("recording");
      timer.current = setTimeout(stop, 10_000);
    } catch (error) {
      stopStream(microphone.current); microphone.current = null; busy.current = false;
      if (active.current) { setPhase("idle"); setError(audioErrorMessage(error, "mic")); }
    }
  };

  return <section className="enroll" aria-label="Test voice" aria-busy={phase === "checking"}>
    <h2>Test voice</h2>
    <p className="muted">Speak naturally for 3–5 seconds, then press Stop to see whose voice it is. Recording stops after 10 seconds. This test checks all saved voices without saving the clip.</p>
    {!hasProfiles && <p className="muted">Save a voice first, then come back to test it.</p>}
    {stream ? <div className="recording">
      <Meter level={level} /><span>Listening…</span>
      <button type="button" className="btn" onClick={stop}><StopIcon weight="fill" /> Stop and identify</button>
    </div> : <div className="enroll-actions">
      <button type="button" className="btn primary" disabled={!hasProfiles || phase !== "idle"} onClick={record}>
        <MicrophoneIcon /> {phase === "requesting" ? "Waiting for microphone…" : phase === "checking" ? "Checking voice…" : result ? "Test again" : "Start test"}
      </button>
    </div>}
    <div role="status" aria-live="polite" aria-atomic="true">
      {phase === "checking" && <p>Comparing with saved voices…</p>}
      {result && <><p>Speaker: <strong>{result.speaker}</strong></p>
        {result.profile_id === null && <p className="muted">{
          result.identification.reason === "no_profiles" ? "Save a voice first, then come back to test it."
            : result.identification.reason === "no_speech" ? "No speech heard. Try again with a clear spoken phrase."
            : result.identification.reason === "embedding_unavailable" ? "Couldn't analyze this recording. Please try again."
            : "No confident match. Try a longer, clear sample or save this person's voice."
        }</p>}</>}
    </div>
    {result?.scores && result.scores.length > 0 && <div>
      <h3>Similarity to saved voices</h3>
      <p className="muted">Higher is more similar (−1 to 1). These scores are not accuracy percentages.</p>
      <table style={{ width: "100%", textAlign: "left", marginTop: 12 }}>
        <thead><tr><th scope="col">Speaker</th><th scope="col" style={{ textAlign: "right" }}>Similarity</th></tr></thead>
        <tbody>{result.scores.map((entry) => <tr key={entry.profile_id}>
          <th scope="row" style={{ fontWeight: 400, padding: "8px 0" }}>{entry.speaker}</th>
          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{entry.score === null ? "Unavailable" : entry.score.toFixed(3)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    <button type="button" className="btn" onClick={onCancel}>Back to saved voices</button>
  </section>;
}
