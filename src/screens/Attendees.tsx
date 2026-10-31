import { useEffect, useState } from "react";
import { ArrowRightIcon, CheckIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { Enroll } from "../components/Enroll";
import { Steps } from "../components/Steps";
import { loadPeople, removePerson, savePerson } from "../lib/peopleStore";
import type { Person } from "../types";

export function Attendees(props: { onBack: () => void; onNext: (people: Person[]) => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadPeople()
      .then((saved) => {
        setPeople(saved);
        setSelected(new Set(saved.map((p) => p.id)));
        setAdding(saved.length === 0);
      })
      .catch(() => {
        setError("Saved voices couldn't be loaded in this browser.");
        setAdding(true);
      })
      .finally(() => setLoaded(true));
  }, []);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const add = (person: Person) => {
    setPeople((list) => [...list, person]);
    setSelected((current) => new Set(current).add(person.id));
    setAdding(false);
    savePerson(person).catch(() => setError(`${person.name} will be forgotten when you close this page.`));
  };

  const remove = (id: string) => {
    setPeople((list) => list.filter((p) => p.id !== id));
    setSelected((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    removePerson(id).catch(() => setError("Couldn't delete that voice from this browser."));
  };

  const chosen = people.filter((p) => selected.has(p.id));

  return (
    <main className="page narrow-page">
      <Steps current={0} />
      <h1 className="step-title">Who's in this meeting?</h1>
      <p className="lead">Each person records their voice once. Voices are saved in this browser only.</p>
      <section className="panel attendee-panel">
        {people.length > 0 && (
          <ul className="attendees">
            {people.map((p) => (
              <li key={p.id}>
                <label>
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="tick" aria-hidden><CheckIcon weight="bold" /></span>
                  <strong>{p.name}</strong>
                  <span className="muted">{p.role === "room" ? "In the room" : "Online"}</span>
                </label>
                <button className="icon-btn" aria-label={`Delete ${p.name}'s voice`} onClick={() => remove(p.id)}>
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {adding ? (
          <Enroll onAdd={add} onCancel={people.length ? () => setAdding(false) : undefined} />
        ) : (
          loaded && (
            <button className="btn" onClick={() => setAdding(true)}>
              <PlusIcon /> Add someone new
            </button>
          )
        )}
      </section>
      <div className="step-nav">
        <button className="btn" onClick={props.onBack}>Back</button>
        <button className="btn primary" disabled={chosen.length === 0} onClick={() => props.onNext(chosen)}>
          Continue with {chosen.length} {chosen.length === 1 ? "person" : "people"} <ArrowRightIcon />
        </button>
      </div>
    </main>
  );
}
