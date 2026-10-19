#!/usr/bin/env python3
"""Print a session transcript's row times as JSON: [[uuid, timestamp, echo], ...] in transcript order.

echo: the row's stored text when it is a command's echo (`<command-name>`, `<bash-input>`), else ''; register.tsx
keys those by their typed form too, as a redraw of an echo row may carry no row id.

  scan.py SESSION_ID [TRANSCRIPT]   # TRANSCRIPT defaults to <config dir>/projects/*/SESSION_ID.jsonl
"""
import glob
import json
import os
import sys


def find(session_id: str) -> str | None:
    base = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    hits = glob.glob(os.path.join(base, "projects", "*", f"{session_id}.jsonl"))
    return max(hits, key=os.path.getmtime) if hits else None


def text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def rows(path: str):
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            # cheap prefilter: tool results and subagent rows are never drawn as a message row
            if '"isSidechain":true' in line or '"tool_result"' in line:
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue
            uuid, at = r.get("uuid"), r.get("timestamp")
            if not uuid or not at or r.get("type") not in ("user", "assistant", "system"):
                continue
            text = text_of((r.get("message") or {}).get("content")) or (r.get("content") if isinstance(r.get("content"), str) else "")
            is_echo = "<command-name>" in text or text.lstrip().startswith("<bash-input>")
            yield [uuid, at, text if is_echo else ""]


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: scan.py SESSION_ID [TRANSCRIPT]", file=sys.stderr)
        return 2
    path = sys.argv[2] if len(sys.argv) > 2 else find(sys.argv[1])
    if not path or not os.path.isfile(path):
        print("[]")
        return 0
    json.dump(list(rows(path)), sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
