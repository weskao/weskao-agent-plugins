# Changelog

All notable changes to skill-step-progress. Versions follow [Semantic Versioning](https://semver.org/).

## 0.5.0 — 2026-10-28

### Changed

- **Clicking a run's header now opens or closes that run's box.** Several runs can be open at once, and opening one no longer closes the others. Until you click a header, only the first run is open, as before.

## 0.4.0 — 2026-10-28

### Changed

- **A bare `/progress` now toggles the pane.** It closes the pane when the pane is the one shown, and opens it otherwise. A pane sitting behind another tab is brought to the front, not closed. `/progress open` and `/progress close` still always open or close, and `/progress-open` / `/progress-close` still turn tracking on or off.

## 0.3.3 — 2026-10-28

### Fixed

- A run's total time is now its main steps' times added up, and those times add up exactly: whole seconds and whole percents are shared out by largest remainder, so rounding no longer leaves the steps a second short of the total or the shares at 99% or 101%. Sub-steps stay inside their main step and are not counted twice. A run with no step times keeps the first-write-to-now total.
- Times of an hour or more now show seconds too (`1h 05m 03s`), so they add up as well.
- A flow in progress during `/reload-plugins` (or a mod update) keeps being followed to its end instead of showing as "left by an earlier process ↷ abandoned 0%". A run whose flow's steps were edited in the rules file meanwhile still ends as abandoned.

## 0.3.2 — 2026-10-28

### Added

- `/progress-open` and `/progress-close` turn Progress on and off. Off stops tracking flows, drops the runs in flight and closes the pane, and `/progress`, the pane tool and a typed skill no longer open or record anything; the choice is kept across sessions.
- Each `/progress` subcommand has its own command, so it shows in the `/` menu: `/progress-history`, `/progress-rules`, `/progress-forget <skill>`. `/progress-update` is another name for `/skill-step-progress-update`. The `/progress` subcommands work as before.
- `/progress-time` lists each run's total time and its steps' times as text, with no pane needed.

## 0.3.1 — 2026-10-28

### Added

- `/safe-git-push` is tracked with the same steps as `/push` (Safe push → Summary).

## 0.3.0 — 2026-10-28

### Added

- Each run's box on the `/progress` pane shows the run's total time (`total 12m 05s`) in its footer: first state write to now while it runs, to the last write once it has finished.

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
