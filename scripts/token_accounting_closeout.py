#!/usr/bin/env python3
"""Run the blessed Token Burn token-accounting closeout subroutine.

This is only the token-accounting portion of agent closeout. It does not replace
project tests, commits, pushes, OpenBrain notes, closeout checkers, or intents.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Token Burn token-accounting closeout")
    parser.add_argument(
        "--codex-min-date",
        default=os.environ.get("CODEX_MIN_DATE"),
        help="Optional YYYY-MM-DD lower bound for Codex collection/backfill",
    )
    parser.add_argument(
        "--skip-claude",
        action="store_true",
        help="Skip local Claude Code collection; intended only for troubleshooting",
    )
    parser.add_argument(
        "--skip-codex",
        action="store_true",
        help="Skip local Codex collection; intended only for troubleshooting",
    )
    return parser.parse_args()


def run_step(label: str, command: list[str], env: dict[str, str] | None = None) -> None:
    print(f"\n## {label}")
    print("$ " + " ".join(command))
    sys.stdout.flush()
    result = subprocess.run(command, cwd=REPO_ROOT, env=env)
    if result.returncode != 0:
        print(f"[token-accounting] ERROR: {label} failed with exit code {result.returncode}", file=sys.stderr)
        sys.exit(result.returncode)


def main() -> None:
    args = parse_args()
    make = ["make"]

    print("# Token Burn Token-Accounting Closeout")
    print("Scope: token accounting only; continue normal project closeout separately.")
    sys.stdout.flush()

    if not args.skip_claude:
        run_step("Collect local Claude Code telemetry", [*make, "collect"])
    else:
        print("\n## Collect local Claude Code telemetry")
        print("Skipped by --skip-claude")

    codex_command = [*make, "collect-codex"]
    env = os.environ.copy()
    if args.codex_min_date:
        env["CODEX_MIN_DATE"] = args.codex_min_date
    if not args.skip_codex:
        run_step("Collect local Codex telemetry", codex_command, env=env)
    else:
        print("\n## Collect local Codex telemetry")
        print("Skipped by --skip-codex")

    run_step("Normalize legacy machine labels", [*make, "normalize-machine-labels"])
    run_step("Apply high-confidence annotation suggestions", [*make, "apply-high-confidence-annotations"])
    run_step("Write remaining annotation review report", [*make, "suggest-annotations"])
    run_step("Run strict accounting audit", [*make, "audit-token-accounting-strict"])

    print("\n[token-accounting] Complete. Review data/annotation-review.json for any remaining medium/low/unknown rows.")


if __name__ == "__main__":
    main()
