#!/usr/bin/env python3
"""
Token Burn Collector
Scans Claude Code JSONL session files → writes public/data/daily-burn.json

Schema (closed — 14 fields exactly):
  date, claude_code_input, claude_code_output, claude_code_cache_read,
  claude_code_cache_create, claude_code_api_requests, claude_code_sessions,
  claude_chat_sessions, claude_chat_est, total_exact, total_est, sources,
  driver, evidence
"""

import argparse
import json
import sys
import hashlib
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

PACIFIC = ZoneInfo("America/Los_Angeles")
DEFAULT_CHAT_TOKENS = 75_000

SCHEMA_KEYS = frozenset({
    "date", "claude_code_input", "claude_code_output",
    "claude_code_cache_read", "claude_code_cache_create",
    "claude_code_api_requests", "claude_code_sessions",
    "claude_chat_sessions", "claude_chat_est",
    "total_exact", "total_est", "sources", "driver", "evidence",
})


# ---------------------------------------------------------------------------
# File-level helpers
# ---------------------------------------------------------------------------

def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def parse_session(path: Path) -> dict | None:
    """
    Parse a JSONL session file.
    Returns token dict or None if the file has no usable data.
    Bucketing by first timestamp in the file (Pacific time).
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
        "date": date_str,
        "input": input_tokens,
        "output": output_tokens,
        "cache_read": cache_read,
        "cache_create": cache_create,
        "api_requests": api_requests,
    }


# ---------------------------------------------------------------------------
# Sidecar: per-file contribution tracking
# ---------------------------------------------------------------------------

def load_contributions(output_path: Path) -> dict[str, dict]:
    """
    Load the sidecar file that records each session file's last-known contribution.
    Key: "<machine>:<absolute_path>"
    Value: {hash, date, input, output, cache_read, cache_create, api_requests}
    """
    sidecar = output_path.parent / "session-contributions.json"
    if not sidecar.exists():
        return {}
    try:
        return json.loads(sidecar.read_text())
    except json.JSONDecodeError:
        return {}


def save_contributions(output_path: Path, contributions: dict[str, dict]) -> None:
    sidecar = output_path.parent / "session-contributions.json"
    sidecar.write_text(json.dumps(contributions, indent=2, sort_keys=True))


# ---------------------------------------------------------------------------
# Annotations
# ---------------------------------------------------------------------------

def load_annotations(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        print(f"[collect] WARNING: could not parse {path}", file=sys.stderr)
        return {}


# ---------------------------------------------------------------------------
# Core aggregation
# ---------------------------------------------------------------------------

def build_daily_totals(
    contributions: dict[str, dict],
) -> dict[str, dict]:
    """Recompute daily totals from all per-file contributions."""
    daily: dict[str, dict] = {}
    for contrib in contributions.values():
        date = contrib["date"]
        machine = contrib["machine"]
        if date not in daily:
            daily[date] = {
                "claude_code_input": 0,
                "claude_code_output": 0,
                "claude_code_cache_read": 0,
                "claude_code_cache_create": 0,
                "claude_code_api_requests": 0,
                "claude_code_sessions": 0,
                "sources": [],
            }
        d = daily[date]
        d["claude_code_input"] += contrib["input"]
        d["claude_code_output"] += contrib["output"]
        d["claude_code_cache_read"] += contrib["cache_read"]
        d["claude_code_cache_create"] += contrib["cache_create"]
        d["claude_code_api_requests"] += contrib["api_requests"]
        d["claude_code_sessions"] += 1
        if machine not in d["sources"]:
            d["sources"].append(machine)
    return daily


def finalize_rows(
    daily: dict[str, dict],
    annotations: dict[str, dict],
    chat_tokens_per_session: int,
) -> list[dict]:
    """Apply annotations, compute derived fields, enforce schema."""
    rows = []
    for date in sorted(daily.keys()):
        d = daily[date]
        ann = annotations.get(date, {})
        chat_sessions = int(ann.get("claude_chat_sessions", 0))
        chat_est = chat_sessions * chat_tokens_per_session
        total_exact = (
            d["claude_code_input"]
            + d["claude_code_output"]
            + d["claude_code_cache_read"]
            + d["claude_code_cache_create"]
        )
        row = {
            "date": date,
            "claude_code_input": d["claude_code_input"],
            "claude_code_output": d["claude_code_output"],
            "claude_code_cache_read": d["claude_code_cache_read"],
            "claude_code_cache_create": d["claude_code_cache_create"],
            "claude_code_api_requests": d["claude_code_api_requests"],
            "claude_code_sessions": d["claude_code_sessions"],
            "claude_chat_sessions": chat_sessions,
            "claude_chat_est": chat_est,
            "total_exact": total_exact,
            "total_est": chat_est,
            "sources": sorted(d["sources"]),
            "driver": ann.get("driver", ""),
            "evidence": ann.get("evidence", "")[:200],
        }
        assert set(row.keys()) == SCHEMA_KEYS, (
            f"Schema violation on {date}: unexpected keys "
            f"{set(row.keys()) ^ SCHEMA_KEYS}"
        )
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def collect(
    sessions_root: Path,
    machine: str,
    chat_tokens_per_session: int,
    annotations_path: Path,
    output_path: Path,
    dry_run: bool,
    verbose: bool,
) -> None:
    contributions = load_contributions(output_path)
    annotations = load_annotations(annotations_path)

    jsonl_files = sorted(sessions_root.glob("**/*.jsonl"))
    new_or_changed = 0
    dates_touched: set[str] = set()

    for path in jsonl_files:
        path_key = f"{machine}:{path}"
        current_hash = file_hash(path)
        existing = contributions.get(path_key, {})

        if existing.get("hash") == current_hash:
            continue  # Unchanged — skip

        session = parse_session(path)
        if session is None:
            continue

        # Replace (not add) the contribution for this file
        contributions[path_key] = {
            "hash": current_hash,
            "machine": machine,
            "date": session["date"],
            "input": session["input"],
            "output": session["output"],
            "cache_read": session["cache_read"],
            "cache_create": session["cache_create"],
            "api_requests": session["api_requests"],
        }
        new_or_changed += 1
        dates_touched.add(session["date"])

        if verbose:
            print(
                f"{path.stem}\t{session['date']}\t{session['input']}\t"
                f"{session['output']}\t{session['cache_read']}\t"
                f"{session['cache_create']}\t{session['api_requests']}"
            )

    # Rebuild daily totals from all contributions
    daily = build_daily_totals(contributions)
    rows = finalize_rows(daily, annotations, chat_tokens_per_session)

    # Reconciliation
    print(f"[collect] Scanned {len(jsonl_files)} session files → {new_or_changed} new/changed")
    for date in sorted(dates_touched):
        row = next(r for r in rows if r["date"] == date)
        print(
            f"[collect] {date}: exact={row['total_exact']:,} est={row['total_est']:,} "
            f"sessions={row['claude_code_sessions']} api_requests={row['claude_code_api_requests']} "
            f"sources={row['sources']}"
        )
    print(f"[collect] Output: {output_path} ({len(rows)} rows)")

    if dry_run:
        print("[collect] DRY RUN — nothing written")
        return

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(rows, indent=2))
    save_contributions(output_path, contributions)
    print(f"[collect] Written: {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Collect Claude Code token usage into daily-burn.json"
    )
    parser.add_argument(
        "--sessions-root",
        type=Path,
        default=Path.home() / ".claude" / "projects",
    )
    parser.add_argument("--machine", default="cadence")
    parser.add_argument("--chat-tokens-per-session", type=int, default=DEFAULT_CHAT_TOKENS, metavar="N")
    parser.add_argument("--annotations", type=Path, default=Path("data/annotations.json"))
    parser.add_argument("--output", type=Path, default=Path("public/data/daily-burn.json"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    collect(
        sessions_root=args.sessions_root,
        machine=args.machine,
        chat_tokens_per_session=args.chat_tokens_per_session,
        annotations_path=args.annotations,
        output_path=args.output,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )


if __name__ == "__main__":
    main()
