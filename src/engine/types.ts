import type { Segment, VoiceWindow } from "../types";

/** Events the speech engine sends. See docs/engine-contract.md. */
export type EngineEvent =
  | { type: "activity"; levels: Record<string, number>; elapsed: number }
  | { type: "window"; window: VoiceWindow }
  | { type: "segment"; segment: Segment }
  | { type: "ended"; duration: number };

export interface Engine {
  start(onEvent: (event: EngineEvent) => void): void;
  pause(): void;
  resume(): void;
  /** Delivers everything left at once, then ends. */
  finish(): void;
  stop(): void;
}
