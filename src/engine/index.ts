import { useEffect, useState } from "react";
import { createSimulatedEngine, type SimulatedIssue } from "./simulatedEngine";
import { request } from "../lib/api";
export { createLocalEngine } from "./localEngine";
export function createSampleEngine() {
  const issue = new URLSearchParams(location.search).get("issue") as SimulatedIssue | null;
  return createSimulatedEngine(issue ?? undefined);
}
export type EngineStatus = "checking" | "off" | "found";
export interface EngineHealth { ready: boolean; loading?: boolean; error?: string; version?: string }
export function useEngineHealth() {
  const [health, setHealth] = useState<EngineHealth | null>(null);
  useEffect(() => {
    let active = true;
    const check = () => request<EngineHealth>("/api/status")
      .then((next) => { if (active) setHealth(next); })
      .catch((error: Error) => { if (active) setHealth({ ready: false, error: error.message }); });
    void check();
    const timer = setInterval(check, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return health;
}
