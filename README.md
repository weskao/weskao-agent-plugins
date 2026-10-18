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
| [`prompt-toc`](./plugins/prompt-toc) | 0.4.0 | Markdown-style TOC pane of your prompts and reply headings; press one to scroll there. Prompts-only chip, time per prompt, follow-viewport underline, settings (Open pane on start, Show time; both on by default), /compact divider, `/prompt-toc <keyword>` filter, `/prompt-toc-export [path]` Markdown export | `claude plugin install prompt-toc@weskao-agent-plugins` |
<!-- plugins:end -->

## License

MIT, see [LICENSE](LICENSE).
