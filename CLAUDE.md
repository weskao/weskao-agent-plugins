# weskao-plugins

Monorepo Claude Code marketplace: one `.claude-plugin/marketplace.json`, one folder per plugin
under `plugins/<name>/`.

## Never edit `plugins/<name>/` here

Every `plugins/<name>/` is a copy that `publish.py stage` writes from the plugin's source, and
the next stage overwrites it. Edit the source instead: mods in `~/.claude/mods/<name>`, skills
in `~/.claude/skills/<name>`.

## Publish a change

```bash
make stage NAME=<name> BUMP=patch     # check, copy here, update marketplace.json + README
make ship M="fix(<name>): ..."        # commit + push (public repo: ask the user first)
```

To keep a release local for now: `make commit M="..."` (no push), then `make push` when ready.

Day-to-day testing never needs this repo: the source in `~/.claude/mods/<name>` is the installed
copy on this machine, so edit it and run `/reload-plugins`.

`make status` shows each plugin as `released` or `changed` since its last stage. In Claude Code,
the `marketplace-publish` skill asks whether (and how) to release after a change.

`make` alone lists every target (`validate`, `status`, `readme`, `check`, `stage`, `form`, `commit`,
`push`, `ship`). The
Makefile wraps `~/.claude/skills/marketplace-publish/scripts/publish.py`; `NAME` is looked up in
`~/.claude/mods/` then `~/.claude/skills/`.

- Each plugin has its own version (its `plugin.json` and its `marketplace.json` entry), and
  `make stage` takes one `NAME`, so each plugin gets its own bump level.
- Users install plugins one at a time (`claude plugin install <name>@weskao-plugins`), so
  every plugin folder keeps its own `README.md`.

## Keeping `README.md` in sync

- The plugins table between `<!-- plugins:start -->` and `<!-- plugins:end -->` is generated
  from `marketplace.json`: never hand-edit it. `stage` rewrites it, and the PostToolUse hook in
  `.claude/settings.json` rewrites it whenever `marketplace.json` is edited
  (`publish.py readme`).
- After creating, updating, or deleting any other file, check whether `README.md` needs a
  matching update (install steps, requirements, license) and update it if so.
