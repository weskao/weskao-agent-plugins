# prompt-toc

A Markdown-style table of contents of your session in a side pane: every prompt you typed, and the `#`–`###` headings of each reply under it. Press a row to scroll the transcript there.

## Install

```bash
claude plugin marketplace add weskao/weskao-agent-plugins
claude plugin install prompt-toc@weskao-agent-plugins
```

Needs Claude Code 2.1.287 or later (mods load by default) and `python3` on `PATH`.

## Use

| Command | Does |
| --- | --- |
| `/prompt-toc [keyword]` | Open the pane, optionally filtered to rows containing the keyword |
| `/prompt-toc-open`, `/prompt-toc-close` | Turn the mod on or off |
| `/prompt-toc-export [path]` | Write the index as a Markdown file |
| `/prompt-toc-update` | Update to the latest version (then restart Claude Code) |

At each session start a toast says when a newer version is published (the version list is fetched at most every 10 minutes).

![The update toast: prompt-toc 0.7.0 is available: run /prompt-toc-update](https://raw.githubusercontent.com/weskao/weskao-agent-plugins/main/assets/prompt-toc/update-toast-prompt-toc.jpeg)

![prompt-toc demo: click a prompt in the side pane and the transcript scrolls to it](https://raw.githubusercontent.com/weskao/weskao-agent-plugins/main/assets/prompt-toc/demo.gif?v=4)

### All and Prompts

The chips at the top of the pane switch between two views of the same session.

**All** puts what came back under each prompt: the `#`–`###` headings of the reply, or, when the reply has none, a `↳` line with the start of the final answer. Each turn gets its own line, including turns started by a background agent reporting back, so a long `/orch` run lists every update and not only the last one. Use it to find the turn where something was said or decided, not only the question that led to it.

![The All view: each prompt with a ↳ preview of its reply](https://raw.githubusercontent.com/weskao/weskao-agent-plugins/main/assets/prompt-toc/pane-all.jpeg?v=2)

**Prompts** keeps only the lines you typed, one per prompt, numbered and timed. More of the session fits on screen, so it is the quick way to jump back to an earlier request.

![The Prompts view: one numbered, timed row per prompt](https://raw.githubusercontent.com/weskao/weskao-agent-plugins/main/assets/prompt-toc/pane-prompts.jpeg?v=2)

In both views, rows above a `/compact` are dimmed under a `── compacted ──` divider; press *▴ hide earlier* to fold them away. The `↑ top · ↓ end` buttons jump to either end of the list, and `▲ up` / `down ▼` beside them move it a page at a time (for touch terminals that tap but send no wheel, such as an iPhone SSH app). They show in the docked and the inline pane alike.

Open a subagent's transcript (from the tasks list) and the pane lists that agent instead: its task (the Agent call's description) as the prompt, then the final reply of each of its turns. Switch back and the main conversation returns. `/prompt-toc-export` writes the main conversation only.

Also in the pane:

- **Cost share**: each prompt row ends with its share of the list's token cost, e.g. `41.37%` (up to two decimals, and the rows add up to exactly 100%): 50% or more is bold red, 25% or more bold yellow, under that the theme's subtle gray, distinct from the time's dim (the statusline's tiers). Tokens are weighted by price relative to uncached input (cache read 0.1, cache write 1.25 or 2 for a 1h cache, output 5), so a long turn that mostly re-reads the cache does not outrank a short one with big output; the footer adds the total, `≈ 1.3M tokens (cost-weighted)`. A turn a background agent's hand-back starts shows its share on its own answer, and a subagent's run counts toward the prompt that started it. A subagent's view shares out that agent's own total. `/prompt-toc-export` adds each prompt's in / cache read / cache write / out. Counted live as the turn runs; turn it off with *Show cost share* in ⚙ settings.
- **🔍 search** (labelled `Search` on Windows and Linux, where the emoji may not render): unfolds a search field under the toolbar that filters the rows as you type, the same filter as `/prompt-toc <keyword>`. Enter (or 🔍 again) folds the field away and keeps the filter as a `filter: … ✕` chip; ✕ clears it. Not shown on mobile, which has no text field.
- **⚙ settings**: *Open pane on start* (wide terminals only), *Show time* (the time of each prompt) and *Show cost share* (each prompt's share of the token cost), all on by default. All are also `/config` rows, synced both ways.
- The row in view is underlined as you scroll (the topmost one; at the very end of the transcript, the last one), and a `/compact` divider can hide or show the rows above it.

## Privacy

The pane is built from the session transcript already on your disk (`scripts/scan.py` reads it). Nothing is sent anywhere. The only network request is the version check (at most every 10 minutes), a plain GET of the public `marketplace.json` on raw.githubusercontent.com.

## License

MIT
