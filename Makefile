# Maintainer shortcuts over marketplace-publish (CLAUDE.md has the workflow). Only `validate` works without
# ~/.claude: plugins/<name>/ is generated from a source there, so the rest need that machine.
P := $(HOME)/.claude/skills/marketplace-publish/scripts/publish.py
# a plugin's source: a mod in ~/.claude/mods, else a skill in ~/.claude/skills
SRC = $(firstword $(wildcard $(HOME)/.claude/mods/$(NAME) $(HOME)/.claude/skills/$(NAME)))

.PHONY: help validate status readme check stage form commit push ship _src

help: ## list the targets
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-9s %s\n", $$1, $$2}'

validate: ## validate the marketplace and every plugin in it
	claude plugin validate .

status: ## each plugin: version, released or changed since, source
	@python3 "$(P)" status --repo .

readme: ## regenerate the README plugins table from marketplace.json
	python3 "$(P)" readme --repo .

check: _src ## run every publish check on a source: make check NAME=prompt-toc
	python3 "$(P)" check "$(SRC)"

stage: _src ## copy a source in: make stage NAME=prompt-toc [BUMP=patch|minor|major]
	python3 "$(P)" stage "$(SRC)" --repo . $(if $(BUMP),--bump $(BUMP))

form: ## print the plugin directory form values: make form NAME=prompt-toc
	python3 "$(P)" form "$(NAME)" --repo .

commit: ## commit locally, no push: make commit M="fix(prompt-toc): ..."
	@test -n "$(M)" || { echo 'usage: make commit M="<commit message>"'; exit 1; }
	git add -A && git commit -m "$(M)"

push: ## push local commits (safe-push: fetch first, never force)
	python3 "$(HOME)/.claude/skills/safe-git-push/scripts/safe_push.py"

ship: ## commit and push (public repo): make ship M="fix(prompt-toc): ..."
	@test -n "$(M)" || { echo 'usage: make ship M="<commit message>"'; exit 1; }
	python3 "$(P)" ship -m "$(M)" --repo .

_src:
	@test -n "$(SRC)" || { echo "no source for NAME=$(NAME) in ~/.claude/mods or ~/.claude/skills"; exit 1; }
