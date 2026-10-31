"""Bounded decoding and signal checks for 16 kHz mono recordings."""

import io
import math

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

SAMPLE_RATE = 16000
MAX_SECONDS = 60
MAX_UPLOAD_BYTES = 32 * 1024 * 1024


def decode_audio(data: bytes) -> np.ndarray:
    if not data or len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("Recording must be a nonempty audio file under 32 MB.")
    try:
        with sf.SoundFile(io.BytesIO(data)) as recording:
            if recording.format not in {"WAV", "WAVEX", "FLAC", "OGG", "AIFF"}:
                raise ValueError("Use a WAV, FLAC, OGG, or AIFF recording.")
            rate = recording.samplerate
            if not 8000 <= rate <= 192000 or recording.channels not in {1, 2}:
                raise ValueError("Use mono or stereo audio sampled at 8–192 kHz.")
            if recording.frames > rate * MAX_SECONDS:
                raise ValueError("Recording exceeds the 60 second limit; trim it before uploading.")
            samples = recording.read(dtype="float32", always_2d=True)
    except (sf.LibsndfileError, RuntimeError) as exc:
        raise ValueError("Cannot decode recording; upload WAV, FLAC, OGG, or AIFF audio.") from exc
    if samples.size == 0 or not np.isfinite(samples).all():
        raise ValueError("Recording contains no valid audio samples.")
    if np.max(np.abs(samples)) > 1.01 or np.mean(np.abs(samples) >= 0.999) > 0.005:
        raise ValueError("Recording is clipped; lower the microphone level and record again.")
    samples = samples.mean(axis=1)
    if rate != SAMPLE_RATE:
        divisor = math.gcd(rate, SAMPLE_RATE)
        samples = resample_poly(samples, SAMPLE_RATE // divisor, rate // divisor)
    samples = np.ascontiguousarray(samples, dtype=np.float32)
    if np.sqrt(np.mean((samples - samples.mean()) ** 2)) < 0.001:
        raise ValueError("Recording is silent or too quiet; record audible speech.")
    return samples


def validate_speech(samples: np.ndarray, min_seconds: float = 2) -> None:
    """Require enough active signal; model VAD supplies semantic speech detection."""
    if samples.ndim != 1 or not samples.size or not np.isfinite(samples).all():
        raise ValueError("Expected finite mono audio at 16 kHz.")
    if samples.size > MAX_SECONDS * SAMPLE_RATE:
        raise ValueError("Recording exceeds the 60 second limit.")
    frame_size = 320
    count = samples.size // frame_size
    if not count:
        raise ValueError(f"Record at least {min_seconds:g} seconds of audible speech.")
    frames = samples[: count * frame_size].reshape(count, frame_size)
    centered = frames - frames.mean(axis=1, keepdims=True)
    energy = np.sqrt(np.mean(centered ** 2, axis=1))
    threshold = max(0.003, min(0.015, float(energy.max()) * 0.15))
    active_seconds = np.count_nonzero(energy >= threshold) * frame_size / SAMPLE_RATE
    if active_seconds + 1e-6 < min_seconds:
        raise ValueError(f"Record at least {min_seconds:g} seconds of audible speech, with less silence.")
