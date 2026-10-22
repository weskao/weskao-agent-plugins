# cache-sentinel

Shows when your prompt cache is about to expire or be re-written, and stops the two habits that re-write it most: a model switch on a warm cache and a subagent waiting on one long Bash call.

## Install

```bash
claude plugin marketplace add weskao/weskao-agent-plugins
claude plugin install cache-sentinel@weskao-agent-plugins
```

Needs Claude Code 2.1.287 or later (mods load by default).

## Use

Nothing to configure. After each of your turns a band above the prompt shows, when it matters (context ≥ 20k tokens):

- `⏳ prompt cache Nm 後過期` — the cache expires in N minutes (1h TTL on the main thread, 5m with `CLAUDE_CODE_PROMPT_CACHE_TTL=5m`); send now to keep it warm.
- `❄ prompt cache 已過期` — the next prompt re-writes the whole context; small questions belong in a fresh session.
- `⚠ /model 會重寫 prompt cache` — typed `/model`, `/effort` or `/fast` would re-write it; `/compact` first, or hand the work to a subagent with its own model.

Each line names the tokens and an estimated cost (`[?]` when the model's price is unknown). The ⏳ and ❄ lines also pop once as a toast.

Two guards:

- **Model switch** — a switch on a warm cache above 100,000 context tokens asks for confirmation (`MODEL_SWITCH_GUARD_TOKENS=<n>` in `settings.json` `env` changes the threshold). Every switch is logged to `~/.claude/cache/model-switch-<YYYY-MM>.jsonl`.
- **Subagent wait** — a subagent's cache lives 5 minutes, so a foreground Bash call with `timeout` over 240,000 ms is refused with the fix: a shorter timeout, or `run_in_background` and polling.

`/cache-sentinel-close` turns the band and toasts off (the guards stay), `/cache-sentinel-open` turns them back on; the choice is kept across sessions. `/cache-sentinel-update` updates to the latest version (then restart Claude Code); at each session start a toast says when a newer version is published (the version list is fetched at most every 10 minutes).

## Privacy

Token counts come from the session's own usage; prices are read from `~/.claude/token-tools.json` when present. The switch log stays on your disk. The only network request is the version check, a plain GET of the public `marketplace.json` on raw.githubusercontent.com.

## License

MIT
