# ============================================================
# Justfile conventions:
#   1. Use printf for colors, never echo (for colored output)
#   2. Empty @echo "" lines before and after each target
#   3. help is the default target, not list
#   4. Help target groups targets by lifecycle stage
#   5. Composite targets use shebang + set -e (fail fast)
#   6. Every target ends with a clear success/failure message
#   7. Help ordering matches file ordering
#   8. This rules comment block at top of file
#   9. Single-line # comment above each target
# ============================================================

# Default recipe: show available commands
_default:
    @just help

# Show available commands
help:
    @echo ""
    @clear
    @echo ""
    @printf "\033[0;34m=== imap-mcp ===\033[0m\n"
    @echo ""
    @printf "\033[0;33mSetup & Lifecycle:\033[0m\n"
    @printf "  %-38s %s\n" "install" "Install dependencies"
    @printf "  %-38s %s\n" "clean" "Clean build artifacts"
    @printf "  %-38s %s\n" "help" "Show available commands"
    @echo ""
    @printf "\033[0;33mRun & Pipeline:\033[0m\n"
    @printf "  %-38s %s\n" "build" "Build the project"
    @printf "  %-38s %s\n" "start" "Build and start the server"
    @echo ""
    @printf "\033[0;33mCode Quality:\033[0m\n"
    @printf "  %-38s %s\n" "lint" "Type-check without emitting"
    @echo ""
    @printf "\033[0;33mCI & Testing:\033[0m\n"
    @printf "  %-38s %s\n" "test" "Run tests"
    @printf "  %-38s %s\n" "test-watch" "Run tests in watch mode"
    @echo ""

# Install dependencies
install:
    @echo ""
    @printf "\033[0;34m=== Installing Dependencies ===\033[0m\n"
    @npm install
    @printf "\033[0;32m✓ Dependencies installed\033[0m\n"
    @echo ""

# Clean build artifacts
clean:
    @echo ""
    @printf "\033[0;34m=== Cleaning Build Artifacts ===\033[0m\n"
    @rm -rf dist
    @printf "\033[0;32m✓ Clean completed\033[0m\n"
    @echo ""

# Build the project
build:
    @echo ""
    @printf "\033[0;34m=== Building Project ===\033[0m\n"
    @npx tsc
    @printf "\033[0;32m✓ Build completed\033[0m\n"
    @echo ""

# Build and start the server
start: build
    @echo ""
    @printf "\033[0;34m=== Starting Server ===\033[0m\n"
    @node dist/index.js
    @printf "\033[0;32m✓ Server stopped\033[0m\n"
    @echo ""

# Type-check without emitting
lint:
    @echo ""
    @printf "\033[0;34m=== Type Checking ===\033[0m\n"
    @npx tsc --noEmit
    @printf "\033[0;32m✓ Type check passed\033[0m\n"
    @echo ""

# Run tests
test:
    #!/usr/bin/env bash
    set -e
    echo ""
    printf "\033[0;34m=== Running Tests ===\033[0m\n"
    npx vitest run
    npx tsx test-integration.ts
    printf "\033[0;32m✓ Tests passed\033[0m\n"
    echo ""

# Run tests in watch mode
test-watch:
    @echo ""
    @printf "\033[0;34m=== Running Tests (Watch Mode) ===\033[0m\n"
    @npx vitest
    @echo ""
