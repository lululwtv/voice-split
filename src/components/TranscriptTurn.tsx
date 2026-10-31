import { NameVoice, SpeakerSelect, whoStyle, colorOf } from "./people";
import { formatTime, isCorrected } from "../lib/stats";
import type { TranscriptTurn as Turn } from "../lib/transcriptTurns";
import type { Person, Segment } from "../types";

export function TranscriptTurn(props: {
  turn: Turn;
  people: Person[];
  roomId?: string;
  saving: string | null;
  live?: boolean;
  current?: boolean;
  onSeek?: (time: number) => void;
  onRelabel: (segment: Segment, personId: string | null) => void | Promise<void>;
  onSaved: (segments: Segment[]) => void;
}) {
  const { turn, people } = props;
  const first = turn.segments[0];
  const multiple = turn.segments.length > 1;
  const label = first.overlap ? "Overlap" : people.find((person) => person.id === first.personId)?.name ?? first.speakerLabel ?? "Unknown speaker";
  const controls = (segment: Segment) => <>
    {segment.overlap ? <strong>Overlap</strong> : <SpeakerSelect people={people} value={segment.personId} disabled={props.saving === segment.id}
      unknownLabel={segment.speakerLabel} confidence={segment.confidence} label={`Speaker of line at ${formatTime(segment.start)}`}
      onChange={(id) => props.onRelabel(segment, id)} />}
    {isCorrected(segment) && <span className="edited">Corrected</span>}
    <NameVoice roomId={props.roomId} segment={segment} onSaved={props.onSaved} />
  </>;
  const evidence = (segment: Segment) => <>
    {segment.alsoHeardId && <span className="also">+ {people.find((person) => person.id === segment.alsoHeardId)?.name ?? segment.alsoHeardId}?</span>}
    {segment.matches.length > 0 && <details className="turn-evidence"><summary>Why this label?</summary><div className="why">
      <p>Voice similarity (not an accuracy percentage):</p>
      {segment.personId === null && <p>No enrolled voice matched reliably. The closest candidate below was not assigned.</p>}
      <ul>{segment.matches.map((match) => <li key={match.personId}>
        <span>{people.find((person) => person.id === match.personId)?.name ?? match.personId}</span>
        <span className="why-track"><i style={{ width: `${Math.max(0, Math.min(1, match.score)) * 100}%`, background: colorOf(people, match.personId) }} /></span>
        <span>{match.score.toFixed(2)}</span>
      </li>)}</ul>
    </div></details>}
  </>;
  const stamp = (segment: Pick<Segment, "start">) => props.onSeek
    ? <button className="stamp" aria-label={`Jump to ${formatTime(segment.start)}`} onClick={() => props.onSeek?.(segment.start)}>{formatTime(segment.start)}</button>
    : <time>{formatTime(segment.start)}</time>;
  return <li className={`${props.live ? "line" : "turn"}${props.current ? " current" : ""}`} style={whoStyle(people, first.personId)}>
    {!props.live && stamp(turn)}
    <div className="t-body">
      <div className={props.live ? "line-head" : "t-who"}>
        {multiple ? <strong>{label}</strong> : controls(first)}
        {props.live && stamp(turn)}
      </div>
      <p>{turn.text}</p>
      {multiple ? <details className="turn-details"><summary>Edit labels · Details</summary>
        {turn.segments.map((segment) => <div className="turn-fragment" id={`line-${segment.id}`} key={segment.id}>
          <div className="t-who">{stamp(segment)}{controls(segment)}</div>
          <p>{segment.text}</p>{evidence(segment)}
        </div>)}
      </details> : <div id={`line-${first.id}`}>{evidence(first)}</div>}
    </div>
  </li>;
}
