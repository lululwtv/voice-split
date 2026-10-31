from types import SimpleNamespace
import pytest
import numpy as np
from voice_split.core_rooms import CoreRoomStore
from voice_split.profiles import ProfileStore
from voice_split.open_matching import MeetingMatcher


@pytest.mark.parametrize("configured", [None, ".45"])
@pytest.mark.parametrize("seconds", [.25, 2])
def test_named_threshold_is_shared_by_profiles_meetings_and_voice_test(tmp_path, monkeypatch, configured, seconds):
    monkeypatch.delenv("VOICE_SPLIT_OPEN_THRESHOLD", raising=False)
    monkeypatch.delenv("VOICE_SPLIT_MATCH_THRESHOLD", raising=False)
    if configured is not None:
        monkeypatch.setenv("VOICE_SPLIT_MATCH_THRESHOLD", configured)
    store, profiles = CoreRoomStore(tmp_path), ProfileStore(tmp_path)
    room = store.create("meeting")["id"]
    alice = profiles.enroll("Alice", np.array([1., 0.]))["id"]
    matcher = MeetingMatcher(SimpleNamespace(embed=lambda audio: audio[:2]), profiles, store)
    threshold = float(configured or ".30")
    for score in (threshold - .01, threshold + .01):
        vector = np.array([score, np.sqrt(1 - score ** 2)])
        audio = np.tile(vector, int(8000 * seconds))
        for result in (profiles.assess(vector), matcher.assess(room, audio, [alice]),
                       matcher.assess_scores(audio, [alice])):
            assert result["identification"]["threshold"] == threshold
            assert result["profile_id"] == (alice if score > threshold else None)


def test_unknowns_persist_and_are_scoped_to_meetings(tmp_path):
    store, profiles = CoreRoomStore(tmp_path), ProfileStore(tmp_path)
    room = store.create("first")["id"]
    other = store.create("second")["id"]
    engine = SimpleNamespace(embed=lambda audio: audio[:3])
    matcher = MeetingMatcher(engine, profiles, store)
    def identify(vector, room_id=room):
        return matcher.identify(room_id, np.tile(vector, 4000), [])
    assert identify([1., 0, 0])["speaker"] == "Unknown speaker 1"
    assert identify([0., 1, 0])["speaker"] == "Unknown speaker 2"
    matcher = MeetingMatcher(engine, profiles, CoreRoomStore(tmp_path))
    assert identify([1., .01, 0])["speaker"] == "Unknown speaker 1"
    assert identify([0., 1, 0], other)["speaker"] == "Unknown speaker 1"


def test_open_matching_rejects_weak_ambiguous_and_unchecked_voices(tmp_path, monkeypatch):
    monkeypatch.setenv("VOICE_SPLIT_OPEN_THRESHOLD", ".55")
    store, profiles = CoreRoomStore(tmp_path), ProfileStore(tmp_path)
    room = store.create("meeting")["id"]
    alice = profiles.enroll("Alice", np.array([1., 0., 0.]))["id"]
    engine = SimpleNamespace(embed=lambda audio: audio[:3])
    matcher = MeetingMatcher(engine, profiles, store)
    def identify(vector, duration=1):
        return matcher.identify(room, np.tile(vector, int(16000 * duration / 3)), [alice])
    assert identify([1., 0, 0])["profile_id"] == alice
    weak = identify([.2, .98, 0])
    assert weak["profile_id"] is None and weak["unknown_id"]
    tentative = identify([.6, 0, .8], .25)
    assert tentative["profile_id"] == alice
    assert tentative["identification"]["confidence"] == "low"
    profiles.enroll("Unchecked Bob", np.array([.7, .7, 0]))
    assert identify([.7, .7, 0])["profile_id"] is None
    assert identify([1., 0, 0])["profile_id"] == alice
    profiles.enroll("Similar voice", np.array([1., .01, 0]))
    assert identify([1., 0, 0])["identification"]["reason"] == "ambiguous"


def test_model_failure_does_not_create_unknown_identity(tmp_path):
    store = CoreRoomStore(tmp_path)
    room = store.create("meeting")["id"]
    def fail(audio):
        raise RuntimeError("offline")
    result = MeetingMatcher(SimpleNamespace(embed=fail), ProfileStore(tmp_path), store).identify(room, np.ones(1600), [])
    assert result["unknown_id"] is None
    with store.connection() as db:
        assert db.execute("SELECT count(*) FROM unknown_voices").fetchone()[0] == 0


def test_returning_unknown_beats_borderline_name_but_strong_enrollment_can_resolve_it(tmp_path, monkeypatch):
    monkeypatch.setenv("VOICE_SPLIT_OPEN_THRESHOLD", ".55")
    store, profiles = CoreRoomStore(tmp_path), ProfileStore(tmp_path)
    room = store.create("meeting")["id"]
    alice = profiles.enroll("Alice", np.array([1., 0.]))["id"]
    matcher = MeetingMatcher(SimpleNamespace(embed=lambda audio: audio[:2]), profiles, store)
    first = matcher.identify(room, np.tile([.4, np.sqrt(.84)], 8000), [alice])
    again = matcher.identify(room, np.tile([.6, .8], 8000), [alice])
    assert first["unknown_id"] == again["unknown_id"] == "unknown-1"
    assert again["profile_id"] is None
    assert again["identification"]["reason"] == "unknown_voice_closer"
    bob = profiles.enroll("Bob", np.array([.6, .8]))["id"]
    resolved = matcher.identify(room, np.tile([.6, .8], 8000), [alice, bob])
    assert resolved["profile_id"] == bob


@pytest.mark.parametrize("samples", [np.ones((16000, 2)), np.array(1.), np.array([np.nan]), np.zeros(10)])
def test_invalid_audio_never_calls_embedding_or_mints_unknown(tmp_path, samples):
    store = CoreRoomStore(tmp_path)
    room = store.create("meeting")["id"]
    def embed(audio):
        raise AssertionError("Invalid audio reached inference")
    result = MeetingMatcher(SimpleNamespace(embed=embed), ProfileStore(tmp_path), store).identify(room, samples, [])
    assert result["unknown_id"] is None


def test_incompatible_saved_reference_is_unavailable_not_new_unknown(tmp_path):
    store, profiles = CoreRoomStore(tmp_path), ProfileStore(tmp_path)
    room = store.create("meeting")["id"]
    person = profiles.enroll("Person", np.ones(3))["id"]
    matcher = MeetingMatcher(SimpleNamespace(embed=lambda audio: np.ones(2)), profiles, store)
    result = matcher.identify(room, np.ones(16000), [person])
    assert result["unknown_id"] is None
    assert result["identification"]["reason"] == "no_compatible_profiles"


def test_unknown_references_do_not_cross_model_versions(tmp_path):
    store, profiles = CoreRoomStore(tmp_path), ProfileStore(tmp_path)
    room = store.create("meeting")["id"]
    def match(model):
        engine = SimpleNamespace(speaker_name=model, embed=lambda audio: np.array([1., 0.]))
        return MeetingMatcher(engine, profiles, store).identify(room, np.ones(16000), [])
    assert match("first")["unknown_id"] == "unknown-1"
    assert match("second")["unknown_id"] == "unknown-2"
    assert match("first")["unknown_id"] == "unknown-1"


def test_credible_named_and_unknown_candidates_need_a_clear_margin(tmp_path):
    store, profiles = CoreRoomStore(tmp_path), ProfileStore(tmp_path)
    room = store.create("meeting")["id"]
    alice = profiles.enroll("Alice", np.array([1., 0., 0.]))["id"]
    matcher = MeetingMatcher(SimpleNamespace(embed=lambda audio: audio[:3]), profiles, store)
    probe = np.array([.7, np.sqrt(.51), 0.])
    reference = .74 * probe + np.sqrt(1 - .74 ** 2) * np.array([0., 0., 1.])
    matcher.identify(room, np.tile(reference, 8000), [])
    result = matcher.identify(room, np.tile(probe, 8000), [alice])
    assert result["profile_id"] is None and result["unknown_id"] is None
    assert result["identification"]["reason"] == "ambiguous_identity"
