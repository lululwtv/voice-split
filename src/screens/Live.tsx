import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircleIcon, CircleNotchIcon, FastForwardIcon, PauseIcon, PictureInPictureIcon, PlayIcon, PlusIcon, StopIcon, WarningIcon } from "@phosphor-icons/react";
import { Avatar, colorOf, SpeakerSelect } from "../components/people";
import type { Engine } from "../engine/types";
import { liveStatus, type LiveStatus } from "../lib/liveStatus";
import { canPopOut, openPopOut } from "../lib/popOut";
import { formatTime } from "../lib/stats";
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

function WrapUp(props: { summaryFailed: boolean; onSkip: () => void }) {
  return (
    <div className="wrapup">
      <h1>Wrapping up your meeting</h1>
      <ul>
        <li className="done"><CheckCircleIcon size={22} weight="fill" /> Transcript saved</li>
        <li className="done"><CheckCircleIcon size={22} weight="fill" /> Speakers labelled</li>
        <li><CircleNotchIcon size={22} className="spin" /> Writing the summary</li>
      </ul>
      <button className="link-btn" onClick={props.onSkip}>See the transcript now</button>
    </div>
  );
}

export function Live(props: {
  createEngine: () => Engine;
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
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
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
          setSilentSeconds(event.elapsed - lastSound);
          break;
        case "window":
          windows.current.push(event.window);
          break;
        case "segment":
          setSegments((list) => [...list, event.segment]);
          break;
        case "status":
          setDelaySeconds(event.delaySeconds);
          break;
        case "error":
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

  useTrackEnded(props.mic, () => setMicLost(true));
  useTrackEnded(props.tab, () => setTabLost(true));

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [segments.length]);

  const complete = (finalSummary: Summary | null) => {
    engine.current?.stop();
    props.onEnd({
      title: props.isSample ? "Sample: launch planning" : "Meeting",
      isSample: props.isSample,
      people,
      segments,
      windows: windows.current,
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

  const addPerson = () => {
    if (!newName.trim()) return;
    setPeople((list) => [...list, { id: crypto.randomUUID(), name: newName.trim(), role: "room" }]);
    setNewName("");
    setAdding(false);
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
    return <main className="live-stage"><WrapUp summaryFailed={summaryFailed} onSkip={() => complete(summary)} /></main>;
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
      {props.isSample && <p className="sample-tag">Sample meeting. Voices and labels are simulated.</p>}
      {engineLost && !ended && (
        <p className="alert" role="alert"><WarningIcon /> The speech engine stopped. Lines so far are safe. Restart it, or end the meeting to keep what you have.</p>
      )}
      {micLost && (
        <div className="alert" role="alert">
          <WarningIcon /> <span>The microphone disconnected, so the room isn't being heard.</span>
          <button className="btn" onClick={() => reconnect("mic")}>Reconnect</button>
        </div>
      )}
      {tabLost && (
        <div className="alert" role="alert">
          <WarningIcon /> <span>The call tab stopped sharing, so people online aren't being heard.</span>
          <button className="btn" onClick={() => reconnect("tab")}>Share again</button>
        </div>
      )}
      {reconnectFailed && (
        <p className="alert" role="alert"><WarningIcon /> That didn't work. Go to the Timbre tab in Chrome and try there.</p>
      )}
      {status === "behind" && <p className="note">Lines are about {delaySeconds} seconds behind. Nothing is lost.</p>}
      {status === "quiet" && <p className="note">No voices for a while. If people are talking, check the mic isn't muted.</p>}
      <ul className="speakers">
        {people.map((p) => {
          const level = levels[p.id] ?? 0;
          return (
            <li key={p.id} className={level > 0 ? "speaking" : ""}>
              <Avatar people={people} person={p} />
              <span className="speaker-name">{p.name}</span>
              <span className="bars" style={{ color: colorOf(people, p.id) }} aria-hidden>
                {[0.6, 1, 0.75, 0.45].map((scale, i) => (
                  <i key={i} style={{ transform: `scaleY(${Math.max(0.12, level * scale)})` }} />
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      <ol className="feed" ref={feed} aria-live="polite">
        {segments.length === 0 && <li className="feed-empty">Lines appear here a few seconds after they're spoken.</li>}
        {segments.map((s) => {
          const person = people.find((p) => p.id === s.personId);
          return (
            <li key={s.id} className="line">
              <div className="line-head">
                <Avatar people={people} person={person} />
                {s.overlap ? (
                  <strong>Several people</strong>
                ) : person ? (
                  <strong>{person.name}</strong>
                ) : (
                  <SpeakerSelect
                    people={people}
                    value={null}
                    label="Name this speaker"
                    onChange={(personId) =>
                      setSegments((list) => list.map((x) => (x.id === s.id ? { ...x, personId } : x)))
                    }
                  />
                )}
                <time>{formatTime(s.start)}</time>
              </div>
              <p>{s.text}</p>
            </li>
          );
        })}
      </ol>
      <footer className="live-foot">
        {adding ? (
          <form
            className="add-inline"
            onSubmit={(e) => {
              e.preventDefault();
              addPerson();
            }}
          >
            <input autoFocus aria-label="New person's name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" />
            <button className="btn">Add</button>
          </form>
        ) : (
          <button className="link-btn" onClick={() => setAdding(true)}>
            <PlusIcon /> Someone joined late
          </button>
        )}
        <div className="live-actions">
          {!ended && !engineLost && (
            <button className="btn" onClick={togglePause}>
              {paused ? <PlayIcon weight="fill" /> : <PauseIcon weight="fill" />} {paused ? "Resume" : "Pause"}
            </button>
          )}
          {!ended && !engineLost && props.isSample && (
            <button className="btn" onClick={() => engine.current?.finish()}>
              <FastForwardIcon weight="fill" /> Skip to end
            </button>
          )}
          <button className="btn primary" onClick={endMeeting}>
            <StopIcon weight="fill" /> {ended ? "See summary" : "End meeting"}
          </button>
        </div>
        <small>Everything is processed on this computer.</small>
      </footer>
    </div>
  );

  return (
    <main className="live-stage">
      {popup ? (
        <>
          {createPortal(panel, popup.document.body)}
          <div className="popped">
            <h2>Timbre is floating beside your call</h2>
            <p>It stays on top of other windows. Keep this tab open until the meeting ends.</p>
          </div>
        </>
      ) : (
        panel
      )}
    </main>
  );
}
