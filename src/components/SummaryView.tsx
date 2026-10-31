import { useState } from "react";
import { ChecksIcon, CopyIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { summaryToMarkdown } from "../lib/export";
import { formatTime } from "../lib/stats";
import type { Meeting, SummaryItem } from "../types";
import { whoStyle } from "./people";

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
          <strong>No summary</strong>
          <p>Transcript saved.</p>
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
        <p className="notice"><WarningCircleIcon /> Speaker changed. Names here may be out of date.</p>
      )}
      <div className="summary-top">
        <p className="overview">{summary.overview}</p>
        <button className="btn" onClick={copy}>
          {copied ? <ChecksIcon /> : <CopyIcon />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {copyFailed && <p className="error" role="alert">Couldn't copy.</p>}

      <h3>Actions</h3>
      {summary.actions.length ? (
        <ul className="actions">
          {summary.actions.map((a) => {
            const owner = people.find((p) => p.id === a.ownerId);
            return (
              <li key={a.text} style={whoStyle(people, owner?.id)}>
                <strong>{owner?.name ?? "Unassigned"}</strong>
                <div>
                  {a.text}
                  {a.due && <span className="due">by {a.due}</span>}
                  <Sources item={a} meeting={meeting} onJump={onJump} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="muted">None</p>}

      <h3>Decisions</h3>
      {summary.decisions.length ? (
        <ul className="points">
          {summary.decisions.map((d) => <li key={d.text}>{d.text} <Sources item={d} meeting={meeting} onJump={onJump} /></li>)}
        </ul>
      ) : <p className="muted">None</p>}

      {summary.questions.length > 0 && (
        <>
          <h3>Open</h3>
          <ul className="points">
            {summary.questions.map((q) => <li key={q.text}>{q.text} <Sources item={q} meeting={meeting} onJump={onJump} /></li>)}
          </ul>
        </>
      )}
    </div>
  );
}
