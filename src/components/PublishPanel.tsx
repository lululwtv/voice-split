import { useMemo, useState } from "react";
import { ArrowSquareOutIcon, CheckCircleIcon, CircleNotchIcon, GithubLogoIcon, NotionLogoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
  buildPayload,
  createRealPublisher,
  createSamplePublisher,
  isValidTarget,
  loadSettings,
  publishItems,
  saveSettings,
  type Destination,
  type PublishSettings,
} from "../lib/publish";
import type { Meeting } from "../types";

type Status = { state: "idle" | "sending" | "failed" } | { state: "done"; url: string | null };

const destinations: { id: Destination; name: string; label: string; placeholder: string }[] = [
  { id: "github", name: "GitHub", label: "Repository", placeholder: "owner/repo" },
  { id: "notion", name: "Notion", label: "Database link or ID", placeholder: "https://www.notion.so/…" },
];

export function PublishPanel({ meeting }: { meeting: Meeting }) {
  const items = useMemo(() => publishItems(meeting), [meeting]);
  const [settings, setSettings] = useState(loadSettings);
  const [selected, setSelected] = useState(() => new Set(items.map((item) => item.id)));
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const connected = createRealPublisher !== null;
  const destination = destinations.find((d) => d.id === settings.destination)!;
  const target = settings[settings.destination];
  const date = new Date().toISOString().slice(0, 10);
  const payload = buildPayload(meeting, settings, selected, includeTranscript, date);
  const unnamed = meeting.segments.filter((s) => !s.overlap && s.personId === null).length;
  const canPublish = isValidTarget(settings.destination, target) && (selected.size > 0 || includeTranscript) && status.state !== "sending";

  const update = (change: Partial<PublishSettings>) => {
    const next = { ...settings, ...change };
    setSettings(next);
    saveSettings(next);
    setStatus({ state: "idle" });
  };

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    setStatus({ state: "idle" });
  };

  const publish = async () => {
    setStatus({ state: "sending" });
    try {
      const publisher = createRealPublisher ? createRealPublisher() : createSamplePublisher();
      const { url } = await publisher.publish(payload);
      setStatus({ state: "done", url });
    } catch {
      setStatus({ state: "failed" });
    }
  };

  if (!items.length) {
    return (
      <div className="summary-failed">
        <WarningCircleIcon size={24} />
        <div><strong>No summary to publish</strong></div>
      </div>
    );
  }

  return (
    <div className="publish">
      <div className="publish-head">
        <h2>Publish to team memory</h2>
        {!connected && <span className="sample-tag">Sample · nothing is sent</span>}
      </div>

      <div className="destination" role="radiogroup" aria-label="Destination">
        {destinations.map((d) => (
          <button
            key={d.id}
            role="radio"
            aria-checked={settings.destination === d.id}
            onClick={() => update({ destination: d.id })}
          >
            {d.id === "github" ? <GithubLogoIcon size={20} /> : <NotionLogoIcon size={20} />} {d.name}
          </button>
        ))}
      </div>

      <label className="publish-field">
        {destination.label}
        <input
          value={target}
          placeholder={destination.placeholder}
          onChange={(e) => update({ [settings.destination]: e.target.value })}
        />
      </label>

      <fieldset className="publish-items">
        <legend>Include</legend>
        {items.map((item) => (
          <label key={item.id}>
            <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
            <span className="item-type">{item.type}</span>
            <span>{item.owner && <b>{item.owner} · </b>}{item.text}{item.due && ` · by ${item.due}`}</span>
          </label>
        ))}
        <label className="transcript-option">
          <input
            type="checkbox"
            checked={includeTranscript}
            onChange={(e) => {
              setIncludeTranscript(e.target.checked);
              setStatus({ state: "idle" });
            }}
          />
          <span className="item-type">full</span>
          <span>Transcript</span>
        </label>
      </fieldset>

      {unnamed > 0 && (
        <p className="notice"><WarningCircleIcon /> {unnamed} {unnamed === 1 ? "line has" : "lines have"} no speaker name.</p>
      )}

      <label className="publish-auto">
        <input
          type="checkbox"
          checked={settings.auto}
          disabled={!connected}
          onChange={(e) => update({ auto: e.target.checked })}
        />
        Publish automatically after every meeting
        {!connected && <span className="muted">Needs backend</span>}
      </label>

      <details className="publish-preview">
        <summary>Preview</summary>
        <pre>{payload.markdown}</pre>
      </details>

      <div className="publish-action">
        <button className="btn primary large" disabled={!canPublish} onClick={publish}>
          {status.state === "sending" && <CircleNotchIcon className="spin" />}
          {status.state === "sending" ? "Publishing" : `Publish to ${destination.name}`}
        </button>
        <div role="status">
          {status.state === "done" &&
            (status.url ? (
              <a className="publish-result" href={status.url} target="_blank" rel="noreferrer">
                <CheckCircleIcon weight="fill" /> Published <ArrowSquareOutIcon />
              </a>
            ) : (
              <span className="publish-result sample"><CheckCircleIcon weight="fill" /> Sample complete. Nothing was sent to {destination.name}.</span>
            ))}
          {status.state === "failed" && <span className="error">Couldn't publish. Your notes are still here. Try again.</span>}
        </div>
      </div>
    </div>
  );
}
