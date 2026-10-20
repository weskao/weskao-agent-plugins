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

`/message-clock-update` updates to the latest version (then restart Claude Code); at each session start a toast says when a newer version is published (the version list is fetched at most every 10 minutes).

![The update toast: message-clock 0.2.0 is available: run /message-clock-update](https://raw.githubusercontent.com/weskao/weskao-agent-plugins/main/assets/message-clock/update-toast-message-clock.jpeg)

![message-clock demo: a resumed session keeps each row's stored time, a new slash command is stamped live](https://raw.githubusercontent.com/weskao/weskao-agent-plugins/main/assets/message-clock/demo.gif?v=2)

- **Prompts and replies** — each is stamped with the time it was stored, including subagent replies, queued prompts and slash-command echoes.
- **Slash commands** — the echo is redrawn as you typed it (`/name args`) with its time, and the command's output row (`⎿ …`) shows the same time.
- **Resumed sessions** — rows stored before this process started take their time from the session transcript; a row already stamped live keeps its stamp.

![A prompt, its reply, and a slash command with its output row, each with its time on the right](https://raw.githubusercontent.com/weskao/weskao-agent-plugins/main/assets/message-clock/transcript.jpeg)

## Privacy

Times come from the clock and the session transcript already on your disk (`scripts/scan.py` reads it). Nothing is sent anywhere. The only network request is the version check (at most every 10 minutes), a plain GET of the public `marketplace.json` on raw.githubusercontent.com.

## License

MIT
