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

    def test_turn_tokens_follow_each_prompt_counting_each_call_once(self):
        def call(uuid, mid, out, text=None):
            content = [{"type": "text", "text": text}] if text else [{"type": "tool_use", "id": uuid, "name": "Bash", "input": {}}]
            usage = {"input_tokens": 10, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 4, "output_tokens": out}
            return rec(uuid=uuid, type="assistant", message={"id": mid, "content": content, "usage": usage})
        out = scan_rows([
            rec(uuid="u1", type="user", message={"content": "one"}),
            call("a1", "m1", 1, "Checking."), call("a2", "m1", 7), call("a3", "m2", 3, "Done."),
            rec(uuid="u2", type="user", message={"content": "two"}),
        ])
        self.assertEqual(out, [
            ["u1", "prompt", "one", T], ["a1", "reply", "Checking.", T], ["a3", "reply", "Done.", T],
            # input, cache read, cache write, output, then the cost-weighted sum: 20 + 200*0.1 + 8*1.25 + 10*5
            ["u1", "tokens", "20 200 8 10 100", ""], ["u2", "prompt", "two", T],
        ])

    @staticmethod
    def answer(uuid, mid, usage, text="Done."):
        return rec(uuid=uuid, type="assistant", message={"id": mid, "stop_reason": "end_turn", "content": [{"type": "text", "text": text}], "usage": usage})

    # a background agent's hand-back starts a turn with no prompt row: its usage goes to that turn's own answer
    def test_a_turn_after_the_prompts_answer_counts_toward_its_own_answer(self):
        u = {"input_tokens": 10, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0, "output_tokens": 2}
        # a 1h cache write weighs 2, a 5m one 1.25
        bg = {"input_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 12,
              "cache_creation": {"ephemeral_5m_input_tokens": 4, "ephemeral_1h_input_tokens": 8}, "output_tokens": 1}
        out = scan_rows([
            rec(uuid="u1", type="user", message={"content": "one"}),
            self.answer("a1", "m1", u),
            rec(uuid="n1", type="user", origin={"kind": "task-notification"}, message={"content": "<task-notification>done</task-notification>"}),
            self.answer("a2", "m2", bg, "Agent finished."),
            rec(uuid="u2", type="user", message={"content": "two"}),
        ])
        self.assertEqual(out, [
            ["u1", "prompt", "one", T], ["a1", "answer", "Done.", T],
            ["u1", "tokens", "10 0 0 2 20", ""], ["a2", "answer", "Agent finished.", T],
            ["a2", "tokens", "0 0 12 1 26", ""], ["u2", "prompt", "two", T],
        ])

    # no answer text to carry it: the turn's usage goes back to the prompt as a second tokens row
    def test_a_background_turn_with_no_answer_counts_toward_the_prompt(self):
        u = {"input_tokens": 10, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0, "output_tokens": 0}
        tool = rec(uuid="a2", type="assistant", message={"id": "m2", "stop_reason": "tool_use", "content": [{"type": "tool_use", "id": "t", "name": "Bash", "input": {}}], "usage": u})
        out = scan_rows([rec(uuid="u1", type="user", message={"content": "one"}), self.answer("a1", "m1", u), tool])
        self.assertEqual(out, [
            ["u1", "prompt", "one", T], ["a1", "answer", "Done.", T],
            ["u1", "tokens", "10 0 0 0 10", ""], ["u1", "tokens", "10 0 0 0 10", ""],
        ])

    def test_image_with_blank_text_still_yields_a_prompt(self):
        out = scan_rows([rec(uuid="u1", type="user", message={"content": [{"type": "text", "text": "  "}, IMG]})])
        self.assertEqual(out, [["u1", "prompt", "[Image]", T]])


if __name__ == "__main__":
    unittest.main()
