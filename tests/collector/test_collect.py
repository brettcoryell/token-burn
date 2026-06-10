"""
Collector tests for scripts/collect.py.

All tests are self-contained — no dependency on real ~/.claude/ session files.
Tests invoke collect.py via subprocess so the test suite is independent of
import side-effects. The script is expected at scripts/collect.py relative to
the repository root.

Conventions:
  - tmp_path (pytest built-in) provides an isolated temp dir per test.
  - Fixture JSONL files are read from tests/collector/fixtures/.
  - AC numbers in test names map 1-to-1 with ACCEPTANCE_CRITERIA.md.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).parent.parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
COLLECT_PY = SCRIPTS_DIR / "collect.py"
FIXTURES_DIR = Path(__file__).parent / "fixtures"

SIMPLE_SESSION = FIXTURES_DIR / "simple_session.jsonl"
MIDNIGHT_SESSION = FIXTURES_DIR / "midnight_spanning_session.jsonl"
MALFORMED_SESSION = FIXTURES_DIR / "malformed_session.jsonl"
ANNOTATIONS_JSON = FIXTURES_DIR / "annotations.json"

EXPECTED_SCHEMA_KEYS = {
    "date",
    "claude_code_input",
    "claude_code_output",
    "claude_code_cache_read",
    "claude_code_cache_create",
    "claude_code_api_requests",
    "claude_code_sessions",
    "claude_chat_sessions",
    "claude_chat_est",
    "total_exact",
    "total_est",
    "sources",
    "driver",
    "evidence",
}

assert len(EXPECTED_SCHEMA_KEYS) == 14, "Schema must have exactly 14 keys"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def run_collect(
    sessions_root: Path,
    output_file: Path,
    *,
    machine: str = "cadence",
    annotations: Path | None = None,
    dry_run: bool = False,
    verbose: bool = False,
    chat_tokens_per_session: int | None = None,
    extra_args: list[str] | None = None,
) -> subprocess.CompletedProcess:
    """Run scripts/collect.py with given arguments and return the result."""
    cmd = [
        sys.executable,
        str(COLLECT_PY),
        "--sessions-root", str(sessions_root),
        "--output", str(output_file),
        "--machine", machine,
    ]
    if annotations is not None:
        cmd += ["--annotations", str(annotations)]
    if dry_run:
        cmd.append("--dry-run")
    if verbose:
        cmd.append("--verbose")
    if chat_tokens_per_session is not None:
        cmd += ["--chat-tokens-per-session", str(chat_tokens_per_session)]
    if extra_args:
        cmd.extend(extra_args)

    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
    )


def load_output(output_file: Path) -> list[dict]:
    """Load and return parsed daily-burn.json."""
    with open(output_file) as f:
        return json.load(f)


def make_session_dir(tmp_path: Path, *fixture_files: Path) -> Path:
    """
    Create a sessions root with one subdirectory per fixture file.
    Claude Code stores sessions as JSONL files inside project subdirectories.
    Each fixture gets its own subdirectory named after the fixture stem.
    """
    sessions_root = tmp_path / "sessions"
    for fixture in fixture_files:
        project_dir = sessions_root / fixture.stem
        project_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(fixture, project_dir / fixture.name)
    return sessions_root


# ---------------------------------------------------------------------------
# AC-1.1 — Token math
# ---------------------------------------------------------------------------

def test_ac1_1_token_math(tmp_path):
    """
    AC-1.1: Given simple_session.jsonl with two assistant messages:
      Message A: input=100, output=50, cache_read=1000, cache_create=500
      Message B: input=200, output=100, cache_read=2000, cache_create=1000
    The output row must have exact integer sums and total_exact = 4950.
    """
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    output_file = tmp_path / "daily-burn.json"

    result = run_collect(sessions_root, output_file)
    assert result.returncode == 0, f"collect.py exited non-zero:\n{result.stderr}"

    rows = load_output(output_file)
    assert len(rows) >= 1, "Expected at least one row in output"

    row = next((r for r in rows if r["date"] == "2026-06-09"), None)
    assert row is not None, "Expected a row for date 2026-06-09"

    assert row["claude_code_input"] == 300, f"Expected input=300, got {row['claude_code_input']}"
    assert row["claude_code_output"] == 150, f"Expected output=150, got {row['claude_code_output']}"
    assert row["claude_code_cache_read"] == 3000, f"Expected cache_read=3000, got {row['claude_code_cache_read']}"
    assert row["claude_code_cache_create"] == 1500, f"Expected cache_create=1500, got {row['claude_code_cache_create']}"
    assert row["total_exact"] == 4950, f"Expected total_exact=4950, got {row['total_exact']}"
    assert row["claude_code_api_requests"] == 2, f"Expected api_requests=2, got {row['claude_code_api_requests']}"


# ---------------------------------------------------------------------------
# AC-1.2 — Idempotency
# ---------------------------------------------------------------------------

def test_ac1_2_idempotency(tmp_path):
    """
    AC-1.2: Running collect.py twice on the same session files produces
    byte-for-byte identical output.
    """
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    output_file = tmp_path / "daily-burn.json"

    r1 = run_collect(sessions_root, output_file)
    assert r1.returncode == 0, f"First run failed:\n{r1.stderr}"
    content_after_first = output_file.read_bytes()

    r2 = run_collect(sessions_root, output_file)
    assert r2.returncode == 0, f"Second run failed:\n{r2.stderr}"
    content_after_second = output_file.read_bytes()

    assert content_after_first == content_after_second, (
        "Output changed between two identical runs — not idempotent"
    )


# ---------------------------------------------------------------------------
# AC-1.3 — New session file adds/updates correctly
# ---------------------------------------------------------------------------

def test_ac1_3_new_session_new_date(tmp_path):
    """
    AC-1.3 (new date): Adding a session for a different date adds exactly one row.
    Row count goes from 1 to 2 after adding the second session.
    """
    # Session 1: 2026-06-09
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    output_file = tmp_path / "daily-burn.json"

    r1 = run_collect(sessions_root, output_file)
    assert r1.returncode == 0
    rows_before = load_output(output_file)
    count_before = len(rows_before)

    # Session 2: midnight_spanning — starts 2026-06-09 23:55 PT → date 2026-06-09
    # We need a truly different date. Create a synthetic session on 2026-06-08.
    new_session_dir = sessions_root / "new_project"
    new_session_dir.mkdir(parents=True, exist_ok=True)
    new_session = new_session_dir / "new_session.jsonl"
    new_session.write_text(
        '{"type":"user","timestamp":"2026-06-08T14:00:00.000Z","uuid":"dddddddd-0001-0001-0001-000000000001","parentUuid":null,"sessionId":"session-new-date-001","message":{"role":"user","content":[{"type":"text","text":"Hello"}]}}\n'
        '{"type":"assistant","timestamp":"2026-06-08T14:01:00.000Z","uuid":"dddddddd-0001-0001-0001-000000000002","parentUuid":"dddddddd-0001-0001-0001-000000000001","sessionId":"session-new-date-001","message":{"id":"msg_new1","type":"message","role":"assistant","model":"claude-opus-4-5","content":[{"type":"text","text":"Hi"}],"stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}}}\n'
    )

    r2 = run_collect(sessions_root, output_file)
    assert r2.returncode == 0
    rows_after = load_output(output_file)

    assert len(rows_after) == count_before + 1, (
        f"Expected {count_before + 1} rows after adding a new-date session, got {len(rows_after)}"
    )
    dates = [r["date"] for r in rows_after]
    assert "2026-06-08" in dates, "New date 2026-06-08 not found in output"
    assert "2026-06-09" in dates, "Original date 2026-06-09 should still be present"


def test_ac1_3_new_session_same_date_additive(tmp_path):
    """
    AC-1.3 (same date): Adding a session on the same date updates that row additively.
    Row count stays the same. Tokens increase.
    """
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    output_file = tmp_path / "daily-burn.json"

    r1 = run_collect(sessions_root, output_file)
    assert r1.returncode == 0
    rows_before = load_output(output_file)
    row_before = next(r for r in rows_before if r["date"] == "2026-06-09")
    total_exact_before = row_before["total_exact"]
    count_before = len(rows_before)

    # Add a second session on 2026-06-09 (different session ID, different file path)
    extra_dir = sessions_root / "extra_project"
    extra_dir.mkdir(parents=True, exist_ok=True)
    extra_session = extra_dir / "extra_session.jsonl"
    extra_session.write_text(
        '{"type":"user","timestamp":"2026-06-09T20:00:00.000Z","uuid":"eeeeeeee-0001-0001-0001-000000000001","parentUuid":null,"sessionId":"session-extra-001","message":{"role":"user","content":[{"type":"text","text":"Extra"}]}}\n'
        '{"type":"assistant","timestamp":"2026-06-09T20:01:00.000Z","uuid":"eeeeeeee-0001-0001-0001-000000000002","parentUuid":"eeeeeeee-0001-0001-0001-000000000001","sessionId":"session-extra-001","message":{"id":"msg_extra1","type":"message","role":"assistant","model":"claude-opus-4-5","content":[{"type":"text","text":"Done"}],"stop_reason":"end_turn","usage":{"input_tokens":50,"output_tokens":25,"cache_read_input_tokens":500,"cache_creation_input_tokens":250}}}\n'
    )

    r2 = run_collect(sessions_root, output_file)
    assert r2.returncode == 0
    rows_after = load_output(output_file)
    row_after = next(r for r in rows_after if r["date"] == "2026-06-09")

    assert len(rows_after) == count_before, (
        f"Row count changed from {count_before} to {len(rows_after)} — should be same date"
    )
    assert row_after["total_exact"] > total_exact_before, (
        "total_exact should increase after adding same-date session"
    )
    # extra session adds input=50, output=25, cache_read=500, cache_create=250 → +825
    assert row_after["total_exact"] == total_exact_before + 825, (
        f"Expected total_exact = {total_exact_before + 825}, got {row_after['total_exact']}"
    )


# ---------------------------------------------------------------------------
# AC-1.4 — Malformed JSONL handled gracefully
# ---------------------------------------------------------------------------

def test_ac1_4_malformed_jsonl_graceful(tmp_path):
    """
    AC-1.4: A JSONL file with a malformed line does not crash the collector.
    Valid lines are processed. Malformed line produces a warning on stderr.
    Final token counts reflect only the valid assistant record.
    """
    sessions_root = make_session_dir(tmp_path, MALFORMED_SESSION)
    output_file = tmp_path / "daily-burn.json"

    result = run_collect(sessions_root, output_file)

    # Must not crash
    assert result.returncode == 0, (
        f"collect.py crashed on malformed input (returncode={result.returncode}):\n{result.stderr}"
    )

    # Warning must appear on stderr
    assert result.stderr.strip() != "" or "warn" in result.stderr.lower() or "skip" in result.stderr.lower() or "malformed" in result.stderr.lower() or "error" in result.stderr.lower(), (
        "Expected a warning on stderr for malformed JSON line, got none"
    )

    # Valid assistant record (line 3) must be processed
    rows = load_output(output_file)
    row = next((r for r in rows if r["date"] == "2026-06-09"), None)
    assert row is not None, "Expected a row for 2026-06-09 from the valid line"
    assert row["claude_code_input"] == 50
    assert row["claude_code_output"] == 25
    assert row["claude_code_cache_read"] == 500
    assert row["claude_code_cache_create"] == 250
    assert row["total_exact"] == 825  # 50+25+500+250


# ---------------------------------------------------------------------------
# AC-1.5 — Timezone bucketing
# ---------------------------------------------------------------------------

def test_ac1_5_timezone_bucketing_utc_to_pt(tmp_path):
    """
    AC-1.5: UTC timestamps are correctly converted to Pacific time for date bucketing.
    2026-06-10T07:00:00Z = 2026-06-09 in US/Pacific (UTC-7 in summer/PDT).
    2026-06-10T08:00:00Z = 2026-06-10 in US/Pacific.
    """
    # Session A: timestamp 2026-06-10T07:00:00Z → should be 2026-06-09 PT
    sessions_root = tmp_path / "sessions"
    proj_a = sessions_root / "proj_a"
    proj_a.mkdir(parents=True)
    (proj_a / "session_a.jsonl").write_text(
        '{"type":"user","timestamp":"2026-06-10T07:00:00.000Z","uuid":"fa000001-0001-0001-0001-000000000001","parentUuid":null,"sessionId":"tz-session-a","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n'
        '{"type":"assistant","timestamp":"2026-06-10T07:01:00.000Z","uuid":"fa000001-0001-0001-0001-000000000002","parentUuid":"fa000001-0001-0001-0001-000000000001","sessionId":"tz-session-a","message":{"id":"msg_tz_a","type":"message","role":"assistant","model":"claude-opus-4-5","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n'
    )

    # Session B: timestamp 2026-06-10T08:00:00Z → should be 2026-06-10 PT
    proj_b = sessions_root / "proj_b"
    proj_b.mkdir(parents=True)
    (proj_b / "session_b.jsonl").write_text(
        '{"type":"user","timestamp":"2026-06-10T08:00:00.000Z","uuid":"fb000001-0001-0001-0001-000000000001","parentUuid":null,"sessionId":"tz-session-b","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n'
        '{"type":"assistant","timestamp":"2026-06-10T08:01:00.000Z","uuid":"fb000001-0001-0001-0001-000000000002","parentUuid":"fb000001-0001-0001-0001-000000000001","sessionId":"tz-session-b","message":{"id":"msg_tz_b","type":"message","role":"assistant","model":"claude-opus-4-5","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","usage":{"input_tokens":20,"output_tokens":10,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n'
    )

    output_file = tmp_path / "daily-burn.json"
    result = run_collect(sessions_root, output_file)
    assert result.returncode == 0, f"collect.py failed:\n{result.stderr}"

    rows = load_output(output_file)
    dates = {r["date"] for r in rows}

    assert "2026-06-09" in dates, (
        "2026-06-10T07:00:00Z should bucket to 2026-06-09 (PDT = UTC-7)"
    )
    assert "2026-06-10" in dates, (
        "2026-06-10T08:00:00Z should bucket to 2026-06-10 (PDT = UTC-7)"
    )

    row_09 = next(r for r in rows if r["date"] == "2026-06-09")
    assert row_09["claude_code_input"] == 10
    row_10 = next(r for r in rows if r["date"] == "2026-06-10")
    assert row_10["claude_code_input"] == 20


# ---------------------------------------------------------------------------
# AC-1.6 — Midnight-spanning session bucketed to first record's date
# ---------------------------------------------------------------------------

def test_ac1_6_midnight_spanning_session(tmp_path):
    """
    AC-1.6: Session starts 2026-06-10T06:55:00Z (= 2026-06-09 23:55 PT) and has
    messages past midnight (2026-06-10T07:15:00Z = 2026-06-10 00:15 PT).
    All tokens must appear in 2026-06-09, not 2026-06-10.
    """
    sessions_root = make_session_dir(tmp_path, MIDNIGHT_SESSION)
    output_file = tmp_path / "daily-burn.json"

    result = run_collect(sessions_root, output_file)
    assert result.returncode == 0, f"collect.py failed:\n{result.stderr}"

    rows = load_output(output_file)
    dates = {r["date"] for r in rows}

    assert "2026-06-09" in dates, "All tokens must be bucketed to 2026-06-09"
    assert "2026-06-10" not in dates, (
        "No tokens from this session should appear in 2026-06-10 row"
    )

    row = next(r for r in rows if r["date"] == "2026-06-09")
    # Two assistant messages, each input=10, output=5, cache_read=100, cache_create=50
    assert row["claude_code_input"] == 20
    assert row["claude_code_output"] == 10
    assert row["claude_code_cache_read"] == 200
    assert row["claude_code_cache_create"] == 100
    assert row["total_exact"] == 330  # 20+10+200+100


# ---------------------------------------------------------------------------
# AC-1.7 — Annotations merged
# ---------------------------------------------------------------------------

def test_ac1_7_annotations_merged(tmp_path):
    """
    AC-1.7: annotations.json containing driver/evidence/claude_chat_sessions for
    2026-06-09 is merged into the output row. claude_chat_est = sessions * 75000.
    """
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    output_file = tmp_path / "daily-burn.json"

    result = run_collect(sessions_root, output_file, annotations=ANNOTATIONS_JSON)
    assert result.returncode == 0, f"collect.py failed:\n{result.stderr}"

    rows = load_output(output_file)
    row = next((r for r in rows if r["date"] == "2026-06-09"), None)
    assert row is not None

    assert row["driver"] == "code", f"Expected driver='code', got {row['driver']!r}"
    assert row["evidence"] == "feature work session", f"Expected evidence='feature work session', got {row['evidence']!r}"
    assert row["claude_chat_sessions"] == 2, f"Expected claude_chat_sessions=2, got {row['claude_chat_sessions']}"
    assert row["claude_chat_est"] == 150000, (
        f"Expected claude_chat_est=150000 (2 × 75000), got {row['claude_chat_est']}"
    )


# ---------------------------------------------------------------------------
# AC-1.8 — Annotations survive re-collection
# ---------------------------------------------------------------------------

def test_ac1_8_annotations_survive_recollection(tmp_path):
    """
    AC-1.8: If annotations.json is unchanged and collect.py is re-run on the same
    session files, driver/evidence/claude_chat_sessions are preserved.
    """
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    output_file = tmp_path / "daily-burn.json"

    r1 = run_collect(sessions_root, output_file, annotations=ANNOTATIONS_JSON)
    assert r1.returncode == 0
    r2 = run_collect(sessions_root, output_file, annotations=ANNOTATIONS_JSON)
    assert r2.returncode == 0

    rows = load_output(output_file)
    row = next(r for r in rows if r["date"] == "2026-06-09")
    assert row["driver"] == "code"
    assert row["evidence"] == "feature work session"
    assert row["claude_chat_sessions"] == 2
    assert row["claude_chat_est"] == 150000


# ---------------------------------------------------------------------------
# AC-1.9 — Changed annotation overwrites previous value
# ---------------------------------------------------------------------------

def test_ac1_9_changed_annotation_overwrites(tmp_path):
    """
    AC-1.9: Changing annotations.json and re-running collect.py overwrites the
    previous annotation value. Most-recent annotation wins.
    """
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    output_file = tmp_path / "daily-burn.json"
    annotations_file = tmp_path / "annotations.json"

    # First run: driver = "code"
    annotations_file.write_text(json.dumps({
        "2026-06-09": {"driver": "code", "evidence": "first", "claude_chat_sessions": 1}
    }))
    r1 = run_collect(sessions_root, output_file, annotations=annotations_file)
    assert r1.returncode == 0

    rows = load_output(output_file)
    row = next(r for r in rows if r["date"] == "2026-06-09")
    assert row["driver"] == "code"

    # Second run: driver changed to "memoir"
    annotations_file.write_text(json.dumps({
        "2026-06-09": {"driver": "memoir", "evidence": "updated", "claude_chat_sessions": 3}
    }))
    r2 = run_collect(sessions_root, output_file, annotations=annotations_file)
    assert r2.returncode == 0

    rows = load_output(output_file)
    row = next(r for r in rows if r["date"] == "2026-06-09")
    assert row["driver"] == "memoir", (
        f"Expected driver='memoir' after annotation update, got {row['driver']!r}"
    )
    assert row["evidence"] == "updated"
    assert row["claude_chat_sessions"] == 3
    assert row["claude_chat_est"] == 225000  # 3 × 75000


# ---------------------------------------------------------------------------
# AC-1.10 — Output schema is exactly 14 fields
# ---------------------------------------------------------------------------

def test_ac1_10_schema_exactly_14_fields(tmp_path):
    """
    AC-1.10: Every output row has exactly the 14 specified keys — no more, no less.
    Presence of any additional key is a test failure.
    """
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    output_file = tmp_path / "daily-burn.json"

    result = run_collect(sessions_root, output_file, annotations=ANNOTATIONS_JSON)
    assert result.returncode == 0

    rows = load_output(output_file)
    assert len(rows) >= 1, "Expected at least one row"

    for row in rows:
        row_keys = set(row.keys())
        extra = row_keys - EXPECTED_SCHEMA_KEYS
        missing = EXPECTED_SCHEMA_KEYS - row_keys
        assert not extra, f"Row has unexpected extra keys: {extra}"
        assert not missing, f"Row is missing required keys: {missing}"
        assert len(row_keys) == 14, f"Row has {len(row_keys)} keys, expected 14"


# ---------------------------------------------------------------------------
# AC-1.11 — Multi-machine additive merge
# ---------------------------------------------------------------------------

def test_ac1_11_multi_machine_additive_merge(tmp_path):
    """
    AC-1.11: Two collect runs with different --machine values on separate session
    files for the same date are additive. sources accumulates both machine names.
    Re-running a machine does not duplicate it in sources.
    """
    output_file = tmp_path / "daily-burn.json"

    # Machine cadence: simple_session.jsonl → 2026-06-09, total_exact = 4950
    sessions_cadence = tmp_path / "cadence_sessions"
    cadence_proj = sessions_cadence / "proj"
    cadence_proj.mkdir(parents=True)
    shutil.copy(SIMPLE_SESSION, cadence_proj / SIMPLE_SESSION.name)

    r1 = run_collect(sessions_cadence, output_file, machine="cadence")
    assert r1.returncode == 0

    rows = load_output(output_file)
    row = next(r for r in rows if r["date"] == "2026-06-09")
    assert row["sources"] == ["cadence"]
    exact_cadence = row["total_exact"]  # 4950

    # Machine coda: a different session file on the same date
    sessions_coda = tmp_path / "coda_sessions"
    coda_proj = sessions_coda / "proj"
    coda_proj.mkdir(parents=True)
    (coda_proj / "coda_session.jsonl").write_text(
        '{"type":"user","timestamp":"2026-06-09T18:00:00.000Z","uuid":"ff000001-0001-0001-0001-000000000001","parentUuid":null,"sessionId":"coda-session-001","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n'
        '{"type":"assistant","timestamp":"2026-06-09T18:01:00.000Z","uuid":"ff000001-0001-0001-0001-000000000002","parentUuid":"ff000001-0001-0001-0001-000000000001","sessionId":"coda-session-001","message":{"id":"msg_coda1","type":"message","role":"assistant","model":"claude-opus-4-5","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":500,"cache_creation_input_tokens":250}}}\n'
    )
    exact_coda = 100 + 50 + 500 + 250  # 900

    r2 = run_collect(sessions_coda, output_file, machine="coda")
    assert r2.returncode == 0

    rows = load_output(output_file)
    row = next(r for r in rows if r["date"] == "2026-06-09")

    assert "cadence" in row["sources"], "cadence must remain in sources"
    assert "coda" in row["sources"], "coda must be added to sources"
    assert row["total_exact"] == exact_cadence + exact_coda, (
        f"Expected additive total_exact = {exact_cadence + exact_coda}, got {row['total_exact']}"
    )

    # Re-running coda again must not duplicate it in sources
    r3 = run_collect(sessions_coda, output_file, machine="coda")
    assert r3.returncode == 0

    rows = load_output(output_file)
    row = next(r for r in rows if r["date"] == "2026-06-09")
    coda_count = row["sources"].count("coda")
    assert coda_count == 1, f"coda appeared {coda_count} times in sources, expected 1 (idempotent)"


# ---------------------------------------------------------------------------
# AC-2.1 — --dry-run doesn't write
# ---------------------------------------------------------------------------

def test_ac2_1_dry_run_does_not_write(tmp_path):
    """
    AC-2.1: --dry-run prints reconciliation summary but does not create or modify
    daily-burn.json.
    """
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    output_file = tmp_path / "daily-burn.json"

    result = run_collect(sessions_root, output_file, dry_run=True)
    assert result.returncode == 0, f"collect.py --dry-run failed:\n{result.stderr}"

    assert not output_file.exists(), (
        "--dry-run must not write daily-burn.json, but the file was created"
    )

    # Should still print something meaningful
    combined = result.stdout + result.stderr
    assert combined.strip() != "", "--dry-run should produce output describing what would be written"


def test_ac2_1_dry_run_does_not_modify_existing(tmp_path):
    """
    AC-2.1: --dry-run on an already-existing output file does not modify it.
    """
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    output_file = tmp_path / "daily-burn.json"

    # First real run
    r1 = run_collect(sessions_root, output_file)
    assert r1.returncode == 0
    original_bytes = output_file.read_bytes()

    # Add more sessions so there would be a change
    extra_dir = sessions_root / "extra_dry"
    extra_dir.mkdir(parents=True, exist_ok=True)
    (extra_dir / "extra_dry.jsonl").write_text(
        '{"type":"user","timestamp":"2026-06-08T14:00:00.000Z","uuid":"drytest01-0001-0001-0001-000000000001","parentUuid":null,"sessionId":"dry-extra-001","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n'
        '{"type":"assistant","timestamp":"2026-06-08T14:01:00.000Z","uuid":"drytest01-0001-0001-0001-000000000002","parentUuid":"drytest01-0001-0001-0001-000000000001","sessionId":"dry-extra-001","message":{"id":"msg_dry1","type":"message","role":"assistant","model":"claude-opus-4-5","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n'
    )

    r2 = run_collect(sessions_root, output_file, dry_run=True)
    assert r2.returncode == 0
    assert output_file.read_bytes() == original_bytes, (
        "--dry-run modified the output file"
    )


# ---------------------------------------------------------------------------
# AC-2.2 — --verbose format
# ---------------------------------------------------------------------------

def test_ac2_2_verbose_format(tmp_path):
    """
    AC-2.2: --verbose prints one tab-separated line per session file in the format:
    <session_id>\t<date>\t<input>\t<output>\t<cache_read>\t<cache_create>\t<api_requests>
    """
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    output_file = tmp_path / "daily-burn.json"

    result = run_collect(sessions_root, output_file, verbose=True)
    assert result.returncode == 0, f"collect.py --verbose failed:\n{result.stderr}"

    combined_output = result.stdout + result.stderr  # verbose may go to either
    lines = [l for l in combined_output.splitlines() if "\t" in l]

    assert len(lines) >= 1, f"Expected at least one tab-separated verbose line, got:\n{combined_output}"

    # Check format: should have 7 tab-separated fields
    for line in lines:
        parts = line.split("\t")
        assert len(parts) == 7, (
            f"Verbose line should have 7 tab-separated fields, got {len(parts)}: {line!r}"
        )
        # Fields: session_id, date, input, output, cache_read, cache_create, api_requests
        _session_id, date, inp, out, cache_read, cache_create, api_reqs = parts
        # Date should be YYYY-MM-DD
        assert len(date) == 10 and date[4] == "-" and date[7] == "-", (
            f"Expected YYYY-MM-DD date in verbose line, got {date!r}"
        )
        # Token fields should be parseable integers
        assert int(inp) >= 0
        assert int(out) >= 0
        assert int(cache_read) >= 0
        assert int(cache_create) >= 0
        assert int(api_reqs) >= 0


# ---------------------------------------------------------------------------
# AC-2.3 — --sessions-root override
# ---------------------------------------------------------------------------

def test_ac2_3_sessions_root_override(tmp_path):
    """
    AC-2.3: --sessions-root /tmp/test-sessions/ collects from the specified path.
    Sessions at ~/.claude/projects/ are not scanned.
    """
    # Only put a session in a custom path
    custom_root = tmp_path / "custom_sessions"
    custom_proj = custom_root / "myproject"
    custom_proj.mkdir(parents=True)
    shutil.copy(SIMPLE_SESSION, custom_proj / SIMPLE_SESSION.name)

    output_file = tmp_path / "daily-burn.json"

    result = run_collect(custom_root, output_file)
    assert result.returncode == 0, f"collect.py failed:\n{result.stderr}"

    rows = load_output(output_file)
    assert len(rows) >= 1, "Expected at least one row from --sessions-root"
    assert rows[0]["date"] == "2026-06-09", "Expected data from the custom sessions root"


# ---------------------------------------------------------------------------
# AC-2.4 — --chat-tokens-per-session override
# ---------------------------------------------------------------------------

def test_ac2_4_chat_tokens_per_session_override(tmp_path):
    """
    AC-2.4: --chat-tokens-per-session 50000 changes the multiplier.
    Given claude_chat_sessions = 2, claude_chat_est = 100000.
    """
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    output_file = tmp_path / "daily-burn.json"

    # Create an annotations file with claude_chat_sessions = 2
    annotations_file = tmp_path / "annotations.json"
    annotations_file.write_text(json.dumps({
        "2026-06-09": {"driver": "code", "evidence": "test", "claude_chat_sessions": 2}
    }))

    result = run_collect(
        sessions_root, output_file,
        annotations=annotations_file,
        chat_tokens_per_session=50000,
    )
    assert result.returncode == 0, f"collect.py failed:\n{result.stderr}"

    rows = load_output(output_file)
    row = next(r for r in rows if r["date"] == "2026-06-09")

    assert row["claude_chat_est"] == 100000, (
        f"Expected claude_chat_est=100000 (2 × 50000), got {row['claude_chat_est']}"
    )
    assert row["claude_chat_sessions"] == 2


# ---------------------------------------------------------------------------
# AC-2.5 — --machine sets sources field
# ---------------------------------------------------------------------------

def test_ac2_5_machine_sets_sources(tmp_path):
    """
    AC-2.5: --machine mybox sets sources = ["mybox"] on all rows written in that run.
    """
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    output_file = tmp_path / "daily-burn.json"

    result = run_collect(sessions_root, output_file, machine="mybox")
    assert result.returncode == 0, f"collect.py failed:\n{result.stderr}"

    rows = load_output(output_file)
    for row in rows:
        assert "mybox" in row["sources"], (
            f"Expected 'mybox' in sources for row {row['date']}, got {row['sources']}"
        )
