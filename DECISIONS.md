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

**Addendum (2026-10-23): labelled scaled estimates.** Brett: "I think scaling the 159
uncorrected rows is fine." D15 left 159 Claude Code rows (5,978.8M tokens) as recorded because
their transcripts no longer exist and a recount is impossible; recorded under the old per-line
convention they run about 1.87× high. They are now stored as `fidelity='estimated'`,
`agent='claude-code'` rows, scaled by 1.873 (the pooled recorded-to-recounted ratio over 253
rows recounted in D15; monthly ratios 1.81–1.93), and are never counted as measured.
- **Originals preserved:** `token_sessions.pre_scale_counts` (jsonb) holds the counts as
  recorded, the factor, the method and the date. To undo, restore the counts from it and set
  `fidelity='exact'`.
- **Three separate numbers:** `get_daily_summary` returns `total_exact` (measured),
  `total_est` (Claude Chat estimates, unchanged meaning) and `total_scaled` (scaled Claude Code
  estimates). `total_scaled` is never added into `total_exact` or `total_est`.
- **Always labelled:** wherever the dashboard shows or sums scaled tokens it says "scaled
  estimate" and uses the estimated chip and `--tb-yellow`, never measured styling.
- **Scope:** only rows D15 could not recount. New Claude Code rows stay `exact` because the
  collector counts them from transcripts. D8's "total_exact includes all exact rows" still
  holds; these rows are simply no longer exact.

**Violation looks like:** Summing `total_scaled` into a "measured" or "exact" figure. Scaling a
row that has a surviving transcript instead of recounting it. Dropping `pre_scale_counts`.

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

**Addendum (2026-10-12): no event stream.** `api/mcp.ts` answers GET with 405 and never holds
an SSE stream open. Each connected Claude/Codex session's open GET stream kept a Fluid function
alive. From 2026-09-30 that used 1,082 of the account's 1,083 GB-hours of provisioned memory
(300% of Hobby), and Vercel paused every project on the account. `vercel.json` also caps
`api/mcp.ts` at 30 s / 512 MB. Re-enabling GET streaming is a violation.

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

---

## D15: Claude Code replies are counted once; a resumed subagent is one session

**Decision (2026-10-23):** Brett ruled on the two collector bugs found in the
2026-10-22 ACUTE audit (`docs/audits/acute-audit-2026-10-22.md` §5). This amends the
usage-summing behavior the collector had since v2, and the file-name keying in D3/D9
for subagents.

1. **Count each reply once.** Brett: "Count each reply once." Claude Code writes several
   transcript lines per assistant reply (text, tool calls) and every line repeats the
   full `message.usage`; summing every line over-counted by about 1.9×. A reply is
   identified by `message.id`, with `requestId` as a fallback; a line with neither is
   counted as its own reply. If repeated lines of one reply disagree, each usage field
   keeps its largest value. `api_requests` is the number of distinct replies.
2. **Subagent tokens.** Brett: "the tokens go with the session that sees the end of the
   subagent." When a subagent is resumed under another parent session, Claude Code writes
   a second `subagents/agent-<id>.jsonl` under the new parent with the same file name.
   The collector groups a subagent's transcript files by subagent id (the file stem),
   counts each reply once across all of the files, and credits the total to the parent
   session of the file whose last reply is latest.
3. **History.** Brett: "Yes, I want to fix the history." Stored Claude Code rows are
   recounted with the fixed collector; the pre-rewrite rows are kept in a dated JSON
   backup under `docs/audits/`. Rows whose transcripts no longer exist cannot be
   recounted and are left as recorded, flagged in `notes` as uncorrected, never scaled.

**Why:** Both bugs inflated or lost real work. Across the mini's 271 transcripts there
were 76,806 usage lines for 40,550 distinct message ids (ratio 1.89), and 12 subagent ids
overwrote each other, losing ~169M deduplicated tokens, all ACUTE. The strict audit
reported 9 collision findings that no documented remediation could clear.

**Constraints:**
- `session_id` stays the transcript file stem (D3, D9 unchanged otherwise); a subagent's
  row is `agent-<id>` no matter how many parents it ran under.
- The parent session credited with a subagent is derived at collection time from the
  winning file's path, shown by `--verbose`, and stored in `token_sessions.parent_session_id`
  (see the addendum below). It is NULL for main sessions and Codex.
- Dedup and grouping apply to Claude Code transcripts only. Codex uses the cumulative
  `total_token_usage` from the latest token-count event and has no duplicate lines
  (D8, D14); `collect_codex` is untouched.
- Totals recorded before 2026-10-23 follow the old convention and are not comparable
  with later totals except for rows marked uncorrected, whose notes say so.

**Violation looks like:** Summing `usage` per transcript line. Keying a subagent row on
anything but its id, or letting the last file written win. Scaling uncorrectable rows by
the ~1.9 ratio instead of flagging them.

**Addendum (2026-10-23): `parent_session_id` column.** Brett approved storing the credited
parent ("Sounds fine to add that parent column"). `token_burn.token_sessions.parent_session_id`
is a nullable `text` column, added by `open_brain/supabase/migrations/20261023000000_token_sessions_parent_session_id.sql`
(applied with `supabase db query --linked`; that repo's migration history does not match the
remote, so `db push` was not used). `scripts/collect.py` sends it only for subagent rows. It
is not part of the upsert key, the driver taxonomy, or any API response. Older collectors that
omit it keep working; their subagent rows simply have NULL parent until recollected.

---

## D16: Token-accounting closeout also runs on a schedule, on every machine

**Decision (2026-10-23):** Each Mac runs `make token-accounting-closeout` unattended every
4 hours through a launchd user agent (`com.brettcoryell.token-burn-closeout`), installed with
`make install-scheduled-closeout`. Brett: "Scheduled token accounting is good. Do it on each
machine."

**Why:** Closeout depended on remembering to run it at the end of every session, and often
was not run. Sessions went uncollected for days, and Claude Code deletes old transcripts, so
a late collection can be a lost one: 159 rows had to be left uncorrected in D15 for exactly
that reason. Moving the real database `.env` onto each machine (it had been an iCloud symlink
that non-interactive shells cannot read) is what makes an unattended run possible.

**Constraints:**
- The job runs the D13 wrapper and nothing else; collection logic is not duplicated. The
  manual end-of-session closeout stays in force. The schedule is a safety net.
- `scripts/scheduled_closeout.sh` fast-forwards `master` before running, but only when the
  checkout is on clean `master`; it never touches a dirty or working branch.
- A failed run (including a dangerous strict-audit finding) exits non-zero, posts a macOS
  notification and logs to `~/Library/Logs/token-burn-closeout.log`.
- The job needs the machine's own readable `.env`. Do not point it at an iCloud symlink, and
  do not copy the key into the repo or the plist.
- Deleting or disabling the job on one machine reopens the gap for that machine's sessions.

**Violation looks like:** A second scheduled job that calls `make collect` directly. A plist
or script that embeds the Supabase key. Running the job from a worktree or feature branch.
