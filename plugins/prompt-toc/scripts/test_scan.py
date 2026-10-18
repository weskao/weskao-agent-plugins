import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scan  # noqa: E402

T = "2026-01-01T00:00:00.000Z"
IMG = {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AA=="}}


def rec(**kw):
    return {"uuid": kw.pop("uuid"), "timestamp": T, "isSidechain": False, **kw}


def scan_rows(records):
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8") as f:
        f.write("\n".join(json.dumps(r) for r in records))
    try:
        return list(scan.rows(f.name))
    finally:
        os.unlink(f.name)


class ScanTest(unittest.TestCase):
    def test_timestamp_is_fourth_element(self):
        out = scan_rows([
            rec(uuid="u1", type="user", message={"content": "hello"}),
            rec(uuid="a1", type="assistant", message={"content": [{"type": "text", "text": "# Title\nbody"}]}),
        ])
        self.assertEqual(out, [["u1", "prompt", "hello", T], ["a1", "reply", "# Title", T]])

    def test_missing_timestamp_is_empty_string(self):
        r = rec(uuid="u1", type="user", message={"content": "hi"})
        del r["timestamp"]
        self.assertEqual(scan_rows([r]), [["u1", "prompt", "hi", ""]])

    def test_compact_boundary_row_and_summary_skipped(self):
        out = scan_rows([
            rec(uuid="s1", type="user", isCompactSummary=True, message={"content": "This session is being continued..."}),
            rec(uuid="b1", type="system", subtype="compact_boundary", content="Conversation compacted",
                compactMetadata={"trigger": "manual"}),
            rec(uuid="u1", type="user", message={"content": "next"}),
        ])
        self.assertEqual(out, [["b1", "compact", "manual", T], ["u1", "prompt", "next", T]])

    # a typed turn and a mid-turn message, each as plain text, image only, image + text and text + image
    SHAPES = [
        ("plain", "plain"),
        ([{"type": "text", "text": "plain"}], "plain"),
        ([IMG], "[Image]"),
        ([IMG, {"type": "text", "text": "after"}], "after"),
        ([{"type": "text", "text": "before"}, IMG], "before"),
    ]

    def test_typed_turn_shapes_yield_a_string_prompt(self):
        out = scan_rows([rec(uuid=f"u{i}", type="user", message={"content": c}) for i, (c, _) in enumerate(self.SHAPES)])
        self.assertEqual(out, [[f"u{i}", "prompt", want, T] for i, (_, want) in enumerate(self.SHAPES)])

    def test_mid_turn_shapes_yield_a_string_prompt(self):
        out = scan_rows([
            rec(uuid=f"q{i}", type="attachment", attachment={"type": "queued_command", "humanTurn": True, "prompt": c})
            for i, (c, _) in enumerate(self.SHAPES)
        ])
        self.assertEqual(out, [[f"q{i}", "prompt", want, T] for i, (_, want) in enumerate(self.SHAPES)])

    def test_reply_that_ends_its_turn_is_an_answer(self):
        out = scan_rows([
            rec(uuid="a1", type="assistant", message={"stop_reason": "tool_use", "content": [{"type": "text", "text": "Checking."}]}),
            rec(uuid="a2", type="assistant", message={"stop_reason": "end_turn", "content": [{"type": "text", "text": "Done."}]}),
        ])
        self.assertEqual(out, [["a1", "reply", "Checking.", T], ["a2", "answer", "Done.", T]])

    def test_subagent_transcripts_follow_the_main_rows_under_their_agent_id(self):
        with tempfile.TemporaryDirectory() as d:
            main = os.path.join(d, "sess.jsonl")
            os.makedirs(os.path.join(d, "sess", "subagents"))
            with open(main, "w", encoding="utf-8") as f:
                f.write(json.dumps(rec(uuid="u1", type="user", message={"content": "go"})))
            sub = os.path.join(d, "sess", "subagents", "agent-abc.jsonl")
            side = {"isSidechain": True, "agentId": "abc"}
            with open(sub, "w", encoding="utf-8") as f:
                f.write("\n".join(json.dumps({**rec(uuid=u, **kw), **side}) for u, kw in [
                    ("s0", dict(type="user", message={"content": "worker_id: T5\ntask: read the spec"})),
                    ("s1", dict(type="assistant", message={"stop_reason": "end_turn", "content": [{"type": "text", "text": "Done."}]})),
                ]))
            with open(os.path.join(d, "sess", "subagents", "agent-abc.meta.json"), "w", encoding="utf-8") as f:
                json.dump({"description": "T5 controller refactor"}, f)
            self.assertEqual(
                list(scan.all_rows(main)),
                [["u1", "prompt", "go", T], ["s0", "prompt", "T5 controller refactor", T, "abc"], ["s1", "answer", "Done.", T, "abc"]],
            )

    def test_image_with_blank_text_still_yields_a_prompt(self):
        out = scan_rows([rec(uuid="u1", type="user", message={"content": [{"type": "text", "text": "  "}, IMG]})])
        self.assertEqual(out, [["u1", "prompt", "[Image]", T]])


if __name__ == "__main__":
    unittest.main()
