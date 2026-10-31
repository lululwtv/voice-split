from types import SimpleNamespace

import numpy as np

from voice_split.core_rooms import CoreRoomStore
from voice_split.meeting_stream import MeetingStream
from voice_split.open_matching import MeetingMatcher
from voice_split.profiles import ProfileStore
from voice_split.turns import identify_meeting_turns


def setup(tmp_path):
    store, profiles = CoreRoomStore(tmp_path), ProfileStore(tmp_path)
    room = store.create("meeting")["id"]
    def embed(samples):
        return np.array([np.count_nonzero(samples > 0), np.count_nonzero(samples < 0)], dtype=float)
    engine = SimpleNamespace(embed=embed)
    matcher = MeetingMatcher(engine, profiles, store)
    return store, room, profiles, engine, matcher


def observe(session, sign, step):
    audio = np.full(8000, sign, dtype=float)
    return session.observe(audio, audio, step / 2, (step + 1) / 2, [])


def test_accumulates_before_minting_and_does_not_swallow_returning_speaker(tmp_path):
    store, room, profiles, engine, matcher = setup(tmp_path)
    session = MeetingStream(matcher, room)
    results = [observe(session, sign, i) for i, sign in enumerate([1] * 8 + [-1] * 8 + [1] * 8)]
    assert all(row["unknown_id"] is None for row in results[:3])
    assert results[7]["unknown_id"] == results[23]["unknown_id"] == "unknown-1"
    assert results[15]["unknown_id"] == "unknown-2"
    assert any(row["unknown_id"] is None for row in results[8:15])
    assert len(session.audio) <= 6 * 16000


def test_single_orthogonal_transient_is_uncertain_without_new_identity(tmp_path):
    store, room, profiles, engine, matcher = setup(tmp_path)
    session = MeetingStream(matcher, room)
    for i in range(4):
        original = observe(session, 1, i)
    transient = session.observe(-np.ones(32000), -np.ones(8000), 2., 2.5, [])
    returning = session.observe(np.ones(32000), np.ones(8000), 2.5, 3., [])
    assert transient["unknown_id"] is None
    assert returning["unknown_id"] == original["unknown_id"]
    with store.connection() as db:
        assert db.execute("SELECT count(*) FROM unknown_voices").fetchone()[0] == 1


def test_streams_do_not_share_pending_evidence_and_bounded_audio(tmp_path):
    store, room, profiles, engine, matcher = setup(tmp_path)
    first, second = MeetingStream(matcher, room), MeetingStream(matcher, room)
    for i in range(30):
        observe(first, 1, i)
    assert observe(second, -1, 0)["unknown_id"] is None
    assert first.track_id != second.track_id
    assert len(first.audio) == 6 * 16000


def test_complete_upload_resolves_early_provisional_words(tmp_path):
    store, room, profiles, engine, matcher = setup(tmp_path)
    words = [{"start": i / 2, "end": (i + 1) / 2, "word": " word"} for i in range(8)]
    turns = identify_meeting_turns(engine, profiles, np.ones(64000), [{"words": words}], [], MeetingStream(matcher, room))
    assert all(turn["unknown_id"] == "unknown-1" for turn in turns)
    assert sum(len(turn["text"].split()) for turn in turns) == 8


def test_track_resolution_is_scoped_and_preserves_manual_edits_and_names(tmp_path):
    store, room, profiles, engine, matcher = setup(tmp_path)
    for id, stream, track in [("pending", "s1", "t1"), ("edited", "s1", "t1"), ("other-stream", "s2", "t1"), ("other-track", "s1", "t2")]:
        store.append(room, dict(id=id, stream_id=stream, track_id=track, start=0, end=1,
                               text=id, speaker="Unknown speaker", profile_id=None, unknown_id=None,
                               assignment_source="manual" if id == "edited" else "unassigned"))
    identity = matcher.identify(room, np.ones(32000), [])
    store.append(room, dict(id="named", start=0, end=1, text="named", **identity))
    store.name_unknown(room, "named", "Jamie", 0)
    changed = store.resolve_track(room, "s1", "t1", identity)
    assert [row["id"] for row in changed] == ["pending"]
    assert changed[0]["speaker"] == "Jamie" and changed[0]["revision"] == 1
    assert store.resolve_track(room, "s1", "t1", identity) == []


def test_strong_new_name_does_not_relabel_earlier_unknown_audio(tmp_path):
    store, room, profiles, engine, matcher = setup(tmp_path)
    bob = profiles.enroll("Bob", np.array([0., 1.]))["id"]
    session = MeetingStream(matcher, room)
    prior = [session.observe(np.ones(8000), np.ones(8000), i / 2, (i + 1) / 2, [bob]) for i in range(3)]
    current = session.observe(-np.ones(8000), -np.ones(8000), 1.5, 2, [bob])
    assert current["profile_id"] == bob
    assert all(row["track_id"] != current["track_id"] for row in prior)
    assert all(row["track_id"] not in session.resolutions for row in prior)


def test_roster_removal_and_empty_novel_audio_never_inherit_stale_identity(tmp_path):
    store, room, profiles, engine, matcher = setup(tmp_path)
    alice = profiles.enroll("Alice", np.array([1., 0.]))["id"]
    session = MeetingStream(matcher, room)
    assert session.observe(np.ones(8000), np.ones(8000), 0, .5, [alice])["profile_id"] == alice
    assert session.observe(np.ones(8000), np.ones(8000), .5, 1, [])["profile_id"] is None
    before = session.until, session.track_id, len(session.audio), len(session.recent)
    assert session.observe(np.ones(8000), np.empty(0), .25, .75, [])["profile_id"] is None
    assert (session.until, session.track_id, len(session.audio), len(session.recent)) == before


def test_new_microphone_context_does_not_enter_identity_evidence(tmp_path):
    store, room, profiles, engine, matcher = setup(tmp_path)
    session = MeetingStream(matcher, room)
    session.source_start = 2.
    words = [{"start": i / 2, "end": (i + 1) / 2, "word": " word"} for i in range(6)]
    audio = np.concatenate([np.ones(32000), -np.ones(16000)])
    turns = identify_meeting_turns(engine, profiles, audio, [{"words": words}], [], session)
    assert len(session.audio) == 16000
    assert np.all(session.audio < 0)
    assert all(turn["unknown_id"] is None for turn in turns)


def test_mature_unknown_reuse_requires_duration_and_clear_rival_margin(tmp_path):
    store, room, profiles, engine, matcher = setup(tmp_path)
    engine.embed = lambda audio: audio[:3]
    first = matcher.identify(room, np.tile([1., 0, 0], 16000), [])
    probe = np.array([.6, .8, 0.])
    assert matcher.identify_stream(room, np.tile(probe, 11000), [])["unknown_id"] is None
    assert matcher.identify_stream(room, np.tile(probe, 16000), [])["unknown_id"] == first["unknown_id"]
    matcher.identify(room, np.tile([0., 1., 0], 16000), [])
    ambiguous = np.array([.6, .6, np.sqrt(.28)])
    assert matcher.identify_stream(room, np.tile(ambiguous, 16000), [])["unknown_id"] is None
    with store.connection() as db:
        assert db.execute("SELECT count(*) FROM unknown_voices").fetchone()[0] == 2


def test_mature_named_unknown_tie_stays_unassigned(tmp_path):
    store, room, profiles, engine, matcher = setup(tmp_path)
    engine.embed = lambda audio: audio[:3]
    probe = np.array([.58, np.sqrt(1 - .58 ** 2), 0.])
    unknown = .62 * probe + np.sqrt(1 - .62 ** 2) * np.array([0., 0., 1.])
    matcher.identify(room, np.tile(unknown, 16000), [])
    alice = profiles.enroll("Alice", np.array([1., 0., 0.]))["id"]
    result = matcher.identify_stream(room, np.tile(probe, 16000), [alice])
    assert result["profile_id"] is None and result["unknown_id"] is None
    assert result["identification"]["reason"] == "ambiguous_identity"
