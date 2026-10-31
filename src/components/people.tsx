import type { CSSProperties } from "react";
import type { Person } from "../types";

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
      <option value="">Who?</option>
      {props.people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
