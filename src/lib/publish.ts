import type { Meeting } from "../types";
import { formatTime } from "./stats";

export type Destination = "github" | "notion";

export interface PublishSettings {
  destination: Destination;
  /** "owner/repo" for GitHub. A database link or ID for Notion. */
  github: string;
  notion: string;
  auto: boolean;
}

export type ItemType = "overview" | "decision" | "action" | "question";

export interface PublishItem {
  id: string;
  type: ItemType;
  text: string;
  owner?: string;
  due?: string;
  sourceTimes: string[];
}

export interface PublishPayload {
  destination: Destination;
  target: string;
  title: string;
  date: string;
  items: PublishItem[];
  transcriptIncluded: boolean;
  markdown: string;
}

export interface Publisher {
  publish(payload: PublishPayload): Promise<{ url: string | null }>;
}

/** Set this to the real adapter once the backend can write to GitHub and Notion. */
export const createRealPublisher: (() => Publisher) | null = null;

const SAMPLE_DELAY_MS = 1200;

/** Sends nothing. It only lets the screens be rehearsed, and they say so. */
export function createSamplePublisher(): Publisher {
  const fails = new URLSearchParams(location.search).get("issue") === "publish";
  return {
    publish: () =>
      new Promise((resolve, reject) => {
        setTimeout(() => (fails ? reject(new Error("sample failure")) : resolve({ url: null })), SAMPLE_DELAY_MS);
      }),
  };
}

export function isValidTarget(destination: Destination, target: string) {
  const value = target.trim();
  return destination === "github" ? /^[\w.-]+\/[\w.-]+$/.test(value) : value.length > 0;
}

export function publishItems(meeting: Meeting): PublishItem[] {
  const { summary, segments, people } = meeting;
  if (!summary) return [];
  const times = (ids: string[]) =>
    ids.flatMap((id) => {
      const line = segments.find((s) => s.id === id);
      return line ? [formatTime(line.start)] : [];
    });
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? "Unassigned";
  return [
    { id: "overview", type: "overview", text: summary.overview, sourceTimes: [] },
    ...summary.decisions.map((d, i): PublishItem => ({ id: `decision-${i}`, type: "decision", text: d.text, sourceTimes: times(d.sources) })),
    ...summary.actions.map((a, i): PublishItem => ({
      id: `action-${i}`,
      type: "action",
      text: a.text,
      owner: nameOf(a.ownerId),
      due: a.due,
      sourceTimes: times(a.sources),
    })),
    ...summary.questions.map((q, i): PublishItem => ({ id: `question-${i}`, type: "question", text: q.text, sourceTimes: times(q.sources) })),
  ];
}

function itemLine(item: PublishItem) {
  const source = item.sourceTimes.length ? ` (${item.sourceTimes.join(", ")})` : "";
  if (item.type === "action") return `- [ ] **${item.owner}:** ${item.text}${item.due ? `, by ${item.due}` : ""}${source}`;
  return `- ${item.text}${source}`;
}

export function buildPayload(
  meeting: Meeting,
  settings: PublishSettings,
  selected: Set<string>,
  includeTranscript: boolean,
  date: string,
): PublishPayload {
  const items = publishItems(meeting).filter((item) => selected.has(item.id));
  const section = (heading: string, type: ItemType) => {
    const lines = items.filter((item) => item.type === type).map(itemLine);
    return lines.length ? [`## ${heading}`, "", ...lines, ""] : [];
  };
  const overview = items.find((item) => item.type === "overview");
  const out = [`# ${meeting.title}`, "", `Date: ${date}`, ""];
  if (overview) out.push(overview.text, "");
  out.push(...section("Decisions", "decision"), ...section("Actions", "action"), ...section("Open questions", "question"));
  if (includeTranscript) {
    out.push("## Transcript", "");
    for (const s of meeting.segments) {
      const name = s.overlap ? "Overlap" : meeting.people.find((p) => p.id === s.personId)?.name ?? "Unknown speaker";
      out.push(`**${name}** [${formatTime(s.start)}]: ${s.text}`, "");
    }
  }
  return {
    destination: settings.destination,
    target: settings[settings.destination].trim(),
    title: meeting.title,
    date,
    items,
    transcriptIncluded: includeTranscript,
    markdown: out.join("\n").trim() + "\n",
  };
}

const KEY = "timbre-publish";
const DEFAULTS: PublishSettings = { destination: "github", github: "", notion: "", auto: false };

export function loadSettings(): PublishSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(settings: PublishSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // The destination just won't survive a reload.
  }
}
