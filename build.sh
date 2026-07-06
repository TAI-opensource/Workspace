#!/bin/bash
set -e

echo "=== Building OpenCode for WebContainer ==="

echo "1. Installing dependencies..."
bun install

echo "2. Building server for WebContainer..."
bun run --cwd packages/opencode build:webcontainer

echo "3. Copying server to frontend assets..."
mkdir -p packages/app/dist/server
for f in packages/opencode/dist/webcontainer/*.js; do
  cp "$f" packages/app/dist/server/
done
for f in packages/opencode/dist/webcontainer/*.wasm; do
  cp "$f" packages/app/dist/server/ 2>/dev/null || true
done

echo "4. Building frontend..."
bun run --cwd packages/app build

echo "=== Build complete ==="
du -sh packages/app/dist/
