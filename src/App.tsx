import { useEffect, useRef, useState } from "react";
import { samplePeople } from "./data/sampleMeeting";
import { createRealEngine, createSampleEngine, useEngineStatus } from "./engine";
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
  const [attendees, setAttendees] = useState<Person[]>([]);
  const [useSample, setUseSample] = useState(true);
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
    setUseSample(!(createRealEngine && engine === "found"));
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
            timbre
          </button>
          <nav>
            <button className={screen === "home" || screen === "attendees" || screen === "connect" ? "active" : ""} onClick={() => go("home")}>
              New
            </button>
            {meeting && (
              <button className={screen === "review" ? "active" : ""} onClick={() => go("review")}>
                Last
              </button>
            )}
            <button className={screen === "how" ? "active" : ""} onClick={() => go("how")}>
              How
            </button>
          </nav>
        </header>
      )}
      {screen === "home" && (
        <Home
          engine={engine}
          onStart={() => setScreen("attendees")}
          onSample={() => {
            popup.current = null;
            setUseSample(true);
            setScreen("live");
          }}
        />
      )}
      {screen === "attendees" && (
        <Attendees onBack={() => setScreen("home")} onNext={(chosen) => {
            setAttendees(chosen);
            setScreen("connect");
          }} />
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
          createEngine={useSample || !createRealEngine ? createSampleEngine : createRealEngine}
          initialPeople={useSample ? samplePeople : attendees}
          isSample={useSample}
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
