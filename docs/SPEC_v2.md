# SPEC v2 — Token Burn: Supabase Data Layer

**Status:** Draft v2 — adversarial review complete, 6 blockers resolved  
**Date:** 2026-06-09  
**Author:** Cadence (Architect)

---

## 1. Motivation

V1 stored token data in three flat JSON files committed to the repo
(`public/data/daily-burn.json`, `session-contributions.json`, `session-hashes.json`).
This created two systemic problems:

1. **Multi-machine sync**: Both Coda (iMac) and Cadence (Mac Mini) must `git pull` before
   collecting, and `git push` after, or data diverges silently.
2. **Ariel's exclusion**: Ariel (Claude Chat) has no disk access and cannot run the Python
   collector, so her token usage has been permanently missing from the dashboard.

V2 moves the data layer to Supabase (shared source of truth), adds session-level granularity,
exposes two new MCP tools so all three agents can record sessions, and adds a Vercel serverless
proxy so the service key never reaches the browser bundle.

---

## 2. Scope of Changes

| Area | V1 | V2 |
|---|---|---|
| Storage | 3 flat JSON files in repo | Supabase `token_sessions` table |
| Granularity | One row per calendar day | One row per agent session |
| Multi-machine | git-pull-to-sync | Real-time via Supabase |
| Ariel recording | Not possible | `record_chat_session` MCP tool |
| Coda/Cadence recording | Python collector → JSON | Python collector → Supabase upsert |
| Browser data access | Fetch static file from repo | Fetch from Vercel proxy (`/api/daily`, `/api/sessions`) |
| Service key | N/A | Server-side only (Vercel env var) |
| Annotations | `data/annotations.json` | `driver` + `notes` columns in `token_sessions` |
| Legacy data | 22 days in JSON | Migrated to Supabase as synthetic rows |

---

## 3. Supabase Schema

### 3.1 Table: `token_sessions`

```sql
CREATE TABLE token_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      text        NOT NULL,
  machine         text        NOT NULL,
  session_date    date        NOT NULL,
  agent           text        NOT NULL,
  input_tokens    bigint      NOT NULL DEFAULT 0,
  output_tokens   bigint      NOT NULL DEFAULT 0,
  cache_read      bigint      NOT NULL DEFAULT 0,
  cache_create    bigint      NOT NULL DEFAULT 0,
  api_requests    int         NOT NULL DEFAULT 0,
  total_tokens    bigint GENERATED ALWAYS AS
                    (input_tokens + output_tokens + cache_read + cache_create) STORED,
  driver          text,
  notes           text,
  fidelity        text        NOT NULL DEFAULT 'exact',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT token_sessions_unique_session  UNIQUE (session_id, machine),
  CONSTRAINT token_sessions_agent_check     CHECK (agent    IN ('claude-code', 'claude-chat')),
  CONSTRAINT token_sessions_fidelity_check  CHECK (fidelity IN ('exact', 'estimated')),
  CONSTRAINT token_sessions_driver_check    CHECK (
    driver IS NULL OR driver IN
    ('infrastructure', 'career', 'creative', 'markets', 'research', 'personal')
  )
);

CREATE INDEX token_sessions_date_idx    ON token_sessions (session_date DESC);
CREATE INDEX token_sessions_machine_idx ON token_sessions (machine);
CREATE INDEX token_sessions_agent_idx   ON token_sessions (agent);

-- Auto-update updated_at on upsert
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER token_sessions_touch_updated_at
  BEFORE UPDATE ON token_sessions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

### 3.2 Column Semantics

| Column | Semantics |
|---|---|
| `session_id` | JSONL filename stem for Code sessions (e.g., `b11e40c0-...`); `ariel-{date}-{ms-epoch}` for Chat; `legacy-{date}` for migrated rows |
| `machine` | `cadence`, `coda`, `ariel`, or `merged` (legacy only) |
| `session_date` | Pacific-time date the session started (matches JSONL first-timestamp logic) |
| `agent` | `claude-code` or `claude-chat` |
| `input_tokens` | Non-cached input tokens (what Anthropic charges at full rate) |
| `output_tokens` | Generated output tokens |
| `cache_read` | Cache-read input tokens |
| `cache_create` | Cache-write tokens |
| `total_tokens` | Computed: sum of all four token columns |
| `driver` | Optional taxonomy label; null until annotated |
| `notes` | Freeform session notes (max 500 chars enforced in MCP tool) |
| `fidelity` | `exact` = from JSONL; `estimated` = Ariel's estimate |

### 3.3 Token Formula

`total_tokens = input_tokens + output_tokens + cache_read + cache_create`

This matches v1's formula and avoids double-counting. `input_tokens` is the non-cached portion only;
the Anthropic API returns cached tokens separately.

### 3.4 RLS Policy

The `token_sessions` table is accessed only via the service role key (never the anon key). RLS is
disabled on this table. All dashboard reads go through the Vercel proxy; no browser-direct access.

---

## 4. Migration: Legacy Data

### 4.1 What Exists

`public/data/daily-burn.json` contains 22 day-level rows (May 7 – June 9 2026) with aggregated
Code token counts. No session-level detail exists for this period.

### 4.2 Migration Strategy

The migration script (`scripts/migrate_legacy.py`) reads `public/data/daily-burn.json` and
`data/annotations.json` and inserts one synthetic `token_sessions` row per day.

**Field name mapping** (v1 daily-burn.json field → v2 token_sessions column):

| v1 daily-burn.json field | v2 `token_sessions` column |
|---|---|
| `date` | `session_date` |
| `claude_code_input` | `input_tokens` |
| `claude_code_output` | `output_tokens` |
| `claude_code_cache_read` | `cache_read` |
| `claude_code_cache_create` | `cache_create` |
| `claude_code_api_requests` | `api_requests` |
| `claude_chat_est` | `input_tokens` on the separate chat row |

For each day with Code data (`total_exact > 0`):
- `session_id = 'legacy-{date}'`
- `machine = 'merged'` (multi-machine aggregate — no machine breakdown exists)
- `session_date = date`
- `agent = 'claude-code'`
- `input_tokens = claude_code_input`
- `output_tokens = claude_code_output`
- `cache_read = claude_code_cache_read`
- `cache_create = claude_code_cache_create`
- `api_requests = claude_code_api_requests`
- `driver = annotations[date].driver` if present, else `null`
- `notes = annotations[date].evidence` if present (max 500 chars), else
  `'Migrated from daily-burn.json v1 — session-level detail not available'`
- `fidelity = 'exact'`

For each day with Chat estimates (`claude_chat_est > 0`):
- `session_id = 'legacy-chat-{date}'`
- `machine = 'ariel'`
- `agent = 'claude-chat'`
- `input_tokens = claude_chat_est` (all attributed to input_tokens; other token fields = 0)
- `api_requests = 0`
- `driver = null`
- `notes = 'Migrated from daily-burn.json v1 — estimate only'`
- `fidelity = 'estimated'`

Migration is idempotent: uses `ON CONFLICT (session_id, machine) DO NOTHING`.
Any driver values in `data/annotations.json` are preserved during migration; the file is deleted
after migration completes successfully.

### 4.3 Acceptance

After migration, the day-level sums visible in the dashboard must match v1 totals within ±1% for
the same date range (minor rounding acceptable).

---

## 5. OB MCP Extension: Two New Tools

These tools are added to
`/Users/brettcoryell/Code/AI/open_brain/supabase/functions/open-brain-mcp/index.ts`.

No existing tools are modified. No existing tools are removed.

### 5.1 `record_code_session` (Tool 14)

**Purpose:** Coda or Cadence calls this at session closeout to record exact token counts for the
current Claude Code session. The Python collector (`make collect`) calls Supabase directly and is
the primary mechanism; this MCP tool is the explicit, per-session alternative.

**Input schema:**
```
session_id      text     required — JSONL filename stem (no path, no .jsonl extension)
machine         text     required — 'cadence' | 'coda'
session_date    text     required — 'YYYY-MM-DD' Pacific time
input_tokens    number   required — non-cached input tokens
output_tokens   number   required — output tokens
cache_read      number   required — cache_read_input_tokens
cache_create    number   required — cache_creation_input_tokens
api_requests    number   required — count of assistant turns
driver          text     optional — one of the 6 driver values
notes           text     optional — max 500 chars; freeform session summary
```

**Behavior:**
- Upserts on `(session_id, machine)` composite key
- Sets `agent = 'claude-code'`, `fidelity = 'exact'`
- Returns `upserted | id: {uuid} | total_tokens: {n:,}`

### 5.2 `record_chat_session` (Tool 15)

**Purpose:** Ariel calls this at session closeout to record an estimated token count for her Claude
Chat session.

**Input schema:**
```
estimated_tokens  number   required — Ariel's estimate of the session's total token use
session_date      text     optional — 'YYYY-MM-DD'; defaults to today UTC (Claude Chat has no TZ access)
driver            text     optional — one of the 6 driver values
notes             text     optional — max 500 chars
```

**Behavior:**
- Generates `session_id = 'ariel-{session_date}-{crypto.randomUUID()}'`
- Sets `machine = 'ariel'`, `agent = 'claude-chat'`, `fidelity = 'estimated'`
- Maps `estimated_tokens` to `input_tokens` (all other token fields = 0; total_tokens = estimated_tokens)
- Returns `recorded | id: {uuid} | estimated: {n:,} tokens`

### 5.3 Validation (both tools)

- `driver` must be one of: `infrastructure`, `career`, `creative`, `markets`, `research`, `personal`
  — return error if invalid value provided
- `notes` truncated to 500 chars server-side
- `session_date` validated as `YYYY-MM-DD` format; return error if malformed
- All token counts validated as non-negative integers; return error if negative

---

## 6. Python Collector: Supabase Upsert

`scripts/collect.py` is rewritten to upsert directly to Supabase instead of writing JSON.

### 6.1 Configuration

New required environment variable: `SUPABASE_SERVICE_ROLE_KEY`
New optional environment variable: `SUPABASE_URL` (falls back to known OB URL if not set)

The collector reads these from environment (or a `.env` file at project root, loaded via `python-dotenv`).
`.env` is already in `.gitignore`. The service key is never written to any file tracked by git.

### 6.2 Upsert Behavior

For each JSONL file that is new or changed:
```python
supabase.table("token_sessions").upsert({
    "session_id":   path.stem,
    "machine":      machine_name,
    "session_date": date_str,
    "agent":        "claude-code",
    "input_tokens": input_tokens,
    "output_tokens": output_tokens,
    "cache_read":   cache_read,
    "cache_create": cache_create,
    "api_requests": api_requests,
    "fidelity":     "exact",
}, on_conflict="session_id,machine").execute()
```

The sidecar files (`session-contributions.json`, `session-hashes.json`) are removed. In their
place, the collector maintains a lightweight local state file: `.collect-state.json` at the
token-burn project root. This file is gitignored. It stores a mapping of
`"{machine}:{absolute_path}" → {hash, last_upserted_at}`. On each run, the collector loads this
file, skips files whose hash matches, upserts changed files, and writes the updated state back.
Idempotency at the database level is guaranteed by the `ON CONFLICT (session_id, machine) DO UPDATE`
upsert — even if the state file is lost, re-running the collector simply re-upserts all sessions
with correct data.

### 6.3 No Output File

The collector no longer writes `public/data/daily-burn.json`. The `--output` flag is removed.
Dry-run mode (`--dry-run`) still exists and prints what would be upserted without writing.

### 6.4 Makefile Targets

```makefile
collect:        ## Collect Code sessions → upsert to Supabase
	python scripts/collect.py --machine cadence

collect-coda:   ## Collect Code sessions on Coda (run on iMac)
	python scripts/collect.py --machine coda

migrate:        ## One-time: migrate legacy daily-burn.json → Supabase
	python scripts/migrate_legacy.py
```

`make collect` on Cadence and `make collect` on Coda each upsert their own machine's sessions.
No git operations required.

---

## 7. Vercel Serverless Proxy

### 7.1 Why a Proxy

The token-burn GitHub repo is public. The Supabase service role key grants write access to the
entire OB database. It must never appear in the browser bundle, in `VITE_*` env vars, or in any
committed file.

Vercel serverless functions run Node.js on the server. They can read non-`VITE_*` env vars.
The frontend calls the proxy; the proxy calls Supabase; the key stays server-side.

### 7.2 `/api/daily.ts`

**Route:** `GET /api/daily?since=YYYY-MM-DD`

**Server-side:** Calls `supabase.rpc` or a Postgres function to GROUP BY `session_date`:

Returns `DayRecord[]`:
```typescript
interface DayRecord {
  date: string              // session_date as YYYY-MM-DD string
  total_exact: number       // sum(total_tokens) where fidelity='exact'
  total_est: number         // sum(total_tokens) where fidelity='estimated'
  claude_code_sessions: number   // count where agent='claude-code'
  claude_chat_sessions: number   // count where agent='claude-chat'
  claude_code_api_requests: number  // sum(api_requests) where agent='claude-code'
  sources: string[]         // distinct machine values
  driver: string            // most recent non-null driver, or ''
}
```

**Implementation note:** Aggregation is done in Postgres via a database function, not in
JavaScript. The SQL migration creates a function `get_daily_summary(since_date date DEFAULT NULL)`
that returns the pre-aggregated `DayRecord` rows. The Vercel proxy calls:
```typescript
const { data, error } = await supabase.rpc('get_daily_summary', {
  since_date: since ?? null,
})
```
This avoids fetching all rows into JavaScript (N+1 / memory risk at scale).

```sql
CREATE OR REPLACE FUNCTION get_daily_summary(since_date date DEFAULT NULL)
RETURNS TABLE (
  date              text,
  total_exact       bigint,
  total_est         bigint,
  claude_code_sessions bigint,
  claude_chat_sessions bigint,
  claude_code_api_requests bigint,
  sources           text[],
  driver            text
) LANGUAGE sql STABLE AS $$
  SELECT
    session_date::text                                           AS date,
    COALESCE(SUM(total_tokens) FILTER (WHERE fidelity = 'exact'),  0) AS total_exact,
    COALESCE(SUM(total_tokens) FILTER (WHERE fidelity = 'estimated'), 0) AS total_est,
    COUNT(*) FILTER (WHERE agent = 'claude-code')              AS claude_code_sessions,
    COUNT(*) FILTER (WHERE agent = 'claude-chat')              AS claude_chat_sessions,
    COALESCE(SUM(api_requests) FILTER (WHERE agent = 'claude-code'), 0) AS claude_code_api_requests,
    ARRAY_AGG(DISTINCT machine)                                AS sources,
    (ARRAY_REMOVE(ARRAY_AGG(driver ORDER BY created_at DESC), NULL))[1] AS driver
  FROM token_sessions
  WHERE since_date IS NULL OR session_date >= since_date
  GROUP BY session_date
  ORDER BY session_date DESC;
$$;
```

**CORS:** No CORS headers needed — the frontend is served from the same Vercel domain.

**Error handling:** Returns `{ error: string }` with appropriate HTTP status on failure.

### 7.3 `/api/sessions.ts`

**Route:** `GET /api/sessions?date=YYYY-MM-DD&limit=50`

Returns raw `SessionRecord[]`:
```typescript
interface SessionRecord {
  id: string
  session_id: string
  machine: string
  session_date: string
  agent: string
  total_tokens: number
  api_requests: number
  driver: string | null
  notes: string | null
  fidelity: string
  created_at: string
}
```

`date` filter is optional; if omitted, returns the 50 most recent sessions.

### 7.4 Environment Variables (Vercel)

Add to the Vercel project settings (these are Brett's to add manually):
```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

These are the same values currently in Cadence's `.env`. They are NOT prefixed with `VITE_` and
are therefore unavailable to the browser bundle.

---

## 8. Frontend Changes

### 8.1 Types (`src/types.ts`)

`DayRecord` shrinks from 14 to 8 fields (raw token breakdowns move to session-level only):

```typescript
export interface DayRecord {
  date: string
  total_exact: number
  total_est: number
  claude_code_sessions: number
  claude_chat_sessions: number
  claude_code_api_requests: number
  sources: string[]
  driver: string
}

export interface SessionRecord {
  id: string
  session_id: string
  machine: string
  session_date: string
  agent: 'claude-code' | 'claude-chat'
  total_tokens: number
  api_requests: number
  driver: string | null
  notes: string | null
  fidelity: 'exact' | 'estimated'
  created_at: string
}
```

`DRIVER_LABELS` is updated to match the approved v2 taxonomy:
```typescript
export const DRIVER_LABELS: Record<string, string> = {
  infrastructure: 'Infrastructure',
  career:         'Career',
  creative:       'Creative',
  markets:        'Markets',
  research:       'Research',
  personal:       'Personal',
}
```

### 8.2 `useTokenData` Hook

Changed from a single JSON fetch to two API fetches:

```typescript
// Parallel fetch from Vercel proxy
const [dailyRes, sessionsRes] = await Promise.all([
  fetch(`/api/daily${since ? `?since=${since}` : ''}`),
  fetch('/api/sessions?limit=50'),
])
```

The hook returns `{ all, filtered, sessions, loading, error }`.

### 8.3 Component Impact

All five views continue to work with minimal changes:
- **Header**: KPI cards computed from `DayRecord[]` — `total_exact`, `total_est` field names unchanged
- **Heatmap**: `record.total_exact`, `record.total_est`, `record.driver` unchanged
- **TrendLine**: `record.total_exact` unchanged
- **DailyTable**: `record.claude_code_sessions`, `record.claude_code_api_requests` unchanged; remove "Code sessions" count column rename if needed
- **Drivers**: `record.driver` unchanged; now has real data from Supabase
- **ScaleEquivalents**: `total_exact` unchanged
- **FidelityBadge**: `record.total_exact === 0 && record.total_est > 0` logic unchanged

No view requires a redesign. Only `DailyTable` may need minor column adjustments (no longer has raw
input/output/cache breakdown — this was never displayed in v1 either).

---

## 9. Files Removed

These files are deleted as part of v2 — they are replaced by Supabase:

| File | Replacement |
|---|---|
| `public/data/daily-burn.json` | `token_sessions` table + `/api/daily` |
| `public/data/session-contributions.json` | Supabase upsert dedup |
| `public/data/session-hashes.json` | Content-hash check in collector (in-memory) |
| `data/annotations.json` | `driver` + `notes` columns in `token_sessions` |

---

## 10. CLAUDE.md Session Closeout Update

The Session End section in `/Users/brettcoryell/Code/AI/open_brain/CLAUDE.md` gains a step:

```markdown
1.5. **Sync token data** — after committing, run the collector to record this session:
     ```
     cd /Users/brettcoryell/Code/AI/token-burn && make collect
     ```
     This upserts all new or changed Claude Code sessions to Supabase. If the session's primary
     driver is clear, pass it to the collector or call `record_code_session` MCP tool with `driver`.
```

---

## 11. Ariel Session Closeout Instructions

Ariel's dedicated Chat project instructions (set by Brett in Claude.ai) should include:

```
At session closeout, call record_chat_session with:
  - estimated_tokens: your best estimate of this session's token use
    (rough guidance: short focused session ≈ 20,000; medium session ≈ 75,000; long session ≈ 150,000+)
  - driver: one of: infrastructure, career, creative, markets, research, personal
  - notes: one sentence describing what the session was about
```

Brett will add this text to Ariel's project instructions manually. The instructions for the exact
wording to paste are included in the session notes.

---

## 12. Security Constraints

1. `SUPABASE_SERVICE_ROLE_KEY` lives only in: Vercel project env vars, local `.env` files (gitignored)
2. No `VITE_SUPABASE_*` env vars — these would be bundled into the browser
3. The token-burn GitHub repo remains public — this is fine because no secrets are committed
4. Raw JSONL session exports must not be committed (`.gitignore` already covers `~/.claude`)
5. The Vercel proxy routes (`/api/*`) have read-only access patterns — they never call MCP tools
   or write to Supabase; only the collector and MCP tools write

---

## 13. Out of Scope for V2

- Real-time dashboard updates (polling or websocket)
- Per-session token breakdown visible in the UI (session detail modal)
- Retroactive driver labeling of legacy data (LATER intent captured in OB)
- Supabase plan migration (SOON intent captured in OB)
- Vercel proxy pattern review for other projects (SOON intent captured in OB)
- Driver annotations from the dashboard UI (still requires MCP tool or manual Supabase edit)

---

## 14. Build Sequence

1. Create `token_sessions` table + `get_daily_summary` function in Supabase (SQL migration run via Supabase dashboard or CLI)
2. Add tools 14–15 to OB MCP Edge Function; deploy Edge Function to Supabase
3. Rewrite `scripts/collect.py` to upsert to Supabase (with `.collect-state.json` state file)
4. Add `scripts/migrate_legacy.py`
5. Run legacy data migration: `python scripts/migrate_legacy.py` (must follow step 4)
6. Add Vercel proxy routes (`api/daily.ts`, `api/sessions.ts`)
7. Install `@supabase/supabase-js` in token-burn (`npm install @supabase/supabase-js`)
8. Update `src/types.ts`, `src/hooks/useTokenData.ts`
9. **Update Playwright test mocks** — change mocked route from `/data/daily-burn.json` to `/api/daily` and `/api/sessions`; update mock response shape to match new `DayRecord` and `SessionRecord` types (this step must precede file deletion)
10. Update `Makefile` (remove old targets, add new ones)
11. Delete the four removed files (`public/data/daily-burn.json`, `public/data/session-contributions.json`, `public/data/session-hashes.json`, `data/annotations.json`)
12. Update `open_brain/CLAUDE.md` session closeout
13. Set Vercel env vars (Brett does this manually; documented in session notes)
14. Commit, push, Vercel deploy
15. Verify dashboard shows historical data and live data matches

---

*End of SPEC_v2.md*
