# prompt-toc

When adding a feature to this mod, check whether it needs an option in the pane's **Settings**
popover (a user may want it off). If so, add it in all of these, default `true` unless told otherwise:

- `types/index.d.ts`: the `Settings` type.
- `hooks/settings.ts`: its `LABELS` entry (the popover item, drawn in this order).
- `.claude-plugin/plugin.json`: a `userConfig` field of the same key (the `/config` row).
- `hooks/register.tsx`: gate the drawing on `prefs.<key>`, including any width the drawing takes in `heights`.
- Tests: the default, the stored value (`hooks/settings.test.ts`), and the feature hidden when off.
- `README.md` (the ⚙ settings line) and `CHANGELOG.md`.

## Refreshing the README media (`/readme-media`)

The README shows 4 images and a demo video, hosted in `weskao-agent-plugins/assets/prompt-toc/`. A
refresh covers all of them: `pane-all.jpeg`, `pane-prompts.jpeg`, `demo.gif` (+ `demo.mp4`) and
`update-toast-prompt-toc.jpeg`. Never skip the toast: its alt text and picture name a version, so they
go stale on every release.

The toast shows only for a *published* install older than the published version, so the unpublished
`mods/prompt-toc` never draws it. Capture it with the real code:

1. Copy `plugins/prompt-toc` from the marketplace clone to `<scratch>/weskao-agent-plugins/plugins/prompt-toc`
   (the path must contain `/weskao-agent-plugins/`; drop `node_modules` and tests) and set the copy's
   `.claude-plugin/plugin.json` version to an older one (e.g. 0.8.0 for a published 0.8.1).
2. Launch `claude --plugin-dir <that copy> --resume <fake session>` and poll the screen from startup, not
   after the prompt is ready: the toast is gone within seconds. Dismiss the trust dialog in the loop.
3. When `is available` and `╰` show, crop to the box (`cols="<╭ col>:<╮ col + 1>"`, `stop=r"^Added"`) and
   take one frame. The text must read `prompt-toc <published version> is available`.
4. Update the alt text in both README copies (`mods/` and `plugins/`) to the same version.
