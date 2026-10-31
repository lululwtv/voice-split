import type { Segment } from "../types";

export interface TranscriptTurn {
  id: string;
  start: number;
  end: number;
  text: string;
  segments: Segment[];
}

function sameSpeaker(left: Segment, right: Segment) {
  if (left.overlap || right.overlap) return false;
  if (left.personId || right.personId) return Boolean(left.personId && left.personId === right.personId);
  if (left.speakerLabel !== right.speakerLabel) return false;
  if (left.unknownId || right.unknownId) return Boolean(left.unknownId && left.unknownId === right.unknownId);
  return Boolean(left.track_id && left.track_id === right.track_id && left.stream_id && left.stream_id === right.stream_id);
}

/** A reading projection; original segments remain the correction and evidence records. */
export function groupTranscriptTurns(segments: Segment[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const segment of segments) {
    const turn = turns.at(-1);
    const previous = turn?.segments.at(-1);
    const gap = previous ? segment.start - previous.end : 0;
    const continues = previous && sameSpeaker(previous, segment)
      && previous.stream_id === segment.stream_id && previous.device_id === segment.device_id
      && segment.start >= previous.start && segment.end >= previous.end && gap >= -0.3 && gap <= 1.5;
    if (turn && continues) {
      const text = segment.text.trim();
      turn.text += `${turn.text && text && !/^[,.;:!?…]/u.test(text) ? " " : ""}${text}`;
      turn.end = segment.end;
      turn.segments.push(segment);
    } else {
      turns.push({ id: segment.id, start: segment.start, end: segment.end, text: segment.text.trim(), segments: [segment] });
    }
  }
  return turns;
}
