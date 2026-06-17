.PHONY: collect collect-codex collect-coda migrate dev build test test-collector test-ui install

SESSIONS_ROOT ?= $(HOME)/.claude/projects/
MACHINE       ?= cadence
CODEX_MACHINE ?= lumen
CODEX_STATE_DB ?= $(HOME)/.codex/state_5.sqlite
CODEX_MIN_DATE ?= $(shell date +%Y-%m-%d)

collect:        ## Collect Code sessions → upsert to Supabase (run on Cadence)
	.venv/bin/python scripts/collect.py \
		--sessions-root "$(SESSIONS_ROOT)" \
		--machine "$(MACHINE)"

collect-dry:    ## Dry run — show what would be upserted
	.venv/bin/python scripts/collect.py \
		--sessions-root "$(SESSIONS_ROOT)" \
		--machine "$(MACHINE)" \
		--dry-run

collect-codex:  ## Collect Codex sessions → upsert to Supabase
		.venv/bin/python scripts/collect.py \
			--source codex \
			--codex-state-db "$(CODEX_STATE_DB)" \
			--machine "$(CODEX_MACHINE)" \
			--codex-min-date "$(CODEX_MIN_DATE)"

collect-coda:   ## Collect Code sessions on Coda (run on iMac with MACHINE=coda)
	.venv/bin/python scripts/collect.py \
		--sessions-root "$(SESSIONS_ROOT)" \
		--machine coda

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
