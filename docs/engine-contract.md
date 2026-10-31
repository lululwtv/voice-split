# Engine contract

What the frontend expects from the speech engine (Resemblyzer + Whisper). `src/engine/simulatedEngine.ts` is a working example, and `src/types.ts` holds the exact types.

The transport isn't decided. A local WebSocket is the likely choice. Whatever carries the messages only needs to implement the `Engine` interface.

## Events, engine to frontend

### `activity`

Sent several times a second to drive the speaker meters.

```json
{ "type": "activity", "elapsed": 12.4, "levels": { "edric": 0.8 } }
```

People who aren't speaking are left out of `levels`.

### `window`

A stretch of audio matched to one person. These draw the timeline and talk time, and they keep short replies that a transcript line would swallow.

```json
{ "type": "window", "window": { "start": 10.0, "end": 11.6, "personId": "edric" } }
```

### `segment`

One finished transcript line. Target: within 3 to 5 seconds of being spoken.

```json
{
  "type": "segment",
  "segment": {
    "id": "s3",
    "start": 10.0,
    "end": 16.0,
    "text": "Two things today.",
    "personId": "edric",
    "originalPersonId": "edric",
    "matches": [{ "personId": "edric", "score": 0.81 }],
    "overlap": false,
    "alsoHeardId": "weiming"
  }
}
```

- `personId` is `null` when nobody matched well enough. The UI asks "Who is this?".
- `matches` holds similarity scores from 0 to 1, highest first. They power the "Why?" panel.
- `overlap: true` marks people talking at once. The UI shows no name for these lines.
- `alsoHeardId` is optional. Set it when another person holds some windows inside the line.

### `ended`

```json
{ "type": "ended", "duration": 87.0 }
```

### `status`

Sent when lines fall behind. The panel warns when `delaySeconds` goes above 10. Send `0` once caught up.

```json
{ "type": "status", "delaySeconds": 14 }
```

### `error`

The engine can't continue. The panel keeps the lines so far and lets people end the meeting.

```json
{ "type": "error" }
```

### `summary`

Sent after `ended`. If it can't be written, send `{ "type": "summary_failed" }`. The frontend gives up after 90 seconds and shows the transcript.

```json
{
  "type": "summary",
  "summary": {
    "overview": "One or two sentences on what happened.",
    "decisions": [{ "text": "Launch on the sixteenth.", "sources": ["s5", "s8"] }],
    "actions": [
      { "text": "Send the screenshots", "ownerId": "dowon", "due": "Monday", "sources": ["s12"] }
    ],
    "questions": [{ "text": "Will the payment fix land?", "sources": ["s4"] }]
  }
}
```

- `sources` are `segment` ids. Each point links back to those lines, so people can check it. Unknown ids are skipped.
- `ownerId` is a person id, or `null` when no owner was stated.
- `due` is optional free text. Leave it out rather than guess.
- Run the model locally (for example through Ollama). A paid API would break the "free per meeting" and "stays on this computer" claims shown in the UI.

## Health check

`GET /health` on `VITE_ENGINE_URL` (default `http://localhost:8000`). Any response means the engine is on.

## Controls, frontend to engine

`start`, `pause`, `resume`, `finish` (send what's left, then `ended`, then `summary`) and `stop`.

## Open questions for the engine

- Can Whisper and Resemblyzer keep up on one laptop during a video call? This is the biggest risk, and it should be measured before more UI work.
- How are enrollment clips sent? The frontend currently stores them as browser recordings (usually WebM/Opus) or uploaded audio files, so the engine needs to convert them.
- Which local model writes the summary, and how long does it take on a laptop?
- How is overlap detected? It isn't in the current pipeline design.
