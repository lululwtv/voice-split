import { useState } from "react";
import { ChecksIcon, CopyIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { summaryToMarkdown } from "../lib/export";
import { formatTime } from "../lib/stats";
import type { Meeting, SummaryItem } from "../types";
import { Avatar } from "./people";

function Sources(props: { item: SummaryItem; meeting: Meeting; onJump: (id: string) => void }) {
  return (
    <span className="sources">
      {props.item.sources.map((id) => {
        const segment = props.meeting.segments.find((s) => s.id === id);
        if (!segment) return null;
        return (
          <button key={id} aria-label={`See the line at ${formatTime(segment.start)}`} onClick={() => props.onJump(id)}>
            {formatTime(segment.start)}
          </button>
        );
      })}
    </span>
  );
}

export function SummaryView({ meeting, onJump }: { meeting: Meeting; onJump: (segmentId: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const { summary, people } = meeting;

  if (!summary) {
    return (
      <div className="summary-failed">
        <WarningCircleIcon size={24} />
        <div>
          <strong>The summary couldn't be written.</strong>
          <p>Your transcript and notes by person are safe. Open them from the tabs above.</p>
        </div>
      </div>
    );
  }

  const copy = () => {
    navigator.clipboard
      .writeText(summaryToMarkdown(meeting))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopyFailed(true));
  };

  return (
    <div className="summary">
      {meeting.relabelledSinceSummary && (
        <p className="notice"><WarningCircleIcon /> You changed a speaker after this summary was written, so a name here may be out of date.</p>
      )}
      <div className="summary-top">
        <p className="overview">{summary.overview}</p>
        <button className="btn" onClick={copy}>
          {copied ? <ChecksIcon /> : <CopyIcon />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {copyFailed && <p className="error" role="alert">Couldn't copy. Use the Markdown download instead.</p>}

      <h3>Action items</h3>
      {summary.actions.length ? (
        <ul className="actions">
          {summary.actions.map((a) => {
            const owner = people.find((p) => p.id === a.ownerId);
            return (
              <li key={a.text}>
                <Avatar people={people} person={owner} />
                <div>
                  <strong>{owner?.name ?? "Unassigned"}</strong> {a.text}
                  {a.due && <span className="due">by {a.due}</span>}
                  <Sources item={a} meeting={meeting} onJump={onJump} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="muted">None found.</p>}

      <h3>Decisions</h3>
      {summary.decisions.length ? (
        <ul className="points">
          {summary.decisions.map((d) => <li key={d.text}>{d.text} <Sources item={d} meeting={meeting} onJump={onJump} /></li>)}
        </ul>
      ) : <p className="muted">None found.</p>}

      {summary.questions.length > 0 && (
        <>
          <h3>Open questions</h3>
          <ul className="points">
            {summary.questions.map((q) => <li key={q.text}>{q.text} <Sources item={q} meeting={meeting} onJump={onJump} /></li>)}
          </ul>
        </>
      )}
      <p className="muted summary-foot">AI summaries can be wrong. Click a time to check the line it came from.</p>
    </div>
  );
}
