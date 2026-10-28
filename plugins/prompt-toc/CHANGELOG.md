# Changelog

All notable changes to prompt-toc. Versions follow [Semantic Versioning](https://semver.org/).

## 0.9.0 — 2026-10-28

### Changed

- **A bare `/prompt-toc` now toggles the pane.** It closes the pane when the pane is the one shown, and opens it otherwise, clearing the filter. A pane sitting behind another tab is brought to the front, not closed. `/prompt-toc <keyword>` still always opens the pane, filtered.

## 0.8.1 — 2026-10-22

### Fixed

- **The `── compacted ──` divider appears after a live `/compact` again.** It waited on the
  `classic.PostCompact` / `classic.SessionStart` hooks, which Claude Code's built-in
  `cc-plugin-sec-default` sends past every user-installed mod, so it only showed after a reload
  or `/prompt-toc`. The pane now rescans when the context fill reported by the session falls by
  more than half, the signature of a finished compaction, and clears the follow memory of the
  rows the compact removed. Those two dead hooks are gone; an in-process `/resume` keeps
  rebuilding the index from the first row of the new session drawn on screen.

## 0.8.0 — 2026-10-21

### Changed

- **Removed the `▲ up` / `down ▼` page chips.** The jump chips now carry their glyphs: `▲ top · ▼ end`.

## 0.7.1 — 2026-10-20

### Changed

- **Update check every 10 minutes instead of once a day.** The marketplace version list is fetched at most every
  10 minutes and the result is reused in between, so every session start toasts while a newer version is pending.

## 0.7.0 — 2026-10-20

### Added

- **Update reminder and `/prompt-toc-update`.** Once a day at most, a toast says when a newer version is
  published to weskao-agent-plugins. `/prompt-toc-update` refreshes the marketplace and updates the mod;
  restart Claude Code to load it.

## 0.6.1 — 2026-10-20

### Changed

- **Low cost shares are subtle gray.** A share under 25% now uses the theme's subtle color in regular
  weight, so it no longer matches the dim time beside it.
- **The whole filter row takes the click.** Pressing anywhere on the open `filter rows` row, out to the
  pane's right edge, focuses the field; the row no longer highlights on hover.

### Fixed

- Pressing one of two same-text headings in a reply no longer highlights both.
- Grouping rows by agent is faster on large sessions (5,000 rows: 6.9 ms to 0.06 ms).

## 0.6.0 — 2026-10-20

### Added

- **Cost share per prompt.** Each prompt row ends with its share of the session's token cost, e.g.
  `41.37%` (up to two decimals, rows add up to exactly 100%; bold red from 50%, bold yellow from 25%, dim under that, as in the statusline), and the footer shows the cost-weighted total.
  Tokens are weighted by price (cache read 0.1, cache write 1.25 or 2, output 5, relative to
  uncached input), so the heaviest row is the one that cost the most, not the one with the most
  tokens. A background agent's hand-back turn shows its own share on its answer, a subagent's run
  counts toward the prompt that started it, and a subagent's view shares out that agent's total.
  The *Show cost share* setting (⚙ and `/config`, on by default) turns it off;
  `/prompt-toc-export` adds each prompt's in / cache read / cache write / out. It counts live as
  the turn runs, and a rescan reads the same from the transcript.

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
