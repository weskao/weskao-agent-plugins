#!/usr/bin/env python3
"""Print a session transcript's prompt-toc rows as JSON: [[uuid, kind, text, iso], ...] in transcript order.

kind 'prompt': what the person typed (prompt, slash command echo, mid-turn message), raw text.
kind 'reply': an assistant text row reduced to its heading and fence lines, or its start when it has no heading
(register.tsx parses them).
kind 'compact': the /compact boundary marker, text = its trigger ('manual' | 'auto'); the post-compact summary
user row (isCompactSummary) is skipped.
iso: the record's transcript timestamp ('' when absent).

  scan.py SESSION_ID [TRANSCRIPT]   # TRANSCRIPT defaults to <config dir>/projects/*/SESSION_ID.jsonl
"""
import glob
import json
import os
import re
import sys

KEEP = re.compile(r"^\s*(#{1,3}\s|```|~~~)")


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


# a prompt's label: its text, or [Image] for a message that is only an image (it has no text to show)
def prompt_of(content) -> str:
    text = text_of(content)
    if not text.strip() and isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "image" for b in content):
        return "[Image]"
    return text


def rows(path: str):
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            # cheap prefilter: most lines are tool calls/results and progress records
            if '"isSidechain":true' in line or '"tool_result"' in line:
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue
            kind, uuid = r.get("type"), r.get("uuid")
            if not uuid or r.get("isSidechain") or r.get("isMeta") or r.get("isCompactSummary"):
                continue
            ts = r.get("timestamp") or ""
            if kind == "user":
                origin = (r.get("origin") or {}).get("kind")
                text = prompt_of((r.get("message") or {}).get("content"))
                # only the person's own input; task notifications, peers and plugins carry another origin
                if origin in (None, "human", "composer") and text.strip() and not text.startswith("[Request interrupted"):
                    yield [uuid, "prompt", text, ts]
            elif kind == "attachment":
                att = r.get("attachment") or {}
                # a mid-turn message with an image carries a content-block list; register.tsx .trim()s it
                text = prompt_of(att.get("prompt"))
                if att.get("type") == "queued_command" and att.get("humanTurn") and text.strip():
                    yield [uuid, "prompt", text, ts]
            elif kind == "system":
                content = r.get("content") or ""
                if r.get("subtype") == "local_command" and "<command-name>" in content:
                    yield [uuid, "prompt", content, ts]
                elif r.get("subtype") == "compact_boundary":
                    yield [uuid, "compact", (r.get("compactMetadata") or {}).get("trigger") or "", ts]
            elif kind == "assistant":
                text = text_of((r.get("message") or {}).get("content"))
                lines = [ln for ln in text.split("\n") if KEEP.match(ln)]
                if any(ln.lstrip().startswith("#") for ln in lines):
                    yield [uuid, "reply", "\n".join(lines), ts]
                elif text.strip():
                    # no headings: its start is enough for the one-line preview register.tsx draws
                    yield [uuid, "reply", text[:2000], ts]


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
