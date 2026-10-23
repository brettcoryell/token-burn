"""The audit must group local transcripts exactly as the collector does (D15)."""

import json
import sys
from datetime import date
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import audit_token_accounting as audit  # noqa: E402


def _reply(msg_id, ts, tokens):
    return json.dumps({
        "type": "assistant",
        "timestamp": ts,
        "message": {"id": msg_id, "usage": {
            "input_tokens": tokens, "output_tokens": 0,
            "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0,
        }},
    })


def _write(root, parent, lines):
    folder = root / "project" / parent / "subagents"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "agent-abc.jsonl").write_text("\n".join(lines) + "\n")


def test_resumed_subagent_is_one_local_session(tmp_path):
    _write(tmp_path, "parent-early", [_reply("m1", "2026-10-01T15:00:00.000Z", 10)])
    _write(tmp_path, "parent-late", [
        _reply("m1", "2026-10-01T15:00:00.000Z", 10),
        _reply("m2", "2026-10-02T15:00:00.000Z", 5),
    ])

    sessions = audit.local_claude_sessions(tmp_path, date(2026, 1, 1))

    assert len(sessions) == 1
    assert sessions[0]["session_id"] == "agent-abc"
    assert sessions[0]["input_tokens"] == 15
    assert sessions[0]["api_requests"] == 2
    assert "parent_session_id" not in sessions[0]
