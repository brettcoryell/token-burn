#!/usr/bin/env python3
"""
Token Burn Collector v2
Scans Claude Code JSONL session files → upserts to Supabase token_sessions table.

Dedup: content hash stored in .collect-state.json (gitignored) to skip unchanged files.
Idempotency: Supabase ON CONFLICT (session_id, machine) DO UPDATE ensures re-runs are safe.
"""

import argparse
import json
import sys
import hashlib
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from supabase import create_client, Client
except ImportError:
    print("[collect] ERROR: supabase package not installed. Run: pip3 install supabase", file=sys.stderr)
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass  # dotenv optional; env vars may be set directly

LOCAL_TZ = ZoneInfo("America/Denver")
STATE_FILE = Path(__file__).parent.parent / ".collect-state.json"
CODEX_STATE_DB = Path.home() / ".codex" / "state_5.sqlite"


# ---------------------------------------------------------------------------
# File-level helpers
# ---------------------------------------------------------------------------

def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def parse_session(path: Path) -> dict | None:
    """
    Parse a JSONL session file.
    Returns token dict or None if no usable data.
    Buckets by first timestamp in the file (Mountain time).
    Malformed lines are skipped with a stderr warning.
    """
    input_tokens = 0
    output_tokens = 0
    cache_read = 0
    cache_create = 0
    api_requests = 0
    first_ts: str | None = None

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                print(f"[collect] WARNING: malformed line in {path.name}: {exc}", file=sys.stderr)
                continue

            if first_ts is None:
                ts = record.get("timestamp")
                if ts:
                    first_ts = ts

            if record.get("type") != "assistant":
                continue
            msg = record.get("message")
            if not isinstance(msg, dict):
                continue
            usage = msg.get("usage")
            if not isinstance(usage, dict):
                continue

            input_tokens += usage.get("input_tokens", 0)
            output_tokens += usage.get("output_tokens", 0)
            cache_read += usage.get("cache_read_input_tokens", 0)
            cache_create += usage.get("cache_creation_input_tokens", 0)
            api_requests += 1

    if first_ts is None:
        return None

    try:
        dt_utc = datetime.fromisoformat(first_ts.replace("Z", "+00:00"))
        date_str = dt_utc.astimezone(LOCAL_TZ).strftime("%Y-%m-%d")
    except (ValueError, TypeError) as exc:
        print(f"[collect] WARNING: bad timestamp in {path.name}: {exc}", file=sys.stderr)
        return None

    return {
        "session_id":   path.stem,
        "session_date": date_str,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_read":   cache_read,
        "cache_create": cache_create,
        "api_requests": api_requests,
    }


def parse_codex_rollout(path: Path) -> dict | None:
    """
    Parse a Codex rollout JSONL file without reading conversational content.
    Uses the latest token_count event's total_token_usage.
    """
    latest_usage: dict | None = None
    api_requests = 0

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                print(f"[collect] WARNING: malformed line in {path.name}: {exc}", file=sys.stderr)
                continue

            payload = record.get("payload")
            if not isinstance(payload, dict) or payload.get("type") != "token_count":
                continue

            info = payload.get("info")
            if not isinstance(info, dict):
                continue
            usage = info.get("total_token_usage")
            if not isinstance(usage, dict):
                continue

            latest_usage = usage
            api_requests += 1

    if latest_usage is None:
        return None

    input_total = int(latest_usage.get("input_tokens", 0) or 0)
    cache_read = int(latest_usage.get("cached_input_tokens", 0) or 0)
    output_tokens = int(latest_usage.get("output_tokens", 0) or 0)

    return {
        "input_tokens": max(input_total - cache_read, 0),
        "output_tokens": output_tokens,
        "cache_read": cache_read,
        "cache_create": 0,
        "api_requests": api_requests,
    }


# ---------------------------------------------------------------------------
# State file: content-hash dedup
# ---------------------------------------------------------------------------

def load_state() -> dict[str, str]:
    """Returns {path_key: hash} map."""
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text())
    except json.JSONDecodeError:
        return {}


def save_state(state: dict[str, str]) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True))


def codex_threads(state_db: Path) -> list[sqlite3.Row]:
    if not state_db.exists():
        print(f"[collect] ERROR: Codex state DB not found: {state_db}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(f"file:{state_db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        return list(conn.execute(
            """
            SELECT id, rollout_path, created_at, tokens_used, model, cwd
            FROM threads
            WHERE tokens_used > 0
              AND rollout_path <> ''
              AND COALESCE(model, '') <> 'codex-auto-review'
              AND source NOT LIKE '{"subagent"%'
              AND COALESCE(thread_source, 'user') = 'user'
            ORDER BY created_at ASC
            """
        ))
    finally:
        conn.close()


def codex_session_from_thread(row: sqlite3.Row) -> dict | None:
    rollout_path = Path(row["rollout_path"])
    if not rollout_path.exists():
        print(f"[collect] WARNING: Codex rollout file missing: {rollout_path}", file=sys.stderr)
        return None

    usage = parse_codex_rollout(rollout_path)
    if usage is None:
        return None

    try:
        date_str = (
            datetime.fromtimestamp(int(row["created_at"]), tz=ZoneInfo("UTC"))
            .astimezone(LOCAL_TZ)
            .strftime("%Y-%m-%d")
        )
    except (ValueError, TypeError, OSError) as exc:
        print(f"[collect] WARNING: bad Codex timestamp for {row['id']}: {exc}", file=sys.stderr)
        return None

    return {
        "session_id": f"codex-{row['id']}",
        "session_date": date_str,
        **usage,
        "notes": f"Codex session via {row['model'] or 'unknown model'} in {row['cwd']}"[:500],
    }


def existing_session_on_other_machine(sb: Client, session_id: str, machine: str) -> dict | None:
    """
    Session IDs are globally unique for Claude/Codex telemetry files. If a
    session already exists under another machine, collecting it again would
    double-count the same work because the table's conflict key includes machine.
    """
    try:
        result = (
            sb.schema("token_burn").table("token_sessions")
            .select("session_id,machine,session_date,total_tokens")
            .eq("session_id", session_id)
            .neq("machine", machine)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - defensive network/client guard
        print(
            f"[collect] WARNING: could not check existing session {session_id}: {exc}",
            file=sys.stderr,
        )
        return None

    data = getattr(result, "data", None)
    if isinstance(data, list) and data:
        return data[0]
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def collect(
    sessions_root: Path,
    machine: str,
    dry_run: bool,
    verbose: bool,
) -> None:
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not dry_run and (not supabase_url or not supabase_key):
        print(
            "[collect] ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n"
            "  Create a .env file at the project root or export them as env vars.",
            file=sys.stderr,
        )
        sys.exit(1)

    sb: Client | None = None
    if not dry_run:
        sb = create_client(supabase_url, supabase_key)  # type: ignore[arg-type]

    state = load_state()
    jsonl_files = sorted(sessions_root.glob("**/*.jsonl"))
    new_or_changed = 0
    upserted = 0

    for path in jsonl_files:
        path_key = f"{machine}:{path}"
        current_hash = file_hash(path)

        if state.get(path_key) == current_hash:
            continue  # Unchanged — skip

        session = parse_session(path)
        if session is None:
            state[path_key] = current_hash  # Mark as processed even if no data
            continue

        new_or_changed += 1

        if verbose:
            total = (
                session["input_tokens"] + session["output_tokens"]
                + session["cache_read"] + session["cache_create"]
            )
            print(
                f"{path.stem}  {session['session_date']}  "
                f"total={total:,}  api_requests={session['api_requests']}"
            )

        if dry_run:
            state[path_key] = current_hash
            continue

        existing = existing_session_on_other_machine(sb, session["session_id"], machine)  # type: ignore[arg-type]
        if existing:
            print(
                f"[collect] WARNING: skipping {session['session_id']} for machine={machine}; "
                f"already collected as machine={existing.get('machine')} on {existing.get('session_date')}",
                file=sys.stderr,
            )
            state[path_key] = current_hash
            continue

        record = {
            **session,
            "machine":     machine,
            "agent":       "claude-code",
            "fidelity":    "exact",
            "updated_at":  datetime.now().isoformat(),
        }

        result = (
            sb.schema("token_burn").table("token_sessions")  # type: ignore[union-attr]
            .upsert(record, on_conflict="session_id,machine")
            .execute()
        )

        if hasattr(result, "error") and result.error:
            print(f"[collect] ERROR upserting {path.stem}: {result.error}", file=sys.stderr)
        else:
            state[path_key] = current_hash
            upserted += 1

    if dry_run:
        print(
            f"[collect] DRY RUN — {len(jsonl_files)} files scanned, "
            f"{new_or_changed} new/changed (nothing written)"
        )
    else:
        print(
            f"[collect] {len(jsonl_files)} files scanned → "
            f"{new_or_changed} new/changed → {upserted} upserted to Supabase"
        )
        save_state(state)


def collect_codex(
    state_db: Path,
    machine: str,
    dry_run: bool,
    verbose: bool,
    min_session_date: str | None = None,
) -> None:
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not dry_run and (not supabase_url or not supabase_key):
        print(
            "[collect] ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n"
            "  Create a .env file at the project root or export them as env vars.",
            file=sys.stderr,
        )
        sys.exit(1)

    sb: Client | None = None
    if not dry_run:
        sb = create_client(supabase_url, supabase_key)  # type: ignore[arg-type]

    state = load_state()
    rows = codex_threads(state_db)
    new_or_changed = 0
    upserted = 0

    for row in rows:
        rollout_path = Path(row["rollout_path"])
        current_hash = file_hash(rollout_path) if rollout_path.exists() else str(row["tokens_used"])
        path_key = f"{machine}:codex:{row['id']}"

        if state.get(path_key) == current_hash:
            continue

        session = codex_session_from_thread(row)
        if session is None:
            state[path_key] = current_hash
            continue

        if min_session_date and session["session_date"] < min_session_date:
            continue

        new_or_changed += 1

        if verbose:
            total = (
                session["input_tokens"] + session["output_tokens"]
                + session["cache_read"] + session["cache_create"]
            )
            print(
                f"{session['session_id']}  {session['session_date']}  "
                f"total={total:,}  api_requests={session['api_requests']}"
            )

        if dry_run:
            state[path_key] = current_hash
            continue

        existing = existing_session_on_other_machine(sb, session["session_id"], machine)  # type: ignore[arg-type]
        if existing:
            print(
                f"[collect] WARNING: skipping {session['session_id']} for machine={machine}; "
                f"already collected as machine={existing.get('machine')} on {existing.get('session_date')}",
                file=sys.stderr,
            )
            state[path_key] = current_hash
            continue

        record = {
            **session,
            "machine":     machine,
            "agent":       "codex",
            "fidelity":    "exact",
            "updated_at":  datetime.now().isoformat(),
        }

        result = (
            sb.schema("token_burn").table("token_sessions")  # type: ignore[union-attr]
            .upsert(record, on_conflict="session_id,machine")
            .execute()
        )

        if hasattr(result, "error") and result.error:
            print(f"[collect] ERROR upserting {session['session_id']}: {result.error}", file=sys.stderr)
        else:
            state[path_key] = current_hash
            upserted += 1

    if dry_run:
        print(
            f"[collect] DRY RUN — {len(rows)} Codex threads scanned, "
            f"{new_or_changed} new/changed (nothing written)"
        )
    else:
        print(
            f"[collect] {len(rows)} Codex threads scanned → "
            f"{new_or_changed} new/changed → {upserted} upserted to Supabase"
        )
        save_state(state)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Collect AI token usage → upsert to Supabase"
    )
    parser.add_argument(
        "--source",
        choices=("claude-code", "codex"),
        default="claude-code",
    )
    parser.add_argument(
        "--sessions-root",
        type=Path,
        default=Path.home() / ".claude" / "projects",
    )
    parser.add_argument(
        "--codex-state-db",
        type=Path,
        default=CODEX_STATE_DB,
    )
    parser.add_argument(
        "--codex-min-date",
        default=None,
        help="Skip Codex sessions before this YYYY-MM-DD date.",
    )
    parser.add_argument("--machine", default="cadence")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if args.source == "codex":
        collect_codex(
            state_db=args.codex_state_db,
            machine=args.machine,
            dry_run=args.dry_run,
            verbose=args.verbose,
            min_session_date=args.codex_min_date,
        )
    else:
        collect(
            sessions_root=args.sessions_root,
            machine=args.machine,
            dry_run=args.dry_run,
            verbose=args.verbose,
        )


if __name__ == "__main__":
    main()
