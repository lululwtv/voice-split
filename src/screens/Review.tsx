import { useEffect, useMemo, useState } from "react";
import { CaretDownIcon, DownloadSimpleIcon, PauseIcon, PlayIcon, UsersThreeIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Avatar, colorOf, SpeakerSelect } from "../components/people";
import { download, toJson, toMarkdown } from "../lib/export";
import { formatTime, labelAccuracy, talkTime } from "../lib/stats";
import type { Meeting, Person, Segment } from "../types";

const TARGET_PERCENT = 80;

function SplitTimeline(props: { meeting: Meeting; time: number; onSeek: (t: number) => void }) {
  const { people, windows, duration } = props.meeting;
  const pct = (t: number) => `${(t / duration) * 100}%`;
  const bars = useMemo(
    () =>
      Array.from({ length: 150 }, (_, i) => {
        const t = (i / 150) * duration;
        const active = windows.some((w) => w.start <= t && t < w.end);
        return active ? 0.25 + 0.75 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.31)) : 0.04;
      }),
    [windows, duration],
  );
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    props.onSeek(((e.clientX - box.left) / box.width) * duration);
  };

  return (
    <div className="timeline">
      <div className="lane-labels">
        <span>One mic</span>
        {people.map((p) => <span key={p.id}>{p.name}</span>)}
      </div>
      <div className="lanes" onClick={seek}>
        <div className="mixed" aria-hidden>
          {bars.map((h, i) => <i key={i} style={{ height: `${h * 100}%` }} />)}
        </div>
        {people.map((p, laneIndex) => (
          <div className="lane" key={p.id} style={{ animationDelay: `${laneIndex * 90}ms` }}>
            {windows.filter((w) => w.personId === p.id).map((w, i) => (
              <i
                key={i}
                style={{ left: pct(w.start), width: pct(w.end - w.start), background: colorOf(people, p.id) }}
              />
            ))}
          </div>
        ))}
        <div className="playhead" style={{ left: pct(props.time) }} />
      </div>
    </div>
  );
}

function WhyPanel({ segment, people }: { segment: Segment; people: Person[] }) {
  return (
    <div className="why">
      <p>Closest voices in this stretch of audio:</p>
      <ul>
        {segment.matches.map((m) => {
          const person = people.find((p) => p.id === m.personId);
          return (
            <li key={m.personId}>
              <span>{person?.name}</span>
              <span className="why-track">
                <i style={{ width: `${m.score * 100}%`, background: colorOf(people, m.personId) }} />
              </span>
              <span>{Math.round(m.score * 100)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Review({ meeting, onChange }: { meeting: Meeting; onChange: (m: Meeting) => void }) {
  const [tab, setTab] = useState<"transcript" | "notes">("transcript");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { people, segments, windows, duration } = meeting;

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setTime((t) => {
        if (t + 0.1 >= duration) {
          setPlaying(false);
          return duration;
        }
        return t + 0.1;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [playing, duration]);

  const accuracy = labelAccuracy(segments);
  const talk = talkTime(people, windows);
  const longest = Math.max(1, ...talk.map((t) => t.seconds));
  const relabel = (id: string, personId: string | null) =>
    onChange({ ...meeting, segments: segments.map((s) => (s.id === id ? { ...s, personId } : s)) });
  const fileBase = meeting.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  if (segments.length === 0) {
    return (
      <main className="page review">
        <h1>{meeting.title}</h1>
        <p className="lead">The meeting ended before any lines came through, so there's nothing to review.</p>
      </main>
    );
  }

  return (
    <main className="page review">
      <div className="review-head">
        <div>
          <h1>{meeting.title}</h1>
          <p className="lead">{formatTime(duration)} · {people.length} people</p>
        </div>
        <div className="export">
          <button className="btn" onClick={() => download(`${fileBase}.md`, toMarkdown(meeting), "text/markdown")}>
            <DownloadSimpleIcon /> Markdown
          </button>
          <button className="btn" onClick={() => download(`${fileBase}.json`, toJson(meeting), "application/json")}>
            <DownloadSimpleIcon /> JSON
          </button>
        </div>
      </div>

      {meeting.isSample && (
        <p className="sample-banner">
          Sample meeting. The names, scores and mistakes below are scripted to show how review works. They aren't real results.
        </p>
      )}

      <section className="panel split">
        <div className="split-head">
          <button className="btn" onClick={() => {
            if (time >= duration) setTime(0);
            setPlaying(!playing);
          }}>
            {playing ? <PauseIcon weight="fill" /> : <PlayIcon weight="fill" />} {playing ? "Pause" : "Replay"}
          </button>
          <time>{formatTime(time)} / {formatTime(duration)}</time>
          {meeting.isSample && <small>Moves the marker only. The sample has no sound.</small>}
        </div>
        <SplitTimeline meeting={meeting} time={time} onSeek={(t) => { setTime(t); setPlaying(false); }} />
      </section>

      <div className="review-grid">
        <section className="panel">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "transcript"} onClick={() => setTab("transcript")}>Transcript</button>
            <button role="tab" aria-selected={tab === "notes"} onClick={() => setTab("notes")}>Notes by person</button>
          </div>
          {tab === "transcript" ? (
            <ol className="transcript">
              {segments.map((s) => {
                const person = people.find((p) => p.id === s.personId);
                const current = s.start <= time && time < s.end;
                const also = people.find((p) => p.id === s.alsoHeardId);
                return (
                  <li key={s.id} className={current ? "current" : ""}>
                    <button className="stamp" aria-label={`Jump to ${formatTime(s.start)}`} onClick={() => { setTime(s.start); setPlaying(false); }}>
                      {formatTime(s.start)}
                    </button>
                    <Avatar people={people} person={person} />
                    <div className="t-body">
                      {s.overlap ? (
                        <span className="overlap"><UsersThreeIcon /> Several people at once. Not separated in this version.</span>
                      ) : (
                        <div className="t-who">
                          <SpeakerSelect people={people} value={s.personId} label={`Speaker of line at ${formatTime(s.start)}`} onChange={(id) => relabel(s.id, id)} />
                          {s.personId !== s.originalPersonId && <span className="edited">Corrected</span>}
                          {s.matches.length > 0 && (
                            <button className="link-btn" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                              Why? <CaretDownIcon className={open === s.id ? "flip" : ""} />
                            </button>
                          )}
                        </div>
                      )}
                      <p>{s.text}</p>
                      {also && (
                        <span className="also"><WarningCircleIcon /> May include {also.name} too</span>
                      )}
                      {open === s.id && <WhyPanel segment={s} people={people} />}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="notes">
              {people.map((p) => {
                const said = segments.filter((s) => s.personId === p.id);
                return (
                  <article key={p.id}>
                    <h3><Avatar people={people} person={p} /> {p.name}</h3>
                    {said.length ? (
                      <ul>{said.map((s) => <li key={s.id}><time>{formatTime(s.start)}</time> {s.text}</li>)}</ul>
                    ) : (
                      <p className="muted">No lines labelled with this name.</p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="side">
          <section className="panel">
            <h3>Labels kept</h3>
            <p className="big">{accuracy.percent}%</p>
            <div className="target-track">
              <i style={{ width: `${accuracy.percent}%` }} className={accuracy.percent >= TARGET_PERCENT ? "met" : ""} />
              <b style={{ left: `${TARGET_PERCENT}%` }} />
            </div>
            <p className="muted">
              {accuracy.changed} corrected and {accuracy.unnamed} still unnamed, out of {accuracy.total} lines. Target is {TARGET_PERCENT}%.
              Lines you leave alone count as right, so check them all first.
            </p>
          </section>
          <section className="panel">
            <h3>Talk time</h3>
            <ul className="talk">
              {talk.map(({ person, seconds }) => (
                <li key={person.id}>
                  <span>{person.name}</span>
                  <span className="why-track"><i style={{ width: `${(seconds / longest) * 100}%`, background: colorOf(people, person.id) }} /></span>
                  <time>{formatTime(seconds)}</time>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
