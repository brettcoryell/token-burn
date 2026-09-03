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
- New machines should run dry-run targets first (`collect-dry`,
  `collect-codex-dry`) and inspect pending sessions before first backfill.
- Long-running Codex threads can span multiple calendar days but currently bucket
  to thread creation date; annotate mixed sessions explicitly or leave `driver=NULL`.

---

## D10: Manual Codex split backfills use a local skip list

**Decision (2026-06-28):** If a single long Codex thread is intentionally recorded
as multiple `token_sessions` rows, the raw thread id can be listed in the local,
gitignored `.collect-codex-skip.json` file.

**Why:** The normal Codex collector is one row per thread. Manual split backfills are
rare but useful for unusually long sessions that span multiple logical work periods.
Without a thread-level skip list, a later `make collect-codex` run could also upsert
the original unsplit row and double-count the same work.

**Constraints:**
- The skip file is local machine state and MUST NOT be committed.
- Split rows must name the source thread in `notes` and use exact token deltas from
  the rollout token-count telemetry.
- Run `make collect-codex-dry CODEX_MIN_DATE=<date>` after adding a skip entry and
  confirm the raw thread is skipped.

---

## D11: The MCP write path lives in this repo, not open-brain-mcp

**Decision (2026-07-08):** `record_code_session`, `record_chat_session`, and `record_codex_session`
are served from `api/mcp.ts` in this repo (deployed to `https://token-burn-nine.vercel.app/api/mcp`
on this project's existing Vercel deployment), not from the `open-brain` project's `open-brain-mcp`
Supabase function where they originally lived.

**Why:** They write to this project's `token_burn` schema, not OB's `ob` schema. Colocating them with
`open-brain-mcp` was deployment convenience from when `record_chat_session` was first added for Ariel,
not a structural fit — this repo already owns the schema, the read API (`/api/daily`, `/api/sessions`),
and the dashboard, so it should own the write path too.

**Constraints:**
- `api/mcp.ts` runs on Vercel's Node.js runtime (no `export const config = { runtime: "edge" }`).
  `@modelcontextprotocol/sdk`'s subpath exports don't bundle under Vercel's Edge runtime.
- It uses `@hono/node-server`'s `getRequestListener(app.fetch)` as the default export, not `app.fetch`
  directly — a bare Vercel Node request isn't a Fetch API `Request`, and Hono's MCP transport needs
  `headers.get()`.
- Auth is a dedicated `TOKEN_BURN_MCP_ACCESS_KEY` Vercel env var (`x-brain-key` header or `?key=`
  query param, same contract shape as OB's `MCP_ACCESS_KEY` but a distinct value) — not shared with OB.
- Claude Code and Codex call this directly with `TOKEN_BURN_MCP_ACCESS_KEY`. Claude Chat (Ariel) reaches
  it through the `token-burn` slug on the `ob-oauth-shim` OAuth shim (see `open_brain/DECISIONS.md`),
  which requires its own claude.ai custom connector separate from the `open-brain` one.

**Violation looks like:** Adding a new MCP tool that writes to `token_burn` back into `open-brain-mcp`.
Changing `api/mcp.ts` to Edge runtime without re-verifying the MCP SDK bundles cleanly there.

---

## D12: Exact MCP writes use structural machine labels only

**Decision (2026-08-23):** `record_code_session` and `record_codex_session` accept only
`machine='mini' | 'imac' | 'macbook'`. Agent nicknames such as `cadence`, `coda`,
`lumen`, and `presto` are not accepted in exact token write tools.

**Why:** Token Burn treats `session_id` as the global collection identity, while the
database conflict key remains `(session_id, machine)`. If a closeout tool writes a
zero-token or stale duplicate under an agent nickname, later collector runs can be
blocked or forced through cleanup even though the closeout appeared successful.
Structural machine labels keep MCP writes aligned with collectors, audits, and
OpenBrain session refs.

**Constraints:**
- `record_chat_session` may continue to use `machine='ariel'` because Chat rows are
  estimated, intentionally separate from exact local telemetry, and not collected from
  a machine-local file.
- Do not add default machine values to exact MCP schemas. A caller must provide the
  actual structural host label.
- Legacy cleanup scripts may know how to normalize old rows, but normal operation
  must fail closed instead of writing nickname-labeled exact rows.

**Violation looks like:** A zod schema or MCP description accepting `cadence`, `coda`,
`lumen`, or any other agent nickname for `record_code_session` or
`record_codex_session`; a default exact machine value like `lumen`; or closeout
instructions telling agents to record exact sessions under nicknames.

---

## D13: Token-accounting closeout uses one blessed wrapper

**Decision (2026-08-23):** Claude Code and Codex should run
`make token-accounting-closeout` from `/Users/brettcoryell/Code/AI/token-burn`
for the token-accounting portion of session closeout.

**Why:** Token accounting has repeatedly drifted because closeout required agents
to remember several separate commands (`collect`, `collect-codex`, machine-label
normalization, annotation repair, and strict audit) and because `driver`/`notes`
repair lived outside ordinary collection. A single wrapper makes the accounting
subroutine repeatable without pretending to replace the rest of session closeout.

**Constraints:**
- `make token-accounting-closeout` is only token accounting. Agents must still run
  project-specific tests, closeout checkers, commits/pushes, OpenBrain notes, and
  intent updates according to the active project instructions.
- The individual collector and reconcile targets remain available for backfills,
  first-machine dry runs, and troubleshooting, but normal end-of-session token
  accounting should not call them as the primary path.
- The wrapper collects local Claude Code telemetry and local Codex telemetry,
  normalizes legacy machine labels, applies only high-confidence annotation
  suggestions, writes the remaining annotation review report, and runs the strict
  accounting audit.
- Dashboard accounting-health UI is intentionally out of scope for this decision.

**Violation looks like:** Closeout instructions telling Claude Code to run only
`make collect`, telling Codex to run only `make collect-codex`, reviving
`collect-coda`, or describing `make token-accounting-closeout` as the whole
session closeout rather than the token-accounting subroutine.

---

## D14: Collection and audit share one lookback window

**Decision (2026-09-03):** `LOOKBACK_DAYS` (default 30) drives both the Codex
collection floor (`CODEX_MIN_DATE`) and the audit window (`--days`). The two must
never be set independently.

**Why:** `CODEX_MIN_DATE` previously defaulted to `$(shell date +%Y-%m-%d)` — today.
The audit looked back 30 days. That gap is not cosmetic: a Codex thread that starts
on one day and keeps running is collected mid-flight, and from the next day onward
it is filtered out of every subsequent collection while its rollout file keeps
growing. The audit then reports a mismatch that collection structurally cannot
repair, forever.

Two sessions sat in exactly that state across several closeouts on multiple
machines — `codex-01a02813…` (2026-08-22, short 426,433 tokens / 5 API calls) and
`codex-01a060eb…` (2026-09-02, short 2,179,051 tokens / 25 calls). Both were
reported as dangerous findings and left untouched by both Claude Code and Codex,
because the documented remediation does not work: `--ignore-state` bypasses the
content-hash check but not the date floor, so `make collect-codex-reconcile`
reported "0 new/changed" while the drift was real.

The today-default was originally correct — it protected historic daily aggregates
during Codex's first backfill (D8). That was a one-time migration concern, and
pinning the floor to today permanently is the wrong way to hold it.

**Constraints:**
- Any audit check that compares local telemetry to Supabase must run over a window
  the collector also covers. Widening the audit without widening collection
  re-creates this bug.
- `CODEX_MIN_DATE` remains an explicit override for first backfills on a new
  machine and for the D10 split-backfill workflow. Only its default changed.
- A reported mismatch that a documented remediation cannot clear is itself a bug.
  If `collect-codex-reconcile` reports "0 new/changed" while the audit still flags
  drift, suspect the date floor before the hash state.
- Zero-token Codex threads are never upserted. Codex writes the thread row before
  any billing occurs, so aborted threads look collectable from sqlite's
  `tokens_used` alone; importing them adds rows to `codex_sessions` worth no
  tokens. Five such 2026-06-16 stubs became reachable the moment the window
  widened, and are now skipped in `codex_session_from_thread`.

**Violation looks like:** hardcoding `--days` in an audit target. Setting
`CODEX_MIN_DATE` to today. Leaving a dangerous audit finding unresolved across
closeouts without determining whether the remediation path actually works.
