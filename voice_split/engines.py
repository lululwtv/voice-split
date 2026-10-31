"""Local models, loaded explicitly during application startup."""

import os
import platform
from pathlib import Path
from threading import Lock

import numpy as np


class _MLXWhisper:
    def __init__(self, model: str):
        if platform.system() != "Darwin" or platform.machine() != "arm64":
            raise RuntimeError("MLX transcription requires Apple silicon macOS.")
        import mlx_whisper
        from faster_whisper.vad import get_speech_timestamps

        self._transcribe = mlx_whisper.transcribe
        self._speech = get_speech_timestamps
        self._model = model
        # Compile/load before reporting ready; keep all timestamps on original audio.
        self._decode(np.zeros(16000, dtype=np.float32))
        self._speech(np.zeros(16000, dtype=np.float32))

    def _decode(self, samples):
        return self._transcribe(
            samples, path_or_hf_repo=self._model, word_timestamps=True,
            condition_on_previous_text=False, temperature=0, language="en", verbose=None,
        )["segments"]

    def transcribe(self, samples):
        samples = np.ascontiguousarray(samples, dtype=np.float32)
        if samples.ndim != 1 or not np.isfinite(samples).all():
            raise ValueError("Transcription audio must be finite mono samples.")
        if not len(samples) or not self._speech(samples):
            return []
        return [{"start": float(row["start"]), "end": float(row["end"]),
                 "text": row["text"].strip(),
                 "words": [{"start": float(word["start"]), "end": float(word["end"]),
                            "word": word["word"]} for word in row.get("words", [])]}
                for row in self._decode(samples) if row["text"].strip()]


class AudioEngines:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.asr_backend = os.getenv("VOICE_SPLIT_ASR_BACKEND", "faster-whisper")
        self.whisper_name = (os.getenv("VOICE_SPLIT_MLX_MODEL", "mlx-community/whisper-small.en-mlx")
                             if self.asr_backend == "mlx"
                             else os.getenv("VOICE_SPLIT_WHISPER_MODEL", "base.en"))
        self.speaker_name = "speechbrain/spkrec-ecapa-voxceleb"
        self.whisper = None
        self.speaker = None
        self.errors = {"transcription": None, "speaker": None}
        self._whisper_lock = Lock()
        self._speaker_lock = Lock()
        self._load_lock = Lock()

    def load(self) -> None:
        with self._load_lock:
            threads = max(1, min(4, int(os.getenv("VOICE_SPLIT_CPU_THREADS", "2"))))
            os.environ.setdefault("OMP_NUM_THREADS", str(threads))
            self.data_dir.mkdir(parents=True, exist_ok=True)
            if self.whisper is None:
                try:
                    with self._whisper_lock:
                        if self.asr_backend == "mlx":
                            self.whisper = _MLXWhisper(self.whisper_name)
                        elif self.asr_backend == "faster-whisper":
                            from faster_whisper import WhisperModel

                            self.whisper = WhisperModel(
                                self.whisper_name, device="cpu", compute_type="int8",
                                cpu_threads=threads, num_workers=1,
                                download_root=str(self.data_dir / "models" / "whisper"),
                            )
                        else:
                            raise ValueError(f"Unknown transcription backend: {self.asr_backend}")
                    self.errors["transcription"] = None
                except Exception as exc:
                    self.errors["transcription"] = f"{type(exc).__name__}: {exc}"
            if self.speaker is None:
                try:
                    import torch
                    from speechbrain.inference.speaker import EncoderClassifier

                    torch.set_num_threads(threads)
                    self.speaker = EncoderClassifier.from_hparams(
                        source=self.speaker_name,
                        savedir=str(self.data_dir / "models" / "speaker"),
                        run_opts={"device": "cpu"},
                    )
                    self.errors["speaker"] = None
                except Exception as exc:
                    self.errors["speaker"] = f"{type(exc).__name__}: {exc}"

    def status(self) -> dict:
        return {
            "ready": self.whisper is not None and self.speaker is not None,
            "transcription": {"ready": self.whisper is not None, "model": self.whisper_name,
                              "backend": self.asr_backend,
                              "error": self.errors["transcription"]},
            "speaker": {"ready": self.speaker is not None, "model": self.speaker_name,
                        "error": self.errors["speaker"]},
        }

    def transcribe(self, samples: np.ndarray) -> list[dict]:
        if self.whisper is None:
            raise RuntimeError("Transcription model is not ready. Check model status.")
        with self._whisper_lock:
            if self.asr_backend == "mlx":
                return self.whisper.transcribe(samples)
            segments, _ = self.whisper.transcribe(
                samples, beam_size=3, vad_filter=True, condition_on_previous_text=False,
                word_timestamps=True,
            )
            return [{"start": float(segment.start), "end": float(segment.end), "text": segment.text.strip(),
                     "words": [{"start": float(word.start), "end": float(word.end), "word": word.word}
                               for word in segment.words or []]}
                    for segment in segments if segment.text.strip()]

    def embed(self, samples: np.ndarray) -> np.ndarray:
        if self.speaker is None:
            raise RuntimeError("Speaker model is not ready. Check model status.")
        import torch

        with self._speaker_lock, torch.inference_mode():
            waveform = torch.from_numpy(np.ascontiguousarray(samples, dtype=np.float32)).unsqueeze(0)
            vector = self.speaker.encode_batch(waveform).detach().cpu().numpy().reshape(-1)
        norm = float(np.linalg.norm(vector))
        if not np.isfinite(vector).all() or norm < 1e-8:
            raise ValueError("Cannot extract a speaker reference from this recording.")
        return vector / norm
