import { useEffect, useState } from "react";
import { ArrowRightIcon, CheckIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { Enroll } from "../components/Enroll";
import { TestVoice } from "../components/TestVoice";
import { Steps } from "../components/Steps";
import { loadPeople, removePerson, savePerson } from "../lib/peopleStore";
import { request, roomPath } from "../lib/api";
import type { Person } from "../types";

export function Attendees(props: { roomId?: string; startEnrollment?: boolean; onBack: () => void; onNext: (people: Person[]) => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState(false);
  const [replacing, setReplacing] = useState<Person | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([loadPeople(), props.roomId ? request<{participant_ids:string[]}>(`${roomPath(props.roomId)}/participants`) : Promise.resolve({participant_ids:[]})])
      .then(([saved, roster]) => { setPeople(saved); setSelected(new Set(roster.participant_ids)); setAdding(Boolean(props.startEnrollment) || saved.length === 0); })
      .catch((e: Error) => setError(e.message)).finally(() => setLoaded(true));
  }, [props.roomId, props.startEnrollment]);
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  const add = async (person: Person) => {
    const saved = await savePerson(person, replacing?.id);
    setPeople((list) => [...new Map([...list, saved].map((p) => [p.id, p])).values()]);
    setAdding(false); setReplacing(null);
  };
  const remove = async (id: string) => {
    setBusy(true); setError("");
    try { await removePerson(id); setPeople((list) => list.filter((p) => p.id !== id)); setSelected((current) => { const next = new Set(current); next.delete(id); return next; }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const chosen = [...new Map(people.filter((p) => selected.has(p.id)).map((p) => [p.id, p])).values()];
  return <main className="page narrow-page">
    <Steps current={0} /><h1 className="step-title">Who's here?</h1>
    <p className="lead">Select the saved voices attending this meeting. Unmatched speakers stay unnamed.</p>
    <section className="panel attendee-panel">
      {people.length > 0 && <ul className="attendees">{people.map((p) => <li key={p.id}>
        <label><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} /><span className="tick" aria-hidden><CheckIcon weight="bold" /></span><strong>{p.name}</strong></label>
        <button className="btn" disabled={busy || adding} onClick={() => { setTesting(false); setReplacing(p); setAdding(true); }}>Re-record</button>
        <button className="icon-btn" disabled={busy || adding} aria-label={`Delete ${p.name}'s voice`} onClick={() => remove(p.id)}><TrashIcon /></button>
      </li>)}</ul>}
      {error && <p className="error" role="alert">{error}</p>}
      {loaded && !testing && <button className="btn" disabled={busy || adding} onClick={() => { setAdding(false); setReplacing(null); setTesting(true); }}>Test voice</button>}
      {testing ? <TestVoice hasProfiles={people.length > 0} onCancel={() => setTesting(false)} /> : adding ? <Enroll key={replacing?.id ?? "new"} initialPerson={replacing ?? undefined} onAdd={add} onCancel={() => { setAdding(false); setReplacing(null); }} /> :
        loaded && <button className="btn" onClick={() => setAdding(true)}><PlusIcon /> Add saved voice</button>}
    </section>
    <div className="step-nav"><button className="btn" onClick={props.onBack}>Back</button><button className="btn primary" disabled={!loaded || busy} onClick={() => props.onNext(chosen)}>Continue {chosen.length ? `with ${chosen.length}` : "without saved voices"} <ArrowRightIcon /></button></div>
  </main>;
}
