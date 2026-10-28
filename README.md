# weskao-agent-plugins

Claude Code plugins and mods by weskao.

## Install

```bash
claude plugin marketplace add weskao/weskao-agent-plugins
claude plugin install <plugin>@weskao-agent-plugins
```

Mods need Claude Code 2.1.287 or later.

## Plugins

<!-- plugins:start -->
| Plugin | Version | What it does | Install |
| --- | --- | --- | --- |
| [`prompt-toc`](./plugins/prompt-toc) | 0.9.0 | Markdown-style TOC pane of your prompts and reply headings; press one to scroll there. Prompts-only chip, time per prompt, follow-viewport underline, settings (Open pane on start, Show time; both on by default), /compact divider, `/prompt-toc <keyword>` filter, `/prompt-toc-export [path]` Markdown export | `claude plugin install prompt-toc@weskao-agent-plugins` |
| [`message-clock`](./plugins/message-clock) | 0.2.2 | Grok-style right-aligned clock on each sent prompt and each reply message | `claude plugin install message-clock@weskao-agent-plugins` |
| [`agent-toggle`](https://github.com/weskao/agent-toggle/tree/HEAD/mod) | [latest](https://github.com/weskao/agent-toggle/releases/latest) | Toggle skills, agents, rules, plugins and MCP servers from a pane (needs the agent-toggle CLI: uv tool install agent-toggle) | `claude plugin install agent-toggle@weskao-agent-plugins` |
| [`cache-sentinel`](./plugins/cache-sentinel) | 0.1.2 | Warns above the prompt and in a toast before a /model, /effort or /fast switch or an idle gap re-writes the prompt cache, with tokens and est. USD; stops the first /model on a warm cache above MODEL_SWITCH_GUARD_TOKENS (a second within a minute goes through) and refuses a subagent Bash timeout over 4 min. | `claude plugin install cache-sentinel@weskao-agent-plugins` |
| [`skill-step-progress`](./plugins/skill-step-progress) | 0.4.0 | Live pane showing the current step and overall progress of this session's flows, one box per run: /commit (and any flow you add in ~/.claude/skill-step-progress/rules.json) by watching the commands it runs, and skills that write their own state to ~/.claude/usage-data/<skill>/<repo>/current.json | `claude plugin install skill-step-progress@weskao-agent-plugins` |
<!-- plugins:end -->

`agent-toggle` is released from [its own repo](https://github.com/weskao/agent-toggle), not staged
here. The mod drives the `agent-toggle` CLI, so install that first (`uv tool install agent-toggle`);
`/agent-toggle update` then updates the CLI and the mod together.

## License

MIT, see [LICENSE](LICENSE).
