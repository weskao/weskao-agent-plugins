# message-clock

A dim, right-aligned clock on every prompt you send and every reply message, so you can see when each turn happened without leaving the transcript.

## Install

```bash
claude plugin marketplace add weskao/weskao-agent-plugins
claude plugin install message-clock@weskao-agent-plugins
```

Needs Claude Code 2.1.287 or later (mods load by default) and `python3` on `PATH`.

## Use

Nothing to configure: once installed, the time shows beside each message, in the same gray band as the prompt.

- **Prompts and replies** — each is stamped with the time it was stored, including subagent replies, queued prompts and slash-command echoes.
- **Slash commands** — the echo is redrawn as you typed it (`/name args`) with its time, and the command's output row (`⎿ …`) shows the same time.
- **Resumed sessions** — rows stored before this process started take their time from the session transcript; a row already stamped live keeps its stamp.

## Privacy

Times come from the clock and the session transcript already on your disk (`scripts/scan.py` reads it). Nothing is sent anywhere.

## License

MIT
