# Mac Sweep — Build, Release & Run Makefile (macOS / Tauri v2)
#
# Overrideable paths:
#   make release RELEASE_DIR=./dist-release
#   make run RELEASE_DIR=./dist-release
#   make install INSTALL_DIR=/Applications

SHELL           := /bin/bash
.DEFAULT_GOAL   := help

APP_NAME          := Mac Sweep
BIN_NAME          := mac-sweep
RELEASE_DIR       ?= release
INSTALL_DIR       ?= $(HOME)/Applications
RELEASE_BUNDLES   ?= app

TAURI_TARGET_DIR  := src-tauri/target
TAURI_DEBUG_BIN   := $(TAURI_TARGET_DIR)/debug/$(BIN_NAME)
TAURI_RELEASE_BIN := $(TAURI_TARGET_DIR)/release/$(BIN_NAME)
TAURI_APP_BUNDLE  := $(TAURI_TARGET_DIR)/release/bundle/macos/$(APP_NAME).app
TAURI_DMG_DIR     := $(TAURI_TARGET_DIR)/release/bundle/dmg

RELEASE_APP       := $(RELEASE_DIR)/$(APP_NAME).app
RELEASE_APP_EXEC  := $(RELEASE_APP)/Contents/MacOS/$(BIN_NAME)
INSTALLED_APP     := $(INSTALL_DIR)/$(APP_NAME).app
INSTALLED_EXEC    := $(INSTALLED_APP)/Contents/MacOS/$(BIN_NAME)

.PHONY: help deps dev check test build release release-dmg run run-app install run-installed clean

help: ## Show available targets and configured release paths
	@echo "Mac Sweep Makefile"
	@echo ""
	@echo "Configured paths (override via VAR=value):"
	@echo "  RELEASE_DIR     = $(RELEASE_DIR)"
	@echo "  RELEASE_APP     = $(RELEASE_APP)"
	@echo "  RELEASE_EXEC    = $(RELEASE_APP_EXEC)"
	@echo "  INSTALL_DIR     = $(INSTALL_DIR)"
	@echo "  RELEASE_BUNDLES = $(RELEASE_BUNDLES)"
	@echo ""
	@echo "Targets:"
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_-]+:.*##/ { printf "  %-16s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

deps: ## Install frontend dependencies with pnpm
	pnpm install

dev: ## Launch Mac Sweep in Tauri hot-reload dev mode
	pnpm tauri dev

check: ## Run Rust fmt/clippy and strict TypeScript typecheck
	cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings
	pnpm tsc --noEmit

test: ## Run Rust and Vitest test suites
	cd src-tauri && cargo test
	pnpm test

build: ## Build frontend production assets and debug Tauri binary
	pnpm build
	pnpm tauri build --debug --no-bundle
	@echo "Debug executable ready at: $(TAURI_DEBUG_BIN)"

release: ## Build optimized macOS release bundle and stage it into $(RELEASE_DIR)
	pnpm tauri build --bundles "$(RELEASE_BUNDLES)"
	@mkdir -p "$(RELEASE_DIR)"
	@rm -rf "$(RELEASE_APP)"
	@cp -R "$(TAURI_APP_BUNDLE)" "$(RELEASE_APP)"
	@if [ -d "$(TAURI_DMG_DIR)" ]; then \
		find "$(TAURI_DMG_DIR)" -maxdepth 1 -name '*.dmg' -exec cp -f {} "$(RELEASE_DIR)/" \; ; \
	fi
	@test -x "$(RELEASE_APP_EXEC)" || (echo "ERROR: Missing executable at $(RELEASE_APP_EXEC)" && exit 1)
	@echo ""
	@echo "Release staged successfully:"
	@echo "  App Bundle : $(RELEASE_APP)"
	@echo "  Executable : $(RELEASE_APP_EXEC)"

release-dmg: ## Build both macOS .app bundle and .dmg installer into $(RELEASE_DIR)
	@$(MAKE) release RELEASE_BUNDLES="app,dmg" RELEASE_DIR="$(RELEASE_DIR)"

run: ## Run the staged release executable directly from $(RELEASE_DIR) (builds if missing)
	@if [ ! -x "$(RELEASE_APP_EXEC)" ]; then \
		echo "Release executable not found at '$(RELEASE_APP_EXEC)'; building release first..."; \
		$(MAKE) release RELEASE_DIR="$(RELEASE_DIR)" RELEASE_BUNDLES="$(RELEASE_BUNDLES)"; \
	fi
	@echo "Executing: $(RELEASE_APP_EXEC)"
	@"$(RELEASE_APP_EXEC)"

run-app: ## Launch the staged $(APP_NAME).app bundle via macOS Finder/LaunchServices (builds if missing)
	@if [ ! -d "$(RELEASE_APP)" ]; then \
		echo "Release app bundle not found at '$(RELEASE_APP)'; building release first..."; \
		$(MAKE) release RELEASE_DIR="$(RELEASE_DIR)" RELEASE_BUNDLES="$(RELEASE_BUNDLES)"; \
	fi
	@echo "Opening: $(RELEASE_APP)"
	@open "$(RELEASE_APP)"

install: ## Copy staged $(APP_NAME).app into $(INSTALL_DIR) (default: ~/Applications)
	@if [ ! -d "$(RELEASE_APP)" ]; then \
		$(MAKE) release RELEASE_DIR="$(RELEASE_DIR)" RELEASE_BUNDLES="$(RELEASE_BUNDLES)"; \
	fi
	@mkdir -p "$(INSTALL_DIR)"
	@rm -rf "$(INSTALLED_APP)"
	@cp -R "$(RELEASE_APP)" "$(INSTALLED_APP)"
	@echo "Installed to: $(INSTALLED_APP)"

run-installed: ## Run the installed executable from $(INSTALL_DIR)
	@test -x "$(INSTALLED_EXEC)" || (echo "Not installed at $(INSTALLED_EXEC). Run 'make install' first." && exit 1)
	@echo "Executing: $(INSTALLED_EXEC)"
	@"$(INSTALLED_EXEC)"

clean: ## Remove frontend dist, staged release directory, and Rust target artifacts
	rm -rf dist "$(RELEASE_DIR)" "$(TAURI_TARGET_DIR)"
