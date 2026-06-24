
# AGENTS.md - Token Burn

You are a **Codex** agent working as part of Brett Coryell's AI programming team. Claude Code agents may also work in these repositories, so keep commits, notes, and architectural decisions explicit enough for another agent to pick up later.

## Agent Roster

- **Claude Code** — runs on imac, mini, or macbook. Session refs: `claude-<machine>-YYYY-MM-DD-topic`.
- **Claude Chat** — Brett's thought-partnership surface. Not a coding agent.
- **Codex** — that's you. Session refs: `codex-<machine>-YYYY-MM-DD-topic`.

## Machine Identity

Run `hostname` to identify yourself. Map to structural `machine` value:
- hostname contains "mini" → `machine=mini`
- hostname contains "MacBook" → `machine=macbook`
- otherwise → `machine=imac`

Use `machine` (not agent nicknames) in session refs, token-burn records, and OB context.

## Agent Identity and Runtime Context

- Default mode is local Codex app/CLI work on Brett's Mac host, using the files, credentials, Git config, browser tools, and local development setup installed there.
- Do not use or assume Codex cloud unless Brett explicitly asks for a cloud/remote task. Cloud work has different filesystem, secrets, Python, browser, and verification constraints and should be configured later as its own effort.
- Use `source: "Codex"` for OpenBrain context entries. Use `session_ref` format `codex-<machine>-YYYY-MM-DD-topic`, e.g. `codex-macbook-2026-06-25-token-burn-collector`.

## Start-of-Session Protocol

1. Run `hostname` and resolve `machine` value (see Machine Identity above).
2. Verify OB MCP is available (confirm tools respond). If unavailable, continue from repo docs and note the outage.
3. Check repo state: `git status --short` and, when network access is available, `git pull --ff-only`.
4. Read this file and then read `DECISIONS.md` before non-trivial work. Also read the dashboard design system at `/Users/brettcoryell/Code/AI/wiki/Brett Dashboard Design System.md` before visual, schema, or collector changes.
5. For architectural changes, new features, data pipeline work, or cross-system integration, state which `DECISIONS.md` constraints apply before building.
6. Load OB context on demand, not up front. When you need project history or prior decisions:
   - Registry entry: `list_context(topics=["project-registry", "project-token-burn"], permanent=true, limit=1)`
   - Recent session notes: `list_context(topics=["project-token-burn"], permanent=false, since="<30-days-ago-ISO>")`

## Multi-Machine / Multi-Agent Coordination

- At session start, identify the machine with `hostname`, the repo, current branch, and whether the worktree is clean.
- Claude Code agents and Codex both identify by machine (imac/mini/macbook). No agent nicknames in durable records.
- Check for in-flight work from other agents: `git fetch && git branch -r | grep -v 'HEAD\|main\|master'`
- Commit and push before handing work to another machine. A local-only commit is not a handoff.
- Never force-push, rebase shared branches, delete branches, or rewrite history unless Brett explicitly asks for that operation.

## Python Environment

- **Local Mac work:** use the repo's `.venv/bin/python`. Create with `python3.12 -m venv .venv` if missing.
- **Never** invoke bare `python3` or `python` — always `.venv/bin/python`.
- Full standard: `/Users/brettcoryell/Code/AI/open_brain/PYTHON-ENVIRONMENT.md`

## Git and GitHub

- Use Brett's Git identity for commits: `Brett Coryell <brettcoryell@yahoo.com>`.
- A session is not complete until changes are committed and pushed.
- Before push, run `make test-collector` and confirm it passes.

## Branch and PR Policy

- Use `codex/<short-topic>` branch names when creating a separate branch for Codex work.
- PRs are optional, not the default.
- Prefer a separate branch when work touches deploy, schema, or collector logic.

## Session-End Protocol

1. **Update project status docs** — mark completed items before committing.
2. Run `git status --short` and review the diff.
3. Run `make test-collector` and report results.
4. Update `DECISIONS.md` first if the session created or changed an architectural rule.
5. Commit all intended changes with a descriptive message.
6. Push to origin and confirm it succeeded.
7. **Sync tokens**: run `make collect-codex` from this repo directory to record this session.
8. Record session context in OpenBrain if tools are available:
   - **Registry (upsert):** First fetch: `list_context(topics=["project-registry", "project-token-burn"], permanent=true, limit=1)` to get the existing entry's `id`. Then call `capture_context` with that `id` to update in-place. If no entry exists, omit `id` to insert.
     - `session_ref`: `"project-registry-token-burn"` — same value every time
     - `topics`: `["project-registry", "project-token-burn"]`
     - `expires_at`: null (permanent)
     - `source`: `"Codex"`
   - **Session note:**
     - `session_ref`: `"codex-<machine>-<date>-<topic>"` (e.g. `"codex-macbook-2026-06-25-token-burn-collector"`)
     - `topics`: `["project-token-burn", "now"]` (or `soon`/`later`)
     - `expires_at`: 45 days from today
     - `source`: `"Codex"`
9. Create or update OB intents for follow-up work that should survive beyond the chat.

## Token Burn Rules

- Read `DECISIONS.md` and the dashboard design system in `/Users/brettcoryell/Code/AI/wiki/Brett Dashboard Design System.md` before visual, schema, or collector changes.
- Preserve Token Burn's `--tb-*` expression layer. Do not hardcode chart, table, chip, heatmap, or status colors in React when a token exists.
- Driver taxonomy is a closed set enforced in Postgres and local validation. To add a driver, update the DB migration/path, validation, UI mapping, and `DECISIONS.md` together.
- Token collection uses `make collect` (Claude Code, machine auto-derived from hostname) or `make collect-codex` (Codex sessions). Pass an explicit `CODEX_MIN_DATE` when backfilling Codex sessions.
- On a new machine or after collector changes, run `make collect-dry` or `make collect-codex-dry CODEX_MIN_DATE=<date>` first and inspect pending sessions before writing.
- Never collect the same telemetry session under two machine labels. `session_id` is the work-session identity; see `DECISIONS.md` D9.

## Visual Verification

- Codex can visually verify web work when the Codex Browser plugin is enabled and the target is a local dev server, file-backed preview, or public unauthenticated page.
- For frontend changes, run `make dev` locally and verify in the in-app browser before closing out.
- Brett's default browser is Edge. Use Computer Use or Edge only when the in-app Browser is insufficient.

## CSS and Theme Architecture

For dashboard/front-end work, preserve the three-layer token architecture:

1. **Primitive layer:** raw palette values (`--primitive-*`) — not used directly by components.
2. **Semantic site layer:** shared roles (`--color-bg-page`, `--color-text-primary`) — map primitives to meaning.
3. **App expression layer:** `--tb-*` tokens — map semantic roles into Token Burn's visual language.

Components consume `--tb-*` tokens, not raw hex or primitive values. Tailwind for layout/spacing/typography; CSS variables for color.

## Project Snapshot

- Repo: `/Users/brettcoryell/Code/AI/token-burn`
- GitHub: `brettcoryell/token-burn`
- Stack: React + TypeScript + Vite dashboard with Python collection scripts, Supabase storage, and token usage analytics.
