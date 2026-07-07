#!/bin/bash
set -e

echo "=== Building OpenCode for WebContainer ==="

# tsconfig.json is already created by vercel.json installCommand (no-op for typecheck)
# Re-create here as safety net
echo '{"compilerOptions":{"noEmit":true,"skipLibCheck":true,"strict":false},"include":[]}' > tsconfig.json

echo "1. Building server for WebContainer..."
bun run --cwd packages/opencode build:webcontainer

echo "2. Building frontend..."
# Aggressively clear ALL caches to force fresh build
rm -rf packages/app/dist 2>/dev/null || true
rm -rf node_modules/.vite 2>/dev/null || true
rm -rf node_modules/.cache 2>/dev/null || true
rm -rf .turbo 2>/dev/null || true
# Build (Vite 7 does not support --force flag)
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

