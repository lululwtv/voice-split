import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TranscriptTurn } from "./TranscriptTurn";
import { SpeakerSelect } from "./people";
import { groupTranscriptTurns } from "../lib/transcriptTurns";
import type { Segment } from "../types";

const rows: Segment[] = [0, 1].map((number) => ({ id: `source-${number}`, start: number, end: number + 1,
  text: number ? "this works." : "I think", personId: "alex", originalPersonId: "alex", matches: [], revision: number }));
const people = [{ id: "alex", name: "Alex", role: "room" as const }];

function findElements(node: unknown, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, type));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<{ children?: unknown }>;
  return [...(element.type === type ? [element as ReactElement<Record<string, unknown>>] : []), ...findElements(element.props.children, type)];
}

it("shows one readable header and paragraph, with each original correction inside details", () => {
  const html = renderToStaticMarkup(createElement(TranscriptTurn, { turn: groupTranscriptTurns(rows)[0], people, saving: null, onRelabel: () => {}, onSaved: () => {} }));
  const visible = html.split('<details class="turn-details">')[0];
  expect(visible).toContain("<strong>Alex</strong>");
  expect(visible).toContain("<p>I think this works.</p>");
  expect(visible).not.toContain("<select");
  expect(html).toContain('id="line-source-0"');
  expect(html).toContain('id="line-source-1"');
  expect(html.match(/<select/g)).toHaveLength(2);
});

it("corrects and seeks the selected source fragment rather than the first row of a turn", async () => {
  const onRelabel = vi.fn();
  const onSeek = vi.fn();
  const tree = TranscriptTurn({ turn: groupTranscriptTurns(rows)[0], people, saving: null, onRelabel, onSeek, onSaved: () => {} });
  const selects = findElements(tree, SpeakerSelect);
  await (selects[1].props.onChange as (id: string) => void)("jamie");
  expect(onRelabel).toHaveBeenCalledWith(rows[1], "jamie");
  const stamps = findElements(tree, "button");
  (stamps.at(-1)!.props.onClick as () => void)();
  expect(onSeek).toHaveBeenCalledWith(1);
});
