#!/usr/bin/env python3
"""
Legacy data migration: daily-burn.json → Supabase token_sessions

Reads public/data/daily-burn.json and data/annotations.json.
Inserts one synthetic row per day (Code) and one per day (Chat, if applicable).
Idempotent: ON CONFLICT (session_id, machine) DO NOTHING — safe to run twice.

Run once after the token_sessions table is created:
    python scripts/migrate_legacy.py
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

try:
    from supabase import create_client
except ImportError:
    print("[migrate] ERROR: supabase package not installed. Run: pip3 install supabase", file=sys.stderr)
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

DAILY_JSON = Path(__file__).parent.parent / "public" / "data" / "daily-burn.json"
ANNOTATIONS_JSON = Path(__file__).parent.parent / "data" / "annotations.json"
NOTE_LEGACY = "Migrated from daily-burn.json v1 — session-level detail not available"
NOTE_CHAT = "Migrated from daily-burn.json v1 — estimate only"


def main() -> None:
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not supabase_key:
        print(
            "[migrate] ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n"
            "  Create a .env file at the project root or export them as env vars.",
            file=sys.stderr,
        )
        sys.exit(1)

    if not DAILY_JSON.exists():
        print(f"[migrate] ERROR: {DAILY_JSON} not found. Nothing to migrate.", file=sys.stderr)
        sys.exit(1)

    sb = create_client(supabase_url, supabase_key)

    daily_rows: list[dict] = json.loads(DAILY_JSON.read_text())
    annotations: dict[str, dict] = {}
    if ANNOTATIONS_JSON.exists():
        try:
            annotations = json.loads(ANNOTATIONS_JSON.read_text())
        except json.JSONDecodeError:
            print("[migrate] WARNING: could not parse annotations.json — skipping driver/notes", file=sys.stderr)

    code_rows: list[dict] = []
    chat_rows: list[dict] = []
    now = datetime.now().isoformat()

    for row in daily_rows:
        date = row["date"]
        ann = annotations.get(date, {})

        driver = ann.get("driver") or None
        evidence = ann.get("evidence", "")
        notes = evidence[:500] if evidence else NOTE_LEGACY

        # Code row
        if row.get("total_exact", 0) > 0 or row.get("claude_code_sessions", 0) > 0:
            code_rows.append({
                "session_id":    f"legacy-{date}",
                "machine":       "merged",
                "session_date":  date,
                "agent":         "claude-code",
                "input_tokens":  row.get("claude_code_input", 0),
                "output_tokens": row.get("claude_code_output", 0),
                "cache_read":    row.get("claude_code_cache_read", 0),
                "cache_create":  row.get("claude_code_cache_create", 0),
                "api_requests":  row.get("claude_code_api_requests", 0),
                "driver":        driver,
                "notes":         notes,
                "fidelity":      "exact",
                "created_at":    now,
                "updated_at":    now,
            })

        # Chat row
        chat_est = row.get("claude_chat_est", 0)
        if chat_est > 0:
            chat_rows.append({
                "session_id":    f"legacy-chat-{date}",
                "machine":       "ariel",
                "session_date":  date,
                "agent":         "claude-chat",
                "input_tokens":  chat_est,
                "output_tokens": 0,
                "cache_read":    0,
                "cache_create":  0,
                "api_requests":  0,
                "driver":        None,
                "notes":         NOTE_CHAT,
                "fidelity":      "estimated",
                "created_at":    now,
                "updated_at":    now,
            })

    all_rows = code_rows + chat_rows
    print(f"[migrate] Prepared {len(code_rows)} code rows + {len(chat_rows)} chat rows = {len(all_rows)} total")

    if not all_rows:
        print("[migrate] Nothing to insert.")
        return

    # Insert in batches of 50 (Supabase REST limit)
    inserted = 0
    skipped = 0
    for i in range(0, len(all_rows), 50):
        batch = all_rows[i:i + 50]
        result = (
            sb.table("token_sessions")
            .upsert(batch, on_conflict="session_id,machine", ignore_duplicates=True)
            .execute()
        )
        if hasattr(result, "error") and result.error:
            print(f"[migrate] ERROR on batch {i//50}: {result.error}", file=sys.stderr)
        else:
            inserted += len(batch)

    print(f"[migrate] Done — {inserted} rows inserted (duplicates silently ignored)")
    print("[migrate] Driver annotations applied:", {d: a.get("driver") for d, a in annotations.items() if a.get("driver")})


if __name__ == "__main__":
    main()
