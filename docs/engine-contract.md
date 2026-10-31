# Engine contract

What the frontend expects from the speech engine (Resemblyzer + Whisper). `src/engine/simulatedEngine.ts` is a working example, and `src/types.ts` holds the exact types.

The transport isn't decided. A local WebSocket is the likely choice. Whatever carries the messages only needs to implement the `Engine` interface.

## Events, engine to frontend

### `activity`

Sent several times a second to drive the speaker meters.

```json
{ "type": "activity", "elapsed": 12.4, "levels": { "maya": 0.8 } }
```

People who aren't speaking are left out of `levels`.

### `window`

A stretch of audio matched to one person. These draw the timeline and talk time, and they keep short replies that a transcript line would swallow.

```json
{ "type": "window", "window": { "start": 10.0, "end": 11.6, "personId": "maya" } }
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
    "personId": "maya",
    "originalPersonId": "maya",
    "matches": [{ "personId": "maya", "score": 0.81 }],
    "overlap": false,
    "alsoHeardId": "priya"
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

## Controls, frontend to engine

`start`, `pause`, `resume`, `finish` (send what's left, then `ended`) and `stop`.

## Open questions for the engine

- Can Whisper and Resemblyzer keep up on one laptop during a video call? This is the biggest risk, and it should be measured before more UI work.
- How are enrollment clips sent? The frontend currently stores them as browser recordings (usually WebM/Opus) or uploaded audio files, so the engine needs to convert them.
- How is overlap detected? It isn't in the current pipeline design.
