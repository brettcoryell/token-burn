# Collector Test Fixtures

These fixture files provide deterministic inputs for `tests/collector/test_collect.py`.
All JSONL files match the real Claude Code session file format. None contain real session
content — all data is synthetic.

---

## simple_session.jsonl

**Tests:** AC-1.1 (token math), AC-1.2 (idempotency), AC-1.5 (timezone bucketing),
AC-1.7 (annotations merge), AC-1.10 (schema shape)

A minimal valid session with exactly one user record and two assistant records. All
timestamps are 2026-06-09 Mountain time (14:00 and 15:00 UTC on 2026-06-09, which is
08:00 and 09:00 MT). Token counts are small and exact:

| Message | input | output | cache_read | cache_create |
|---------|-------|--------|------------|--------------|
| A       | 100   | 50     | 1000       | 500          |
| B       | 200   | 100    | 2000       | 1000         |
| **Sum** | **300** | **150** | **3000** | **1500**   |

Expected output row:
- `date = "2026-06-09"`
- `claude_code_input = 300`
- `claude_code_output = 150`
- `claude_code_cache_read = 3000`
- `claude_code_cache_create = 1500`
- `total_exact = 4950`
- `claude_code_api_requests = 2`

---

## midnight_spanning_session.jsonl

**Tests:** AC-1.6 (midnight-spanning bucketing)

A session whose first record is 2026-06-10T05:55:00Z (= 2026-06-09 23:55 MT) and
whose final assistant message is 2026-06-10T06:15:00Z (= 2026-06-10 00:15 MT).

All tokens from this file should be bucketed into 2026-06-09 (the date of the first
record in Mountain time). Zero tokens should appear in a 2026-06-10 row.

Token counts per message: input=10, output=5, cache_read=100, cache_create=50.
Two assistant messages → totals: input=20, output=10, cache_read=200, cache_create=100.

---

## malformed_session.jsonl

**Tests:** AC-1.4 (graceful malformed handling)

Three lines:
1. Valid user record (no usage data)
2. Broken JSON — `{broken json here` — must cause a JSONDecodeError when parsed
3. Valid assistant record with token counts: input=50, output=25, cache_read=500,
   cache_create=250

Expected behavior:
- Collector does NOT crash
- Line 2 produces a warning on stderr
- Line 3 is processed; final row reflects only the valid assistant record
- `claude_code_input = 50`, `claude_code_output = 25`, etc.

---

## annotations.json

**Tests:** AC-1.7 (annotations merged), AC-1.8 (survive re-collection),
AC-1.9 (changed annotation overwrites)

A sample annotations sidecar with one entry for 2026-06-09:
- `driver = "code"`
- `evidence = "feature work session"`
- `claude_chat_sessions = 2`

Expected merge behavior with default `--chat-tokens-per-session 75000`:
- `claude_chat_sessions = 2`
- `claude_chat_est = 150000`
- `driver = "code"`
- `evidence = "feature work session"`
