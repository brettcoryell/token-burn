# Acceptance Criteria v2 — Token Burn: Supabase Data Layer

**Status:** Draft v2 — 6 adversarial blockers addressed  
**Date:** 2026-06-09  
**Companion spec:** SPEC_v2.md

All criteria are MUST PASS unless marked SHOULD. Tests marked [AUTO] have automated coverage;
[MANUAL] require human verification. Both sets must pass before the v2 build is considered complete.

---

## AC-1: Supabase Table

**AC-1.1** [AUTO] `token_sessions` table exists in the OB Supabase instance with all columns
defined in SPEC §3.1 (verified by migration script checking table structure before inserting).

**AC-1.2** [AUTO] `total_tokens` is a generated column equal to
`input_tokens + output_tokens + cache_read + cache_create` — verify with a test insert.

**AC-1.3** [AUTO] `UNIQUE (session_id, machine)` constraint prevents duplicate rows — verify that
upserting the same session_id+machine twice results in exactly one row.

**AC-1.4** [AUTO] `driver` CHECK constraint rejects values outside the approved taxonomy.
Valid: `infrastructure`, `career`, `creative`, `markets`, `research`, `personal`, `NULL`.
Invalid: any other string.

**AC-1.5** [AUTO] `agent` CHECK constraint rejects values other than `claude-code` and `claude-chat`.

**AC-1.6** [AUTO] `fidelity` CHECK constraint rejects values other than `exact` and `estimated`.

---

## AC-2: Legacy Migration

**AC-2.1** [AUTO] After `python scripts/migrate_legacy.py`, the count of rows in `token_sessions`
with `session_id LIKE 'legacy-%'` equals the number of days in `daily-burn.json` that have
`total_exact > 0`, plus the number of days with `claude_chat_est > 0`.

**AC-2.5** [AUTO] Any `driver` and `evidence` values present in `data/annotations.json` are
applied to the corresponding legacy row's `driver` and `notes` fields (not discarded).
Specifically: `2026-06-09` legacy row has `driver='infrastructure'` after migration.

**AC-2.2** [AUTO] For each legacy day with Code data, the `total_tokens` of the corresponding
`legacy-{date}` row equals `claude_code_input + claude_code_output + claude_code_cache_read +
claude_code_cache_create` from the source JSON.

**AC-2.3** [AUTO] Migration is idempotent — running `migrate_legacy.py` twice produces the same row
count (ON CONFLICT DO NOTHING).

**AC-2.4** [MANUAL] Dashboard loaded after migration shows the same 22-day history as v1. The
grand total displayed in the KPI cards is within ±1% of the v1 total (minor rounding acceptable).

---

## AC-3: OB MCP — `record_code_session`

**AC-3.1** [AUTO] Tool exists and is registered in the OB MCP server (verified by listing tools
from the Edge Function endpoint).

**AC-3.2** [AUTO] Calling `record_code_session` with valid inputs returns a confirmation string
containing `upserted`, `id:`, and `total_tokens:`.

**AC-3.3** [AUTO] Calling `record_code_session` twice with the same `session_id` + `machine`
produces exactly one row (upsert, not duplicate insert).

**AC-3.4** [AUTO] `record_code_session` with an invalid `driver` value returns an error response
(`isError: true`).

**AC-3.5** [AUTO] `record_code_session` with a negative token count returns an error response.

**AC-3.6** [AUTO] `record_code_session` with a malformed `session_date` (e.g., `"2026-13-01"`)
returns an error response.

**AC-3.7** [AUTO] `notes` exceeding 500 characters is truncated to exactly 500 characters in the
stored row.

---

## AC-4: OB MCP — `record_chat_session`

**AC-4.1** [AUTO] Tool exists and is registered in the OB MCP server.

**AC-4.2** [AUTO] Calling `record_chat_session` with `estimated_tokens=75000` inserts a row with
`total_tokens = 75000`, `agent = 'claude-chat'`, `fidelity = 'estimated'`, `machine = 'ariel'`.

**AC-4.3** [AUTO] Each call to `record_chat_session` (even with same date) inserts a NEW row
(no upsert dedup — each chat session is distinct, identified by UUID-based session_id).

**AC-4.4** [AUTO] `record_chat_session` without a `session_date` defaults to today's UTC date
(YYYY-MM-DD).

**AC-4.5** [AUTO] `record_chat_session` with an invalid `driver` value returns an error.

**AC-4.6** [AUTO] `record_chat_session` with `estimated_tokens = 0` is accepted (zero-token
sessions are valid).

---

## AC-5: Python Collector

**AC-5.1** [AUTO] `python scripts/collect.py --dry-run` succeeds without database credentials
(no network call made in dry-run).

**AC-5.2** [AUTO] Running the collector with a known session fixture produces an upsert with the
correct token totals matching `input + output + cache_read + cache_create` from the JSONL.

**AC-5.3** [AUTO] Running the collector twice on the same unchanged JSONL files results in zero
Supabase upsert network calls (`.collect-state.json` content-hash dedup works).

**AC-5.4** [AUTO] Running the collector on a modified JSONL file (hash changed) upserts the new
totals, replacing the old row.

**AC-5.5** [AUTO] Malformed JSONL lines are skipped; the session is still processed using valid lines.

**AC-5.6** [AUTO] `public/data/daily-burn.json` no longer exists after running `make collect`
(no output file written).

**AC-5.7** [MANUAL] After running the collector on both Codex and Claude Code, the dashboard shows
data from both machines without requiring a git pull on either.

---

## AC-6: Vercel Proxy — `/api/daily`

**AC-6.1** [AUTO] `GET /api/daily` returns a JSON array of `DayRecord` objects.

**AC-6.2** [AUTO] Each `DayRecord` in the response contains all required fields:
`date`, `total_exact`, `total_est`, `claude_code_sessions`, `claude_chat_sessions`,
`claude_code_api_requests`, `sources`, `driver`.

**AC-6.3** [AUTO] `GET /api/daily?since=2026-06-01` returns only records with `date >= 2026-06-01`.

**AC-6.7** [AUTO] `GET /api/daily?since=not-a-date` returns HTTP 400 with `{ error: string }` (malformed date rejected before Supabase call).

**AC-6.4** [AUTO] `GET /api/daily` returns HTTP 200 with `Content-Type: application/json`.

**AC-6.5** [AUTO] The `SUPABASE_SERVICE_ROLE_KEY` does not appear anywhere in the compiled
JavaScript bundle (`dist/assets/*.js`). Grep for the key prefix (first 10 chars) in build output.

**AC-6.6** [MANUAL] The dashboard loads without CORS errors in the browser console.

---

## AC-7: Vercel Proxy — `/api/sessions`

**AC-7.1** [AUTO] `GET /api/sessions` returns a JSON array of `SessionRecord` objects.

**AC-7.2** [AUTO] Each `SessionRecord` contains: `id`, `session_id`, `machine`, `session_date`,
`agent`, `total_tokens`, `api_requests`, `driver`, `notes`, `fidelity`, `created_at`.

**AC-7.3** [AUTO] `GET /api/sessions?date=2026-06-09` returns only sessions for that date.

**AC-7.4** [AUTO] `GET /api/sessions?limit=5` returns at most 5 records.

**AC-7.5** [AUTO] `GET /api/sessions` returns HTTP 200 with `Content-Type: application/json`.

---

## AC-8: Frontend

**AC-8.1** [AUTO] Dashboard loads without runtime errors (no console errors on initial load).

**AC-8.2** [AUTO] Heatmap renders cells for all 22+ days with correct color bins (log scale).

**AC-8.3** [AUTO] Heatmap tooltip shows `total_exact` and `total_est` values when hovering a
populated cell.

**AC-8.4** [AUTO] Header KPI cards show grand total tokens (exact), time range, and session counts.

**AC-8.5** [AUTO] TrendLine renders a line chart for all available dates.

**AC-8.6** [AUTO] DailyTable shows rows sorted descending by date.

**AC-8.7** [AUTO] Drivers view shows "Annotate sessions to see drivers" when all `driver` fields
are null/empty.

**AC-8.8** [AUTO] ScaleEquivalents shows disclaimer text "These are scale translations, not
measured utility".

**AC-8.9** [AUTO] Time range selector (30d/90d/1y/all) filters the displayed data correctly.

**AC-8.10** [AUTO] `src/hooks/useTokenData.ts` no longer references `/data/daily-burn.json`
(grep check).

**AC-8.11** [MANUAL] Dashboard deployed to Vercel production URL loads real data from Supabase
within 3 seconds on a standard connection.

---

## AC-9: File Cleanup

**AC-9.1** [AUTO] `public/data/daily-burn.json` does not exist in the repo.

**AC-9.2** [AUTO] `public/data/session-contributions.json` does not exist in the repo.

**AC-9.3** [AUTO] `public/data/session-hashes.json` does not exist in the repo.

**AC-9.4** [AUTO] `data/annotations.json` does not exist in the repo.

**AC-9.5** [AUTO] `dist/` directory is not committed (no dist files in git history after v2 commit).

---

## AC-10: CLAUDE.md and Documentation

**AC-10.1** [MANUAL] `open_brain/CLAUDE.md` Session End section includes a step to run
`make collect` from the token-burn directory.

**AC-10.2** [MANUAL] `token-burn/Makefile` has a `collect` target that runs the updated collector.

**AC-10.3** [MANUAL] `token-burn/Makefile` has a `migrate` target that runs the legacy migration script.

**AC-10.4** [MANUAL] Session notes written at end of this session include the exact text Brett
should paste into Claude Chat's Claude.ai project instructions.

---

## AC-11: TypeScript Compilation

**AC-11.1** [AUTO] `tsc --noEmit` exits 0 with no errors in the frontend.

**AC-11.2** [AUTO] `tsc --noEmit` in the Vercel API routes exits 0 (or the proxy routes are
valid TypeScript that Vercel can compile).

**AC-11.3** [AUTO] No unused imports or variables (`noUnusedLocals: true` is enforced).

---

## AC-12: Existing Tests Do Not Break

**AC-12.1** [AUTO] All previously-passing Playwright UI tests continue to pass after v2 changes.
The Playwright config intercepts `/api/daily` and `/api/sessions` (not `/data/daily-burn.json`).
Mock responses use the v2 `DayRecord` and `SessionRecord` shapes from SPEC §8.1.
The mock migration (build step 9) must complete BEFORE file deletion (build step 11).

**AC-12.2** [AUTO] Python collector unit tests (`tests/collector/test_collect.py`) are updated
for the new Supabase-based collect function. All tests pass.

---

*End of ACCEPTANCE_CRITERIA_v2.md*
