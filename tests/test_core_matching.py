from types import SimpleNamespace

import numpy as np
import pytest

from voice_split.identification import identify_speaker, identify_speaker_ranked
from voice_split.profiles import ProfileStore
from voice_split.streaming import recognize_window_ranked


def test_short_speech_assigns_highest_even_with_negative_similarity(tmp_path):
    profiles = ProfileStore(tmp_path)
    a = profiles.enroll("Alice", np.array([1., 0.]))
    b = profiles.enroll("Bob", np.array([.8, .6]))
    lengths = []
    def embed(audio):
        lengths.append(len(audio))
        return np.array([-1., 0.])
    engines = SimpleNamespace(embed=embed)
    result = identify_speaker_ranked(engines, profiles, np.ones(3200), [a["id"], b["id"]])
    assert lengths == [3200]
    assert result["profile_id"] == b["id"]
    assert result["score"] == pytest.approx(-.8)
    assert result["assignment_source"] == "automatic"
    assert result["identification"]["confidence"] == "low"
    assert result["identification"]["speech_seconds"] == .2
    assert result["identification"]["margin"] == pytest.approx(.2)


def test_roster_filters_before_matching_and_ties_sort_by_id(tmp_path):
    profiles = ProfileStore(tmp_path)
    a = profiles.enroll("Alice", np.array([1., 0.]))
    b = profiles.enroll("Bob", np.array([1., 0.]))
    c = profiles.enroll("Carol", np.array([0., 1.]))
    assert profiles.rank(np.array([1., 0.]), [c["id"]])[0]["profile_id"] == c["id"]
    assert [row["profile_id"] for row in profiles.rank(np.array([1., 0.]), [a["id"], b["id"]])] == sorted([a["id"], b["id"]])
    assert profiles.rank(np.array([1., 0., 0.]), [a["id"]]) == []
    assert profiles.rank(np.array([1., 0.]), []) == []


@pytest.mark.parametrize("embedding", [np.zeros(2), np.array([np.inf, 1.]), np.array([np.nan, 1.]), np.ones((2, 2)), np.array([1e308, 1e308])])
def test_rank_rejects_invalid_embedding(tmp_path, embedding):
    with pytest.raises(ValueError):
        ProfileStore(tmp_path).rank(embedding, [])


@pytest.mark.parametrize("samples,reason", [(np.empty(0), "no_speech"), (np.zeros(10), "no_speech"), (np.array([np.nan]), "invalid_audio")])
def test_unusable_audio_does_not_embed(tmp_path, samples, reason):
    engines = SimpleNamespace(embed=lambda audio: pytest.fail("unusable audio"))
    result = identify_speaker_ranked(engines, ProfileStore(tmp_path), samples, ["participant"])
    assert result["identification"]["reason"] == reason
    assert result["identification"]["confidence"] == "unavailable"
    assert result["assignment_source"] == "unassigned"


@pytest.mark.parametrize("error", [ValueError("too short"), RuntimeError("model failed")])
def test_model_failure_reports_unavailable(tmp_path, error):
    def embed(audio):
        raise error
    result = identify_speaker_ranked(SimpleNamespace(embed=embed), ProfileStore(tmp_path), np.ones(10), ["participant"])
    assert result["identification"]["reason"] == "embedding_unavailable"


def test_programming_errors_propagate(tmp_path):
    def embed(audio):
        raise TypeError("bug")
    with pytest.raises(TypeError):
        identify_speaker_ranked(SimpleNamespace(embed=embed), ProfileStore(tmp_path), np.ones(10), ["participant"])


def test_missing_participants_and_compatible_profiles(tmp_path):
    profiles = ProfileStore(tmp_path)
    engines = SimpleNamespace(embed=lambda audio: np.array([1., 0.]))
    assert identify_speaker_ranked(engines, profiles, np.ones(10), [])["identification"]["reason"] == "no_participants"
    assert identify_speaker_ranked(engines, profiles, np.ones(10), ["missing"])["identification"]["reason"] == "no_compatible_profiles"
    profile = profiles.enroll("Alice", np.ones(3))
    assert identify_speaker_ranked(engines, profiles, np.ones(10), [profile["id"]])["identification"]["reason"] == "no_compatible_profiles"


def test_legacy_matching_and_short_speech_contract_is_unchanged(tmp_path):
    profiles = ProfileStore(tmp_path)
    profiles.enroll("Alice", np.array([1., 0.]))
    assert profiles.match(np.array([0., 1.])) == {"speaker": "Unknown", "score": 0., "profile_id": None}
    result = identify_speaker(SimpleNamespace(embed=lambda audio: pytest.fail("legacy duration gate")), profiles, np.ones(3200))
    assert result["identification"]["reason"] == "insufficient_speech"
    assert "assignment_source" not in result


def test_stream_embedding_uses_emitted_bounds_and_holdback_flush(tmp_path):
    profiles = ProfileStore(tmp_path)
    profile = profiles.enroll("Alice", np.array([1., 0.]))
    state = SimpleNamespace(context=np.ones(32000) * .2, emitted_until=3., last_word="old")
    captured = []
    def embed(audio):
        captured.append(audio.copy())
        return np.array([1., 0.])
    words = [{"start": 1., "end": 1.5, "word": "old"},
             {"start": 2., "end": 2.2, "word": "new"},
             {"start": 4.8, "end": 5., "word": " later"}]
    engines = SimpleNamespace(embed=embed, transcribe=lambda audio: [{"start": 0., "end": 5., "words": words}])
    rows = recognize_window_ranked(engines, profiles, state, np.ones(48000) * .5, 3., participant_ids=[profile["id"]])
    assert rows[0]["text"] == "new"
    assert rows[0]["revision"] == 0
    assert rows[0]["profile_id"] == profile["id"]
    assert len(captured[0]) == 3200
    np.testing.assert_array_equal(captured[0], np.ones(3200) * .5)
    engines.transcribe = lambda audio: [{"start": 0., "end": len(audio) / 16000,
        "words": [{"start": len(audio) / 16000 - .2, "end": len(audio) / 16000, "word": " later"}]}]
    rows = recognize_window_ranked(engines, profiles, state, np.empty(0), 6., True, [profile["id"]])
    assert rows[0]["text"] == "later"
    assert rows[0]["end"] == 6.
    assert recognize_window_ranked(engines, profiles, state, np.empty(0), 6., True, [profile["id"]]) == []
