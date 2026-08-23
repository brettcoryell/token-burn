#!/usr/bin/env python3
"""Suggest and optionally apply Token Burn driver annotations.

The script intentionally relies on session metadata and repository timelines,
not conversation transcript contents. It is meant to produce auditable evidence
for high-value unannotated rows before any Supabase updates are applied.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from supabase import Client, create_client

from collect import CODEX_STATE_DB

LOCAL_TZ = ZoneInfo("America/Denver")
PAGE_SIZE = 1000
VALID_DRIVERS = {"infrastructure", "career", "creative", "markets", "research", "personal"}

PROJECT_DRIVER = {
    "acute": "research",
    "acute-codex": "research",
    "ai-resume": "career",
    "brettcoryell-site": "career",
    "career-router": "career",
    "cavendish": "research",
    "dday": "creative",
    "estate": "personal",
    "market-signal-monitor": "markets",
    "open_brain": "infrastructure",
    "runlog": "personal",
    "token-burn": "infrastructure",
    "wiki": "infrastructure",
}

PROJECT_KEYWORDS = {
    "acute": ("acute",),
    "ai-resume": ("ai resume", "ai-resume"),
    "brettcoryell-site": ("brettcoryell-site", "brett site", "website"),
    "career-router": ("career-router", "career router"),
    "cavendish": ("cavendish",),
    "dday": ("d-day", "dday", "d day"),
    "estate": ("estate", "parents' estate", "parents estate"),
    "market-signal-monitor": ("market signal", "msm", "s&p", "spread", "treasury", "yield"),
    "open_brain": ("openbrain", "open brain", "registry", "intent", "memory"),
    "runlog": ("brava", "runlog", "garmin", "running log", "watch import"),
    "token-burn": ("token-burn", "token burn", "token sync", "token accounting"),
    "wiki": ("wiki",),
}

DRIVER_KEYWORDS = {
    "career": ("ai resume", "career", "linkedin", "job", "interview"),
    "creative": ("game", "scenario", "sprite", "map", "tutorial", "campaign"),
    "infrastructure": ("startup protocol", "mcp", "collector", "sync", "codex", "claude", "registry", "automation"),
    "markets": ("market", "s&p", "spread", "treasury", "yield", "equity", "index"),
    "personal": ("estate", "parents", "brava", "run", "garmin", "watch", "health"),
    "research": ("research", "experiment", "acute", "cavendish", "science"),
}


@dataclass
class Evidence:
    kind: str
    detail: str
    weight: float


@dataclass
class Suggestion:
    id: str
    session_id: str
    session_date: str
    agent: str
    machine: str
    total_tokens: int
    existing_notes: str | None
    inferred_driver: str | None
    confidence: float
    confidence_label: str
    title: str | None
    cwd: str | None
    evidence: list[Evidence]
    caps: list[str]
    conflicts: list[str]
    proposed_notes: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Suggest Token Burn driver annotations")
    parser.add_argument("--days", type=int, default=60, help="Lookback window ending today")
    parser.add_argument("--since", help="Explicit YYYY-MM-DD start date; overrides --days")
    parser.add_argument("--min-tokens", type=int, default=10_000_000)
    parser.add_argument("--confidence-threshold", type=float, default=0.85)
    parser.add_argument("--sessions-root", type=Path, default=Path.home() / ".claude" / "projects")
    parser.add_argument("--codex-state-db", type=Path, default=CODEX_STATE_DB)
    parser.add_argument("--repos-root", type=Path, default=Path.home() / "Code" / "AI")
    parser.add_argument("--output", type=Path, default=Path("data") / "annotation-suggestions.json")
    parser.add_argument("--apply", action="store_true", help="Apply suggestions at or above threshold")
    parser.add_argument("--overwrite-notes", action="store_true", help="Replace existing notes when applying")
    return parser.parse_args()


def start_date(args: argparse.Namespace) -> date:
    if args.since:
        return date.fromisoformat(args.since)
    return date.today() - timedelta(days=args.days)


def supabase_client() -> Client:
    load_dotenv(Path(__file__).parent.parent / ".env")
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("[annotations] ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set", file=sys.stderr)
        sys.exit(1)
    return create_client(url, key)


def fetch_target_rows(sb: Client, since: date, min_tokens: int) -> list[dict[str, Any]]:
    columns = "id,session_id,machine,session_date,agent,total_tokens,driver,notes"
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        result = (
            sb.schema("token_burn").table("token_sessions")
            .select(columns)
            .is_("driver", "null")
            .gte("session_date", since.isoformat())
            .gte("total_tokens", min_tokens)
            .order("total_tokens", desc=True)
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def claude_metadata(root: Path, session_id: str) -> dict[str, Any]:
    paths = list(root.glob(f"**/{session_id}.jsonl"))
    if not paths:
        return {}
    path = paths[0]
    title: str | None = None
    cwd: str | None = None
    first_ts: str | None = None
    last_ts: str | None = None
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("type") == "ai-title" and isinstance(record.get("aiTitle"), str):
                title = record["aiTitle"]
            if cwd is None and isinstance(record.get("cwd"), str):
                cwd = record["cwd"]
            ts = record.get("timestamp")
            if isinstance(ts, str):
                first_ts = first_ts or ts
                last_ts = ts
    return {"path": str(path), "title": title, "cwd": cwd, "first_ts": first_ts, "last_ts": last_ts}


def codex_metadata(state_db: Path, session_id: str) -> dict[str, Any]:
    if not session_id.startswith("codex-") or not state_db.exists():
        return {}
    thread_id = session_id.removeprefix("codex-")
    conn = sqlite3.connect(f"file:{state_db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT id, created_at, model, cwd, rollout_path FROM threads WHERE id = ?",
            (thread_id,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return {}
    created_at = datetime.fromtimestamp(int(row["created_at"]), tz=ZoneInfo("UTC")).astimezone(LOCAL_TZ)
    return {
        "title": None,
        "cwd": row["cwd"],
        "first_ts": created_at.isoformat(),
        "last_ts": created_at.isoformat(),
        "model": row["model"],
        "path": row["rollout_path"],
    }


def repo_name_from_cwd(cwd: str | None, repos_root: Path) -> str | None:
    if not cwd:
        return None
    try:
        rel = Path(cwd).resolve().relative_to(repos_root.resolve())
    except (ValueError, OSError):
        return None
    return rel.parts[0] if rel.parts else None


def nearby_git_repos(repos_root: Path, session_day: str, window_days: int = 1) -> Counter[str]:
    day = date.fromisoformat(session_day)
    since = (day - timedelta(days=window_days)).isoformat()
    until = (day + timedelta(days=window_days + 1)).isoformat()
    counts: Counter[str] = Counter()
    for git_dir in repos_root.glob("*/.git"):
        repo = git_dir.parent
        try:
            result = subprocess.run(
                ["git", "-C", str(repo), "log", "--since", since, "--until", until, "--pretty=%H"],
                check=False,
                capture_output=True,
                text=True,
                timeout=3,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if result.returncode == 0:
            count = len([line for line in result.stdout.splitlines() if line.strip()])
            if count:
                counts[repo.name] = count
    return counts


def add_project_evidence(
    evidence: list[Evidence],
    candidates: Counter[str],
    project: str,
    weight: float,
    detail: str,
) -> None:
    driver = PROJECT_DRIVER.get(project)
    if not driver:
        return
    candidates[driver] += weight
    evidence.append(Evidence("project", detail, weight))


def score_row(row: dict[str, Any], meta: dict[str, Any], git_counts: Counter[str], repos_root: Path) -> Suggestion:
    title = meta.get("title")
    cwd = meta.get("cwd")
    title_text = title.lower() if isinstance(title, str) else ""
    notes_text = row.get("existing_notes").lower() if isinstance(row.get("existing_notes"), str) else ""
    cwd_text = cwd.lower() if isinstance(cwd, str) else ""
    searchable_text = " ".join(part for part in (title_text, notes_text) if part)
    evidence: list[Evidence] = []
    candidates: Counter[str] = Counter()
    caps: list[str] = []
    conflicts: list[str] = []

    title_projects: list[str] = []
    for project, keywords in PROJECT_KEYWORDS.items():
        if any(keyword in searchable_text for keyword in keywords):
            title_projects.append(project)
            add_project_evidence(
                evidence,
                candidates,
                project,
                0.45,
                f"title/notes name {project}",
            )

    for driver, keywords in DRIVER_KEYWORDS.items():
        matched = [keyword for keyword in keywords if keyword in searchable_text]
        if matched:
            candidates[driver] += 0.25
            evidence.append(Evidence("driver_keyword", f"matched {driver} keyword(s): {', '.join(matched[:3])}", 0.25))

    cwd_project = repo_name_from_cwd(cwd, repos_root)
    if cwd_project in PROJECT_DRIVER and (cwd_project != "open_brain" or not title_projects):
        add_project_evidence(
            evidence,
            candidates,
            cwd_project,
            0.20,
            f"cwd is in {cwd_project}",
        )
    elif cwd_project == "open_brain":
        evidence.append(Evidence("context", "cwd is in open_brain; not used as driver evidence", 0.0))

    mapped_git = [(repo, count, PROJECT_DRIVER[repo]) for repo, count in git_counts.most_common() if repo in PROJECT_DRIVER]
    if mapped_git:
        git_applied = False
        for project in title_projects:
            match = next(((repo, count, driver) for repo, count, driver in mapped_git if repo == project), None)
            if match:
                repo, count, driver = match
                candidates[driver] += 0.20
                evidence.append(Evidence("git", f"{count} nearby commit(s) in {repo}", 0.20))
                git_applied = True
                break
        if not git_applied and not title_projects:
            top_repo, top_count, top_driver = mapped_git[0]
            candidates[top_driver] += 0.20
            evidence.append(Evidence("git", f"{top_count} nearby commit(s) in {top_repo}", 0.20))
            other_drivers = {driver for _, _, driver in mapped_git[1:]}
            if other_drivers and top_driver not in other_drivers:
                conflicts.append(f"nearby commits also present for {', '.join(repo for repo, _, _ in mapped_git[1:4])}")

    if title and ("startup protocol" in title.lower() or title.lower() in {"count from 1 to 10"}) and not title_projects:
        caps.append("generic title caps confidence at 0.50 unless corroborated")
    if cwd_project == "open_brain" and not title:
        caps.append("open_brain cwd without title caps confidence at 0.60")

    if not candidates:
        inferred_driver = None
        confidence = 0.0
    else:
        winner, winner_score = candidates.most_common(1)[0]
        runner_up = candidates.most_common(2)[1:] or []
        if runner_up and runner_up[0][1] >= winner_score - 0.20:
            conflicts.append(f"close competing driver: {runner_up[0][0]}")
            winner_score -= 0.30
        inferred_driver = winner if winner in VALID_DRIVERS else None
        confidence = max(0.0, min(1.0, winner_score))

    if title and title.lower() in {"count from 1 to 10"}:
        confidence = min(confidence, 0.40)
    elif any("generic title" in cap for cap in caps):
        confidence = min(confidence, 0.75 if len(evidence) >= 3 else 0.50)
    if any("open_brain cwd without title" in cap for cap in caps):
        confidence = min(confidence, 0.60)

    if confidence >= 0.85:
        label = "high"
    elif confidence >= 0.65:
        label = "medium"
    elif confidence >= 0.40:
        label = "low"
    else:
        label = "unknown"
        inferred_driver = None

    proposed_notes = None
    if inferred_driver:
        source = title or cwd or "local metadata"
        evidence_summary = "; ".join(item.detail for item in evidence[:3])
        proposed_notes = f"Inferred {inferred_driver} from {source!r}; confidence {confidence:.2f}; evidence: {evidence_summary}"[:500]

    return Suggestion(
        id=str(row["id"]),
        session_id=str(row["session_id"]),
        session_date=str(row["session_date"]),
        agent=str(row["agent"]),
        machine=str(row["machine"]),
        total_tokens=int(row.get("total_tokens") or 0),
        existing_notes=row.get("notes"),
        inferred_driver=inferred_driver,
        confidence=round(confidence, 2),
        confidence_label=label,
        title=title,
        cwd=cwd,
        evidence=evidence,
        caps=caps,
        conflicts=conflicts,
        proposed_notes=proposed_notes,
    )


def apply_suggestion(sb: Client, suggestion: Suggestion, overwrite_notes: bool) -> None:
    values: dict[str, Any] = {"driver": suggestion.inferred_driver}
    if suggestion.proposed_notes and (overwrite_notes or not suggestion.existing_notes):
        values["notes"] = suggestion.proposed_notes
    result = (
        sb.schema("token_burn").table("token_sessions")
        .update(values)
        .eq("id", suggestion.id)
        .execute()
    )
    error = getattr(result, "error", None)
    if error:
        raise RuntimeError(str(error))


def suggestion_to_json(suggestion: Suggestion) -> dict[str, Any]:
    result = asdict(suggestion)
    result["evidence"] = [asdict(item) for item in suggestion.evidence]
    return result


def main() -> None:
    args = parse_args()
    since = start_date(args)
    sb = supabase_client()
    rows = fetch_target_rows(sb, since, args.min_tokens)

    suggestions: list[Suggestion] = []
    git_cache: dict[str, Counter[str]] = {}
    for row in rows:
        session_id = str(row["session_id"])
        meta = claude_metadata(args.sessions_root, session_id)
        if not meta:
            meta = codex_metadata(args.codex_state_db, session_id)
        day = str(row["session_date"])
        if day not in git_cache:
            git_cache[day] = nearby_git_repos(args.repos_root, day)
        row_with_notes = {**row, "existing_notes": row.get("notes")}
        suggestions.append(score_row(row_with_notes, meta, git_cache[day], args.repos_root))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(tz=LOCAL_TZ).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "since": since.isoformat(),
        "min_tokens": args.min_tokens,
        "confidence_threshold": args.confidence_threshold,
        "total_candidates": len(suggestions),
        "suggestions": [suggestion_to_json(item) for item in suggestions],
    }
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    high = [item for item in suggestions if item.inferred_driver and item.confidence >= args.confidence_threshold]
    medium = [item for item in suggestions if item.confidence_label == "medium"]
    low = [item for item in suggestions if item.confidence_label in {"low", "unknown"}]

    applied = 0
    if args.apply:
        for item in high:
            apply_suggestion(sb, item, args.overwrite_notes)
            applied += 1

    print("# Token Burn Annotation Suggestions")
    print(f"Mode: {'apply' if args.apply else 'dry-run'}")
    print(f"Candidates: {len(suggestions)}")
    print(f"High confidence >= {args.confidence_threshold:.2f}: {len(high)}")
    print(f"Medium confidence: {len(medium)}")
    print(f"Low/unknown confidence: {len(low)}")
    print(f"Applied: {applied}")
    print(f"Report: {args.output}")
    print("\nTop suggestions:")
    for item in suggestions[:12]:
        driver = item.inferred_driver or "unresolved"
        title = f" title={item.title!r}" if item.title else ""
        print(
            f"- {item.session_date} {item.agent} {item.total_tokens:,} "
            f"{item.session_id[:12]} driver={driver} confidence={item.confidence:.2f} ({item.confidence_label}){title}"
        )


if __name__ == "__main__":
    main()
