import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FastForwardIcon, PauseIcon, PictureInPictureIcon, PlayIcon, PlusIcon, StopIcon } from "@phosphor-icons/react";
import { Avatar, colorOf, SpeakerSelect } from "../components/people";
import type { Engine } from "../engine/types";
import { formatTime } from "../lib/stats";
import type { Meeting, Person, Segment, VoiceWindow } from "../types";

function usePopOut() {
  const [popup, setPopup] = useState<Window | null>(null);
  const supported = "documentPictureInPicture" in window;

  const open = async () => {
    const win: Window = await (window as any).documentPictureInPicture.requestWindow({ width: 380, height: 680 });
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      win.document.head.appendChild(node.cloneNode(true));
    });
    win.document.title = "VoiceSplit";
    win.addEventListener("pagehide", () => setPopup(null));
    setPopup(win);
  };

  return { popup, supported, open };
}

export function Live(props: {
  createEngine: () => Engine;
  initialPeople: Person[];
  isSample: boolean;
  onEnd: (meeting: Meeting) => void;
}) {
  const [people, setPeople] = useState(props.initialPeople);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const engine = useRef<Engine | null>(null);
  const windows = useRef<VoiceWindow[]>([]);
  const duration = useRef(0);
  const feed = useRef<HTMLOListElement>(null);
  const { popup, supported, open } = usePopOut();

  useEffect(() => {
    const running = props.createEngine();
    engine.current = running;
    running.start((event) => {
      if (event.type === "activity") {
        setLevels(event.levels);
        setElapsed(event.elapsed);
      } else if (event.type === "window") {
        windows.current.push(event.window);
      } else if (event.type === "segment") {
        setSegments((list) => [...list, event.segment]);
      } else {
        duration.current = event.duration;
        setEnded(true);
      }
    });
    return () => running.stop();
  }, [props.createEngine]);

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [segments.length]);

  const finish = () => {
    popup?.close();
    engine.current?.stop();
    props.onEnd({
      title: props.isSample ? "Sample: launch planning" : "Meeting",
      isSample: props.isSample,
      people,
      segments,
      windows: windows.current,
      duration: duration.current || elapsed,
    });
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

  const status = ended ? "Meeting finished" : paused ? "Paused" : "Listening";

  const panel = useMemo(
    () => (
      <div className="live">
        <header className="live-head">
          <span className={`status ${paused || ended ? "off" : ""}`}>
            <i /> {status}
          </span>
          <time>{formatTime(elapsed)}</time>
          {supported && !popup && (
            <button className="icon-btn" aria-label="Keep on top of other windows" title="Keep on top of other windows" onClick={open}>
              <PictureInPictureIcon size={18} />
            </button>
          )}
        </header>
        {props.isSample && <p className="sample-tag">Sample meeting. Voices and labels are simulated.</p>}
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
            {!ended && (
              <button className="btn" onClick={togglePause}>
                {paused ? <PlayIcon weight="fill" /> : <PauseIcon weight="fill" />} {paused ? "Resume" : "Pause"}
              </button>
            )}
            {!ended && props.isSample && (
              <button className="btn" onClick={() => engine.current?.finish()}>
                <FastForwardIcon weight="fill" /> Skip to end
              </button>
            )}
            <button className="btn primary" onClick={finish}>
              <StopIcon weight="fill" /> {ended ? "See results" : "End meeting"}
            </button>
          </div>
          <small>Everything is processed on this computer.</small>
        </footer>
      </div>
    ),
    [people, levels, segments, elapsed, paused, ended, adding, newName, popup, supported, status],
  );

  return (
    <main className="live-stage">
      {popup ? (
        <>
          {createPortal(panel, popup.document.body)}
          <div className="popped">
            <h2>VoiceSplit is in its own window</h2>
            <p>It stays on top of your Meet. Keep this tab open while the meeting runs.</p>
          </div>
        </>
      ) : (
        panel
      )}
    </main>
  );
}
