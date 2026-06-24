# DECISIONS.md — token-burn

Architectural decisions for the token-burn dashboard. Consult before making changes.

---

## D1: Supabase as the single source of truth for token data

**Decision (2026-06-09):** Token data lives in a Supabase `token_sessions` table,
not in flat JSON files committed to the repo.

**Why:** Multiple agents across machines (Claude Code, Codex) and Claude Chat all need to write
token data. Flat JSON files committed to git require synchronization via git pull/push,
and Claude Chat has no disk access at all. Supabase gives a shared source of truth with
real-time consistency.

**Constraints:**
- The Supabase service key MUST stay server-side (Vercel env vars, local `.env`).
  Never in `VITE_*` env vars. Never committed to git.
- The repo is public — no secrets in tracked files.

---

## D2: Vercel serverless proxy for all Supabase reads

**Decision (2026-06-09):** The frontend fetches data from Vercel API routes (`/api/daily`,
`/api/sessions`), never from Supabase directly from the browser.

**Why:** The service role key grants write access to the entire OB database. If it
appeared in the browser bundle, any visitor could read or write all OB data.

**Constraints:**
- No `VITE_SUPABASE_*` env vars — these would be bundled.
- All new dashboard data fetches go through `/api/*.ts` routes.
- This proxy pattern should be reviewed for other Vercel-deployed projects (SOON intent in OB).

---

## D3: Session-level granularity in token_sessions

**Decision (2026-06-09):** One row per session (not per day). The `get_daily_summary()`
Postgres function aggregates to day-level for the dashboard views.

**Why:** Per-day rows lose information about which work drove token spend. Session-level
rows allow driver labeling at the session level, enabling the Drivers view to show
accurate per-project attribution.

**Constraints:**
- Upsert key: `UNIQUE (session_id, machine)` — idempotent on collector re-runs.
- `session_id` for Code sessions = JSONL filename stem (no extension).
- `session_id` for Chat sessions = `ariel-{date}-{uuid}`.
- `session_id` for legacy rows = `legacy-{date}` or `legacy-chat-{date}`.

---

## D4: Driver taxonomy (closed set)

**Decision (2026-06-09):** The `driver` field accepts only these values:
`infrastructure`, `career`, `creative`, `markets`, `research`, `personal`, or `NULL`.

**Why:** An open-ended text field would make the Drivers view unworkable (too many
distinct values). The closed set is enforced by a CHECK constraint in Postgres and
validated in both MCP tools before the Supabase insert.

---

## D5: Fidelity separation — never mix exact and estimated without labels

**Decision (inherited from v1, confirmed v2):** Claude Code and Codex
session tokens (`fidelity='exact'`) and Claude Chat estimates
(`fidelity='estimated'`) are NEVER summed into a single
undifferentiated total. The dashboard shows them separately with MEASURED/EST badges.

**Why:** Mixing signals of different reliability misleads the user about their true
AI spend. Exact data from JSONL files is exact; chat estimates are educated guesses.

---

## D7: Python environment standard

**Decision (2026-06-14):** All Python invocations use a `.venv` at the project root built from Homebrew `python@3.12`. Never bare `python3` or `pip3` in Makefiles, scripts, or documentation.

**Why:** The system Python on macOS is 3.9.6 and lacks PEP 604 union syntax (`dict | None`) used throughout the collector. Bare `python3` silently resolves to the wrong interpreter and fails at runtime.

**Constraints:**
- `make collect`, `make collect-codex`, `make collect-dry`, `make migrate`, `make test-collector` all call `.venv/bin/python`
- `make install` creates the venv via `python3.12 -m venv .venv`
- Canonical standard: `~/Code/AI/open_brain/PYTHON-ENVIRONMENT.md`

---

## D6: .collect-state.json for dedup — not committed to git

**Decision (2026-06-09):** The collector uses `.collect-state.json` (gitignored) to
track content hashes of JSONL files, avoiding redundant Supabase upserts on unchanged files.

**Why:** Without local hash state, every collector run would upsert every JSONL file
— correct semantically (Supabase ON CONFLICT handles it) but wasteful on large histories.
If `.collect-state.json` is lost, the collector re-upserts everything — safe, just slow.

---

## D8: Codex is a first-class exact contributor

**Decision (2026-06-17):** Codex sessions are stored in `token_sessions` with
`agent='codex'`, `machine=<hostname-derived: mini|macbook|imac>`, and `fidelity='exact'`.

**Why:** Codex is part of Brett's AI programming team and must be counted alongside
Claude Code agents in measured team token usage. Codex records expose aggregate
token-count events in `~/.codex/state_5.sqlite` and rollout JSONL files, which are
exact local telemetry rather than chat estimates.

**Constraints:**
- `total_exact` includes all `fidelity='exact'` rows, including Claude Code and Codex.
- Dashboard agent counts remain separate: Claude Code counts stay in
  `claude_code_sessions` / `claude_code_api_requests`; Codex counts use
  `codex_sessions` / `codex_api_requests`.
- Historic dates before Codex collection must not change when the schema/function is
  widened. Verify pre-change daily summaries before and after any migration.
- Auto-review/subagent Codex threads are excluded from Codex contribution totals.

---

## D9: Session IDs are globally unique collection identities

**Decision (2026-06-21):** Claude Code and Codex telemetry `session_id` values are
treated as globally unique work-session identities, even though the database conflict
key remains `UNIQUE (session_id, machine)`.

**Why:** During MacBook Pro onboarding, the same Claude JSONL session IDs
were collected under multiple machine labels, inflating dashboard totals. A telemetry
session copied or visible on another machine is still the same work and must not be
counted twice.

**Constraints:**
- Collectors must check for an existing `session_id` under another machine before
  upserting and skip with a warning if found.
- Historical duplicate cleanup preserves the row with the best annotation
  (`driver`/`notes`) when possible, then removes duplicate rows.
- New machines should run dry-run targets first (`collect-presto-dry`,
  `collect-codex-dry`) and inspect pending sessions before first backfill.
- Long-running Codex threads can span multiple calendar days but currently bucket
  to thread creation date; annotate mixed sessions explicitly or leave `driver=NULL`.
