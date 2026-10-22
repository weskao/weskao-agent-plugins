# Changelog

All notable changes to cache-sentinel. Versions follow [Semantic Versioning](https://semver.org/).

## 0.1.0 — 2026-10-22

### Added

- A band above the prompt that counts down the prompt cache TTL, warns when the cache has expired, and warns when a typed `/model`, `/effort` or `/fast` would re-write it, with token count and estimated cost; the countdown and expiry also pop once as a toast.
- A model-switch guard: a switch on a warm cache above `MODEL_SWITCH_GUARD_TOKENS` (default 100,000) asks for confirmation, and every switch is logged to `~/.claude/cache/model-switch-<YYYY-MM>.jsonl`.
- A subagent wait guard: a subagent's foreground Bash call with a timeout over 240,000 ms is refused, since its 5-minute cache would be re-written.
- `/cache-sentinel-open` and `/cache-sentinel-close` to turn the band and toasts on or off, kept across sessions.
- `/cache-sentinel-update` and a toast at session start when a newer version is published.
