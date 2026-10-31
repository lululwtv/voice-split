import type { Meeting, Person, Segment } from "../types";

interface Identification {
  confidence?: string;
  candidate_profile_id?: string | null;
  score?: number | null;
  original?: Identification;
}

export interface RawSegment {
  unknown_id?: string | null;
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  profile_id?: string | null;
  score?: number | null;
  revision?: number;
  assignment_source?: "automatic" | "manual" | "unassigned";
  identification?: Identification;
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!path.startsWith("/api/")) throw new Error("Use a local API path.");
  const headers = new Headers(options.headers);
  if (typeof options.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const error = await response.json();
      if (typeof error.detail === "string") message = error.detail;
      else if (Array.isArray(error.detail)) {
        message = error.detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join("; ") || message;
      }
    } catch { /* Keep the HTTP error when the server did not return JSON. */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function roomPath(id: string): string {
  return `/api/v2/rooms/${encodeURIComponent(id)}`;
}

export function toSegment(row: RawSegment): Segment {
  const personId = row.profile_id ?? null;
  const original = row.assignment_source === "manual" ? row.identification?.original : undefined;
  const originalPersonId = row.assignment_source === "manual" ? original?.candidate_profile_id ?? null : personId;
  const score = row.assignment_source === "manual" ? original?.score : row.score;
  const candidateId = (original ?? row.identification)?.candidate_profile_id ?? originalPersonId;
  return {
    id: row.id, start: row.start, end: row.end, text: row.text,
    speakerLabel: row.speaker, unknownId: row.unknown_id, confidence: row.identification?.confidence,
    personId, profile_id: personId, originalPersonId,
    matches: candidateId !== null && typeof score === "number" && Number.isFinite(score)
      ? [{ personId: candidateId, score }] : [],
    revision: row.revision ?? 0,
    assignment_source: row.assignment_source ?? "automatic",
  };
}

export function mergeSegment(list: Segment[], incoming: Segment): Segment[] {
  const index = list.findIndex((segment) => segment.id === incoming.id);
  if (index === -1) return [...list, incoming];
  if ((incoming.revision ?? 0) <= (list[index].revision ?? 0)) return list;
  return list.map((segment, position) => position === index ? incoming : segment);
}

export async function correctSpeaker(roomId: string, segment: Segment, personId: string): Promise<Segment> {
  const row = await request<RawSegment>(`${roomPath(roomId)}/segments/${encodeURIComponent(segment.id)}/speaker`, {
    method: "PATCH",
    body: JSON.stringify({ profile_id: personId, expected_revision: segment.revision ?? 0,
      idempotency_key: crypto.randomUUID() }),
  });
  return toSegment(row);
}

export async function loadMeeting(room: { id: string; title: string }, people: Person[]): Promise<Meeting> {
  const result = await request<{ segments: RawSegment[] }>(`${roomPath(room.id)}/segments`);
  const segments = result.segments.map(toSegment);
  return {
    roomId: room.id, title: room.title, isSample: false, people, segments,
    windows: segments.flatMap((segment) => segment.personId === null ? [] : [
      { start: segment.start, end: segment.end, personId: segment.personId },
    ]),
    duration: segments.reduce((end, segment) => Math.max(end, segment.end), 0),
    summary: null,
  };
}
