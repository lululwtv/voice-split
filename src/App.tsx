import { useCallback, useEffect, useRef, useState } from "react";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { samplePeople } from "./data/sampleMeeting";
import { createLocalEngine, createSampleEngine, useEngineHealth, type EngineStatus } from "./engine";
import { loadMeeting, request, roomPath } from "./lib/api";
import { audioErrorMessage, requestMeetingTab, requestMic, stopStream, toWav } from "./lib/audio";
import { loadPeople } from "./lib/peopleStore";
import { isDeployedSite } from "./lib/deployment";
import { canPopOut, closePopOut, openPopOut } from "./lib/popOut";
import { useTheme } from "./lib/theme";
import type { Meeting, Person } from "./types";
import { Attendees } from "./screens/Attendees";
import { Connect } from "./screens/Connect";
import { HowItWorks } from "./screens/HowItWorks";
import { Live } from "./screens/Live";
import { Meetings } from "./screens/Meetings";
import { Pitch } from "./screens/Pitch";
import { Review } from "./screens/Review";

type Screen = "home" | "meetings" | "attendees" | "connect" | "live" | "review" | "how";
type Room = { id: string; title: string };

const paths: Record<Screen, string> = {
  home: "#/",
  meetings: "#/meetings",
  attendees: "#/people",
  connect: "#/connect",
  live: "#/live",
  review: "#/summary",
  how: "#/how",
};

const ENGINE_SCREENS: Screen[] = ["meetings", "attendees", "connect"];

function screenFromUrl(): Screen {
  const match = (Object.keys(paths) as Screen[]).find((key) => paths[key] === location.hash);
  return match ?? "home";
}

/** Live, connect and review need state that a reload loses, so they can't be opened directly. */
function firstScreen(): Screen {
  const screen = screenFromUrl();
  if (isDeployedSite) return screen === "how" ? screen : "home";
  return screen === "how" || screen === "meetings" || screen === "attendees" ? screen : "home";
}

export function App() {
  const [screen, setScreen] = useState<Screen>(firstScreen);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState("");
  const [title, setTitle] = useState("");
  const [mic, setMic] = useState<MediaStream | null>(null);
  const [tab, setTab] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState("");
  const [tabError, setTabError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attendees, setAttendees] = useState<Person[]>([]);
  const [startEnrollment, setStartEnrollment] = useState(false);
  const [useSample, setUseSample] = useState(true);
  const popup = useRef<Window | null>(null);
  const streams = useRef<(MediaStream | null)[]>([]);
  streams.current = [mic, tab];
  const health = useEngineHealth();
  const engine: EngineStatus = health === null ? "checking" : health.ready ? "found" : "off";
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    window.scrollTo(0, 0);
    if (screen === "meetings" && engine === "found") void request<Room[]>("/api/rooms").then(setRooms).catch((e: Error) => setError(e.message));
  }, [screen, engine]);

  useEffect(() => {
    history.replaceState(null, "", paths[screen]);
  }, []);

  useEffect(() => () => streams.current.forEach(stopStream), []);

  const navigate = (next: Screen) => {
    if (next === screen) return;
    setError("");
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
      if (isDeployedSite && ENGINE_SCREENS.includes(target)) target = "home";
      if (screen === "live" && target !== "live") {
        if (!window.confirm("Leave this meeting?")) {
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
      setError("");
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

  const prepare = async () => {
    const current = rooms.find((r) => r.id === selectedRoom) ?? await request<Room>("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() || `Meeting · ${new Date().toLocaleString()}` }),
    });
    const roster = await request<{ revision: number }>(`${roomPath(current.id)}/participants`);
    await request(`${roomPath(current.id)}/participants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_ids: attendees.map((p) => p.id), expected_revision: roster.revision }),
    });
    setRoom(current);
    setSelectedRoom(current.id);
    return current;
  };

  const startLive = async () => {
    setBusy(true);
    setError("");
    // Chrome only opens the floating window straight after a click, so it comes before the network calls.
    popup.current = canPopOut() ? await openPopOut().catch(() => null) : null;
    try {
      await prepare();
      setUseSample(false);
      navigate("live");
    } catch (e) {
      closePopOut();
      popup.current = null;
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openRoom = async () => {
    const current = rooms.find((r) => r.id === selectedRoom);
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      const [people, roster] = await Promise.all([
        loadPeople(),
        request<{ participant_ids: string[] }>(`${roomPath(current.id)}/participants`),
      ]);
      setRoom(current);
      setMeeting(await loadMeeting(current, people.filter((p) => roster.participant_ids.includes(p.id))));
      navigate("review");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const current = await prepare();
      const body = new FormData();
      body.append("file", await toWav(file), "recording.wav");
      await request(`${roomPath(current.id)}/transcribe`, { method: "POST", body });
      setMeeting(await loadMeeting(current, attendees));
      releaseAudio();
      navigate("review");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const realEngine = useCallback(() => createLocalEngine(room!.id, () => streams.current), [room?.id]);

  const endMeeting = (finished: Meeting) => {
    popup.current = null;
    releaseAudio();
    setMeeting(useSample ? finished : { ...finished, roomId: room?.id, title: room?.title ?? "Meeting" });
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
            {!isDeployedSite && (
              <button className={ENGINE_SCREENS.includes(screen) ? "active" : ""} onClick={() => go("meetings")}>
                Meetings
              </button>
            )}
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
      {error && <p className="notice warn app-message" role="alert">{error}</p>}
      {busy && <p className="notice app-message" role="status">Working locally…</p>}
      {screen === "home" && (
        <Pitch
          engine={engine}
          onStart={() => navigate("meetings")}
          onSample={() => {
            popup.current = null;
            setUseSample(true);
            navigate("live");
          }}
        />
      )}
      {screen === "meetings" && (
        <Meetings
          engine={engine}
          onStart={() => {
            setStartEnrollment(false);
            navigate("attendees");
          }}
          onRecordVoice={() => {
            setStartEnrollment(true);
            navigate("attendees");
          }}
        >
          <section className="room-controls">
            <label>
              Meeting{" "}
              <select value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)}>
                <option value="">New meeting</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            </label>
            {selectedRoom ? (
              <button className="btn" disabled={busy} onClick={openRoom}>Open transcript</button>
            ) : (
              <label>
                Meeting name{" "}
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Friday catch-up" maxLength={100} />
              </label>
            )}
            <p className="muted">
              {health?.error || (health?.loading ? "Preparing local speech models…" : `Local workspace${health?.version ? ` · v${health.version}` : ""}. Saved voices and transcripts stay on this machine.`)}
            </p>
          </section>
        </Meetings>
      )}
      {screen === "attendees" && (
        <Attendees
          startEnrollment={startEnrollment}
          roomId={selectedRoom || undefined}
          onBack={() => history.back()}
          onNext={(chosen) => {
            setStartEnrollment(false);
            setAttendees(chosen);
            navigate("connect");
          }}
        />
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
          onUpload={upload}
          busy={busy}
        />
      )}
      {screen === "live" && (
        <Live
          createEngine={useSample ? createSampleEngine : realEngine}
          roomId={useSample ? undefined : room?.id}
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
      {screen === "review" && meeting && <Review key={meeting.roomId ?? "sample"} meeting={meeting} onChange={setMeeting} />}
      {screen === "how" && <HowItWorks />}
    </div>
  );
}
