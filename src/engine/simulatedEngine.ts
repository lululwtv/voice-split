import { buildSampleMeeting } from "../data/sampleMeeting";
import type { Engine, EngineEvent } from "./types";

const TICK_MS = 200;
/** Transcript lines appear this long after they were spoken, like the real engine will. */
export const LABEL_DELAY_SECONDS = 3;

export function createSimulatedEngine(): Engine {
  const { segments, windows, duration } = buildSampleMeeting();
  let timer: ReturnType<typeof setInterval> | undefined;
  let emit: (event: EngineEvent) => void = () => {};
  let elapsed = 0;
  let nextSegment = 0;
  let nextWindow = 0;
  let ended = false;

  function deliverUpTo(time: number) {
    while (nextWindow < windows.length && windows[nextWindow].end <= time) {
      emit({ type: "window", window: windows[nextWindow++] });
    }
    while (nextSegment < segments.length && segments[nextSegment].end + LABEL_DELAY_SECONDS <= time) {
      emit({ type: "segment", segment: segments[nextSegment++] });
    }
  }

  function end() {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    emit({ type: "activity", levels: {}, elapsed: duration });
    emit({ type: "ended", duration });
  }

  function tick() {
    elapsed += TICK_MS / 1000;
    const levels: Record<string, number> = {};
    for (const w of windows) {
      if (w.start <= elapsed && elapsed < w.end) {
        levels[w.personId] = 0.45 + 0.55 * Math.abs(Math.sin(elapsed * 7 + w.start));
      }
    }
    emit({ type: "activity", levels, elapsed });
    deliverUpTo(elapsed);
    if (elapsed >= duration + LABEL_DELAY_SECONDS) end();
  }

  const run = () => {
    clearInterval(timer);
    timer = setInterval(tick, TICK_MS);
  };

  return {
    start(onEvent) {
      emit = onEvent;
      run();
    },
    pause: () => clearInterval(timer),
    resume: () => {
      if (!ended) run();
    },
    finish() {
      if (ended) return;
      deliverUpTo(Infinity);
      end();
    },
    stop() {
      clearInterval(timer);
      ended = true;
    },
  };
}
