.PHONY: collect collect-dry collect-reconcile collect-reconcile-dry collect-codex collect-codex-dry collect-codex-reconcile collect-codex-reconcile-dry token-accounting-closeout audit-token-accounting audit-token-accounting-strict suggest-annotations apply-high-confidence-annotations normalize-machine-labels-dry normalize-machine-labels migrate dev build test test-collector test-ui install

SESSIONS_ROOT ?= $(HOME)/.claude/projects/
MACHINE       ?= $(shell hostname | tr '[:upper:]' '[:lower:]' | awk '/mini/ {print "mini"; found=1} /macbook|book/ {print "macbook"; found=1} /imac/ {print "imac"; found=1} END {if (!found) print "unknown"}')
AGENT_FAMILY  ?= claude
SURFACE       ?= claude-code
CODEX_STATE_DB ?= $(HOME)/.codex/state_5.sqlite

# Collection and audit MUST share one lookback window. When the collector's
# window is narrower than the audit's, the audit reports drift that collection
# structurally cannot repair — a Codex thread that starts on one day and keeps
# running is collected mid-flight, then filtered out from the next day onward
# and never reconciles. That is exactly how the 2026-08-22 and 2026-09-02
# sessions sat stale across several closeouts (see D14).
#
# CODEX_MIN_DATE still exists as an explicit override for first backfills and
# for the D10 split-backfill workflow; only its default has changed.
LOOKBACK_DAYS  ?= 30
CODEX_MIN_DATE ?= $(shell date -v-$(LOOKBACK_DAYS)d +%Y-%m-%d 2>/dev/null || date -d "$(LOOKBACK_DAYS) days ago" +%Y-%m-%d)

collect:        ## Collect agent sessions → upsert to Supabase
	.venv/bin/python scripts/collect.py \
		--sessions-root "$(SESSIONS_ROOT)" \
		--machine "$(MACHINE)" \
		--agent-family "$(AGENT_FAMILY)" \
		--surface "$(SURFACE)"

collect-dry:    ## Dry run — show what would be upserted
	.venv/bin/python scripts/collect.py \
		--sessions-root "$(SESSIONS_ROOT)" \
		--machine "$(MACHINE)" \
		--agent-family "$(AGENT_FAMILY)" \
		--surface "$(SURFACE)" \
		--dry-run

collect-reconcile:  ## Re-upsert local Claude Code telemetry ignoring hash state
	.venv/bin/python scripts/collect.py \
		--sessions-root "$(SESSIONS_ROOT)" \
		--machine "$(MACHINE)" \
		--agent-family "$(AGENT_FAMILY)" \
		--surface "$(SURFACE)" \
		--ignore-state

collect-reconcile-dry:  ## Dry run reconciliation ignoring hash state
	.venv/bin/python scripts/collect.py \
		--sessions-root "$(SESSIONS_ROOT)" \
		--machine "$(MACHINE)" \
		--agent-family "$(AGENT_FAMILY)" \
		--surface "$(SURFACE)" \
		--ignore-state \
		--dry-run \
		--verbose

collect-codex:  ## Collect Codex sessions → upsert to Supabase
		.venv/bin/python scripts/collect.py \
			--source codex \
			--codex-state-db "$(CODEX_STATE_DB)" \
			--machine "$(MACHINE)" \
			--codex-min-date "$(CODEX_MIN_DATE)"

collect-codex-dry:  ## Dry run Codex collection
		.venv/bin/python scripts/collect.py \
			--source codex \
			--codex-state-db "$(CODEX_STATE_DB)" \
			--machine "$(MACHINE)" \
			--codex-min-date "$(CODEX_MIN_DATE)" \
			--dry-run \
			--verbose

collect-codex-reconcile:  ## Re-upsert Codex telemetry ignoring hash state
		.venv/bin/python scripts/collect.py \
			--source codex \
			--codex-state-db "$(CODEX_STATE_DB)" \
			--machine "$(MACHINE)" \
			--codex-min-date "$(CODEX_MIN_DATE)" \
			--ignore-state

collect-codex-reconcile-dry:  ## Dry run Codex reconciliation ignoring hash state
		.venv/bin/python scripts/collect.py \
			--source codex \
			--codex-state-db "$(CODEX_STATE_DB)" \
			--machine "$(MACHINE)" \
			--codex-min-date "$(CODEX_MIN_DATE)" \
			--ignore-state \
			--dry-run \
			--verbose

token-accounting-closeout:  ## Blessed token-accounting closeout subroutine for Claude Code and Codex
	.venv/bin/python scripts/token_accounting_closeout.py

audit-token-accounting:  ## Audit recent Supabase rows against local telemetry
	.venv/bin/python scripts/audit_token_accounting.py --days $(LOOKBACK_DAYS) --machine "$(MACHINE)"

audit-token-accounting-strict:  ## Fail on dangerous accounting findings only
	.venv/bin/python scripts/audit_token_accounting.py --days $(LOOKBACK_DAYS) --machine "$(MACHINE)" --fail-on-dangerous

suggest-annotations:  ## Suggest high-value driver annotations without writing
	.venv/bin/python scripts/suggest_annotations.py --days 60 --min-tokens 10000000 --output data/annotation-review.json

apply-high-confidence-annotations:  ## Apply high-confidence high-value driver annotations
	.venv/bin/python scripts/suggest_annotations.py --days 60 --min-tokens 10000000 --output data/annotation-suggestions.json --apply

normalize-machine-labels-dry:  ## Dry-run legacy machine label cleanup
	.venv/bin/python scripts/normalize_machine_labels.py

normalize-machine-labels:  ## Apply legacy machine label cleanup
	.venv/bin/python scripts/normalize_machine_labels.py --apply

migrate:        ## One-time: migrate legacy daily-burn.json → Supabase
	.venv/bin/python scripts/migrate_legacy.py

dev:            ## Start Vite dev server (use vercel dev for API routes)
	npm run dev

build:          ## Build frontend
	npm run build

install:        ## Install dependencies
	npm install
	python3.12 -m venv .venv
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -e ".[dev]" 2>/dev/null || .venv/bin/pip install supabase python-dotenv pytest

test-collector: ## Run Python collector unit tests
	.venv/bin/python -m pytest tests/collector/ -v

test-ui:        ## Run Playwright UI tests
	npx playwright test --config tests/ui/playwright.config.ts

test: test-collector test-ui  ## Run all tests
