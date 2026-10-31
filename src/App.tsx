import { useEffect, useRef, useState } from "react";
import { WaveformIcon } from "@phosphor-icons/react";
import { samplePeople } from "./data/sampleMeeting";
import { createSampleEngine, useEngineStatus } from "./engine";
import { audioErrorMessage, requestMeetingTab, requestMic, stopStream } from "./lib/audio";
import { canPopOut, openPopOut } from "./lib/popOut";
import type { Meeting, Person } from "./types";
import { Attendees } from "./screens/Attendees";
import { Connect } from "./screens/Connect";
import { Home } from "./screens/Home";
import { HowItWorks } from "./screens/HowItWorks";
import { Live } from "./screens/Live";
import { Review } from "./screens/Review";

type Screen = "home" | "attendees" | "connect" | "live" | "review" | "how";

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [mic, setMic] = useState<MediaStream | null>(null);
  const [tab, setTab] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState("");
  const [tabError, setTabError] = useState("");
  const popup = useRef<Window | null>(null);
  const engine = useEngineStatus();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  const releaseAudio = () => {
    stopStream(mic);
    stopStream(tab);
    setMic(null);
    setTab(null);
    setMicError("");
    setTabError("");
  };

  const connectMic = async () => {
    setMicError("");
    try {
      stopStream(mic);
      setMic(await requestMic());
      return true;
    } catch (e) {
      setMicError(audioErrorMessage(e, "mic"));
      return false;
    }
  };

  const connectTab = async () => {
    setTabError("");
    try {
      stopStream(tab);
      setTab(await requestMeetingTab());
      return true;
    } catch (e) {
      setTabError(audioErrorMessage(e, "tab"));
      return false;
    }
  };

  const go = (next: Screen) => {
    if (next === "home" || next === "how") releaseAudio();
    setScreen(next);
  };

  const startLive = async () => {
    popup.current = canPopOut() ? await openPopOut().catch(() => null) : null;
    setScreen("live");
  };

  const endMeeting = (finished: Meeting) => {
    popup.current = null;
    releaseAudio();
    setMeeting(finished);
    setScreen("review");
  };

  return (
    <div className="app">
      {screen !== "live" && (
        <header className="topbar">
          <button className="brand" onClick={() => go("home")}>
            <WaveformIcon size={22} weight="bold" /> Timbre
          </button>
          <nav>
            <button className={screen === "home" || screen === "attendees" || screen === "connect" ? "active" : ""} onClick={() => go("home")}>
              New meeting
            </button>
            {meeting && (
              <button className={screen === "review" ? "active" : ""} onClick={() => go("review")}>
                Last meeting
              </button>
            )}
            <button className={screen === "how" ? "active" : ""} onClick={() => go("how")}>
              How it knows
            </button>
          </nav>
          <span className="local-badge">Free · Runs on this computer</span>
        </header>
      )}
      {screen === "home" && (
        <Home
          engine={engine}
          onStart={() => setScreen("attendees")}
          onSample={() => {
            popup.current = null;
            setScreen("live");
          }}
        />
      )}
      {screen === "attendees" && (
        <Attendees onBack={() => setScreen("home")} onNext={(_chosen: Person[]) => setScreen("connect")} />
      )}
      {screen === "connect" && (
        <Connect
          engine={engine}
          mic={mic}
          tab={tab}
          micError={micError}
          tabError={tabError}
          onConnectMic={connectMic}
          onConnectTab={connectTab}
          onBack={() => setScreen("attendees")}
          onStart={startLive}
        />
      )}
      {screen === "live" && (
        <Live
          createEngine={createSampleEngine}
          initialPeople={samplePeople}
          isSample
          initialPopup={popup.current}
          mic={mic}
          tab={tab}
          onReconnectMic={connectMic}
          onReconnectTab={connectTab}
          onEnd={endMeeting}
        />
      )}
      {screen === "review" && meeting && <Review meeting={meeting} onChange={setMeeting} />}
      {screen === "how" && <HowItWorks />}
    </div>
  );
}
