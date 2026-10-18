# Changelog

All notable changes to prompt-toc. Versions follow [Semantic Versioning](https://semver.org/).

## 0.5.0 — 2026-10-18

### Changed

- The `filter: … ✕` chip's clear button now lights up on hover, and only the ✕ presses; the
  keyword beside it is a plain label.

## 0.4.0 — 2026-10-18

### Added

- **Subagent views.** Open a subagent's transcript from the tasks list and the pane lists that
  agent instead of the main conversation: its task (the Agent call's description) as the prompt,
  then the final reply of each of its turns. Switch back and the main list returns.
  `/prompt-toc-export` still writes the main conversation only.
- **🔍 search field** in the pane toolbar. It filters rows as you type, sharing the keyword with
  `/prompt-toc <keyword>`; Enter folds it into the `filter: … ✕` chip. Labelled `Search` on
  Windows and Linux, and not shown on mobile.

### Fixed

- Each turn keeps its own final-reply line in the All view. Turns started by a background agent
  reporting back used to replace each other under the previous prompt, so a long `/orch` run
  showed only its last update.
- The follow underline now reaches the last entry when the transcript ends on a short exchange.

### Changed

- Install steps point at the renamed marketplace, `weskao-agent-plugins`.

## 0.3.0 — 2026-10-18

### Added

- `▲ up` / `down ▼` page chips beside `↑ top · ↓ end`, for touch terminals that tap but send no
  wheel. Shown in the docked and the inline pane.

## 0.2.3 — 2026-10-17

### Changed

- README demo GIF.

## 0.2.2 — 2026-10-17

### Changed

- README notes that both settings are on by default.

## 0.2.1 — 2026-10-17

### Changed

- README introduces the All and Prompts views.

## 0.2.0 — 2026-10-16

### Changed

- Settings are capitalized (*Open pane on start*, *Show time*) and both on by default.

## 0.1.0 — 2026-10-16

First release: a side pane listing every prompt and the `#`–`###` headings of each reply (or a
`↳` preview of a headingless reply); press a row to scroll there. All / Prompts chips, time per
prompt, follow-viewport underline, `/compact` divider with fold, settings synced with `/config`,
`/prompt-toc <keyword>` filter and `/prompt-toc-export [path]` Markdown export.
