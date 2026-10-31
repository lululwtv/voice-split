import { useEffect, useState } from "react";
import { createSimulatedEngine, type SimulatedIssue } from "./simulatedEngine";
import type { Engine } from "./types";

const ENGINE_URL = import.meta.env.VITE_ENGINE_URL ?? "http://localhost:8000";
const CHECK_EVERY_MS = 5000;

/** Set this to the real adapter once the speech engine is ready. */
export const createRealEngine: (() => Engine) | null = null;

export function createSampleEngine() {
  const issue = new URLSearchParams(location.search).get("issue") as SimulatedIssue | null;
  return createSimulatedEngine(issue ?? undefined);
}

export type EngineStatus = "checking" | "off" | "found";

export function useEngineStatus() {
  const [status, setStatus] = useState<EngineStatus>("checking");
  useEffect(() => {
    let active = true;
    const check = () =>
      fetch(`${ENGINE_URL}/health`, { mode: "no-cors" })
        .then(() => active && setStatus("found"))
        .catch(() => active && setStatus("off"));
    void check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return status;
}
