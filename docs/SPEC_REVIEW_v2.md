# Token Burn Dashboard — Adversarial Spec Review v2

**Reviewer:** Claude Sonnet 4.6 (second-pass verification)
**Date:** 2026-06-09
**Documents reviewed:** SPEC.md v2.0, ACCEPTANCE_CRITERIA.md v2.0, SPEC_REVIEW.md (original)
**Purpose:** Verify all 6 critical issues are resolved; identify new problems introduced by revision.

---

## Critical Issues — Verification Pass

**Issue 1 — Multi-source aggregation unspecified.**
RESOLVED. v2 adds a `sources` field to the schema, defines `(date, source)` as the unique ingest key, specifies additive merge behavior when multiple machines contribute to the same date, defines idempotency for repeated runs per machine, and adds AC-1.11 covering the two-machine scenario including deduplication on re-run. The Make targets (`make collect` / `make collect-iMac`) and the rsync-based cross-machine path are now explicit.

**Issue 2 — Timestamp field location and midnight-spanning sessions unspecified.**
RESOLVED. v2 names `record.timestamp` (top-level on each JSONL record, ISO 8601 UTC) as the source field, specifies bucketing is per-session-file using the first record's timestamp, and adds an explicit midnight-spanning rule: all tokens from a session go into the date of the first record. AC-1.6 is updated with a midnight-spanning fixture (session starts at 23:55 PT, last record at 00:15 PT the next day, all tokens bucketed to the earlier date).

**Issue 3 — `claude_code_calls` definition ambiguous.**
RESOLVED. v2 renames the field to `claude_code_api_requests` and defines it as "Count of records where `type == 'assistant'` AND `message.usage` exists" — unambiguously counting API response turns, not user turns. The reconciliation output and View 5 column are updated to match.

**Issue 4 — Fidelity enforcement only at UI layer, not data layer.**
RESOLVED. v2 promotes the honesty constraint to inviolable status with explicit schema-level language: "The schema is CLOSED — no field may be added that combines exact and estimated values. A `total` convenience field is explicitly prohibited." AC-1.10 asserts the output schema has exactly 14 fields and no others, with presence of any additional key being a test failure.

**Issue 5 — `claude_chat_sessions` entry mechanism unspecified.**
RESOLVED. v2 defines `claude_chat_sessions` as a field in `annotations.json` per-date (shown in the example JSON). AC-1.7 now covers this path explicitly: annotations containing `claude_chat_sessions: 3` produce `claude_chat_est = 225000`. AC-1.8 and AC-1.9 cover survivability and overwrite behavior.

**Issue 6 — `input_tokens` double-counting risk with cache tokens.**
RESOLVED. v2 adds an "Empirical verification" section with a concrete JSONL fixture showing `input_tokens = 3` when `cache_read_input_tokens = 14415` — confirming Claude Code JSONL reports only the non-cached portion in `input_tokens`. The formula note now explicitly states this matches Anthropic's billing model. The fixture makes the assumption testable and falsifiable.

---

## New Problems Introduced by v2

**A. AC-1.6 midnight-spanning fixture has a timezone error.**
AC-1.6 says: session first record is `2026-06-09T23:55:00Z` (= `2026-06-09 PT`) and last record is `2026-06-10T00:15:00Z` (= `2026-06-09 PT, still same day`). But `2026-06-10T00:15:00Z` in US/Pacific is `2026-06-09T17:15:00-07:00` — that is still 2026-06-09 PT. The comment says "still same day" which is correct, but only because both UTC timestamps are before the Pacific midnight (07:00 UTC). The fixture works but is labeled confusingly — it isn't actually a midnight-spanning session from the PT perspective. A genuine midnight-spanning session would start near `2026-06-10T06:55:00Z` (= 23:55 PT) and end at `2026-06-10T07:15:00Z` (= 00:15 PT next day). The test will pass, but a developer reading the fixture may not understand what edge case is being tested. Low severity but worth fixing.

**B. Schema field count assertion in AC-1.10 will be brittle if `sources` type is wrong.**
AC-1.10 asserts exactly 14 keys. The 14 keys listed include `sources` (a `string[]`). If an implementation serializes `sources` as a JSON string instead of a JSON array, the key count is still 14 but the schema is wrong. AC-1.10 should additionally assert that `sources` is a JSON array type, not just that the key exists.

**C. Multi-machine idempotency in AC-1.11 is underspecified.**
AC-1.11 says "Re-running Run 2 again does not add `coda` twice." But it doesn't define the mechanism that prevents duplication — session file hash, session ID, or some other deduplication key. The spec says "session file hash check" in the idempotency section, but doesn't define what constitutes a session ID or how files from the iMac are identified distinctly from Cadence files with potentially the same filename. If two machines happen to have a session file with the same hash (unlikely but possible with empty sessions), the deduplication could fail silently. The spec should name the dedup key explicitly (hash of file content? hash of path+machine? session UUID from filename?).

**D. Annotation overwrite behavior (AC-1.9) conflicts with AC-1.8 on the re-run without annotation change.**
AC-1.8 says "annotations survive re-collection: if `annotations.json` is unchanged, values are unchanged." AC-1.9 says "changing annotations and re-running produces the new value." These are consistent, but neither covers the case where a date has tokens but no annotation entry. The spec says `driver` defaults to `""` and `evidence` defaults to `""` — but if a date already has `driver = "code"` from a prior annotation and Brett removes the date from `annotations.json`, the next collect run should presumably write `driver = ""`. This isn't stated. "Annotations always overwrite" (the spec's stated behavior) implies this is correct, but it would silently erase manually-set values when annotations.json is cleaned up. No AC tests this removal path.

**E. View 3 driver threshold (7 days) is now range-scoped in the AC but the spec also says range-scoped — these agree. However, neither document defines what "non-empty `driver` field" means for `driver = ""`.**
The schema defines `driver = ""` for unannotated days. The threshold logic must treat `driver = ""` as "not annotated." This is implied but never stated. If an implementation uses `len(driver) > 0` vs. `driver is not None` vs. `driver != ""`, behavior may differ depending on how the JSON is parsed. The AC should specify: `driver != ""` is the condition for "annotated."

**F. `total_est` is defined as equal to `claude_chat_est`, making it redundant.**
The schema includes both `claude_chat_est` and `total_est`, where `total_est = claude_chat_est`. This is currently correct since Chat is the only estimated lane. But the field names imply different semantics: `total_est` sounds like an aggregate while `claude_chat_est` is the source. When the iMac lane is added (also exact), `total_est` still equals `claude_chat_est`. This creates no immediate bug, but the redundancy means the schema has two fields containing identical values, and a developer might reasonably wonder whether to use one or the other. The spec should either drop `total_est` and rename it `claude_chat_est` everywhere in the UI, or document why both fields exist.

---

## Verdict: PASS (with minor caveats)

All 6 critical issues from the original review are resolved. The new issues introduced by v2 are:
- One is a low-severity fixture labeling error (A) that won't break the test
- Two are specification gaps that could produce subtle bugs (C, D) but are unlikely to surface in the single-machine MVP
- Three are clarity/consistency issues (B, E, F) that a careful builder will handle correctly

None of the new issues are blockers for the MVP build on Cadence with a single machine. The fidelity constraint is now enforced at both the data layer and the UI layer, which was the most dangerous gap. The timestamp bucketing and multi-source aggregation are now specified with enough precision to implement correctly.

**Recommended before handing to the builder:** Fix the AC-1.6 fixture comments (A) and clarify the dedup key for multi-machine collection (C). These take 10 minutes to fix and prevent a confusing debugging session later.
