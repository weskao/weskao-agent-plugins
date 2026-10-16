# prompt-toc

A Markdown-style table of contents of your session in a side pane: every prompt you typed, and the `#`–`###` headings of each reply under it. Press a row to scroll the transcript there.

## Install

```bash
claude plugin marketplace add weskao/weskao-plugins
claude plugin install prompt-toc@weskao-plugins
```

Needs Claude Code 2.1.287 or later (mods load by default) and `python3` on `PATH`.

## Use

| Command | Does |
| --- | --- |
| `/prompt-toc [keyword]` | Open the pane, optionally filtered to rows containing the keyword |
| `/prompt-toc-open`, `/prompt-toc-close` | Turn the mod on or off |
| `/prompt-toc-export [path]` | Write the index as a Markdown file |

In the pane:

- **All / Prompts** switch: show reply headings too, or only your prompts.
- **⚙ settings**: *open pane on start* (wide terminals only) and *show time* (the time of each prompt). Both are also `/config` rows, synced both ways.
- The row in view is underlined as you scroll, and a `/compact` divider can hide or show the rows above it.

## Privacy

The pane is built from the session transcript already on your disk (`scripts/scan.py` reads it). Nothing is sent anywhere.

## License

MIT
