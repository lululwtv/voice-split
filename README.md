# VoiceSplit

Know who said what, even when a whole room shares one mic. VoiceSplit runs beside Google Meet and labels each transcript line with the person who said it. It is open source, runs locally, and costs nothing per meeting.

## Status

The frontend is built. The speech engine isn't connected yet, so transcripts in the app come from a scripted sample and are labelled as simulated. Voice enrollment, microphone capture and Meet tab capture use real browser audio.

## Run it

Requires Node 22 and Chrome.

```bash
npm install
npm run dev
```

Open http://localhost:5173. `npm test` runs the tests and `npm run build` makes a production build.

## Connect the engine

Implement the `Engine` interface in `src/engine/types.ts`. The messages it expects are in [docs/engine-contract.md](docs/engine-contract.md).
