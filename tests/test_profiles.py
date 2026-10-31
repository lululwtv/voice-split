import numpy as np
import pytest

from voice_split.profiles import ProfileStore


def test_enrollment_persists_stable_identity_without_recordings(tmp_path):
    store = ProfileStore(tmp_path)
    original = store.enroll("  Alice   Smith ", np.array([1, 0, 0]))
    repeated = store.enroll("alice smith", np.array([0.9, 0.1, 0]))
    assert repeated == {**original, "samples": 2}
    reloaded = ProfileStore(tmp_path)
    assert reloaded.list() == [repeated]
    assert reloaded.match(np.array([1, 0, 0]))["profile_id"] == original["id"]
    assert [path.name for path in tmp_path.iterdir()] == ["profiles.json"]
    assert "vector_sum" not in repeated


def test_unknown_and_ambiguous_speakers_are_not_assigned(tmp_path):
    store = ProfileStore(tmp_path)
    assert store.match(np.array([1, 0]))["speaker"] == "Unknown"
    store.enroll("Alice", np.array([1, 0]))
    assert store.match(np.array([0, 1]))["speaker"] == "Unknown"
    store.enroll("Bob", np.array([0.99, 0.01]))
    assert store.match(np.array([1, 0]))["profile_id"] is None


def test_delete_survives_restart(tmp_path):
    store = ProfileStore(tmp_path)
    alice = store.enroll("Alice", np.array([1, 0]))
    assert store.delete(alice["id"])
    assert not store.delete(alice["id"])
    assert ProfileStore(tmp_path).list() == []


@pytest.mark.parametrize("name", ["", "   ", "a" * 81])
def test_invalid_names_are_rejected(tmp_path, name):
    with pytest.raises(ValueError):
        ProfileStore(tmp_path).enroll(name, np.array([1, 0]))


@pytest.mark.parametrize("vector", [np.zeros(2), np.array([np.nan, 1]), np.ones((2, 2))])
def test_invalid_embeddings_do_not_create_profiles(tmp_path, vector):
    store = ProfileStore(tmp_path)
    with pytest.raises(ValueError):
        store.enroll("Alice", vector)
    assert store.list() == []
