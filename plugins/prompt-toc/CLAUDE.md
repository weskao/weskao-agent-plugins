# prompt-toc

When adding a feature to this mod, check whether it needs an option in the pane's **Settings**
popover (a user may want it off). If so, add it in all of these, default `true` unless told otherwise:

- `types/index.d.ts`: the `Settings` type.
- `hooks/settings.ts`: its `LABELS` entry (the popover item, drawn in this order).
- `.claude-plugin/plugin.json`: a `userConfig` field of the same key (the `/config` row).
- `hooks/register.tsx`: gate the drawing on `prefs.<key>`, including any width the drawing takes in `heights`.
- Tests: the default, the stored value (`hooks/settings.test.ts`), and the feature hidden when off.
- `README.md` (the ⚙ settings line) and `CHANGELOG.md`.
