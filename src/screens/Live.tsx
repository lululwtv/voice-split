import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleNotchIcon, FastForwardIcon, PauseIcon, PictureInPictureIcon, PlayIcon, StopIcon, WarningIcon } from "@phosphor-icons/react";
import { SpeakerSelect, whoStyle, NameVoice } from "../components/people";
import type { Engine } from "../engine/types";
import { correctSpeaker, loadMeeting, mergeSegment, request, roomPath } from "../lib/api";
import { loadPeople } from "../lib/peopleStore";
import { liveStatus, type LiveStatus } from "../lib/liveStatus";
import { canPopOut, openPopOut } from "../lib/popOut";
import { formatTime, isCorrected } from "../lib/stats";
import type { Meeting, Person, Segment, Summary, VoiceWindow } from "../types";

const SUMMARY_TIMEOUT_MS = 90_000;

const statusText: Record<LiveStatus, string> = {
  listening: "Listening",
  quiet: "Quiet",
  behind: "Running behind",
  paused: "Paused",
  lost: "Connection lost",
  finished: "Meeting finished",
};

function useTrackEnded(stream: MediaStream | null, onEnded: () => void) {
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track) return;
    track.addEventListener("ended", onEnded);
    return () => track.removeEventListener("ended", onEnded);
  }, [stream]);
}

function WrapUp(props: { onSkip: () => void }) {
  return (
    <div className="wrapup">
      <h1>Finishing transcript<CircleNotchIcon size={34} className="spin" /></h1>
      <button className="link-btn" onClick={props.onSkip}>Skip</button>
    </div>
  );
}

export function Live(props: {
  createEngine: () => Engine;
  roomId?: string;
  initialPeople: Person[];
  isSample: boolean;
  initialPopup: Window | null;
  mic: MediaStream | null;
  tab: MediaStream | null;
  onReconnectMic: () => Promise<boolean>;
  onReconnectTab: () => Promise<boolean>;
  onEnd: (meeting: Meeting) => void;
}) {
  const [people, setPeople] = useState(props.initialPeople);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [engineLost, setEngineLost] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState(0);
  const [silentSeconds, setSilentSeconds] = useState(0);
  const [micLost, setMicLost] = useState(false);
  const [tabLost, setTabLost] = useState(false);
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [wrapping, setWrapping] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [popup, setPopup] = useState<Window | null>(props.initialPopup);
  const engine = useRef<Engine | null>(null);
  const windows = useRef<VoiceWindow[]>([]);
  const duration = useRef(0);
  const feed = useRef<HTMLOListElement>(null);

  useEffect(() => {
    popup?.addEventListener("pagehide", () => setPopup(null));
  }, [popup]);

  useEffect(() => {
    const running = props.createEngine();
    engine.current = running;
    let lastSound = 0;
    running.start((event) => {
      switch (event.type) {
        case "activity":
          setLevels(event.levels);
          setElapsed(event.elapsed);
          if (Object.keys(event.levels).length) lastSound = event.elapsed;
          setSilentSeconds(props.isSample ? event.elapsed - lastSound : 0);
          break;
        case "window":
          windows.current.push(event.window);
          break;
        case "segment":
          setSegments((list) => mergeSegment(list, event.segment));
          break;
        case "status":
          setDelaySeconds(event.delaySeconds);
          break;
        case "participants":
          void loadPeople().then((all) => setPeople(all.filter((p) => event.ids.includes(p.id))));
          break;
        case "error":
          setMessage(event.message ?? "The engine stopped.");
          setEngineLost(true);
          setLevels({});
          break;
        case "ended":
          duration.current = event.duration;
          setEnded(true);
          break;
        case "summary":
          setSummary(event.summary);
          break;
        case "summary_failed":
          setSummaryFailed(true);
          break;
      }
    });
    return () => running.stop();
  }, [props.createEngine]);

  useEffect(() => { engine.current?.reconnectAudio?.(); }, [props.mic, props.tab]);

  useTrackEnded(props.mic, () => setMicLost(true));
  useTrackEnded(props.tab, () => setTabLost(true));

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [segments.length]);

  const complete = (finalSummary: Summary | null) => {
    engine.current?.stop();
    props.onEnd({
      title: props.isSample ? "Launch planning" : "Meeting",
      isSample: props.isSample,
      people,
      segments,
      windows: props.isSample ? windows.current : segments.flatMap((s) => s.personId ? [{ start: s.start, end: s.end, personId: s.personId }] : []),
      duration: duration.current || elapsed,
      summary: finalSummary,
    });
  };

  // Leave for review as soon as the summary settles, or give up rather than strand the transcript.
  useEffect(() => {
    if (!wrapping) return;
    if (summary || summaryFailed || engineLost) {
      complete(summary);
      return;
    }
    const timer = setTimeout(() => complete(null), SUMMARY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [wrapping, summary, summaryFailed, engineLost]);

  const endMeeting = () => {
    popup?.close();
    if (!ended) engine.current?.finish();
    setWrapping(true);
  };

  const relabel = async (segment: Segment, personId: string | null) => {
    if (!props.roomId || !personId || saving) return;
    setSaving(segment.id); setMessage("");
    try { const saved = await correctSpeaker(props.roomId, segment, personId); setSegments((list) => mergeSegment(list, saved)); }
    catch (error) {
      setMessage((error as Error).message);
      try { const current = await loadMeeting({ id: props.roomId, title: "Meeting" }, people); setSegments((list) => current.segments.reduce(mergeSegment, list)); } catch { /* Keep the saved transcript visible. */ }
    } finally { setSaving(null); }
  };
  const refreshParticipants = async () => {
    if (!props.roomId) return;
    try {
      const [all, roster] = await Promise.all([loadPeople(), request<{participant_ids: string[]}>(`${roomPath(props.roomId)}/participants`)]);
      setPeople(all.filter((p) => roster.participant_ids.includes(p.id)));
    } catch (error) { setMessage((error as Error).message); }
  };

  const togglePause = () => {
    paused ? engine.current?.resume() : engine.current?.pause();
    setPaused(!paused);
  };

  const reconnect = async (kind: "mic" | "tab") => {
    setReconnectFailed(false);
    const ok = await (kind === "mic" ? props.onReconnectMic() : props.onReconnectTab());
    if (ok) (kind === "mic" ? setMicLost : setTabLost)(false);
    else setReconnectFailed(true);
  };

  if (wrapping) {
    return <main className="live-stage"><WrapUp onSkip={() => complete(summary)} /></main>;
  }

  const status = liveStatus({ paused, ended, engineLost, delaySeconds, silentSeconds });

  const panel = (
    <div className="live">
      <header className="live-head">
        <span className={`status ${status}`}>
          <i /> {statusText[status]}
        </span>
        <time>{formatTime(elapsed)}</time>
        {canPopOut() && !popup && (
          <button
            className="icon-btn"
            aria-label="Keep on top of other windows"
            title="Keep on top of other windows"
            onClick={() => openPopOut().then(setPopup).catch(() => {})}
          >
            <PictureInPictureIcon size={18} />
          </button>
        )}
      </header>
      {props.isSample && <span className="sample-tag">Sample</span>}
      {message && <p className="alert" role="alert">{message}</p>}
      {engineLost && !ended && (
        <p className="alert" role="alert"><WarningIcon /> Engine stopped. Lines saved.</p>
      )}
      {micLost && (
        <div className="alert" role="alert">
          <WarningIcon /> <span>Mic disconnected</span>
          <button className="btn" onClick={() => reconnect("mic")}>Reconnect</button>
        </div>
      )}
      {tabLost && (
        <div className="alert" role="alert">
          <WarningIcon /> <span>Tab stopped sharing</span>
          <button className="btn" onClick={() => reconnect("tab")}>Share again</button>
        </div>
      )}
      {reconnectFailed && (
        <p className="alert" role="alert"><WarningIcon /> Failed. Try from the Timbre tab.</p>
      )}
      {status === "behind" && <p className="note">{delaySeconds}s behind</p>}
      <ul className="speakers">
        {people.map((p) => {
          const level = levels[p.id] ?? 0;
          return (
            <li key={p.id} className={level > 0 ? "speaking" : ""} style={whoStyle(people, p.id)}>
              <span className="speaker-name">{p.name}</span>
              <span className="strand" aria-hidden>
                <i style={{ transform: `scaleY(${1 + level * 5})` }} />
              </span>
            </li>
          );
        })}
      </ul>
      <ol className="feed" ref={feed} aria-live="polite">
        {segments.map((s) => {
          const person = people.find((p) => p.id === s.personId);
          return (
            <li key={s.id} className="line" style={whoStyle(people, s.personId)}>
              <div className="line-head">
                {s.overlap ? (
                  <strong>Overlap</strong>
                ) : (
                  <SpeakerSelect people={people} value={s.personId} disabled={saving === s.id} unknownLabel={s.speakerLabel} confidence={s.confidence}
                    label={`Speaker of line at ${formatTime(s.start)}`}
                    onChange={(personId) => void relabel(s, personId)} />
                )}
                {person && isCorrected(s) && <span className="edited">Corrected</span>}
                <NameVoice roomId={props.roomId} segment={s} onSaved={(rows) => setSegments((list) => rows.reduce(mergeSegment, list))} />
                <time>{formatTime(s.start)}</time>
              </div>
              <p>{s.text}</p>
            </li>
          );
        })}
      </ol>
      <footer className="live-foot">
        <button className="link-btn" onClick={refreshParticipants}>Refresh participants</button>
        <div className="live-actions">
          {!ended && !engineLost && (
            <button className="btn" onClick={togglePause}>
              {paused ? <PlayIcon weight="fill" /> : <PauseIcon weight="fill" />} {paused ? "Resume" : "Pause"}
            </button>
          )}
          {!ended && !engineLost && props.isSample && (
            <button className="btn" onClick={() => engine.current?.finish()}>
              <FastForwardIcon weight="fill" /> Skip
            </button>
          )}
          <button className="btn primary" onClick={endMeeting}>
            <StopIcon weight="fill" /> {ended ? "Summary" : "End"}
          </button>
        </div>
      </footer>
    </div>
  );

  return (
    <main className="live-stage">
      {popup ? (
        <>
          {createPortal(panel, popup.document.body)}
          <div className="popped">
            <h2>Floating</h2>
          </div>
        </>
      ) : (
        panel
      )}
    </main>
  );
}
