# Changelog

All notable changes to message-clock. Versions follow [Semantic Versioning](https://semver.org/).

## 0.2.2 — 2026-10-22

### Fixed

- **An in-process `/resume` now stamps the resumed rows.** The restore used to wait on the
  `classic.SessionStart` hook, which Claude Code's built-in `cc-plugin-sec-default` sends past
  every user-installed mod, so it never ran. The first turn of a session not yet restored now
  reads the transcript's times instead; a subagent's turn never does.

## 0.2.1 — 2026-10-20

### Changed

- **Update check every 10 minutes instead of once a day.** The marketplace version list is fetched at most every
  10 minutes and the result is reused in between, so every session start toasts while a newer version is pending.

## 0.2.0 — 2026-10-20

### Added

- **Update reminder and `/message-clock-update`.** Once a day at most, a toast says when a newer version is
  published to weskao-agent-plugins. `/message-clock-update` refreshes the marketplace and updates the mod;
  restart Claude Code to load it.

## 0.1.0 — 2026-10-19

### Added

- A dim, right-aligned clock on every sent prompt and every reply message, in the prompt's gray band.
- Subagent replies, queued prompts and slash-command echoes are stamped too; a command's output row shows the command's time.
- Resumed sessions and reloads restore times from the session transcript, keeping any time already stamped live.

### Fixed

- A stored command echo is drawn as typed (`/name args`) with its time, instead of its stored form.
