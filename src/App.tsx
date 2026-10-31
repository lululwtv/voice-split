import { useCallback, useEffect, useRef, useState } from "react";
import { createLocalEngine, useEngineHealth, type EngineStatus } from "./engine";
import { audioErrorMessage, requestMeetingTab, requestMic, stopStream, toWav } from "./lib/audio";
import { loadMeeting, request, roomPath } from "./lib/api";
import { loadPeople } from "./lib/peopleStore";
import type { Meeting, Person } from "./types";
import { Attendees } from "./screens/Attendees";
import { Connect } from "./screens/Connect";
import { Home } from "./screens/Home";
import { HowItWorks } from "./screens/HowItWorks";
import { Live } from "./screens/Live";
import { Review } from "./screens/Review";

type Screen = "home" | "attendees" | "connect" | "live" | "review" | "how";
type Room = { id: string; title: string };
export function App() {
  const [screen, setScreen] = useState<Screen>("home");
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
  const streams = useRef<(MediaStream | null)[]>([]);
  streams.current = [mic, tab];
  const health = useEngineHealth();
  const engine: EngineStatus = health === null ? "checking" : health.ready ? "found" : "off";
  const releaseAudio = () => { stopStream(mic); stopStream(tab); setMic(null); setTab(null); };
  const go = (next: Screen) => {
    if (screen === "live" && next !== "live") return;
    if (next === "home" || next === "how") releaseAudio();
    setError(""); setScreen(next);
  };
  useEffect(() => {
    window.scrollTo(0, 0);
    history.replaceState(null, "", `#/${screen === "home" ? "" : screen}`);
    if (screen === "home") void request<Room[]>("/api/rooms").then(setRooms).catch((e: Error) => setError(e.message));
  }, [screen]);
  useEffect(() => () => streams.current.forEach(stopStream), []);
  const connectMic = async () => {
    setMicError("");
    try { stopStream(mic); setMic(await requestMic()); return true; }
    catch (e) { setMicError(audioErrorMessage(e, "mic")); return false; }
  };
  const connectTab = async () => {
    setTabError("");
    try { stopStream(tab); setTab(await requestMeetingTab()); return true; }
    catch (e) { setTabError(audioErrorMessage(e, "tab")); return false; }
  };
  const prepare = async () => {
    const current = rooms.find((r) => r.id === selectedRoom) ?? await request<Room>("/api/rooms", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() || `Meeting · ${new Date().toLocaleString()}` }),
    });
    const roster = await request<{ revision: number }>(`${roomPath(current.id)}/participants`);
    await request(`${roomPath(current.id)}/participants`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_ids: attendees.map((p) => p.id), expected_revision: roster.revision }),
    });
    setRoom(current);
    setSelectedRoom(current.id);
    return current;
  };
  const startLive = async () => {
    setBusy(true); setError("");
    try { await prepare(); setScreen("live"); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const openRoom = async () => {
    const current = rooms.find((r) => r.id === selectedRoom);
    if (!current) return;
    setBusy(true); setError("");
    try {
      const [people, roster] = await Promise.all([loadPeople(), request<{participant_ids: string[]}>(`${roomPath(current.id)}/participants`)]);
      setRoom(current);
      setMeeting(await loadMeeting(current, people.filter((p) => roster.participant_ids.includes(p.id))));
      setScreen("review");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    setBusy(true); setError("");
    try {
      const current = await prepare();
      const body = new FormData(); body.append("file", await toWav(file), "recording.wav");
      await request(`${roomPath(current.id)}/transcribe`, { method: "POST", body });
      setMeeting(await loadMeeting(current, attendees)); releaseAudio(); setScreen("review");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const realEngine = useCallback(() => createLocalEngine(room!.id, () => streams.current), [room?.id]);
  const endMeeting = (finished: Meeting) => {
    releaseAudio(); setMeeting({ ...finished, roomId: room?.id, title: room?.title ?? "Meeting" }); setScreen("review");
  };
  return (
    <div className="app">
      {screen !== "live" && <header className="topbar">
        <button className="brand" onClick={() => go("home")}>timbre</button>
        <nav>
          <button className={["home","attendees","connect"].includes(screen) ? "active" : ""} onClick={() => go("home")}>Meetings</button>
          {meeting && <button className={screen === "review" ? "active" : ""} onClick={() => go("review")}>Last</button>}
          <button className={screen === "how" ? "active" : ""} onClick={() => go("how")}>How</button>
        </nav>
      </header>}
      {error && <p className="notice warn app-message" role="alert">{error}</p>}
      {busy && <p className="notice app-message" role="status">Working locally…</p>}
      {screen === "home" && <Home engine={engine}
        onStart={() => { setStartEnrollment(false); go("attendees"); }}
        onRecordVoice={() => { setStartEnrollment(true); go("attendees"); }}>
        <section className="room-controls">
          <label>Meeting <select value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)}>
            <option value="">New meeting</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select></label>
          {selectedRoom ? <button className="btn" disabled={busy} onClick={openRoom}>Open transcript</button> :
            <label>Meeting name <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Friday catch-up" maxLength={100} /></label>}
          <p className="muted">{health?.error || (health?.loading ? "Preparing local speech models…" : `Local workspace${health?.version ? ` · v${health.version}` : ""}. Saved voices and transcripts stay on this machine.`)}</p>
        </section>
      </Home>}
      {screen === "attendees" && <Attendees startEnrollment={startEnrollment} roomId={selectedRoom || undefined} onBack={() => go("home")} onNext={(chosen) => { setStartEnrollment(false); setAttendees(chosen); go("connect"); }} />}
      {screen === "connect" && <Connect engine={engine} mic={mic} tab={tab} micError={micError} tabError={tabError} onConnectMic={connectMic} onConnectTab={connectTab} onBack={() => go("attendees")} onStart={startLive} onUpload={upload} busy={busy} />}
      {screen === "live" && <Live createEngine={realEngine} roomId={room?.id} initialPeople={attendees} isSample={false} initialPopup={null} mic={mic} tab={tab} onReconnectMic={connectMic} onReconnectTab={connectTab} onEnd={endMeeting} />}
      {screen === "review" && meeting && <Review key={meeting.roomId ?? "sample"} meeting={meeting} onChange={setMeeting} />}
      {screen === "how" && <HowItWorks />}
    </div>
  );
}
