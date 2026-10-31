const labels = ["Who's here", "Connect the call"];

export function Steps({ current }: { current: 0 | 1 }) {
  return (
    <ol className="steps" aria-label="Setup progress">
      {labels.map((label, i) => (
        <li key={label} className={i === current ? "on" : i < current ? "done" : ""} aria-current={i === current ? "step" : undefined}>
          <span>{i + 1}</span> {label}
        </li>
      ))}
    </ol>
  );
}
