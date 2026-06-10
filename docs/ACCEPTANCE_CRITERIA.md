# Token Burn Dashboard — Acceptance Criteria

**Version:** 2.0 (post-adversarial review)  
**Date:** 2026-06-09  
**Written by:** Cadence  
**Status:** Final — cleared for build

All criteria must pass before the build is considered complete.
Tests in `tests/` are written independently by the Testing Agent.
The Builder does not write or modify test files.

---

## AC-1: Collector — Token Math

**AC-1.1** Given a JSONL fixture with exactly two assistant messages:
- Message A: `input=100, output=50, cache_read=1000, cache_create=500`
- Message B: `input=200, output=100, cache_read=2000, cache_create=1000`

Running `collect.py` produces a row where:
- `claude_code_input = 300`
- `claude_code_output = 150`
- `claude_code_cache_read = 3000`
- `claude_code_cache_create = 1500`
- `total_exact = 4950`
- `claude_code_api_requests = 2`

Tolerance: exact integer match.

**AC-1.2** Running `collect.py` twice on the same set of session files produces
byte-for-byte identical `daily-burn.json` output (idempotency).

**AC-1.3** Adding a new session file (different session ID) and re-running `collect.py`:
- If new session is a new date: adds exactly one new row.
- If new session is the same date as existing: updates that date's row with additive token counts; row count unchanged.
- No rows are duplicated.

**AC-1.4** A JSONL file containing malformed lines (unparseable JSON interspersed with
valid lines) does not crash the collector. All valid lines are processed. The malformed
lines produce a warning to stderr. Final token counts reflect only the valid lines.

**AC-1.5** A JSONL file where `record.timestamp` is `2026-06-10T07:00:00Z` (= 2026-06-09
in US/Pacific) produces a `daily-burn.json` row with `date = "2026-06-09"`. A record with
`2026-06-10T08:00:00Z` (= 2026-06-10 PT) produces `date = "2026-06-10"`.

**AC-1.6** Midnight-spanning session: a session file whose first record has timestamp
`2026-06-10T06:55:00Z` (= 2026-06-09 23:55 PT) and whose last record has timestamp
`2026-06-10T07:15:00Z` (= 2026-06-10 00:15 PT) is bucketed entirely into `2026-06-09`
(the date of the first record in Pacific time). All tokens from the file appear in the
`2026-06-09` row. No tokens appear in the `2026-06-10` row from this file.

**AC-1.7** `annotations.json` containing `{"2026-06-09": {"driver": "code", "evidence": "feature work", "claude_chat_sessions": 3}}` produces a `daily-burn.json` row for `2026-06-09` where:
- `driver = "code"`
- `evidence = "feature work"`
- `claude_chat_sessions = 3`
- `claude_chat_est = 225000` (3 × 75000 default)

**AC-1.8** Annotations survive re-collection: if `annotations.json` is unchanged and
`collect.py` is re-run on the same session files, the `driver`, `evidence`, and
`claude_chat_sessions` values in the output are unchanged.

**AC-1.9** Changing `annotations.json` (e.g., updating `driver` from `"code"` to
`"memoir"`) and re-running `collect.py` produces a row where `driver = "memoir"`. The
annotation always overwrites the previous value (most-recent annotation wins).

**AC-1.10** The output schema is exactly closed. Running `collect.py` on any valid
input produces rows with exactly these 14 keys:
`date, claude_code_input, claude_code_output, claude_code_cache_read, claude_code_cache_create, claude_code_api_requests, claude_code_sessions, claude_chat_sessions, claude_chat_est, total_exact, total_est, sources, driver, evidence`

No other keys are present. Presence of any additional key is a test failure.

**AC-1.11** Two collect runs with different `--machine` values on separate session files
for the same date:
- Run 1: `--machine cadence` → produces `sources: ["cadence"]`, `total_exact = X`
- Run 2: `--machine coda` on different session files (different session IDs / file paths) → produces `sources: ["cadence", "coda"]`, `total_exact = X + Y` (additive)
- The dedup key for session files is the full file path. Re-running with the same `--machine` and same file paths produces no change (idempotent).
- Re-running Run 2 again does not add `coda` twice to `sources`.

---

## AC-2: Collector — CLI

**AC-2.1** `collect.py --dry-run` prints the reconciliation summary to stdout but does
not write or modify `daily-burn.json`.

**AC-2.2** `collect.py --verbose` prints one tab-separated line per session file to stdout in the format:
`<session_id>\t<date>\t<input>\t<output>\t<cache_read>\t<cache_create>\t<api_requests>`

**AC-2.3** `collect.py --sessions-root /tmp/test-sessions/` collects from the specified
path. Sessions at `~/.claude/projects/` are not scanned.

**AC-2.4** `collect.py --chat-tokens-per-session 50000` uses 50000 as the multiplier
for `claude_chat_est`. Given `claude_chat_sessions = 2`, `claude_chat_est = 100000`.

**AC-2.5** `collect.py --machine mybox` sets `sources = ["mybox"]` on all rows written
in that run.

---

## AC-3: Data Loading

**AC-3.1** The dashboard loads `daily-burn.json` via static fetch — no API server
process required. `npm run dev` alone is sufficient to serve the full dashboard.

**AC-3.2** If `daily-burn.json` contains `[]` (empty array), the dashboard renders
without JavaScript errors and displays the message: "No data yet — run `make collect`
to get started."

**AC-3.3** A `daily-burn.json` with 365 rows renders without console errors or
visible layout breakage.

---

## AC-4: View 1 — Daily Burn Heatmap

**AC-4.1** Every day in the selected time range has a rendered cell in the heatmap grid,
including days with `total_exact = 0` and `total_est = 0`.

**AC-4.2** A cell for a day with `total_exact = 1000000` (1M) and a cell for a day with
`total_exact = 100000` (100K) must have visually distinct background colors (different
CSS class or different inline style value). A linear color scale that maps both to
nearly the same color is a test failure.

**AC-4.3** A cell with `total_exact = 0` and `total_est > 0` (pure Ariel day) has
`data-estimated="true"` on the DOM element. A cell with `total_exact = 0` and
`total_est = 0` does NOT have `data-estimated="true"`.

**AC-4.4** Hovering a cell with `total_exact > 0` shows a tooltip containing the date
string, the `total_exact` value, and the text "measured".

**AC-4.5** Hovering a cell with `total_est > 0` shows a tooltip containing the
`total_est` value and the text "estimated".

**AC-4.6** Switching the time range selector from 90d to "all" changes the number of
rendered heatmap cells (verified by cell count in the DOM).

**AC-4.7** Week columns start on Sunday. A Monday date and the following Sunday date
are in adjacent columns (not the same column).

---

## AC-5: View 2 — Weekly Trend Line

**AC-5.1** The Recharts `YAxis` component uses `scale="log"`. A week with 10M tokens
and a week with 100M tokens are plotted at different y-positions (not the same pixel).

**AC-5.2** The peak week (highest weekly total) is labeled directly on the chart with
its total value and its week-start date.

**AC-5.3** Switching the time range selector changes the number of data points on the
trend line.

**AC-5.4** Week boundaries use Sunday-start, matching the heatmap. A week's total
is the sum of `total_exact` for days Sunday through Saturday.

---

## AC-6: View 3 — Burn Drivers

**AC-6.1** If fewer than 7 days within the currently-selected time range have a
non-empty `driver` field, the component renders the text "Annotate sessions to see
drivers" and no bars.

**AC-6.2** When driver bars are rendered, they are in descending order by token share
(largest share first, leftmost/topmost bar).

**AC-6.3** Each bar displays the driver label string and a percentage value.

**AC-6.4** Switching the time range selector changes which driver bars are shown (if
the annotation distribution differs by range).

---

## AC-7: View 4 — Scale Equivalents

**AC-7.1** All five scale equivalent cards are rendered: query-equivalents, electricity
(kWh), Netflix movies, code volume (LOC), engineer-years.

**AC-7.2** Each card shows the formula used (e.g., "total_exact / 1000").

**AC-7.3** The disclaimer text "These are scale translations, not measured utility,
billing, or environmental accounting" is visible on the page.

**AC-7.4** Scale equivalent calculations use `total_exact` only. A `daily-burn.json`
with `total_exact = 1000` and `total_est = 500` produces query-equivalents of 1
(not 1.5).

**AC-7.5** Scale equivalents update when the time range selector changes.

---

## AC-8: View 5 — Daily Detail Table

**AC-8.1** Table renders with columns: Date, Total Exact, Claude Code, Claude Chat Est,
Sessions, API Requests, Driver.

**AC-8.2** Every cell in the "Claude Chat Est" column with a non-zero value has
`data-fidelity="estimated"` on the DOM element.

**AC-8.3** The "Total Exact" column header contains the text "MEASURED" or has a badge
element with that text.

**AC-8.4** Rows are sorted most-recent-first by default.

**AC-8.5** Table row count matches the number of days in the selected time range.

---

## AC-9: Fidelity Integrity (non-negotiable)

**AC-9.1** No UI element displays a value that is the sum of `total_exact` and
`total_est` without clearly labeling both components. Specifically: the header KPI
area shows exact total and estimated total as two separate elements. There is no
combined "grand total" anywhere on the page.

**AC-9.2** Searching the DOM for elements with text content containing "estimated" or
badge attribute `data-fidelity="estimated"` yields at least one result whenever
`total_est > 0` for any day in the selected range.

**AC-9.3** Searching the DOM for elements with text content containing "measured" or
badge attribute `data-fidelity="measured"` yields at least one result whenever any
Claude Code data is in the selected range.

---

## AC-10: Code Quality

**AC-10.1** `npm run build` exits 0 with TypeScript strict mode. Zero type errors.

**AC-10.2** `pytest tests/collector/` — all tests pass.

**AC-10.3** `npx playwright test` against a local dev server seeded with a 30-row
fixture `daily-burn.json` — all UI tests pass.

**AC-10.4** Browser console shows no `console.error` calls when the dashboard is loaded
with the 30-row fixture data. (Playwright tests use the fixture, not the live data file,
to make tests portable across environments.)

**AC-10.5** The collector contains no bare `except:` clauses. All exception handling
is specific (e.g., `except json.JSONDecodeError`).

---

## AC-11: Deployment

**AC-11.1** `make collect` runs end-to-end and produces a valid `daily-burn.json`
without manual intervention.

**AC-11.2** `make dev` starts Vite and the dashboard is accessible at `localhost:5173`
within 10 seconds.

**AC-11.3** `make build` produces a `dist/` directory. `dist/index.html` exists and
contains a `<script>` tag.

**AC-11.4** `make test` runs both `pytest tests/collector/` and `npx playwright test`
and reports a combined exit code (0 = all pass, non-zero = any failure).

---

## Test Authorship Rule

All `.py` files in `tests/collector/` and all `.ts` files in `tests/ui/` are written
by the Testing Agent. The Builder does not write or modify these files.

Fixture files in `tests/collector/fixtures/` (JSONL and expected JSON) may be created
by either party — they are test data, not test logic.
