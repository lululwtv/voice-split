import { useEffect, useRef, useState } from "react";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { samplePeople } from "./data/sampleMeeting";
import { createRealEngine, createSampleEngine, useEngineStatus } from "./engine";
import { audioErrorMessage, requestMeetingTab, requestMic, stopStream } from "./lib/audio";
import { canPopOut, closePopOut, openPopOut } from "./lib/popOut";
import { useTheme } from "./lib/theme";
import type { Meeting, Person } from "./types";
import { Attendees } from "./screens/Attendees";
import { Connect } from "./screens/Connect";
import { Home } from "./screens/Home";
import { HowItWorks } from "./screens/HowItWorks";
import { Live } from "./screens/Live";
import { Review } from "./screens/Review";

type Screen = "home" | "attendees" | "connect" | "live" | "review" | "how";

const paths: Record<Screen, string> = {
  home: "#/",
  attendees: "#/people",
  connect: "#/connect",
  live: "#/live",
  review: "#/summary",
  how: "#/how",
};

function screenFromUrl(): Screen {
  const match = (Object.keys(paths) as Screen[]).find((key) => paths[key] === location.hash);
  return match ?? "home";
}

/** Live, connect and review need state that a reload loses, so they can't be opened directly. */
function firstScreen(): Screen {
  const screen = screenFromUrl();
  return screen === "how" || screen === "attendees" ? screen : "home";
}

export function App() {
  const [screen, setScreen] = useState<Screen>(firstScreen);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [mic, setMic] = useState<MediaStream | null>(null);
  const [tab, setTab] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState("");
  const [tabError, setTabError] = useState("");
  const [attendees, setAttendees] = useState<Person[]>([]);
  const [useSample, setUseSample] = useState(true);
  const popup = useRef<Window | null>(null);
  const engine = useEngineStatus();
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  useEffect(() => {
    history.replaceState(null, "", paths[screen]);
  }, []);

  const navigate = (next: Screen) => {
    if (next === screen) return;
    history.pushState(null, "", paths[next]);
    setScreen(next);
  };

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
    navigate(next);
  };

  // Browser back and forward. A finished or abandoned meeting can't be re-entered, so those land on home.
  useEffect(() => {
    const onPopState = () => {
      let target = screenFromUrl();
      if (screen === "live" && target !== "live") {
        if (!window.confirm("Leave this meeting? Its lines won't be saved.")) {
          history.pushState(null, "", paths.live);
          return;
        }
        closePopOut();
      }
      const stale =
        target === "live" ||
        (target === "review" && !meeting) ||
        (screen === "review" && (target === "attendees" || target === "connect")) ||
        (target === "connect" && attendees.length === 0);
      if (stale) {
        target = "home";
        history.replaceState(null, "", paths.home);
      }
      if (target === "home" || target === "how") releaseAudio();
      setScreen(target);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [screen, meeting, attendees, mic, tab]);

  useEffect(() => {
    if (screen !== "live") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [screen]);

  const startLive = async () => {
    popup.current = canPopOut() ? await openPopOut().catch(() => null) : null;
    setUseSample(!(createRealEngine && engine === "found"));
    navigate("live");
  };

  const endMeeting = (finished: Meeting) => {
    popup.current = null;
    releaseAudio();
    setMeeting(finished);
    history.replaceState(null, "", paths.review);
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
            <button
              className="icon-btn theme-toggle"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <SunIcon size={18} /> : <MoonIcon size={18} />}
            </button>
          </nav>
        </header>
      )}
      {screen === "home" && (
        <Home
          engine={engine}
          onStart={() => navigate("attendees")}
          onSample={() => {
            popup.current = null;
            setUseSample(true);
            navigate("live");
          }}
        />
      )}
      {screen === "attendees" && (
        <Attendees onBack={() => history.back()} onNext={(chosen) => {
            setAttendees(chosen);
            navigate("connect");
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
          onBack={() => history.back()}
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
