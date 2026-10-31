import { useEffect, useState } from "react";
import { WaveformIcon } from "@phosphor-icons/react";
import { samplePeople } from "./data/sampleMeeting";
import { createSimulatedEngine } from "./engine/simulatedEngine";
import { stopStream } from "./lib/audio";
import type { Meeting } from "./types";
import { HowItWorks } from "./screens/HowItWorks";
import { Live } from "./screens/Live";
import { Review } from "./screens/Review";
import { Setup } from "./screens/Setup";

type Screen = "setup" | "live" | "review" | "how";

export function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [mic, setMic] = useState<MediaStream | null>(null);
  const [tab, setTab] = useState<MediaStream | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  const endMeeting = (finished: Meeting) => {
    stopStream(mic);
    stopStream(tab);
    setMic(null);
    setTab(null);
    setMeeting(finished);
    setScreen("review");
  };

  return (
    <div className="app">
      {screen !== "live" && (
        <header className="topbar">
          <button className="brand" onClick={() => setScreen("setup")}>
            <WaveformIcon size={22} weight="bold" /> VoiceSplit
          </button>
          <nav>
            <button className={screen === "setup" ? "active" : ""} onClick={() => setScreen("setup")}>
              New meeting
            </button>
            {meeting && (
              <button className={screen === "review" ? "active" : ""} onClick={() => setScreen("review")}>
                Last meeting
              </button>
            )}
            <button className={screen === "how" ? "active" : ""} onClick={() => setScreen("how")}>
              How it knows
            </button>
          </nav>
          <span className="local-badge">Free · Runs on this computer</span>
        </header>
      )}
      {screen === "setup" && (
        <Setup mic={mic} tab={tab} setMic={setMic} setTab={setTab} onStartSample={() => setScreen("live")} />
      )}
      {screen === "live" && (
        <Live createEngine={createSimulatedEngine} initialPeople={samplePeople} isSample onEnd={endMeeting} />
      )}
      {screen === "review" && meeting && <Review meeting={meeting} onChange={setMeeting} />}
      {screen === "how" && <HowItWorks />}
    </div>
  );
}
