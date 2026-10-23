# D15 history rewrite (2026-10-23)

Applies Brett's rulings recorded in `DECISIONS.md` D15 to the stored Claude Code rows.
Run from the MacBook (`machine=macbook`) by Claude Code. Reversible from
`claude-code-rows-backup-2026-10-23.json` (all 491 `agent='claude-code'` rows before the rewrite).

## What was done

- **MacBook:** `make collect-reconcile` (fixed collector, its own transcripts): 19 rows upserted, 18 existing plus
  this live session.
- **Mini and iMac:** their `.env` is an iCloud symlink that ssh sessions cannot read. Their transcripts were recounted
  read-only over ssh with the fixed collector, and the results applied from the MacBook with its `.env`. Only
  `input_tokens`, `output_tokens`, `cache_read`, `cache_create` and `api_requests` were updated, on existing
  `(session_id, machine)` rows (283 updated, 31 already equal). No keys were copied. Two sessions with no stored
  row were not created. No row changed machine; `driver`, `notes`, `session_date` and `fidelity` were verified
  identical to the backup on all 491 rows.
- **Uncorrected rows:** 159 rows have no surviving transcript (91 mini, 46 iMac, 22 legacy `merged`; 2026-05-07 to
  2026-07-17, 5,978.8M tokens). Counts left as recorded. Each `notes` ends with
  `[uncorrected: pre-D15 count, transcript no longer exists; not recounted 2026-10-23]`.

## Totals (all Claude Code rows, by session_date month)

| Month | Before | After |
|---|---|---|
| 2026-05 | 1,501.7M | 1,501.7M (all uncorrected) |
| 2026-06 | 2,469.6M | 2,271.3M |
| 2026-07 | 4,948.5M | 3,794.1M |
| 2026-08 | 1,875.5M | 1,036.7M |
| 2026-09 | 1,654.8M | 859.0M |
| 2026-10 | 19,786.8M | 10,536.8M |
| **Total** | **32,237.0M** | **19,999.7M** |

## ACUTE (driver `research`, notes naming ACUTE, since 2026-01-01), Claude Code only, 220 rows

| Month | Before | After | of which uncorrected |
|---|---|---|---|
| 2026-06 | 781.8M | 714.6M | 659.2M |
| 2026-07 | 1,083.6M | 983.6M | 880.9M |
| 2026-08 | 36.7M | 24.0M | 0 |
| 2026-09 | 893.1M | 491.9M | 0 |
| 2026-10 | 19,687.7M | 10,496.9M | 0 |
| **Total** | **22,482.9M** | **12,710.9M** | **1,540.1M** |

Recounted rows are 11,170.8M. Scaling the uncorrected 1,540.1M by the audit's 1.9 ratio would add about 810M
(about 11.98B); it is not applied. Codex ACUTE rows (1,658.1M) are unchanged.

## Audit

`make audit-token-accounting` (run outside the sandbox: the sandbox blocks the read-only open of the Codex
state DB): 0 dangerous findings (was 9), 4 findings. The remaining findings are this live MacBook session being
unannotated, and the three idle days. The audit compares local telemetry for the MacBook only.
