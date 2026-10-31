import { afterEach, describe, expect, it, vi } from "vitest";
import { correctSpeaker, loadMeeting, mergeSegment, request, toSegment, type RawSegment } from "./api";

const raw = (patch: Partial<RawSegment> = {}): RawSegment => ({
  id: "segment", start: 1, end: 3, text: "Hello", profile_id: "alice", score: -.2,
  revision: 0, assignment_source: "automatic", ...patch,
});

afterEach(() => vi.unstubAllGlobals());

describe("speaker segment mapping", () => {
  it("preserves the engine identity and evidence after a manual correction", () => {
    const segment = toSegment(raw({ profile_id: "bob", score: null, revision: 2,
      assignment_source: "manual", identification: { original: { candidate_profile_id: "alice", score: -.2 } } }));
    expect(segment.personId).toBe("bob");
    expect(segment.originalPersonId).toBe("alice");
    expect(segment.matches).toEqual([{ personId: "alice", score: -.2 }]);
    expect(segment.revision).toBe(2);
  });

  it("ignores a stale automatic event arriving after a manual correction", () => {
    const corrected = toSegment(raw({ profile_id: "bob", assignment_source: "manual", revision: 2 }));
    const list = [corrected];
    expect(mergeSegment(list, toSegment(raw({ revision: 1 })))).toBe(list);
    expect(mergeSegment(list, toSegment(raw({ revision: 2 })))).toBe(list);
    expect(mergeSegment(list, toSegment(raw({ revision: 3 })))[0].personId).toBe("alice");
    expect(mergeSegment(list, toSegment(raw({ id: "next" })))).toHaveLength(2);
  });
});

describe("local meeting API", () => {
  it("sends the correction revision and a unique idempotency key", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(raw({
      profile_id: "bob", revision: 5, assignment_source: "manual",
    })), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const result = await correctSpeaker("room/one", toSegment(raw({ id: "line/one", revision: 4 })), "bob");
    const [path, options] = fetcher.mock.calls[0];
    expect(path).toBe("/api/v2/rooms/room%2Fone/segments/line%2Fone/speaker");
    expect(options.method).toBe("PATCH");
    expect(options.credentials).toBe("same-origin");
    expect(options.headers.get("Content-Type")).toBe("application/json");
    const body = JSON.parse(options.body);
    expect(body).toEqual({ profile_id: "bob", expected_revision: 4, idempotency_key: expect.any(String) });
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.personId).toBe("bob");
    expect(result.revision).toBe(5);
  });

  it("surfaces revision conflicts without inventing a successful correction", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "The segment has changed. Reload and retry." }), { status: 409 })));
    await expect(correctSpeaker("room", toSegment(raw()), "bob")).rejects.toThrow("The segment has changed");
  });

  it("loads saved transcript labels and derives duration and attributed windows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ segments: [raw(), raw({ id: "unknown", end: 8, profile_id: null })] }))));
    const people = [{ id: "alice", name: "Alice", role: "room" as const }];
    const meeting = await loadMeeting({ id: "room", title: "Planning" }, people);
    expect(meeting).toMatchObject({ roomId: "room", title: "Planning", isSample: false, duration: 8, summary: null });
    expect(meeting.people).toBe(people);
    expect(meeting.windows).toEqual([{ start: 1, end: 3, personId: "alice" }]);
  });

  it("rejects external URLs before any request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(request("https://other.example/api/rooms")).rejects.toThrow("local API");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
