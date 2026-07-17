#!/usr/bin/env python3
"""Normalize legacy token_sessions machine labels to structural names."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client

LEGACY_MACHINE_MAP = {
    "cadence": "mini",
    "coda": "imac",
    "lumen": "mini",
    "presto": "macbook",
}
PAGE_SIZE = 1000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Normalize legacy machine labels in token_burn.token_sessions")
    parser.add_argument("--since", help="Optional YYYY-MM-DD lower bound")
    parser.add_argument("--apply", action="store_true", help="Apply changes; default is dry-run")
    return parser.parse_args()


def supabase_client() -> Client:
    load_dotenv(Path(__file__).parent.parent / ".env")
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("[normalize] ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set", file=sys.stderr)
        sys.exit(1)
    return create_client(url, key)


def fetch_legacy_rows(sb: Client, since: str | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    machines = list(LEGACY_MACHINE_MAP)
    columns = (
        "id,session_id,machine,session_date,agent,total_tokens,input_tokens,"
        "output_tokens,cache_read,cache_create,api_requests,driver,notes,"
        "fidelity,created_at,updated_at"
    )

    while True:
        query = (
            sb.schema("token_burn").table("token_sessions")
            .select(columns)
            .in_("machine", machines)
            .order("session_date", desc=False)
            .range(offset, offset + PAGE_SIZE - 1)
        )
        if since:
            query = query.gte("session_date", since)
        result = query.execute()
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def fetch_target_row(sb: Client, session_id: str, target_machine: str) -> dict[str, Any] | None:
    result = (
        sb.schema("token_burn").table("token_sessions")
        .select("id,session_id,machine,driver,notes,total_tokens")
        .eq("session_id", session_id)
        .eq("machine", target_machine)
        .limit(1)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def row_total(row: dict[str, Any]) -> int:
    return int(row.get("total_tokens") or 0)


def apply_update(sb: Client, row_id: str, values: dict[str, Any]) -> None:
    result = (
        sb.schema("token_burn").table("token_sessions")
        .update(values)
        .eq("id", row_id)
        .execute()
    )
    if getattr(result, "error", None):
        raise RuntimeError(str(result.error))


def apply_delete(sb: Client, row_id: str) -> None:
    result = (
        sb.schema("token_burn").table("token_sessions")
        .delete()
        .eq("id", row_id)
        .execute()
    )
    if getattr(result, "error", None):
        raise RuntimeError(str(result.error))


def merge_values(legacy: dict[str, Any], target: dict[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    if not target.get("driver") and legacy.get("driver"):
        values["driver"] = legacy["driver"]
    if not target.get("notes") and legacy.get("notes"):
        values["notes"] = legacy["notes"]
    return values


def main() -> None:
    args = parse_args()
    sb = supabase_client()
    legacy_rows = fetch_legacy_rows(sb, args.since)

    print("# Normalize Token Burn Machine Labels")
    print(f"Mode: {'apply' if args.apply else 'dry-run'}")
    if args.since:
        print(f"Since: {args.since}")
    print(f"Legacy rows found: {len(legacy_rows)}")

    updated = 0
    merged_deleted = 0
    refused = 0

    for row in legacy_rows:
        source_machine = str(row["machine"])
        target_machine = LEGACY_MACHINE_MAP[source_machine]
        target = fetch_target_row(sb, str(row["session_id"]), target_machine)

        if target is None:
            print(f"UPDATE {row['session_date']} {row['session_id']}: {source_machine} -> {target_machine} total={row_total(row):,}")
            if args.apply:
                apply_update(sb, str(row["id"]), {"machine": target_machine})
            updated += 1
            continue

        if row_total(row) == 0:
            values = merge_values(row, target)
            print(
                f"MERGE+DELETE {row['session_date']} {row['session_id']}: "
                f"{source_machine}=0 into {target_machine}={row_total(target):,} "
                f"preserve={','.join(values) or 'none'}"
            )
            if args.apply:
                if values:
                    apply_update(sb, str(target["id"]), values)
                apply_delete(sb, str(row["id"]))
            merged_deleted += 1
            continue

        if row_total(target) == 0:
            values = merge_values(target, row)
            print(
                f"DELETE+UPDATE {row['session_date']} {row['session_id']}: "
                f"remove target zero row then {source_machine} -> {target_machine} "
                f"preserve={','.join(values) or 'none'}"
            )
            if args.apply:
                if values:
                    apply_update(sb, str(row["id"]), values)
                apply_delete(sb, str(target["id"]))
                apply_update(sb, str(row["id"]), {"machine": target_machine})
            updated += 1
            merged_deleted += 1
            continue

        print(
            f"REFUSE {row['session_date']} {row['session_id']}: "
            f"{source_machine}={row_total(row):,} conflicts with {target_machine}={row_total(target):,}"
        )
        refused += 1

    print(f"\nUpdated labels: {updated}")
    print(f"Merged/deleted zero duplicates: {merged_deleted}")
    print(f"Refused conflicts: {refused}")
    if refused:
        sys.exit(1)


if __name__ == "__main__":
    main()
