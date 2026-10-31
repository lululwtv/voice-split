export type LiveStatus = "listening" | "quiet" | "behind" | "paused" | "lost" | "finished";

const QUIET_AFTER_SECONDS = 20;
const BEHIND_AFTER_SECONDS = 10;

export function liveStatus(state: {
  paused: boolean;
  ended: boolean;
  engineLost: boolean;
  delaySeconds: number;
  silentSeconds: number;
}): LiveStatus {
  if (state.ended) return "finished";
  if (state.engineLost) return "lost";
  if (state.paused) return "paused";
  if (state.delaySeconds > BEHIND_AFTER_SECONDS) return "behind";
  if (state.silentSeconds > QUIET_AFTER_SECONDS) return "quiet";
  return "listening";
}
