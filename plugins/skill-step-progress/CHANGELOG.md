# Changelog

All notable changes to skill-step-progress. Versions follow [Semantic Versioning](https://semver.org/).

## 0.2.1 — 2026-10-28

### Fixed

- A `/commit` typed while the previous turn's Stop hook was still running is no longer ended at once as "abandoned: stopped at Survey". The earlier turn's end used to reach the run after it had started.
- A flow that spans turns (such as `/merge-into-main`) no longer stays in progress for good when Claude stops working on it. After two turns in a row in which none of its commands ran, it ends as "abandoned: idle at <step>". One quiet turn, such as answering a question about the conflicts, still keeps it open.

## 0.2.0 — 2026-10-27

### Added

- **First public release: a Progress pane beside the chat with one box per run.** Each box shows the current step, a progress bar, each step's time and share, and the commits the run made.
- `/commit` is tracked out of the box by watching the commands it runs. Add your own flows by asking Claude, from the pane's Rules view, or with `/progress rules`; they are kept in `~/.claude/skill-step-progress/rules.json`.
- Skills that write their own state to `~/.claude/usage-data/<skill>/<repo>/current.json` show up with no setup.
- `/progress history` lists this session's finished runs with status, time and why.
- A toast when a run fails or is abandoned, so you notice it with the pane closed.
- A sub-agent's run gets its own box, and commits made in another work tree (`git -C <dir>`, `cd <dir> && …`) are listed.
- Ask Claude in plain words to open or close the pane.
- A toast when a newer version is published; `/skill-step-progress-update` installs it.
