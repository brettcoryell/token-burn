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

PACIFIC = ZoneInfo("America/Los_Angeles")
STATE_FILE = Path(__file__).parent.parent / ".collect-state.json"


# ---------------------------------------------------------------------------
# File-level helpers
# ---------------------------------------------------------------------------

def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def parse_session(path: Path) -> dict | None:
    """
    Parse a JSONL session file.
    Returns token dict or None if no usable data.
    Buckets by first timestamp in the file (Pacific time).
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
        date_str = dt_utc.astimezone(PACIFIC).strftime("%Y-%m-%d")
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

        record = {
            **session,
            "machine":     machine,
            "agent":       "claude-code",
            "fidelity":    "exact",
            "updated_at":  datetime.now().isoformat(),
        }

        result = (
            sb.table("token_sessions")  # type: ignore[union-attr]
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


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Collect Claude Code token usage → upsert to Supabase"
    )
    parser.add_argument(
        "--sessions-root",
        type=Path,
        default=Path.home() / ".claude" / "projects",
    )
    parser.add_argument("--machine", default="cadence")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    collect(
        sessions_root=args.sessions_root,
        machine=args.machine,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )


if __name__ == "__main__":
    main()
