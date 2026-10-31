# Timbre

Know who said what, even when a whole room shares one mic. Timbre runs beside Google Meet and labels each transcript line with the person who said it. It is open source, runs locally, and costs nothing per meeting.

## Status

The Timbre frontend connects to the local voice-split backend for saved voices, meeting rooms, transcription, speaker corrections and exports. Speaker labels are estimates and can be corrected. Automatic summaries and direct Google Meet integration are not implemented.

## Run it

Requires Node 22, Python 3.11, uv and a browser with microphone access. On Apple Silicon, MLX Whisper uses the GPU; other machines can use the CPU engine. Models download on first startup.

```bash
npm ci
npm run build
uv sync --python 3.11 --extra test
VOICE_SPLIT_ASR_BACKEND=mlx uv run uvicorn voice_split.server:app --host 127.0.0.1 --port 4320
```

Open http://127.0.0.1:4320. Omit `VOICE_SPLIT_ASR_BACKEND=mlx` for the CPU engine. Wait for model loading to finish before recording. `npm test` checks the frontend; `uv run pytest -q` checks the backend.

## Contributing

Bug reports, ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and how to submit a change.

Timbre is available under the [MIT license](LICENSE).

## Local data

Saved voices and transcripts live in `~/.local/share/voice-split`, independently of this repository. Set `VOICE_SPLIT_DATA_DIR` to use a separate test workspace. Raw enrollment recordings are not retained. No paid API key is required. The server accepts localhost connections only.

Speaker matching requires credible evidence, not just the closest voice. Numbered unknown voices persist within each meeting; ambiguous matches stay unassigned. Configure `VOICE_SPLIT_OPEN_THRESHOLD` (0.55), `VOICE_SPLIT_OPEN_MARGIN` (0.08), and `VOICE_SPLIT_UNKNOWN_THRESHOLD` (0.65) before startup. Clips under 0.5 seconds require 0.05 more named-match similarity. Existing unknown references compete with borderline named matches; strong named matches (0.80+) may resolve a previously unknown voice. Confidence labels are heuristic, not accuracy percentages. Short clips can still fragment one unknown speaker into several identities; thresholds need evaluation on separate labeled meeting recordings. Corrections retain original evidence but do not automatically train profiles or adjust thresholds.
