#!/usr/bin/env python3
"""Store D15's uncorrectable Claude Code rows as labelled scaled estimates (D5 addendum).

These rows were recorded under the old per-line convention and their transcripts no
longer exist, so they cannot be recounted. Each is divided by one pooled factor, marked
fidelity='estimated', and keeps its recorded counts in pre_scale_counts. Dry-run by default.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

# Pooled recorded/recounted ratio over the 253 rows with >= 1M tokens that D15 recounted
# (monthly 1.81 - 1.93). See the D5 addendum in DECISIONS.md.
SCALE_FACTOR = 1.873
OLD_MARKER = "[uncorrected: pre-D15 count, transcript no longer exists; not recounted 2026-10-23]"
COUNT_FIELDS = ("input_tokens", "output_tokens", "cache_read", "cache_create", "api_requests")


def scaled_update(row: dict, factor: float = SCALE_FACTOR, today: str | None = None) -> dict:
    """Columns to write for one uncorrected row. Pure; the original counts go to pre_scale_counts."""
    original = {field: int(row[field] or 0) for field in COUNT_FIELDS}
    original["total_tokens"] = int(row["total_tokens"] or 0)
    original["fidelity"] = row["fidelity"]
    update = {field: round(original[field] / factor) for field in COUNT_FIELDS}
    update["fidelity"] = "estimated"
    update["pre_scale_counts"] = {
        **original,
        "factor": factor,
        "method": "pooled recorded/recounted ratio of D15-recounted Claude Code rows",
        "scaled_on": today or date.today().isoformat(),
    }
    notes = row.get("notes") or ""
    label = f"[scaled estimate: pre-D15 count / {factor}; recorded counts in pre_scale_counts]"
    update["notes"] = notes.replace(OLD_MARKER, label) if OLD_MARKER in notes else f"{notes} {label}".strip()
    return update


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    load_dotenv(Path(__file__).parent.parent / ".env")
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    table = sb.schema("token_burn").table("token_sessions")

    rows, offset = [], 0
    while True:
        batch = (
            table.select("*").eq("agent", "claude-code").eq("fidelity", "exact")
            .like("notes", "%uncorrected: pre-D15%").is_("pre_scale_counts", "null")
            .range(offset, offset + 999).execute().data
        )
        rows.extend(batch)
        offset += 1000
        if len(batch) < 1000:
            break

    before = sum(r["total_tokens"] for r in rows)
    after = 0
    for row in rows:
        update = scaled_update(row)
        after += sum(update[f] for f in ("input_tokens", "output_tokens", "cache_read", "cache_create"))
        if args.apply:
            result = table.update(update).eq("id", row["id"]).execute()
            if len(result.data) != 1:
                sys.exit(f"update of {row['session_id']} touched {len(result.data)} rows")

    print(f"{'APPLIED' if args.apply else 'DRY RUN'}: {len(rows)} rows, {before:,} recorded -> {after:,} scaled (factor {SCALE_FACTOR})")


if __name__ == "__main__":
    main()
