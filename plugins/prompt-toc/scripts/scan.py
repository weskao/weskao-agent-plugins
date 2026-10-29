#!/usr/bin/env python3
"""Print a session transcript's prompt-toc rows as JSON: [[uuid, kind, text, iso], ...] in transcript order.

kind 'prompt': what the person typed (prompt, slash command echo, mid-turn message), raw text.
kind 'reply': an assistant text row reduced to its heading and fence lines, or its start when it has no heading
(register.tsx parses them).
kind 'answer': a reply row that ended its turn (stop_reason end_turn), the same text as 'reply'.
A subagent's rows follow the main ones with a fifth element, its agent id; its opening prompt reads as its
description (.meta.json).
kind 'compact': the /compact boundary marker, text = its trigger ('manual' | 'auto'); the post-compact summary
user row (isCompactSummary) is skipped.
iso: the record's transcript timestamp ('' when absent).
kind 'tokens': after a turn, the tokens its API calls used, text = 'INPUT CACHE_READ CACHE_WRITE OUTPUT COST' (COST: the
cost-weighted sum in uncached-input tokens); uuid = the turn's prompt, or for a turn no prompt started (a background
agent's hand-back) its answer; iso = ''. A prompt can get two (a later promptless turn with no answer text).

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


# each token's price relative to an uncached input token: Anthropic's ratios, the same for every model
READ, WRITE_5M, WRITE_1H, OUT = 0.1, 1.25, 2, 5


# the turn's usage, one per API call: a call's content blocks are separate records sharing message.id, the last
# record holding its final usage
def tokens(owner: str | None, usage: dict):
    if owner and usage:
        total, cost = [0, 0, 0, 0], 0.0
        for u in usage.values():
            fresh, read, write, out = (u.get(k) or 0 for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"))
            hour = (u.get("cache_creation") or {}).get("ephemeral_1h_input_tokens") or 0
            total = [a + b for a, b in zip(total, (fresh, read, write, out))]
            cost += fresh + READ * read + WRITE_1H * hour + WRITE_5M * (write - hour) + OUT * out
        yield [owner, "tokens", " ".join(map(str, [*total, round(cost)])), ""]


# owner: the row a turn's usage counts toward, its prompt or, for a turn that starts after the prompt's turn answered
# (no prompt row), that turn's answer (None until it arrives; with none, the prompt)
def rows(path: str, side: bool = False):
    prompt = owner = None
    usage, done = {}, False
    for row in turns(path, side):
        if row[1] == "usage":
            if done:
                yield from tokens(owner, usage)
                owner, usage, done = None, {}, False
            usage[row[2]] = row[3]
            continue
        if row[1] == "prompt":
            yield from tokens(owner or prompt, usage)
            prompt = owner = row[0]
            usage, done = {}, False
        elif row[1] == "answer":
            owner, done = owner or row[0], True
        yield row
    yield from tokens(owner or prompt, usage)


# the uuids on the conversation's live branch: from the file's last row back along parentUuid (logicalParentUuid across a
# /compact boundary). A /rewind appends nothing; the next row's parent points back at the rewind point, so the rows it left
# behind stay in the file off this branch. None = no row carries parentUuid (nothing to follow, keep every row).
# shortcut: until the first row after a /rewind is written, the last row is still the rewound branch's; the live pane
# prunes on its own (register.tsx, checkRewind)
def branch(links: dict) -> set | None:
    if not links:
        return None
    on, uuid = set(), next(reversed(links))
    while uuid and uuid not in on:
        on.add(uuid)
        uuid = links.get(uuid)
    return on


def turns(path: str, side: bool):
    links = {}
    found = list(records(path, side, links))
    on = branch(links)
    return (row for row in found if on is None or row[0] in on)


# every row turns() yields, in file order, filling links (uuid -> parent) from the main rows as it goes
# perf: the branch needs the tool result lines' links, so those are parsed too (+0.5 s on a 130 MB transcript, 0.8 s before)
def records(path: str, side: bool, links: dict):
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            # cheap prefilter: most lines are tool calls/results and progress records; a subagent's file is all sidechain
            if '"isSidechain":true' in line and not side:
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if "parentUuid" in r and r.get("uuid") and not r.get("isSidechain"):
                links[r["uuid"]] = r["parentUuid"] or r.get("logicalParentUuid")
            if '"tool_result"' in line:
                continue
            kind, uuid = r.get("type"), r.get("uuid")
            if not uuid or (r.get("isSidechain") and not side) or r.get("isMeta") or r.get("isCompactSummary"):
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
                msg = r.get("message") or {}
                if msg.get("id") and isinstance(msg.get("usage"), dict):
                    yield [uuid, "usage", msg["id"], msg["usage"]]
                text = text_of(msg.get("content"))
                lines = [ln for ln in text.split("\n") if KEEP.match(ln)]
                reply = "answer" if msg.get("stop_reason") == "end_turn" else "reply"
                if any(ln.lstrip().startswith("#") for ln in lines):
                    yield [uuid, reply, "\n".join(lines), ts]
                elif text.strip():
                    # no headings: its start is enough for the one-line preview register.tsx draws
                    yield [uuid, reply, text[:2000], ts]


# the transcript's subagents' rows, each led by its task: <session>/subagents/agent-<id>.jsonl (+ .meta.json)
# shortcut: reads every subagent file on each scan; a session with hundreds of agents wants a per-agent request
def all_rows(path: str):
    yield from rows(path)
    folder = os.path.join(path[: -len(".jsonl")], "subagents")
    for sub in sorted(glob.glob(os.path.join(folder, "agent-*.jsonl"))):
        agent = os.path.basename(sub)[len("agent-") : -len(".jsonl")]
        try:
            with open(sub[: -len(".jsonl")] + ".meta.json", encoding="utf-8") as f:
                task = (json.load(f).get("description") or "").strip()
        except (OSError, ValueError):
            task = ""
        first = True
        for row in rows(sub, side=True):
            # its opening row is the whole task brief: the short description labels it better
            if first and row[1] == "prompt" and task:
                row[2] = task
            first = False
            yield [*row, agent]


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: scan.py SESSION_ID [TRANSCRIPT]", file=sys.stderr)
        return 2
    path = sys.argv[2] if len(sys.argv) > 2 else find(sys.argv[1])
    if not path or not os.path.isfile(path):
        print("[]")
        return 0
    json.dump(list(all_rows(path)), sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
