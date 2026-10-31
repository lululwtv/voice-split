import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Person, Segment } from "../types";
import { request, roomPath, toSegment, type RawSegment } from "../lib/api";

export function NameVoice({ roomId, segment, onSaved }: { roomId?: string; segment: Segment; onSaved: (segments: Segment[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const scope = useRef({ active: true });
  useEffect(() => { const current = { active: true }; scope.current = current; return () => { current.active = false; }; }, [roomId]);
  if (!roomId || !segment.unknownId || segment.personId) return null;
  if (!editing) return <button className="link-btn" onClick={() => { setName(segment.confidence === "manual" ? segment.speakerLabel ?? "" : ""); setEditing(true); }}>Name this voice</button>;
  return <form onSubmit={async (event) => {
    event.preventDefault(); setSaving(true); setError("");
    const current = scope.current;
    try {
      const result = await request<{ segments: RawSegment[] }>(`${roomPath(roomId)}/segments/${encodeURIComponent(segment.id)}/voice-name`, {
        method: "PUT", body: JSON.stringify({ name: name.trim(), expected_revision: segment.revision ?? 0 }),
      });
      if (current.active) { onSaved(result.segments.map(toSegment)); setEditing(false); }
    } catch (reason) { if (current.active) setError((reason as Error).message); }
    finally { if (current.active) setSaving(false); }
  }}>
    <label>Name for this voice <input autoFocus value={name} maxLength={100} onChange={(event) => setName(event.target.value)} disabled={saving} /></label>
    <p className="muted">Applies to all lines linked to this voice in this meeting, including future lines.</p>
    <button className="btn" disabled={saving || !name.trim()}>Save name</button>{" "}
    <button type="button" className="btn" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
    {error && <p role="alert" className="error">{error}</p>}
  </form>;
}

export function colorOf(people: Person[], personId: string | null | undefined) {
  const index = people.findIndex((p) => p.id === personId);
  return index < 0 ? "var(--unknown)" : `var(--speaker-${(index % 6) + 1})`;
}

/** Sets the color a line's text and label inherit. */
export function whoStyle(people: Person[], personId: string | null | undefined) {
  return { "--who": colorOf(people, personId) } as CSSProperties;
}

/** Reassigns a line. Used live for unnamed voices and in review for any label. */
export function SpeakerSelect(props: {
  people: Person[];
  value: string | null;
  disabled?: boolean;
  label: string;
  unknownLabel?: string;
  confidence?: string;
  onChange: (personId: string | null) => void;
}) {
  return (
    <><select
      className="speaker-select"
      disabled={props.disabled}
      aria-label={props.label}
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value || null)}
    >
      <option value="" disabled>{props.unknownLabel || "Unknown speaker"}</option>
      {props.people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>{props.confidence && props.confidence !== "manual" && <small title="Heuristic evidence strength, not an accuracy probability">{props.value ? `${props.confidence} confidence` : "Uncertain voice match"}</small>}</>
  );
}
