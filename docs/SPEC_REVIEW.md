# Token Burn Dashboard — Adversarial Spec Review

**Reviewer:** Claude Sonnet 4.6 (adversarial pass)  
**Date:** 2026-06-09  
**Documents reviewed:** SPEC.md v1.0, ACCEPTANCE_CRITERIA.md v1.0  
**Verdict:** FAIL — 6 critical issues must be resolved before building

---

## Summary

The spec is well-structured and shows real thought about fidelity separation — the
MEASURED/ESTIMATED honesty constraint is genuinely well-articulated and the schema is
mostly sound. However, it has six critical defects that would cause either a broken
implementation or a faithless one. The most dangerous: `total_exact` is silently
double-counted on days that receive data from both Codex and the future Claude Code iMac
import (the multi-source aggregation logic is completely unspecified). The second most
dangerous: the timezone bucketing rule applies to session timestamps but JSONL session
files are named by session ID, not date — the spec never says where the timestamp
actually lives inside the JSONL, making AC-1.6 untestable with the information given.
There are also meaningful gaps in edge case handling, fidelity enforcement in the
aggregation layer (not just the UI layer), and three views whose AC coverage is too thin
to catch a wrong implementation.

---

## Critical Issues (must fix before building)

**1. The multi-source aggregation problem is completely unspecified.**

The spec defines `claude_code_sessions` as "count of JSONL files contributing to this
date" and describes a future iMac import path. But it never defines what happens when
both Codex and Claude Code contribute sessions to the same date. Does the collector:
- Sum `input_tokens` from both machines into one row?
- Produce two rows (one per machine)?
- Tag rows with a `source` field?

There is no `source` field in the schema. If you naively run `collect.py --sessions-root
~/.claude/projects/` on Codex and then again with the iMac path on the same
`daily-burn.json`, you either silently corrupt the output or correctly upsert — but
which behavior is correct is nowhere specified. A developer building the iMac import
path in the future will be forced to make this up. This is not a "future problem" —
the upsert logic must be designed now to be correct for the single-machine case and
extendable to multi-machine.

**Fix:** Define the aggregation key explicitly. Add a `sources` field to the schema (e.g.,
`["cadence", "coda"]`). Define whether `make collect-iMac` produces a second invocation
of the same script (requiring additive merge logic) or produces a separate file that
gets merged in a post-processing step.

---

**2. The timezone bucketing rule references a timestamp field that is never located.**

AC-1.6 says: "A session whose UTC timestamp is `2026-06-10T02:00:00Z` appears under
`2026-06-09` in the output." The spec says dates are bucketed from "JSONL timestamp."
But neither document says:
- Which field inside a JSONL message record contains the timestamp
- Whether that timestamp is on every message or only some
- Whether the collector should use the first message's timestamp, the last message's
  timestamp, or the median

Claude Code JSONL files contain records with a `timestamp` field per message. But a
session spanning midnight (e.g., started at 11:45 PM Mountain, ended at 12:15 AM Mountain)
will have messages on both sides of midnight. The spec says nothing about which bucket
those messages go into. Two reasonable implementations diverge here:
- Bucket each message individually by its own timestamp (one session can contribute to
  two dates)
- Bucket the entire session by the first (or last) message timestamp (all-or-nothing
  per session)

These produce different `total_exact` values for midnight-spanning sessions. This is
directly testable by AC-1.6 but the AC provides only a clean non-edge-case timestamp.
The AC passes with either implementation.

**Fix:** Name the exact field path used for bucketing (e.g., `record.timestamp`). Specify
whether bucketing is per-message or per-session-file. Add a midnight-spanning fixture to
AC-1.6 that makes the expected behavior unambiguous.

---

**3. The `claude_code_calls` field definition is ambiguous and probably wrong.**

The spec defines `claude_code_calls` as "Count of messages with `usage` field." But in
Claude Code JSONL format, `usage` appears on `assistant` messages (the API response),
not on `user` or `tool_result` messages. There are two possible counts:
- Total messages with a `usage` field (all API response turns)
- Total "user turns" (human messages initiating a call)

These are not the same number. A single tool call chain (user → assistant → tool_use →
tool_result → assistant) has two assistant messages with `usage` but represents one
conceptual "call" from the user's perspective. If the intent is "API requests made to
Anthropic," counting all assistant messages with `usage` is correct. If the intent is
"conversational turns the user initiated," it's wrong.

Worse: the spec uses "calls" in the View 5 table column and the reconciliation summary
(`[collect] 2026-06-09: exact=5,831,412 est=0 sessions=3`) without clarifying which
definition is in use.

**Fix:** Define precisely: is `claude_code_calls` the count of assistant messages with a
`usage` block, or the count of unique user turns? Both are defensible — pick one and
name it.

---

**4. Fidelity enforcement is specified only at the UI layer, not at the data layer.**

The spec's honesty constraint says "exact and estimated values are never summed into a
single unlabeled total." AC-9.1 checks this at the UI (header KPI). But the data layer
has no corresponding constraint. Specifically:

- `total_exact` in the schema is always Claude Code only
- `total_est` is always Claude Chat only
- But nothing in the collector spec prevents a careless future implementation from
  writing `total_exact + total_est` into some new field (e.g., a convenience `total`
  field added during a refactor)
- The schema itself has no `total` field, which is correct — but the schema spec never
  explicitly prohibits adding one, and never says "this field must not be created"

More concretely: the `makeCollect-iMac` future path could accidentally fold iMac's
Claude Code tokens into `total_est` if the developer reads `total_est` as "everything
not from this machine." The fidelity guarantee needs to live in the data layer contract,
not just the UI layer.

**Fix:** Add an explicit schema constraint: no field may combine exact and estimated
values. The schema should be declared closed (no additional fields without spec update).
The collector tests should assert that the output schema has exactly these fields and
no others.

---

**5. The `claude_chat_sessions` count mechanism is completely unspecified.**

The spec says Claude Chat sessions are entered "manually — Brett enters weekly" but
gives no mechanism for how this manual entry becomes data. The collector reads
`data/annotations.json` for driver/evidence — does Brett also put `claude_chat_sessions`
there? Does he edit `daily-burn.json` directly? Is there a separate data entry script?

AC-1.7 covers annotation merge for `driver` and `evidence` but says nothing about
`claude_chat_sessions`. The flow for the Claude Chat lane is a black hole.

**Fix:** Define the data entry path for `claude_chat_sessions` explicitly. Either:
(a) Extend `annotations.json` to include `claude_chat_sessions` per date, or
(b) Add a separate `data/chat-sessions.json` file with its own schema, or
(c) Add a CLI flag `--chat-sessions DATE N` to the collector.
Then add an AC covering this path.

---

**6. `total_exact` formula conflicts with its own field definition.**

The spec's field table says:
> `claude_code_input` — Excludes cache

And the `total_exact` formula says:
> `total_exact = claude_code_input + claude_code_output + claude_code_cache_read + claude_code_cache_create`

This is internally consistent — `claude_code_input` is the non-cached input tokens,
and the cache tokens are in their own fields, so `total_exact` correctly sums all four.

However, the source fields in the JSONL are:
- `message.usage.input_tokens` — Anthropic's docs describe this as the total input
  tokens INCLUDING cached tokens in some API versions, and EXCLUDING in others

Whether `input_tokens` includes or excludes cache depends on the API version. If the
JSONL was generated by a Claude Code version that reports `input_tokens` as the total
(with cache already included), then separately adding `cache_read_input_tokens` and
`cache_creation_input_tokens` will double-count cache tokens.

**Fix:** Verify empirically which Claude Code JSONL format is in use. Add a fixture
showing a known session with known cache usage and assert the exact expected
`total_exact`. The formula note "This matches Anthropic's billing model" should cite
the specific API behavior being assumed.

---

## Significant Issues (should fix)

**7. Heatmap cell coloring uses `total_exact` only, but the AC doesn't test what
happens when a day has only estimated data.**

AC-4.5 says "Cells from `total_exact` and `total_est` are visually differentiated (e.g.,
estimated days get a subtle indicator)." But how is a day with `total_exact = 0` and
`total_est > 0` (a pure Claude Chat day) colored? By `total_exact` only, it would appear as
an empty cell even though significant work happened. The spec says "Cells colored by
`total_exact` only" which is correct for fidelity, but the dot indicator for estimated
data described in the spec is too subtle to find significant pure-Claude Chat days.

A user might legitimately want to see "this was an Claude Chat-heavy day" at a glance. The
current spec makes that nearly invisible, and there is no AC that tests whether a
pure-Claude Chat day is distinguishable from a zero-activity day.

**8. The weekly trend line (View 2) bucketing is undefined.**

The spec says "7-day rolling total, one point per week." But does a "week" start on
Sunday (GitHub contribution style, matching the heatmap) or Monday (ISO week)? The
heatmap layout is Sunday-Saturday. If the trend line uses a different week boundary,
days near week edges will be counted in different buckets across the two views,
producing inconsistent-looking data. AC-5 has no criterion testing week alignment.

**9. AC-4.5 describes visual differentiation for estimated cells but does not specify
what the indicator looks like, making it unautomatic to Playwright-test.**

"A subtle dot indicator" (from the spec) is not testable as-is. Playwright can check
for the presence of a DOM element with a specific class or aria-label, but not for
"subtlety." The AC should specify a concrete, testable indicator (e.g., a `data-estimated`
attribute, a specific CSS class, or a small badge element) that a Playwright test can
assert `toBeVisible()` against.

**10. The 7-annotated-days threshold in View 3 is applied to the full dataset, not the
selected range.**

AC-6.1 says "If fewer than 7 days in the selected range have a non-empty `driver` field."
The spec says "If fewer than 7 days are annotated" — the spec doesn't scope this to the
current range. If a user selects a 30-day range that contains only 5 annotated days, but
there are 20 annotated days in the full dataset, the behavior differs between
implementations that read the spec literally versus those that read the AC literally.
The AC is correct (range-scoped) but the spec should be updated to match.

**11. `annotations.json` merge is one-directional and overwrite behavior is undefined.**

AC-1.8 says "annotations survive re-collection." But what happens if Brett changes an
annotation after the day's tokens are already collected? The collector must merge
annotation values over the existing row — but the spec doesn't say whether the merge is:
- Always overwrite annotation fields from `annotations.json`
- Only write if the field is currently empty
- Fail if annotation conflicts with existing non-empty value

"Annotations survive re-collection" is satisfied by all three behaviors. The idempotency
AC (AC-1.2) runs on the same files twice — but doesn't test whether changing
`annotations.json` between runs produces the expected change in output.

**12. Scale Equivalents (View 4) uses `total_tokens` undefined in the formula table.**

The formula table in View 4 reads:
> `Query-equivalents = total_tokens / 1000`

But `total_tokens` is not a schema field. It should presumably be `total_exact` (since
mixing exact and estimated would violate the honesty constraint). But the spec doesn't
say. A developer might implement this as `total_exact + total_est` (a "grand total")
which would violate the fidelity principle. AC-7.1 doesn't specify which token source
feeds the equivalents.

**Fix:** Replace `total_tokens` in the formula table with `total_exact` (or explicitly
define `total_tokens` and state whether it includes estimates).

---

## Minor Issues (nice to fix)

**13. `AC-1.5` is testing business logic that belongs in a separate document.**

AC-1.5 tests a specific project name extraction rule: path `-Users-brettcoryell-Code-AI-open-brain`
→ `open_brain`. But the spec never defines the project name extraction algorithm. There
is no field in the schema for project name (only `driver` and `evidence`). What is this
extracted project name used for? The schema doesn't include a `project` field. AC-1.5
tests behavior that doesn't connect to any schema output or UI display.

If project names are used internally for something (e.g., per-project breakdowns in a
future view), that future use must be spec'd. If they're not used at all in v1, AC-1.5
is testing dead code.

**14. `--chat-tokens-per-session` flag is mentioned in the spec but has no AC.**

AC-2 covers `--dry-run`, `--verbose`, and `--sessions-root` but not
`--chat-tokens-per-session`. A developer who skips implementing this flag (or implements
it with the wrong default) will pass all ACs.

**15. The time range selector options are inconsistent between the spec and the ACs.**

The spec says: "Time range selector: 30d / 90d / 1y / all" (four options).  
View 2 says: "90d / 180d / 1y / all" (different second option).  
The spec then says "Default: 90d."

The discrepancy between "30d" (global controls section) and "180d" (View 2 section) is
a contradiction. Neither AC-4 nor AC-5 specifies which options the range selector
contains, so a developer will have to pick one arbitrarily.

**16. The header KPI card "SESSIONS" is ambiguous.**

The header shows `SESSIONS` defined as "sum of `claude_code_sessions` for range." But
`claude_code_sessions` is "count of JSONL files contributing to this date." If Brett
runs multiple collect passes on overlapping session roots, can one JSONL file be counted
twice? The sessions count is meant to represent something human-meaningful ("I had 3
sessions today") but the file-count definition doesn't guarantee 1:1 correspondence with
actual working sessions.

**17. The `evidence` field (string) has no length constraint or truncation behavior.**

The spec shows `evidence` as a free-form string (e.g., "Mac Mini bootstrap, portability
work, MSM v3 closeout"). In View 3, hovering shows the evidence string "for top
contributing days." There is no specified max length, truncation rule, or overflow
behavior. A very long evidence string could break the hover tooltip layout. No AC covers
this.

**18. The Moving Average Table (View 5) says "rolling 30-day averages" in the spec's
heading but the column definition doesn't show an average column.**

View 5 is titled "Moving Average Table" and described as "Per-day breakdown with rolling
30-day averages." But the columns listed are `Date | Total Exact | Claude Code | Claude
Chat Est | Sessions | Calls | Driver` — there is no rolling average column. Is the
rolling average shown as an annotation, a chart overlay, or is it simply absent despite
the view being named for it? AC-8 doesn't mention an average column either. If there is
no average, the view should be renamed "Daily Detail Table" to avoid confusion.

**19. No AC covers the `--verbose` output format.**

AC-2.2 says `--verbose` prints per-session token counts to stdout. But there's no
assertion about the format of this output, making it impossible to test automatically.
If verbose output is meant to be machine-readable (for piping to other tools), the
format matters. If it's human-readable only, the test should at least assert it contains
certain tokens.

**20. The Vercel deployment path has a hidden assumption about file commit behavior.**

The spec says `daily-burn.json` is committed to the repo, so Vercel has it at build
time. But if `make collect` runs on the Mac Mini and commits/pushes, then Vercel will
serve stale data between pushes. The spec states "daily cron is sufficient" but the
cron runs at 23:00 local time — if Vercel redeploys on every push (including non-data
pushes like UI changes), it will serve whatever the last committed `daily-burn.json`
contains, which may be hours old. The spec should state explicitly that Vercel serves
the committed snapshot and is expected to be up to 24 hours behind.

**21. The Playwright tests have no spec for what "real data" means in AC-10.4.**

AC-10.4 says "Opening the browser console with real data shows no `console.error`." But
the test suite's fixture data (in `tests/collector/fixtures/`) is test data, not "real
data." Does AC-10.4 mean: (a) load the actual current `public/data/daily-burn.json` in
the Playwright test, or (b) use a representative fixture? These have different
implications — (a) makes the test environment-dependent (fails on a clean checkout),
(b) requires the fixture to be "real enough" to trigger data-dependent errors.

---

## Verdict: FAIL

**Must resolve before building (Critical Issues 1–6):**

1. Multi-source aggregation for iMac import is unspecified — upsert logic will be
   designed wrong and will be hard to fix after data exists
2. Timestamp field location and midnight-spanning session bucketing are unspecified —
   AC-1.6 is untestable as written
3. `claude_code_calls` definition is ambiguous — count of API requests vs. user turns
4. Fidelity enforcement exists only in the UI layer, not the data layer contract
5. `claude_chat_sessions` manual entry mechanism is a complete black hole
6. `input_tokens` double-counting risk with cache tokens depending on API version

**Blocking inconsistency that must be corrected:**
- Time range selector options differ between the global controls section (30d/90d/1y/all)
  and the View 2 section (90d/180d/1y/all) — pick one and make it consistent everywhere

**The fidelity constraint is the soul of this spec.** Issues 4, 5, and 6 all threaten
it at the data layer. A dashboard that shows correct labels on wrong numbers is worse
than no dashboard.
