#!/usr/bin/env bun

import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")
import pkg from "../package.json"

console.log("Building OpenCode HTTP server for WebContainer...")

const fs = await import("fs")
fs.rmSync("dist/webcontainer", { recursive: true, force: true })
fs.mkdirSync("dist/webcontainer", { recursive: true })

const result = await Bun.build({
  target: "node",
  conditions: ["webcontainer", "node"],
  tsconfig: "./tsconfig.json",
  external: [
    "node-gyp",
    "wa-sqlite",
  ],
  format: "esm",
  minify: false,
  sourcemap: "none",
  splitting: true,
  entrypoints: ["./src/server/server.ts"],
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
    console.error(String(msg))
  }
  process.exit(1)
}

console.log(`Build successful! ${result.outputs.length} output files:`)

const manifest: Record<string, "js" | "wasm"> = {}
for (const output of result.outputs) {
  const name = output.path.split("/").pop()!
  console.log(`  ${output.path.replace(dir + "/", "")} (${(output.size / 1024).toFixed(1)} KB)`)
  if (name.endsWith(".wasm")) {
    manifest[name] = "wasm"
  } else if (name.endsWith(".js")) {
    manifest[name] = "js"
  }
}

const manifestPath = path.join(dir, "dist/webcontainer/manifest.json")
fs.writeFileSync(manifestPath, JSON.stringify(manifest))
console.log(`Manifest written: ${Object.keys(manifest).length} files`)
