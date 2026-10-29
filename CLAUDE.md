# weskao-agent-plugins

Monorepo marketplace: `.claude-plugin/marketplace.json` + `plugins/<name>/`, each with its own
version and `README.md` (users install one at a time).

- **Never edit `plugins/<name>/`**: `stage` regenerates it from the source (`~/.claude/mods/<name>`,
  else `~/.claude/skills/<name>`). Testing needs only the source + `/reload-plugins`.
- **External entries** (`agent-toggle`): a `git-subdir` source pointing at their own repo, no
  `plugins/<name>/`, no `version` (their `plugin.json` holds it). Released there, so `release` skips them
  and `stage` never touches them; edit the entry in `marketplace.json` by hand, then `make readme`.
- **Release** (`make` lists targets; they wrap `~/.claude/skills/marketplace-publish/scripts/publish.py`,
  whose skill holds the SOP):

  ```bash
  make notes NAME=<name>              # CHANGELOG `## Unreleased` from template + changes since release
  make stage NAME=<name> BUMP=patch   # refuses an empty CHANGELOG entry; dates it, copies here
  make ship M="fix(<name>): ..."      # commit + push + GitHub release <name>-v<version> (public: ask first)
  ```

  Local only: `make commit M=...`, later `make push` (also releases). `make release` retries.
- README: the table between `<!-- plugins:start -->` / `<!-- plugins:end -->` is generated from
  `marketplace.json` (`stage` or the PostToolUse hook), never hand-edit it. After changing any other
  file, check whether README needs a matching update (install steps, requirements, license).
