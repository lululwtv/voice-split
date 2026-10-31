import io

import numpy as np
import pytest
import soundfile as sf

from voice_split.audio import decode_audio, validate_speech


def recording(samples, rate=16000, **kwargs):
    stream = io.BytesIO()
    sf.write(stream, samples, rate, format="WAV", **kwargs)
    return stream.getvalue()


def tone(seconds=3, rate=16000):
    return 0.2 * np.sin(2 * np.pi * 220 * np.arange(int(rate * seconds)) / rate)


def test_stereo_resampling_preserves_duration_and_pitch():
    source = tone(rate=44100)
    decoded = decode_audio(recording(np.column_stack([source, source]), 44100))
    assert decoded.dtype == np.float32
    assert decoded.shape == (48000,)
    assert np.argmax(np.abs(np.fft.rfft(decoded))) / 3 == pytest.approx(220, abs=1)
    validate_speech(decoded)


@pytest.mark.parametrize("data", [b"", b"not an audio file"])
def test_invalid_recordings(data):
    with pytest.raises(ValueError):
        decode_audio(data)


def test_long_recording_rejected_instead_of_truncated():
    with pytest.raises(ValueError, match="60 second"):
        decode_audio(recording(tone(60.1)))


@pytest.mark.parametrize("samples", [np.zeros(48000), np.ones(48000) * 0.1])
def test_silence_and_dc_rejected(samples):
    with pytest.raises(ValueError, match="silent"):
        decode_audio(recording(samples))


def test_clipping_and_nonfinite_audio_rejected():
    with pytest.raises(ValueError, match="clipped"):
        decode_audio(recording(np.sign(tone())))
    samples = tone()
    samples[3] = np.nan
    with pytest.raises(ValueError, match="valid audio"):
        decode_audio(recording(samples, subtype="FLOAT"))


def test_enrollment_requires_active_audio_not_just_duration():
    short_speech = np.concatenate([tone(0.5), np.zeros(48000)])
    with pytest.raises(ValueError, match="audible speech"):
        validate_speech(short_speech)
