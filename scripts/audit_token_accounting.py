#!/usr/bin/env python3
"""Audit recent Token Burn accounting against Supabase and local telemetry."""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client

from collect import (
    CODEX_SKIP_FILE,
    CODEX_STATE_DB,
    codex_session_from_thread,
    codex_threads,
    detect_machine,
    load_codex_skip_ids,
    parse_session,
)

VALID_EXACT_MACHINES = {"mini", "macbook", "imac"}
HIGH_VOLUME_TOKENS = 1_000_000
PAGE_SIZE = 1000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit recent token_sessions accounting")
    parser.add_argument("--days", type=int, default=30, help="Lookback window ending today")
    parser.add_argument("--since", help="Explicit YYYY-MM-DD start date; overrides --days")
    parser.add_argument("--machine", default=detect_machine(), help="Local machine label")
    parser.add_argument(
        "--sessions-root",
        type=Path,
        default=Path.home() / ".claude" / "projects",
        help="Claude Code JSONL root for local telemetry comparison",
    )
    parser.add_argument(
        "--codex-state-db",
        type=Path,
        default=CODEX_STATE_DB,
        help="Codex state SQLite DB for local telemetry comparison",
    )
    parser.add_argument(
        "--skip-local",
        action="store_true",
        help="Only audit Supabase rows; skip local telemetry comparison",
    )
    parser.add_argument(
        "--fail-on-findings",
        action="store_true",
        help="Exit non-zero when audit findings are present",
    )
    parser.add_argument(
        "--fail-on-dangerous",
        action="store_true",
        help="Exit non-zero only for dangerous accounting findings: nonzero duplicate rows, token sum mismatches, missing local telemetry, or local/Supabase mismatches",
    )
    parser.add_argument(
        "--include-today-local-mismatches",
        action="store_true",
        help="Report local-vs-Supabase mismatches for today's in-progress telemetry",
    )
    return parser.parse_args()


def start_date(args: argparse.Namespace) -> date:
    if args.since:
        return date.fromisoformat(args.since)
    return date.today() - timedelta(days=args.days - 1)


def supabase_client() -> Client:
    load_dotenv(Path(__file__).parent.parent / ".env")
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("[audit] ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set", file=sys.stderr)
        sys.exit(1)
    return create_client(url, key)


def fetch_rows(sb: Client, since: date) -> list[dict[str, Any]]:
    columns = (
        "id,session_id,machine,session_date,agent,total_tokens,input_tokens,"
        "output_tokens,cache_read,cache_create,api_requests,driver,notes,"
        "fidelity,created_at,updated_at"
    )
    rows: list[dict[str, Any]] = []
    offset = 0

    while True:
        result = (
            sb.schema("token_burn").table("token_sessions")
            .select(columns)
            .gte("session_date", since.isoformat())
            .order("session_date", desc=False)
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def fetch_daily(sb: Client, since: date) -> list[dict[str, Any]]:
    result = sb.schema("token_burn").rpc("get_daily_summary", {"since_date": since.isoformat()}).execute()
    return result.data or []


def row_total(row: dict[str, Any]) -> int:
    return int(row.get("total_tokens") or 0)


def expected_total(session: dict[str, Any]) -> int:
    return int(session.get("input_tokens") or 0) + int(session.get("output_tokens") or 0) + int(session.get("cache_read") or 0) + int(session.get("cache_create") or 0)


def local_claude_sessions(root: Path, since: date) -> list[dict[str, Any]]:
    sessions: list[dict[str, Any]] = []
    if not root.exists():
        return sessions
    for path in sorted(root.glob("**/*.jsonl")):
        session = parse_session(path)
        if session is None or date.fromisoformat(session["session_date"]) < since:
            continue
        sessions.append({"agent": "claude-code", **session})
    return sessions


def local_codex_sessions(state_db: Path, since: date) -> list[dict[str, Any]]:
    sessions: list[dict[str, Any]] = []
    if not state_db.exists():
        return sessions
    skip_ids = load_codex_skip_ids()
    for row in codex_threads(state_db):
        if row["id"] in skip_ids or f"codex-{row['id']}" in skip_ids:
            continue
        session = codex_session_from_thread(row)
        if session is None or date.fromisoformat(session["session_date"]) < since:
            continue
        sessions.append({"agent": "codex", **session})
    return sessions


def format_tokens(value: int) -> str:
    return f"{value:,}"


def print_table(title: str, rows: list[str]) -> None:
    print(f"\n## {title}")
    if not rows:
        print("OK")
        return
    for row in rows:
        print(f"- {row}")


def main() -> None:
    args = parse_args()
    since = start_date(args)
    today = date.today()
    sb = supabase_client()

    rows = fetch_rows(sb, since)
    daily = fetch_daily(sb, since)
    findings = 0

    print("# Token Burn Accounting Audit")
    print(f"Window: {since.isoformat()} through {today.isoformat()}")
    print(f"Supabase rows: {len(rows)}")
    print(f"Daily summary rows: {len(daily)}")
    print(f"Local machine: {args.machine}")
    if not args.include_today_local_mismatches:
        print("Today local mismatches: skipped unless missing from Supabase")
    if CODEX_SKIP_FILE.exists():
        print(f"Codex skip file present: {CODEX_SKIP_FILE.name}")

    by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_day: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_session[str(row["session_id"])].append(row)
        by_day[str(row["session_date"])].append(row)

    duplicate_rows = []
    dangerous_duplicate_rows = []
    for session_id, grouped in sorted(by_session.items()):
        machines = sorted({str(row["machine"]) for row in grouped})
        if len(machines) > 1:
            total = sum(row_total(row) for row in grouped)
            nonzero_rows = [row for row in grouped if row_total(row) > 0]
            label = "dangerous" if len(nonzero_rows) > 1 else "harmless"
            detail = f"{session_id}: {label}; machines={', '.join(machines)} rows={len(grouped)} nonzero_rows={len(nonzero_rows)} total={format_tokens(total)}"
            duplicate_rows.append(detail)
            if len(nonzero_rows) > 1:
                dangerous_duplicate_rows.append(detail)
    findings += len(duplicate_rows)
    print_table("Cross-Machine Duplicate Session IDs", duplicate_rows)
    print_table("Dangerous Nonzero Duplicate Session IDs", dangerous_duplicate_rows)

    stale_machine_rows = [
        f"{row['session_date']} {row['session_id']} agent={row['agent']} machine={row['machine']} total={format_tokens(row_total(row))}"
        for row in rows
        if row.get("fidelity") == "exact" and str(row.get("machine")) not in VALID_EXACT_MACHINES
    ]
    findings += len(stale_machine_rows)
    print_table("Exact Rows With Non-Structural Machine Labels", stale_machine_rows)

    high_unannotated_rows = [
        f"{row['session_date']} {row['agent']} {row['session_id']} machine={row['machine']} total={format_tokens(row_total(row))}"
        for row in sorted(rows, key=row_total, reverse=True)
        if not row.get("driver") and row_total(row) >= HIGH_VOLUME_TOKENS
    ]
    findings += len(high_unannotated_rows)
    print_table(f"Unannotated Sessions >= {format_tokens(HIGH_VOLUME_TOKENS)} Tokens", high_unannotated_rows)

    component_mismatch_rows = [
        f"{row['session_date']} {row['session_id']} machine={row['machine']} total={format_tokens(row_total(row))} component_sum={format_tokens(expected_total(row))}"
        for row in rows
        if row_total(row) != expected_total(row)
    ]
    print_table("Rows With Token Component Sum Mismatch", component_mismatch_rows)

    missing_days = []
    cursor = since
    while cursor <= today:
        day = cursor.isoformat()
        if day not in by_day:
            missing_days.append(day)
        cursor += timedelta(days=1)
    findings += len(missing_days)
    print_table("Days With No token_sessions Rows", missing_days)

    daily_totals = sorted(
        (
            str(row["date"]),
            int(row.get("total_exact") or 0),
            int(row.get("total_est") or 0),
        )
        for row in daily
    )
    top_days = sorted(daily_totals, key=lambda item: item[1] + item[2], reverse=True)[:10]
    print_table(
        "Top 10 Days By Daily Summary Total",
        [
            f"{day}: measured={format_tokens(exact)} estimated={format_tokens(est)} total={format_tokens(exact + est)}"
            for day, exact, est in top_days
        ],
    )

    if not args.skip_local:
        local_sessions = local_claude_sessions(args.sessions_root, since)
        local_sessions.extend(local_codex_sessions(args.codex_state_db, since))

        missing_local = []
        mismatched_local = []
        for session in local_sessions:
            grouped = by_session.get(str(session["session_id"]), [])
            total = expected_total(session)
            if not grouped:
                missing_local.append(f"{session['session_date']} {session['agent']} {session['session_id']} total={format_tokens(total)}")
                continue
            best = max(grouped, key=row_total)
            if (
                not args.include_today_local_mismatches
                and session["session_date"] == today.isoformat()
            ):
                continue
            if row_total(best) != total or int(best.get("api_requests") or 0) != int(session.get("api_requests") or 0):
                mismatched_local.append(
                    f"{session['session_date']} {session['agent']} {session['session_id']} "
                    f"local={format_tokens(total)}/{session.get('api_requests')} "
                    f"supabase={format_tokens(row_total(best))}/{best.get('api_requests')} machine={best.get('machine')}"
                )

        findings += len(missing_local) + len(mismatched_local)
        print_table("Local Telemetry Missing From Supabase", missing_local)
        print_table("Local Telemetry Total/API Mismatches", mismatched_local)

    dangerous_findings = (
        len(dangerous_duplicate_rows)
        + len(component_mismatch_rows)
        + (len(missing_local) if not args.skip_local else 0)
        + (len(mismatched_local) if not args.skip_local else 0)
    )
    print(f"Dangerous findings: {dangerous_findings}")
    print(f"\nFindings: {findings}")
    if dangerous_findings and args.fail_on_dangerous:
        sys.exit(1)
    if findings and args.fail_on_findings:
        sys.exit(1)


if __name__ == "__main__":
    main()
