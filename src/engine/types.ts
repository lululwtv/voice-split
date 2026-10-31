import type { Segment, Summary, VoiceWindow } from "../types";

/** Events the speech engine sends. See docs/engine-contract.md. */
export type EngineEvent =
  | { type: "activity"; levels: Record<string, number>; elapsed: number }
  | { type: "window"; window: VoiceWindow }
  | { type: "segment"; segment: Segment }
  | { type: "ended"; duration: number }
  | { type: "status"; delaySeconds: number }
  | { type: "error"; message?: string }
  | { type: "summary"; summary: Summary }
  | { type: "summary_failed" }
  | { type: "participants"; ids: string[] };

export interface Engine {
  start(onEvent: (event: EngineEvent) => void): void;
  reconnectAudio?(): void;
  pause(): void;
  resume(): void;
  /** Delivers everything left at once, ends, then writes the summary. */
  finish(): void;
  stop(): void;
}
