#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")
import pkg from "../package.json"

console.log("Building OpenCode server for WebContainer (Node.js compatible)...")

await $`rm -rf dist/webcontainer`
await $`mkdir -p dist/webcontainer`

const result = await Bun.build({
  conditions: ["webcontainer", "node"],
  tsconfig: "./tsconfig.json",
  external: ["node-gyp"],
  format: "esm",
  minify: false,
  sourcemap: "linked",
  splitting: true,
  entrypoints: ["./src/index.ts"],
  define: {
    OPENCODE_VERSION: `'${pkg.version}'`,
    OPENCODE_MODELS_DEV: generated.modelsData,
    OPENCODE_CHANNEL: `'web'`,
    OPENCODE_LIBC: `'glibc'`,
  },
  outdir: "dist/webcontainer",
})

if (!result.success) {
  console.error("Build failed:")
  for (const msg of result.logs) {
    console.error(msg)
  }
  process.exit(1)
}

console.log(`Build successful! Output files:`)
for (const output of result.outputs) {
  console.log(`  ${output.path} (${(output.size / 1024).toFixed(1)} KB)`)
}

export { result }
