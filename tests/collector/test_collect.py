"""
Collector tests for scripts/collect.py — v2 (Supabase-based).

All tests are self-contained — no dependency on real ~/.claude/ session files
or live Supabase credentials.

Key design choices:
  - Pure functions (parse_session, file_hash, load_state, save_state) are
    imported directly and tested in-process.
  - collect() is called with dry_run=True to avoid any Supabase network calls.
  - Tests that need to verify Supabase upsert behavior mock the supabase client
    via unittest.mock.patch.
  - tmp_path (pytest built-in) provides an isolated temp dir per test.
  - .collect-state.json dedup is tested by manipulating tmp files.

AC numbers in test names map to ACCEPTANCE_CRITERIA_v2.md §AC-5.x.
"""

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import hashlib
from pathlib import Path
from unittest.mock import MagicMock, patch, call

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
CODEX_SESSION = FIXTURES_DIR / "codex_session.jsonl"

# ---------------------------------------------------------------------------
# Import helpers: add scripts/ to sys.path so we can import collect directly
# ---------------------------------------------------------------------------

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def _import_collect():
    """Import collect module, re-importing fresh each time to avoid state leakage."""
    import importlib
    if "collect" in sys.modules:
        return importlib.reload(sys.modules["collect"])
    import collect
    return collect


# ---------------------------------------------------------------------------
# Session directory helper
# ---------------------------------------------------------------------------

def make_session_dir(tmp_path: Path, *fixture_files: Path) -> Path:
    """
    Create a sessions root with one subdirectory per fixture file.
    Each fixture gets its own subdirectory named after the fixture stem.
    """
    sessions_root = tmp_path / "sessions"
    for fixture in fixture_files:
        project_dir = sessions_root / fixture.stem
        project_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(fixture, project_dir / fixture.name)
    return sessions_root


def make_codex_state_db(
    tmp_path: Path,
    rollout_path: Path,
    created_at: int = 1781683204,
) -> Path:
    state_db = tmp_path / "state_5.sqlite"
    conn = sqlite3.connect(state_db)
    try:
        conn.execute(
            """
            CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                rollout_path TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                tokens_used INTEGER NOT NULL DEFAULT 0,
                model TEXT,
                cwd TEXT NOT NULL,
                source TEXT NOT NULL,
                thread_source TEXT NOT NULL DEFAULT 'user'
            )
            """
        )
        conn.execute(
            """
            INSERT INTO threads
              (id, rollout_path, created_at, tokens_used, model, cwd, source, thread_source)
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "019ed498-test",
                str(rollout_path),
                created_at,
                1590,
                "gpt-5.5",
                "/tmp/token-burn-test",
                "vscode",
                "user",
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return state_db


# ---------------------------------------------------------------------------
# AC-5.1 — --dry-run works without database credentials
# ---------------------------------------------------------------------------

def test_ac5_1_dry_run_no_credentials(tmp_path):
    """
    AC-5.1: python scripts/collect.py --dry-run succeeds without Supabase
    credentials. No network call should be made.
    """
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)

    env = os.environ.copy()
    env.pop("SUPABASE_URL", None)
    env.pop("SUPABASE_SERVICE_ROLE_KEY", None)

    result = subprocess.run(
        [sys.executable, str(COLLECT_PY), "--sessions-root", str(sessions_root), "--dry-run"],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(tmp_path),  # state file goes here (different from repo root)
    )

    assert result.returncode == 0, (
        f"--dry-run failed without credentials (returncode={result.returncode}):\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )

    combined = result.stdout + result.stderr
    assert "DRY RUN" in combined, (
        f"Expected 'DRY RUN' in output, got:\n{combined}"
    )


# ---------------------------------------------------------------------------
# AC-5.2 — parse_session returns correct token totals
# ---------------------------------------------------------------------------

def test_ac5_2_parse_session_correct_token_totals():
    """
    AC-5.2: parse_session on simple_session.jsonl returns correct token sums.
    Message A: input=100, output=50, cache_read=1000, cache_create=500
    Message B: input=200, output=100, cache_read=2000, cache_create=1000
    Expected: input=300, output=150, cache_read=3000, cache_create=1500
    total = 300+150+3000+1500 = 4950
    """
    collect = _import_collect()

    result = collect.parse_session(SIMPLE_SESSION)

    assert result is not None, "parse_session returned None for a valid session"
    assert result["session_id"] == "simple_session", (
        f"Expected session_id='simple_session', got {result['session_id']!r}"
    )
    assert result["input_tokens"] == 300
    assert result["output_tokens"] == 150
    assert result["cache_read"] == 3000
    assert result["cache_create"] == 1500
    assert result["api_requests"] == 2

    # Total is input + output + cache_read + cache_create
    total = result["input_tokens"] + result["output_tokens"] + result["cache_read"] + result["cache_create"]
    assert total == 4950, f"Expected token total 4950, got {total}"


def test_ac5_2_parse_session_correct_date_bucketing():
    """
    AC-5.2 (date): simple_session.jsonl has timestamp 2026-06-09T14:00:00.000Z
    which is 2026-06-09 in Mountain time (UTC-6 in summer). Date must be 2026-06-09.
    """
    collect = _import_collect()

    result = collect.parse_session(SIMPLE_SESSION)
    assert result is not None
    assert result["session_date"] == "2026-06-09", (
        f"Expected session_date='2026-06-09', got {result['session_date']!r}"
    )


def test_ac5_2_parse_session_midnight_spanning():
    """
    AC-5.2 (midnight): midnight_spanning_session.jsonl starts at
    2026-06-10T05:55:00.000Z = 2026-06-09 23:55 MT. All tokens must be
    bucketed to 2026-06-09 (first timestamp wins).
    """
    collect = _import_collect()

    result = collect.parse_session(MIDNIGHT_SESSION)
    assert result is not None
    assert result["session_date"] == "2026-06-09", (
        f"Expected midnight session to bucket to 2026-06-09, got {result['session_date']!r}"
    )

    # Two messages, each input=10, output=5, cache_read=100, cache_create=50
    assert result["input_tokens"] == 20
    assert result["output_tokens"] == 10
    assert result["cache_read"] == 200
    assert result["cache_create"] == 100
    assert result["api_requests"] == 2


def test_parse_codex_rollout_maps_cached_input():
    """
    Codex rollout files expose total input plus cached input. token_sessions
    stores non-cached input separately from cache_read, so the collector must
    subtract cached input before upsert.
    """
    collect = _import_collect()

    result = collect.parse_codex_rollout(CODEX_SESSION)

    assert result is not None
    assert result["input_tokens"] == 1000
    assert result["cache_read"] == 500
    assert result["cache_create"] == 0
    assert result["output_tokens"] == 90
    assert result["api_requests"] == 2


def test_collect_codex_upserts_correct_record_shape(tmp_path):
    """
    Codex collection writes first-class token_sessions rows with agent='codex'
    and fidelity='exact'.
    """
    collect = _import_collect()

    rollout = tmp_path / "codex_session.jsonl"
    shutil.copy(CODEX_SESSION, rollout)
    state_db = make_codex_state_db(tmp_path, rollout)
    state_file = tmp_path / ".collect-state.json"

    captured_records = []

    mock_sb = MagicMock()
    mock_execute = MagicMock()
    mock_execute.return_value.error = None

    def capture_upsert(record, **kwargs):
        captured_records.append(record)
        return mock_execute

    mock_sb.schema.return_value.table.return_value.upsert = capture_upsert

    with patch.object(collect, "STATE_FILE", state_file):
        with patch("collect.create_client", return_value=mock_sb):
            with patch.dict(os.environ, {
                "SUPABASE_URL": "https://fake.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "fake-key",
            }):
                collect.collect_codex(state_db, machine="lumen", dry_run=False, verbose=False)

    assert len(captured_records) == 1
    rec = captured_records[0]
    assert rec["session_id"] == "codex-019ed498-test"
    assert rec["machine"] == "lumen"
    assert rec["agent"] == "codex"
    assert rec["fidelity"] == "exact"
    assert rec["session_date"] == "2026-06-17"
    assert rec["input_tokens"] == 1000
    assert rec["cache_read"] == 500
    assert rec["cache_create"] == 0
    assert rec["output_tokens"] == 90
    assert rec["api_requests"] == 2


def test_collect_codex_respects_min_session_date(tmp_path):
    """
    Codex collection can be constrained to today's date so adding Codex does not
    mutate historic daily aggregates by default.
    """
    collect = _import_collect()

    rollout = tmp_path / "codex_session.jsonl"
    shutil.copy(CODEX_SESSION, rollout)
    state_db = make_codex_state_db(tmp_path, rollout, created_at=1781596804)
    state_file = tmp_path / ".collect-state.json"

    mock_sb = MagicMock()
    mock_execute = MagicMock()
    mock_execute.return_value.error = None
    mock_sb.table.return_value.upsert.return_value = mock_execute

    with patch.object(collect, "STATE_FILE", state_file):
        with patch("collect.create_client", return_value=mock_sb):
            with patch.dict(os.environ, {
                "SUPABASE_URL": "https://fake.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "fake-key",
            }):
                collect.collect_codex(
                    state_db,
                    machine="lumen",
                    dry_run=False,
                    verbose=False,
                    min_session_date="2026-06-17",
                )

    mock_sb.table.return_value.upsert.assert_not_called()


# ---------------------------------------------------------------------------
# AC-5.3 — Content-hash dedup: unchanged files produce zero upsert calls
# ---------------------------------------------------------------------------

def test_ac5_3_dedup_unchanged_files_skips_upsert(tmp_path):
    """
    AC-5.3: Running collect() twice on the same JSONL files results in zero
    Supabase upsert calls on the second run (content-hash dedup).
    """
    collect = _import_collect()

    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)

    # Redirect STATE_FILE to tmp_path so we don't pollute the repo
    state_file = tmp_path / ".collect-state.json"

    mock_sb = MagicMock()
    mock_table = MagicMock()
    mock_upsert = MagicMock()
    mock_execute = MagicMock()
    mock_execute.return_value.error = None
    mock_upsert.return_value.execute = mock_execute
    mock_table.return_value.upsert = mock_upsert
    mock_sb.schema.return_value.table = mock_table

    with patch.object(collect, "STATE_FILE", state_file):
        with patch("collect.create_client", return_value=mock_sb):
            with patch.dict(os.environ, {
                "SUPABASE_URL": "https://fake.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "fake-key",
            }):
                # First run: should upsert
                collect.collect(sessions_root, machine="cadence", dry_run=False, verbose=False)
                calls_after_first = mock_execute.call_count

                # Second run: files unchanged — must NOT upsert again
                collect.collect(sessions_root, machine="cadence", dry_run=False, verbose=False)
                calls_after_second = mock_execute.call_count

    assert calls_after_first >= 1, "First run should have upserted at least one record"
    assert calls_after_second == calls_after_first, (
        f"Second run on unchanged files should not trigger new upserts "
        f"(first={calls_after_first}, second={calls_after_second})"
    )


# ---------------------------------------------------------------------------
# AC-5.4 — Modified JSONL triggers re-upsert
# ---------------------------------------------------------------------------

def test_ac5_4_modified_file_triggers_reupsert(tmp_path):
    """
    AC-5.4: After a file's content hash changes, the next collect() run
    upserts new totals to Supabase.
    """
    collect = _import_collect()

    sessions_root = tmp_path / "sessions"
    proj = sessions_root / "proj"
    proj.mkdir(parents=True)
    session_file = proj / "my_session.jsonl"
    shutil.copy(SIMPLE_SESSION, session_file)

    state_file = tmp_path / ".collect-state.json"

    mock_sb = MagicMock()
    mock_execute = MagicMock()
    mock_execute.return_value.error = None
    mock_sb.schema.return_value.table.return_value.upsert.return_value.execute = mock_execute

    with patch.object(collect, "STATE_FILE", state_file):
        with patch("collect.create_client", return_value=mock_sb):
            with patch.dict(os.environ, {
                "SUPABASE_URL": "https://fake.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "fake-key",
            }):
                # First run
                collect.collect(sessions_root, machine="cadence", dry_run=False, verbose=False)
                count_after_first = mock_execute.call_count

                # Modify the file (append a new assistant message)
                extra_line = (
                    '{"type":"assistant","timestamp":"2026-06-09T16:00:00.000Z",'
                    '"uuid":"mod00001-0001-0001-0001-000000000001",'
                    '"parentUuid":"aaaaaaaa-0001-0001-0001-000000000001",'
                    '"sessionId":"my_session","message":{"id":"msg_mod1","type":"message",'
                    '"role":"assistant","model":"claude-opus-4-5","content":[],'
                    '"stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":5,'
                    '"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n'
                )
                with open(session_file, "a") as f:
                    f.write(extra_line)

                # Second run after modification
                collect.collect(sessions_root, machine="cadence", dry_run=False, verbose=False)
                count_after_second = mock_execute.call_count

    assert count_after_second > count_after_first, (
        "Modified file should trigger a new upsert on the second run"
    )


# ---------------------------------------------------------------------------
# AC-5.5 — Malformed JSONL lines are skipped gracefully
# ---------------------------------------------------------------------------

def test_ac5_5_malformed_jsonl_lines_skipped():
    """
    AC-5.5: parse_session on malformed_session.jsonl skips the bad line and
    still returns data from the valid assistant record.
    Valid assistant record: input=50, output=25, cache_read=500, cache_create=250
    """
    collect = _import_collect()

    result = collect.parse_session(MALFORMED_SESSION)

    assert result is not None, (
        "parse_session should return data despite a malformed line"
    )
    assert result["input_tokens"] == 50
    assert result["output_tokens"] == 25
    assert result["cache_read"] == 500
    assert result["cache_create"] == 250


def test_ac5_5_malformed_jsonl_warning_on_stderr(tmp_path, capsys):
    """
    AC-5.5: When a malformed line is encountered, a warning is printed to stderr.
    """
    collect = _import_collect()

    # Capture stderr by calling parse_session and checking stderr output
    import io
    from unittest.mock import patch as upatch
    import sys as _sys

    buf = io.StringIO()
    with upatch("sys.stderr", buf):
        collect.parse_session(MALFORMED_SESSION)

    stderr_output = buf.getvalue()
    assert stderr_output.strip() != "", (
        "Expected a warning on stderr for malformed JSON line"
    )
    assert any(word in stderr_output.lower() for word in ("malformed", "warning", "error")), (
        f"Warning message not found in stderr: {stderr_output!r}"
    )


# ---------------------------------------------------------------------------
# AC-5.6 — No output file written (no daily-burn.json)
# ---------------------------------------------------------------------------

def test_ac5_6_no_output_file_written(tmp_path):
    """
    AC-5.6: collect.py does not write public/data/daily-burn.json.
    Running collect (dry-run) must not create any JSON output file.
    """
    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    output_path = tmp_path / "public" / "data" / "daily-burn.json"

    env = os.environ.copy()
    env.pop("SUPABASE_URL", None)
    env.pop("SUPABASE_SERVICE_ROLE_KEY", None)

    subprocess.run(
        [sys.executable, str(COLLECT_PY), "--sessions-root", str(sessions_root), "--dry-run"],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(tmp_path),
    )

    assert not output_path.exists(), (
        f"collect.py wrote {output_path} — v2 must not write any JSON output file"
    )

    # Also verify the real repo public/data/daily-burn.json does not exist
    repo_output = REPO_ROOT / "public" / "data" / "daily-burn.json"
    assert not repo_output.exists(), (
        f"public/data/daily-burn.json exists in repo — AC-5.6 requires it not to exist"
    )


# ---------------------------------------------------------------------------
# file_hash tests
# ---------------------------------------------------------------------------

def test_file_hash_deterministic():
    """file_hash returns the same value for the same file content."""
    collect = _import_collect()

    h1 = collect.file_hash(SIMPLE_SESSION)
    h2 = collect.file_hash(SIMPLE_SESSION)
    assert h1 == h2, "file_hash must be deterministic"


def test_file_hash_differs_for_different_content(tmp_path):
    """file_hash returns different values for files with different content."""
    collect = _import_collect()

    f1 = tmp_path / "a.jsonl"
    f2 = tmp_path / "b.jsonl"
    f1.write_text('{"type": "user"}\n')
    f2.write_text('{"type": "assistant"}\n')

    assert collect.file_hash(f1) != collect.file_hash(f2)


def test_file_hash_is_sha256(tmp_path):
    """file_hash produces a valid SHA-256 hex digest (64 hex chars)."""
    collect = _import_collect()

    f = tmp_path / "test.jsonl"
    f.write_text("hello\n")
    h = collect.file_hash(f)

    assert len(h) == 64, f"Expected 64-char SHA-256 hex digest, got {len(h)} chars"
    assert all(c in "0123456789abcdef" for c in h), "Hash must be lowercase hex"

    # Verify correctness
    expected = hashlib.sha256(b"hello\n").hexdigest()
    assert h == expected


# ---------------------------------------------------------------------------
# load_state / save_state tests
# ---------------------------------------------------------------------------

def test_load_state_returns_empty_dict_when_missing(tmp_path):
    """load_state returns {} when .collect-state.json does not exist."""
    collect = _import_collect()

    state_file = tmp_path / ".collect-state.json"
    with patch.object(collect, "STATE_FILE", state_file):
        state = collect.load_state()

    assert state == {}, f"Expected empty dict, got {state}"


def test_load_state_returns_empty_dict_on_corrupt_json(tmp_path):
    """load_state returns {} when the state file contains invalid JSON."""
    collect = _import_collect()

    state_file = tmp_path / ".collect-state.json"
    state_file.write_text("{broken json here")

    with patch.object(collect, "STATE_FILE", state_file):
        state = collect.load_state()

    assert state == {}, f"Expected empty dict on corrupt JSON, got {state}"


def test_save_and_load_state_roundtrip(tmp_path):
    """save_state writes and load_state reads back the same dict."""
    collect = _import_collect()

    state_file = tmp_path / ".collect-state.json"
    original = {
        "cadence:/path/to/session1.jsonl": "abc123",
        "cadence:/path/to/session2.jsonl": "def456",
    }

    with patch.object(collect, "STATE_FILE", state_file):
        collect.save_state(original)
        loaded = collect.load_state()

    assert loaded == original, f"Roundtrip failed: {loaded} != {original}"


# ---------------------------------------------------------------------------
# parse_session edge cases
# ---------------------------------------------------------------------------

def test_parse_session_returns_none_for_empty_file(tmp_path):
    """parse_session returns None for a file with no usable timestamps."""
    collect = _import_collect()

    empty = tmp_path / "empty.jsonl"
    empty.write_text("")

    result = collect.parse_session(empty)
    assert result is None, "parse_session should return None for an empty file"


def test_parse_session_returns_none_for_no_assistant_records(tmp_path):
    """
    parse_session returns None if there are no assistant records with usage data.
    A file with only user messages has a timestamp but no token data.
    Note: session_date is extracted even without assistant messages,
    but the function returns None only if no first_ts found.
    A file with a user message but no assistant records should still return
    something (the timestamp is there) but with zero tokens — verify behavior.
    """
    collect = _import_collect()

    user_only = tmp_path / "user_only.jsonl"
    user_only.write_text(
        '{"type":"user","timestamp":"2026-06-09T14:00:00.000Z",'
        '"uuid":"test-0001","parentUuid":null,"sessionId":"user-only",'
        '"message":{"role":"user","content":[{"type":"text","text":"Hi"}]}}\n'
    )

    result = collect.parse_session(user_only)
    # A user-only file has a timestamp, so parse_session returns a dict with 0 tokens
    # OR returns None — either is acceptable as long as it doesn't crash
    # The key invariant: must not raise an exception
    assert result is None or isinstance(result, dict), (
        "parse_session should return None or dict, not raise"
    )


def test_parse_session_session_id_from_filename(tmp_path):
    """parse_session uses the file stem (filename without extension) as session_id."""
    collect = _import_collect()

    result = collect.parse_session(SIMPLE_SESSION)
    assert result is not None
    assert result["session_id"] == SIMPLE_SESSION.stem


# ---------------------------------------------------------------------------
# collect() dry-run behavior
# ---------------------------------------------------------------------------

def test_collect_dry_run_does_not_call_supabase(tmp_path):
    """
    collect() with dry_run=True never calls create_client or table.upsert.
    """
    collect = _import_collect()

    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    state_file = tmp_path / ".collect-state.json"

    with patch.object(collect, "STATE_FILE", state_file):
        with patch("collect.create_client") as mock_create_client:
            collect.collect(sessions_root, machine="cadence", dry_run=True, verbose=False)

    mock_create_client.assert_not_called(), "create_client must not be called in dry_run mode"


def test_collect_dry_run_state_behavior(tmp_path):
    """
    collect() with dry_run=True updates in-memory state (per-file hash) during
    the run but does NOT write .collect-state.json to disk (nothing written in
    dry_run mode). This mirrors the implementation: dry_run continues after
    updating the hash but never calls save_state().

    The practical implication: dry_run re-scans all files on each invocation.
    This test verifies no state file is written (implementation behavior).
    """
    collect = _import_collect()

    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    state_file = tmp_path / ".collect-state.json"

    with patch.object(collect, "STATE_FILE", state_file):
        collect.collect(sessions_root, machine="cadence", dry_run=True, verbose=False)

    # dry_run does NOT persist state — state file should NOT exist
    # (collect.py only calls save_state() in the non-dry-run branch)
    assert not state_file.exists(), (
        ".collect-state.json must NOT be written during dry_run "
        "(save_state is only called in the non-dry-run branch)"
    )


def test_collect_requires_credentials_when_not_dry_run():
    """
    collect() without dry_run exits with error if credentials are missing.
    We test this via the collect() function directly with mocked env vars
    (using subprocess is unreliable because a .env file at the project root
    may provide real credentials to the subprocess).
    """
    collect = _import_collect()

    sessions_root = FIXTURES_DIR  # any directory with JSONL files

    # Patch STATE_FILE to avoid writing to repo root
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        state_file = Path(td) / ".collect-state.json"
        with patch.object(collect, "STATE_FILE", state_file):
            # Explicitly clear both credential env vars
            with patch.dict(os.environ, {
                "SUPABASE_URL": "",
                "SUPABASE_SERVICE_ROLE_KEY": "",
            }):
                # Temporarily unset the vars (patch.dict with empty strings doesn't unset)
                env_backup_url = os.environ.pop("SUPABASE_URL", None)
                env_backup_key = os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)
                try:
                    with pytest.raises(SystemExit) as exc_info:
                        collect.collect(
                            sessions_root,
                            machine="cadence",
                            dry_run=False,
                            verbose=False,
                        )
                    assert exc_info.value.code != 0, (
                        "collect() should sys.exit(1) when credentials are missing"
                    )
                finally:
                    if env_backup_url is not None:
                        os.environ["SUPABASE_URL"] = env_backup_url
                    if env_backup_key is not None:
                        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = env_backup_key


def test_collect_upserts_correct_record_shape(tmp_path):
    """
    collect() with a live (mocked) Supabase client upserts a record with
    the correct fields: session_id, machine, agent, fidelity, session_date,
    input_tokens, output_tokens, cache_read, cache_create, api_requests.
    """
    collect = _import_collect()

    sessions_root = make_session_dir(tmp_path, SIMPLE_SESSION)
    state_file = tmp_path / ".collect-state.json"

    captured_records = []

    mock_sb = MagicMock()
    mock_execute = MagicMock()
    mock_execute.return_value.error = None

    def capture_upsert(record, **kwargs):
        captured_records.append(record)
        return mock_execute

    mock_sb.schema.return_value.table.return_value.upsert = capture_upsert

    with patch.object(collect, "STATE_FILE", state_file):
        with patch("collect.create_client", return_value=mock_sb):
            with patch.dict(os.environ, {
                "SUPABASE_URL": "https://fake.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "fake-key",
            }):
                collect.collect(sessions_root, machine="cadence", dry_run=False, verbose=False)

    assert len(captured_records) >= 1, "Should have upserted at least one record"

    rec = captured_records[0]
    required_fields = {
        "session_id", "session_date", "machine", "agent", "fidelity",
        "input_tokens", "output_tokens", "cache_read", "cache_create", "api_requests",
    }
    missing = required_fields - set(rec.keys())
    assert not missing, f"Upserted record missing fields: {missing}"

    assert rec["machine"] == "cadence"
    assert rec["agent"] == "claude-code"
    assert rec["fidelity"] == "exact"
    assert rec["session_id"] == "simple_session"
    assert rec["session_date"] == "2026-06-09"
    assert rec["input_tokens"] == 300
    assert rec["output_tokens"] == 150
    assert rec["cache_read"] == 3000
    assert rec["cache_create"] == 1500
    assert rec["api_requests"] == 2


# ---------------------------------------------------------------------------
# AC-9.1, AC-9.2, AC-9.3 — File cleanup (repo-level static checks)
# ---------------------------------------------------------------------------

def test_ac9_1_daily_burn_json_not_in_repo():
    """AC-9.1: public/data/daily-burn.json does not exist in the repo."""
    target = REPO_ROOT / "public" / "data" / "daily-burn.json"
    assert not target.exists(), (
        f"AC-9.1 FAIL: {target} exists — v2 must not commit this file"
    )


def test_ac9_2_session_contributions_json_not_in_repo():
    """AC-9.2: public/data/session-contributions.json does not exist."""
    target = REPO_ROOT / "public" / "data" / "session-contributions.json"
    assert not target.exists(), (
        f"AC-9.2 FAIL: {target} exists — must be removed for v2"
    )


def test_ac9_3_session_hashes_json_not_in_repo():
    """AC-9.3: public/data/session-hashes.json does not exist."""
    target = REPO_ROOT / "public" / "data" / "session-hashes.json"
    assert not target.exists(), (
        f"AC-9.3 FAIL: {target} exists — must be removed for v2"
    )


# ---------------------------------------------------------------------------
# AC-8.10 — useTokenData.ts does not reference /data/daily-burn.json
# ---------------------------------------------------------------------------

def test_ac8_10_use_token_data_no_daily_burn_reference():
    """
    AC-8.10: src/hooks/useTokenData.ts must not reference /data/daily-burn.json.
    """
    hook_file = REPO_ROOT / "src" / "hooks" / "useTokenData.ts"
    assert hook_file.exists(), f"useTokenData.ts not found at {hook_file}"

    content = hook_file.read_text()
    assert "daily-burn.json" not in content, (
        "AC-8.10 FAIL: useTokenData.ts still references /data/daily-burn.json"
    )
    assert "/api/daily" in content, (
        "AC-8.10: useTokenData.ts should reference /api/daily"
    )
    assert "/api/sessions" in content, (
        "AC-8.10: useTokenData.ts should reference /api/sessions"
    )
