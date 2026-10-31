export type Role = "room" | "online";

export interface Person {
  id: string;
  name: string;
  role: Role;
  /** The enrollment recording. Sample speakers have none. */
  clip?: Blob;
}

export interface VoiceMatch {
  personId: string;
  /** Cosine similarity against the enrolled voiceprint, 0 to 1. */
  score: number;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  /** null means nobody matched well enough, or several people spoke at once. */
  personId: string | null;
  /** What the engine said, kept so corrections can be counted. */
  originalPersonId: string | null;
  matches: VoiceMatch[];
  /** Several people spoke at once. Attribution is out of scope for v1. */
  overlap?: boolean;
  /** Someone else held part of this segment's windows. */
  alsoHeardId?: string;
}

/** Who holds the floor over a stretch of audio, independent of transcript segments. */
export interface VoiceWindow {
  start: number;
  end: number;
  personId: string;
}

/** One claim in the summary, tied to the transcript lines it came from. */
export interface SummaryItem {
  text: string;
  sources: string[];
}

export interface ActionItem extends SummaryItem {
  ownerId: string | null;
  due?: string;
}

export interface Summary {
  overview: string;
  decisions: SummaryItem[];
  actions: ActionItem[];
  questions: SummaryItem[];
}

export interface Meeting {
  title: string;
  isSample: boolean;
  people: Person[];
  segments: Segment[];
  windows: VoiceWindow[];
  duration: number;
  /** null when the summary couldn't be written. */
  summary: Summary | null;
  /** A label changed after the summary was written, so its names may be out of date. */
  relabelledSinceSummary?: boolean;
}
