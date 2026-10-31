# Contributing to Timbre

Bug reports, documentation fixes and code contributions are welcome.

## Report a bug or suggest an improvement

[Open an issue](https://github.com/lululwtv/voice-split/issues) with what you expected, what happened, steps to reproduce and your operating system/browser. For larger changes, discuss the idea in an issue first.

Use synthetic examples or recordings you have permission to share. Remove private meeting content, voice profiles and credentials from screenshots, logs and attachments.

## Submit a pull request

1. Fork this repository on GitHub. A fork is your own copy where you can make changes.
2. Clone your fork and create a branch for your change.
3. Follow the [README setup instructions](README.md#run-it). For frontend development, run `npm run dev` alongside the local backend.
4. Make a focused change. Add or update tests when behavior changes.
5. Run the checks below, then commit and push to your fork.
6. Open a pull request from your branch to `lululwtv/voice-split`'s `main` branch. Explain the change and how you tested it; include screenshots for visual changes.

```bash
npm test
npm run build
uv run pytest -q
```

The maintainer reviews proposed changes and may request revisions before merging. You do not need write access to this repository to contribute.

## License

By submitting a contribution, you agree that it will be licensed under this project's [MIT license](LICENSE).
