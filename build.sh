#!/bin/bash
set -e

echo "=== Building OpenCode for WebContainer ==="

echo "1. Building server for WebContainer..."
bun run --cwd packages/opencode build:webcontainer

echo "2. Building frontend..."
bun run --cwd packages/app build

echo "3. Copying server to frontend assets..."
mkdir -p packages/app/dist/server
for f in packages/opencode/dist/webcontainer/*.js; do
  cp "$f" packages/app/dist/server/
done
for f in packages/opencode/dist/webcontainer/*.wasm; do
  cp "$f" packages/app/dist/server/ 2>/dev/null || true
done
cp packages/opencode/dist/webcontainer/manifest.json packages/app/dist/server/

echo "4. Copying to dist/ for Vercel..."
rm -rf dist
cp -r packages/app/dist dist

echo "=== Build complete ==="
du -sh dist/

