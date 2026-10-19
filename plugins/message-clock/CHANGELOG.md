# Changelog

All notable changes to message-clock. Versions follow [Semantic Versioning](https://semver.org/).

## 0.1.0 — 2026-10-19

### Added

- A dim, right-aligned clock on every sent prompt and every reply message, in the prompt's gray band.
- Subagent replies, queued prompts and slash-command echoes are stamped too; a command's output row shows the command's time.
- Resumed sessions and reloads restore times from the session transcript, keeping any time already stamped live.

### Fixed

- A stored command echo is drawn as typed (`/name args`) with its time, instead of its stored form.
