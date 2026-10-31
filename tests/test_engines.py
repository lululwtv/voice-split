from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from voice_split.engines import AudioEngines
from voice_split.engines import _MLXWhisper


def test_transcription_exposes_word_timestamps_for_live_context_filtering(tmp_path):
    engines = AudioEngines(tmp_path)
    samples = np.zeros(16000, dtype=np.float32)
    words = [SimpleNamespace(start=0.12, end=0.3, word=" Hello"),
             SimpleNamespace(start=0.32, end=0.75, word=" world.")]
    segments = iter([SimpleNamespace(start=0.1, end=0.8, text=" Hello world. ", words=words),
                     SimpleNamespace(start=0.9, end=1.0, text=" ", words=None)])
    engines.whisper = Mock()
    engines.whisper.transcribe.return_value = segments, None

    assert engines.transcribe(samples) == [{
        "start": 0.1, "end": 0.8, "text": "Hello world.",
        "words": [{"start": 0.12, "end": 0.3, "word": " Hello"},
                  {"start": 0.32, "end": 0.75, "word": " world."}],
    }]
    assert engines.whisper.transcribe.call_args.kwargs["word_timestamps"] is True


def test_mlx_configuration_preserves_legacy_model_setting(tmp_path, monkeypatch):
    monkeypatch.setenv("VOICE_SPLIT_WHISPER_MODEL", "tiny.en")
    assert AudioEngines(tmp_path).whisper_name == "tiny.en"
    monkeypatch.setenv("VOICE_SPLIT_ASR_BACKEND", "mlx")
    engines = AudioEngines(tmp_path)
    assert engines.status()["transcription"]["model"] == "mlx-community/whisper-small.en-mlx"
    assert engines.status()["transcription"]["backend"] == "mlx"
    monkeypatch.setenv("VOICE_SPLIT_MLX_MODEL", "/tmp/custom-model")
    assert AudioEngines(tmp_path).whisper_name == "/tmp/custom-model"


def test_mlx_prewarm_silence_and_timestamp_mapping(monkeypatch):
    import sys
    import faster_whisper.vad

    monkeypatch.setattr("voice_split.engines.platform.system", lambda: "Darwin")
    monkeypatch.setattr("voice_split.engines.platform.machine", lambda: "arm64")
    decode = Mock(return_value={"segments": [{"start": .5, "end": .9,
        "text": " Hello. ", "words": [{"start": .5, "end": .9, "word": " Hello.",
                                       "probability": .9}]}]})
    speech = Mock(return_value=[])
    monkeypatch.setitem(sys.modules, "mlx_whisper", SimpleNamespace(transcribe=decode))
    monkeypatch.setattr(faster_whisper.vad, "get_speech_timestamps", speech)
    adapter = _MLXWhisper("model")
    assert decode.call_count == 1
    assert adapter.transcribe(np.zeros(16000)) == []
    assert decode.call_count == 1
    speech.return_value = [{"start": 8000, "end": 14400}]
    audio = np.ones(16000, dtype=np.float32)
    assert adapter.transcribe(audio) == [{"start": .5, "end": .9, "text": "Hello.",
        "words": [{"start": .5, "end": .9, "word": " Hello."}]}]
    np.testing.assert_array_equal(decode.call_args.args[0], audio)
    assert decode.call_args.kwargs["temperature"] == 0
    assert "beam_size" not in decode.call_args.kwargs
    with pytest.raises(ValueError, match="finite mono"):
        adapter.transcribe(np.array([np.nan], dtype=np.float32))


def test_mlx_unsupported_platform_reports_load_error(tmp_path, monkeypatch):
    monkeypatch.setenv("VOICE_SPLIT_ASR_BACKEND", "mlx")
    monkeypatch.setattr("voice_split.engines.platform.system", lambda: "Linux")
    engines = AudioEngines(tmp_path)
    engines.speaker = object()
    engines.load()
    assert engines.status()["transcription"]["ready"] is False
    assert "Apple silicon" in engines.errors["transcription"]


def test_mlx_failed_prewarm_is_not_ready(tmp_path, monkeypatch):
    monkeypatch.setenv("VOICE_SPLIT_ASR_BACKEND", "mlx")
    monkeypatch.setattr("voice_split.engines._MLXWhisper", Mock(side_effect=OSError("broken model")))
    engines = AudioEngines(tmp_path)
    engines.speaker = object()
    engines.load()
    assert engines.whisper is None
    assert engines.errors["transcription"] == "OSError: broken model"
