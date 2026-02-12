# Default: list available recipes
default:
    @just --list

# Type-check without emitting
lint:
    npx tsc --noEmit

# Run tests
test:
    npx vitest run

# Run tests in watch mode
test-watch:
    npx vitest

# Build the project
build:
    npx tsc

# Build and start the server
start: build
    node dist/index.js

# Install dependencies
install:
    npm install

# Clean build artifacts
clean:
    rm -rf dist
