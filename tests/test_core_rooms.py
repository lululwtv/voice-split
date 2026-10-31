import json
from concurrent.futures import ThreadPoolExecutor

import pytest

from voice_split.core_rooms import ConflictError, CoreRoomStore
from voice_split.rooms import RoomStore


PROFILE = {"id": "alice", "name": "Alice"}


def test_unknown_name_propagates_and_survives_restart_without_overwriting_corrections(tmp_path):
    store = CoreRoomStore(tmp_path)
    room = store.create("Names")["id"]
    other = store.create("Other")["id"]
    store.set_roster(room, ["alice"], 0)
    for identity, unknown in [("a", "u1"), ("b", "u1"), ("c", "u2"), ("d", "u1")]:
        store.append(room, live_segment(identity, 0, 1, profile_id=None, unknown_id=unknown))
    store.append(other, live_segment("outside", 0, 1, profile_id=None, unknown_id="u1"))
    store.correct(room, "d", PROFILE, 0, "single")
    changed = store.name_unknown(room, "a", "  Jamie  ", 0)
    assert {s["id"] for s in changed} == {"a", "b"}
    assert all(s["speaker"] == "Jamie" and s["revision"] == 1 for s in changed)
    assert store.get_segment(room, "d")["speaker"] == "Alice"
    assert store.get_segment(other, "outside")["speaker"] != "Jamie"
    with pytest.raises(ConflictError):
        store.name_unknown(room, "a", "Stale", 0)
    store = CoreRoomStore(tmp_path)
    result = store.append_live(room, live_segment("future", 4, 5, profile_id=None, unknown_id="u1"))
    assert result["speaker"] == "Jamie"
    assert result["identification"]["confidence"] == "manual"
    store.append(room, live_segment("generic", 6, 7, profile_id=None))
    with pytest.raises(ValueError):
        store.name_unknown(room, "generic", "Nobody", 0)


def live_segment(identity, start, end, **overrides):
    return {"id": identity, "start": start, "end": end, "text": identity,
            "profile_id": "alice", "speaker": "Alice", "score": .8,
            "stream_id": "recording", "device_id": "microphone", **overrides}


def test_live_continuation_reuses_identity_and_keeps_weakest_evidence(tmp_path):
    store = CoreRoomStore(tmp_path)
    room = store.create("Live")["id"]
    first = store.append_live(room, live_segment("first", 0, 1))
    second = store.append_live(room, live_segment("second", 1.1, 2, score=.6))
    assert second["id"] == first["id"]
    assert second["revision"] == 1
    assert second["text"] == "first second"
    assert second["score"] == .6
    assert CoreRoomStore(tmp_path).history(room) == [second]


def test_continuation_preserves_lower_confidence_even_with_higher_similarity(tmp_path):
    store = CoreRoomStore(tmp_path)
    room = store.create("Live")["id"]
    store.append_live(room, live_segment("first", 0, 1, score=.81, identification={"confidence": "high"}))
    merged = store.append_live(room, live_segment("second", 1.1, 2, score=.9, identification={"confidence": "low"}))
    assert merged["identification"]["confidence"] == "low"


def test_numbered_unknown_continuations_merge_but_distinct_unknowns_do_not(tmp_path):
    store = CoreRoomStore(tmp_path)
    room = store.create("Live")["id"]
    def segment(identity, start, end, unknown):
        return live_segment(identity, start, end, profile_id=None, unknown_id=unknown,
                            assignment_source="unassigned", speaker=unknown)
    store.append_live(room, segment("first", 0, 1, "unknown-1"))
    store.append_live(room, segment("second", 1.1, 2, "unknown-1"))
    store.append_live(room, segment("third", 2.1, 3, "unknown-2"))
    assert [row["text"] for row in store.history(room)] == ["first second", "third"]


@pytest.mark.parametrize("changes", [
    {"profile_id": "bob"}, {"profile_id": None}, {"device_id": "other"},
    {"stream_id": "another-recording"}, {"start": 2}, {"start": .8}, {"end": 21},
])
def test_live_turn_boundaries_are_not_merged(tmp_path, changes):
    store = CoreRoomStore(tmp_path)
    room = store.create("Live")["id"]
    store.append_live(room, live_segment("first", 0, 1))
    store.append_live(room, {**live_segment("second", 1.1, 2), **changes})
    assert len(store.history(room)) == 2


def test_manual_correction_closes_live_turn(tmp_path):
    store = CoreRoomStore(tmp_path)
    room = store.create("Live")["id"]
    store.set_roster(room, [PROFILE["id"]], 0)
    store.append_live(room, live_segment("first", 0, 1))
    manual = store.correct(room, "first", PROFILE, 0, "correction")
    store.append_live(room, live_segment("second", 1.1, 2))
    assert store.history(room)[0] == manual
    assert len(store.history(room)) == 2


def setup_room(tmp_path):
    store = CoreRoomStore(tmp_path)
    room_id = store.create("Planning")["id"]
    store.set_roster(room_id, [PROFILE["id"]], 0)
    store.append(room_id, {"id": "segment-a", "speaker": "Unknown", "text": "Hello",
                           "identification": {"reason": "low_score", "candidate": "Alice"}})
    return store, room_id


def test_legacy_preserved_and_full_history(tmp_path):
    legacy = RoomStore(tmp_path)
    room_id = legacy.create("Existing")["id"]
    profiles = tmp_path / "profiles.json"
    profiles.write_text('{"original":true}')
    with legacy.connection() as db:
        db.executemany("INSERT INTO segments VALUES (?,?,?)", [
            (str(index), room_id, json.dumps({"id": str(index), "speaker": "Unknown"}))
            for index in range(1002)
        ])
    store = CoreRoomStore(tmp_path)
    assert store.roster(room_id) == {"participant_ids": [], "revision": 0}
    rows = store.history(room_id)
    assert len(rows) == 1002
    assert [row["id"] for row in rows] == [str(index) for index in range(1002)]
    assert rows[0]["revision"] == 0
    assert rows[0]["assignment_source"] == "automatic"
    assert rows[0]["profile_id"] is None
    assert rows[0]["learning_status"] == "unavailable"
    assert legacy.history(room_id)[0] == {"id": "2", "speaker": "Unknown"}
    assert profiles.read_text() == '{"original":true}'


def test_correction_survives_reopen_and_preserves_evidence(tmp_path):
    store, room_id = setup_room(tmp_path)
    result = store.correct(room_id, "segment-a", PROFILE, 0, "request-a")
    reopened = CoreRoomStore(tmp_path)
    assert reopened.get_segment(room_id, "segment-a") == result
    assert result["speaker"] == "Alice"
    assert result["profile_id"] == "alice"
    assert result["revision"] == 1
    assert result["assignment_source"] == "manual"
    assert result["learning_status"] == "unavailable"
    assert result["identification"]["confidence"] == "manual"
    assert result["identification"]["original"]["reason"] == "low_score"
    assert result["text"] == "Hello"


def test_roster_revision_validation_and_no_implicit_members(tmp_path):
    store, room_id = setup_room(tmp_path)
    with pytest.raises(ConflictError):
        store.set_roster(room_id, [], 0)
    with pytest.raises(ValueError):
        store.set_roster(room_id, ["alice", "alice"], 1)
    for invalid in ([""], "alice", [None]):
        with pytest.raises(ValueError):
            store.set_roster(room_id, invalid, 1)
    with pytest.raises(ValueError):
        store.correct(room_id, "segment-a", {"id": "bob", "name": "Bob"}, 0, "bob")
    assert store.roster(room_id) == {"participant_ids": ["alice"], "revision": 1}
    assert store.set_roster(room_id, [], 1) == {"participant_ids": [], "revision": 2}


def test_idempotency_replays_original_response_and_rejects_reuse(tmp_path):
    store, room_id = setup_room(tmp_path)
    first = store.correct(room_id, "segment-a", PROFILE, 0, "request")
    store.correct(room_id, "segment-a", PROFILE, 1, "second-request")
    reopened = CoreRoomStore(tmp_path)
    assert reopened.correct(room_id, "segment-a", dict(PROFILE), 0, "request") == first
    with pytest.raises(ConflictError):
        store.correct(room_id, "segment-a", PROFILE, 1, "request")
    with pytest.raises(ConflictError):
        store.correct(room_id, "segment-a", PROFILE, 0, "third-request")


def test_automatic_revision_and_manual_lock(tmp_path):
    store, room_id = setup_room(tmp_path)
    assert store.update_automatic(room_id, "segment-a", {"speaker": "Candidate"}, 0)["revision"] == 1
    assert store.update_automatic(room_id, "segment-a", {"speaker": "Late"}, 0) is None
    with pytest.raises(ConflictError):
        store.correct(room_id, "segment-a", PROFILE, 0, "stale")
    manual = store.correct(room_id, "segment-a", PROFILE, 1, "manual")
    assert store.update_automatic(room_id, "segment-a", {"speaker": "Late"}, 2) is None
    assert store.get_segment(room_id, "segment-a") == manual


def test_idempotency_uses_request_identity_after_profile_changes(tmp_path):
    store, room_id = setup_room(tmp_path)
    assert store.correction_replay(room_id, "segment-a", PROFILE["id"], 0, "request") is None
    first = store.correct(room_id, "segment-a", {**PROFILE, "samples": 1}, 0, "request")
    changed = {**PROFILE, "name": "Renamed Alice", "samples": 2}
    assert store.correct(room_id, "segment-a", changed, 0, "request") == first
    reopened = CoreRoomStore(tmp_path)
    assert reopened.correction_replay(room_id, "segment-a", PROFILE["id"], 0, "request") == first
    with pytest.raises(ConflictError):
        store.correction_replay(room_id, "segment-a", "different-profile", 0, "request")
    with pytest.raises(KeyError):
        store.correction_replay("missing-room", "segment-a", PROFILE["id"], 0, "request")


def test_concurrent_corrections_only_one_revision_wins(tmp_path):
    store, room_id = setup_room(tmp_path)

    def correct(key):
        try:
            return CoreRoomStore(tmp_path).correct(room_id, "segment-a", PROFILE, 0, key)
        except ConflictError:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(correct, ["one", "two"]))
    assert sum(result is not None for result in results) == 1
    assert store.get_segment(room_id, "segment-a")["revision"] == 1


def test_automatic_and_manual_race_retains_manual_assignment(tmp_path):
    store, room_id = setup_room(tmp_path)

    def automatic():
        return CoreRoomStore(tmp_path).update_automatic(
            room_id, "segment-a", {"speaker": "Automatic"}, 0
        )

    def manual():
        try:
            return CoreRoomStore(tmp_path).correct(room_id, "segment-a", PROFILE, 0, "manual")
        except ConflictError:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        auto_future = pool.submit(automatic)
        manual_future = pool.submit(manual)
        automatic_result, manual_result = auto_future.result(), manual_future.result()
    assert (automatic_result is None) != (manual_result is None)
    if manual_result is None:
        manual_result = store.correct(room_id, "segment-a", PROFILE, 1, "retry")
    assert store.update_automatic(
        room_id, "segment-a", {"speaker": "Late automatic"}, manual_result["revision"]
    ) is None
    assert store.get_segment(room_id, "segment-a") == manual_result


def test_room_and_segment_scope(tmp_path):
    store, room_id = setup_room(tmp_path)
    other = store.create("Other")["id"]
    with pytest.raises(KeyError):
        store.correct(other, "segment-a", PROFILE, 0, "cross-room")
    with pytest.raises(KeyError):
        store.get_segment(other, "segment-a")
    for action in (
        lambda: store.roster("missing"), lambda: store.history("missing"),
        lambda: store.set_roster("missing", [], 0),
        lambda: store.append("missing", {"id": "orphan"}),
    ):
        with pytest.raises(KeyError):
            action()
    assert store.get_segment(room_id, "segment-a")["revision"] == 0
