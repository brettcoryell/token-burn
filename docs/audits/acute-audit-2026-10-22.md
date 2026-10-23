# Token-accounting audit, focused on ACUTE (2026-10-22)

Run by Claude Code on the Mac mini (`Bretts-Mac-mini.local`, `machine=mini`) at Brett's
request. The request was to audit token-burn accounting for the last 30 days, add missing
sessions, attribute unattributed sessions, and then estimate ACUTE token use since
2026-01-01.

The per-row change log is in `acute-audit-2026-10-22-changes.csv` (same folder). It lists
every row added, updated or attributed, with driver before → after. It holds no notes text.

## 1. What was checked

Sources compared against `token_burn.token_sessions` (read with the service key, read-only
dumps before and after):

| Source | mini | macbook | imac |
|---|---|---|---|
| Claude Code transcripts `~/.claude/projects/**/*.jsonl` (incl. `subagents/`) | 270 files | 18 | 56 |
| Codex threads `~/.codex/state_5.sqlite` + rollouts | 72 collectable | read with `immutable=1` (no WAL) | yes |
| Claude Desktop session metadata `claude-code-sessions/**/local_*.json` (titles, cli id) | 125 | 18 | 70 |
| Cowork transcripts `local-agent-mode-sessions/**/.claude/projects` | 72 files | 4 | 10 |

The other Macs were read over ssh only. No collector or write ran on them.

## 2. Coverage findings, last 30 days (2026-09-23 → 2026-10-22)

Before the audit the store had 169 rows in the window: 138 mini Claude Code, 27 mini Codex,
4 iMac Claude Code, and none from the MacBook.

| Machine / agent | Local sessions found | Recorded before | Missing | Stale count (recorded but grown) |
|---|---|---|---|---|
| mini / Claude Code | 207 (incl. ~150 subagent files) | 140 | 67 file entries = 57 distinct ids | 5 |
| mini / Codex | 27 | 27 | 0 | 0 |
| macbook / Claude Code | 3 | 0 | 3 | 0 |
| macbook / Codex | 1 | 0 | 1 | 0 |
| imac / Claude Code | 5 | 4 | 1 | 2 (small, non-ACUTE) |
| imac / Codex | 1 | 0 | 1 | 0 |

Causes:

- **mini, 2026-10-20 → 10-22.** `make token-accounting-closeout` had not run since about
  10-20. The busy multi-session, subagent-heavy days were never collected: 57 ids,
  2.67B tokens (collector convention). Five sessions had grown after their last
  collection. One example is `bd8ba7c2…`, recorded at 2.7M and actually 355M.
- **MacBook / iMac.** Their closeout has not run since the sessions happened. The MacBook
  Codex state DB was last written on 10-07.
- **Every Claude Code row from the collector had `driver=NULL` and `notes=NULL`.** The
  collector writes no attribution. `make suggest-annotations` scored 0 of 151 candidates as
  high-confidence, because desktop titles live in the Desktop app's metadata and not in the
  transcripts. So nothing had been attributed since about 2026-08. Before the audit, every
  September/October row was unattributed.

Days with no rows (09-24, 09-26, 09-28) have no local transcripts on any Mac either. They
look like genuinely idle days.

## 3. What was added (64 sessions)

1. **mini, via the documented collector.** `collect.py --dry-run --verbose` (equivalent to
   `make collect-dry`, plus verbose) showed 72 new or changed files. `make collect` then
   upserted 72 files: 57 new rows (6 main sessions, 51 subagents) and 4 updated rows
   (`9c5352cb` 403.7M→663.1M, `31819fe1` 465.4M→482.3M, `bd8ba7c2` 2.7M→355.3M, and the
   collision row below). Codex: `make collect-codex-dry` gave 0 new/changed, and
   `make collect-codex-reconcile-dry` re-derived 27 rows, all already matching. No Codex
   write was needed.
2. **macbook / imac, via the token-burn MCP** (`record_code_session` / `record_codex_session`,
   structural machine labels per D12). Token components came from the transcripts using the
   collector's own parsing rules, so a later `make collect` on those Macs is an idempotent
   upsert of the same `(session_id, machine)`.
   - macbook Claude: `974d9a31` (ACUTE, MacBook remote-workstation setup, 16.3M), `98721819`
     (ACUTE, live at audit time, partial 27.6M), `72576b5c` (MacBook cleanup/security
     review, infrastructure, 91.6M)
   - macbook Codex: `codex-01a1191a` (ACUTE startup, 1.0M)
   - imac Claude: `25436715` (personal, 27.1M)
   - imac Codex: `codex-019ebfa1` (infrastructure, 3.7M), `codex-01a0f104` (personal, 0.45M)

`codex-019f0b53…` (mini, 06-27) looked missing but is in `.collect-codex-skip.json`. It was a
D10 split backfill and its split rows exist, so it was correctly left alone.

## 4. What was re-attributed (303 rows)

- **296 rows, `driver` NULL → set, with a primary-use `notes`.** By driver: research 220
  (219 ACUTE + 1 Cavendish), creative 45 (D-Day), personal 19, markets 7, infrastructure 4,
  career 1. Every new note ends `[attributed 2026-10-22 token audit]`.
- **7 rows, driver kept (`research`), empty or generic notes → ACUTE description.** These
  are `3061cae7`, `58c78e14`, `e2c3abb9` (iMac/mini, 06-24) and Codex `019f1cff`,
  `019f1eb3`, `019f289f`, `019f33f7` (07-01 → 07-05).
- **Method.** Main sessions were attributed by hand from the Desktop session title, the cwd,
  and the first few user prompts. Subagents inherit the parent session's attribution
  (parent = transcript directory), and their notes carry the subagent's own task. Codex rows
  were attributed from thread title, first user message and cwd.
- **Write path.** The MCP upsert re-sent each row's stored token components unchanged. The
  before/after dump comparison shows **0 token, date or agent changes** on existing rows, and
  no previously annotated row was touched.
- **Public repo, public dashboard API.** `/api/sessions` returns `notes`, so personal rows got
  deliberately generic notes.

## 5. What could not be resolved

1. **Subagent id collisions (collector bug, unfixed).** When a subagent is resumed from a
   different parent session (SendMessage to a warm reviewer, or forks), Claude Code writes a
   second `subagents/agent-<id>.jsonl` under the new parent with the same stem. The collector
   keys on the stem, so the last file upserted overwrites the other. 12 ids on mini are
   affected. About **296M tokens (collector convention), ~169M deduplicated, never
   counted**, all of it ACUTE. This run's `make collect` itself overwrote
   `agent-ace413ba…` from 41.9M to 0.7M for this reason. These are the 9 remaining
   "dangerous" findings in `make audit-token-accounting`, and no documented remediation
   clears them. Suggested fix: make subagent `session_id` include the parent (for example
   `<parent>/agent-<id>`). That needs a collector and `DECISIONS.md` change (D3/D9), which
   is outside this audit's authorization.
2. **Claude Code totals are about 1.9× actual API usage (collector convention).** Claude
   Code writes one JSONL line per content block, and each line repeats the same
   `message.id` and `usage`. Across all 271 mini transcripts there are 76,806 usage lines
   but only 40,550 distinct message ids. Summing every line gives 25.36B tokens, while
   counting each message once (taking its largest usage) gives 13.40B, a ratio of 1.89.
   The ratio by month is stable: 1.84 for July, 1.81 for August, 1.87 for September and
   1.91 for October. `api_requests` is inflated the same way. Codex is unaffected because it
   uses the cumulative `total_token_usage`. Historical rows were **not** rewritten. That
   would change the collection convention and needs a decision.
3. **Remote stale counts, not ACUTE.** MacBook `997baca9` (local 81.3M vs stored 71.8M) and
   iMac `24eb1eaa` / `b7dfa3df` (+0.2M / +4.1M). The fix is `make collect` on those Macs at
   their next closeout.
4. **53 rows from 2026-05-07 → 06-15 with no surviving transcripts** stay `driver=NULL`
   (0.92B tokens), plus 3 small rows (`b8cd1023`, `codex-01a087e7`, `codex-01a0bf54`) and 4
   zero-token rows. All of them predate ACUTE's restart (late June) or are trivial.
5. **Not collected at all.**
   - Cowork (`local-agent-mode-sessions`) transcripts: mini August 2026 physics-email and
     astrophotography work, plus macbook/imac February → July sessions. None of it is ACUTE.
   - Claude Chat discussion of ACUTE: there are no chat rows for it.
   - ACUTE's own runtime LLM/API calls made by the pipeline: these are outside token-burn.
6. **Live sessions.** `16be21af`, `e84895c1`, `f6d69a16`, their subagents, and MacBook
   `98721819` were mid-flight. Their rows are partial until the next closeout.

## 6. ACUTE token estimate, 2026-01-01 → 2026-10-22

**Method.** A row counts as ACUTE when `driver='research'` and its notes name ACUTE
(case-insensitive). That covers this audit's notes and the 2026-07-17 `project=acute-codex`
annotations. The store has no project-tag or cwd column, so cwd was used during attribution
and not afterwards. Four rows are counted as *uncertain* instead:

- `8d556ce2` and `82972983` (iMac 06-24, "infrastructure standardization", research, no
  transcript)
- `72576b5c` (MacBook cleanup that touched ACUTE plists)
- `agent-a8f772d0` (subagent decommissioning non-ACUTE projects)

The store starts on 2026-05-07, and no ACUTE row predates 2026-06-23. The ACUTE repos
(`acute`, `acute-legacy`, `aisec`) have no commits between 2025-12 and 2026-06, so
January–May ACUTE agent usage is effectively 0. That is **inferred**, not measured.

### As recorded in the store (MEASURED, collector convention; 255 rows)

| Month | Claude Code | Codex | Total |
|---|---|---|---|
| 2026-06 | 781.8M | 209.7M | 991.4M |
| 2026-07 | 1,083.6M | 113.2M | 1,196.8M |
| 2026-08 | 36.7M | — | 36.7M |
| 2026-09 | 893.1M | 20.7M | 913.8M |
| 2026-10 (to 10-22) | 19,687.7M | 1,314.7M | 21,002.4M |
| **Total** | **22,482.9M (220 rows)** | **1,658.1M (35 rows)** | **24,141.0M** |

Claude chat: 0 ACUTE rows (estimated-fidelity rows exist only for June/July non-ACUTE).

Component split of the 24.14B total:

| Component | Tokens | Share |
|---|---|---|
| Input (non-cached) | 50.6M | — |
| Output | 56.3M | — |
| Cache read | 23,659.0M | 98.0% |
| Cache write | 375.1M | — |

Codex reports no cache-write tokens (0).

### Corrected estimate (ESTIMATED)

1. Claude Code rows with a matching local transcript (20.75B as recorded) recount to
   **10.87B** when each message is counted once (measured).
2. Claude Code rows without a transcript (1.73B as recorded, mostly June/July) are divided
   by 1.9, giving about 0.91B (estimated). The observed monthly ratio ranges from 1.5 to
   2.2.
3. Add the subagent copies lost to collisions: +0.17B deduplicated.
4. Add Codex as recorded: 1.66B.

| Month | Corrected total |
|---|---|
| 2026-06 | ~0.61B |
| 2026-07 | ~0.68B |
| 2026-08 | ~0.02B |
| 2026-09 | ~0.51B |
| 2026-10 | ~11.78B |
| **Total** | **~13.6B** |

**Uncertainty.**

- **Choice of convention.** The figure is ±0.2B under the deduplicated convention, or about
  24.4B under the store's own convention (24.14B plus 0.30B of collision losses).
- **Uncertain rows.** The four uncertain rows (182M recorded, about 95M deduplicated) are
  excluded and could add about +1%.
- **Live sessions.** They will add more at the next closeout.
- **Not counted.** ACUTE work in Claude Chat and the pipeline's own API calls are not
  counted.

**Cost.** `token_sessions` records no cost, so no cost figure is given.

## 7. Evidence commands

All were run on the mini from `/Users/brettcoryell/Code/AI/token-burn`. Outputs were kept in
the session scratchpad.

```
make audit-token-accounting                      # before: 169 rows, 71 dangerous, 212 findings
.venv/bin/python scripts/collect.py --sessions-root ~/.claude/projects/ --machine mini \
    --agent-family claude --surface claude-code --dry-run --verbose   # 271 scanned, 72 new/changed
make collect                                     # 72 upserted
make collect-codex-dry                           # 72 threads, 0 new/changed
make collect-codex-reconcile-dry                 # 27 re-derived, all matching store
make suggest-annotations                         # 151 candidates, 0 high-confidence (so apply was not run)
# remote, read-only:
ssh macbook|imac 'python3 -' < inventory.py      # Claude transcripts
ssh macbook|imac 'python3 -' < codex_inv.py      # Codex threads (sqlite immutable=1 on macbook)
# writes: token-burn MCP record_code_session / record_codex_session (7 adds, 303 attributions)
make audit-token-accounting                      # after: 232 rows in window, 0 missing local,
                                                 # 0 unannotated >=1M, 9 dangerous (all subagent collisions)
```

`make apply-high-confidence-annotations` and `make token-accounting-closeout` were not run.
The first would have applied nothing. The second is the separate closeout ritual.
