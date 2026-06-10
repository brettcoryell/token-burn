.PHONY: collect collect-iMac dev build test test-collector test-ui install

SESSIONS_ROOT ?= $(HOME)/.claude/projects/
MACHINE ?= cadence
CHAT_TOKENS ?= 75000
OUTPUT ?= public/data/daily-burn.json
ANNOTATIONS ?= data/annotations.json

collect:
	python3 scripts/collect.py \
		--sessions-root "$(SESSIONS_ROOT)" \
		--machine "$(MACHINE)" \
		--chat-tokens-per-session $(CHAT_TOKENS) \
		--annotations "$(ANNOTATIONS)" \
		--output "$(OUTPUT)"

collect-dry:
	python3 scripts/collect.py \
		--sessions-root "$(SESSIONS_ROOT)" \
		--machine "$(MACHINE)" \
		--annotations "$(ANNOTATIONS)" \
		--output "$(OUTPUT)" \
		--dry-run

collect-iMac:
	@echo "Requires Tailscale + SSH to iMac. Future: rsync sessions then run collect."
	@echo "For now, manually copy iMac sessions to /tmp/iMac-sessions/ then:"
	@echo "  make collect SESSIONS_ROOT=/tmp/iMac-sessions/ MACHINE=coda"

dev:
	npm run dev

build:
	npm run build

install:
	npm install
	pip3 install pytest

test-collector:
	python3 -m pytest tests/collector/ -v

test-ui:
	npx playwright test

test: test-collector test-ui

seed-annotations:
	@if [ ! -f data/annotations.json ]; then \
		echo '{}' > data/annotations.json; \
		echo "Created empty data/annotations.json"; \
	fi
