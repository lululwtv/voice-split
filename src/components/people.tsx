import { QuestionIcon } from "@phosphor-icons/react";
import type { Person } from "../types";

export function colorOf(people: Person[], personId: string | null | undefined) {
  const index = people.findIndex((p) => p.id === personId);
  return index < 0 ? "var(--unknown)" : `var(--speaker-${(index % 6) + 1})`;
}

export function Avatar({ people, person }: { people: Person[]; person: Person | undefined }) {
  return (
    <span className="avatar" style={{ background: colorOf(people, person?.id) }} aria-hidden>
      {person ? person.name[0].toUpperCase() : <QuestionIcon size={14} weight="bold" />}
    </span>
  );
}

/** Reassigns a line. Used live for unnamed voices and in review for any label. */
export function SpeakerSelect(props: {
  people: Person[];
  value: string | null;
  label: string;
  onChange: (personId: string | null) => void;
}) {
  return (
    <select
      className="speaker-select"
      aria-label={props.label}
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value || null)}
    >
      <option value="">Who is this?</option>
      {props.people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
