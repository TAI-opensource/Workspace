import type { WebContainer } from "@webcontainer/api"

type BootState = "idle" | "mounting" | "starting" | "ready" | "error"

type BootCallbacks = {
  onState?: (state: BootState) => void
  onOutput?: (line: string) => void
  onError?: (error: string) => void
}

const STARTUP_SCRIPT = `#!/bin/bash
set -e
echo "=== OpenCode WebContainer Server ==="
if [ ! -f "server/server.js" ]; then
  echo "ERROR: Server file not found at server/server.js"
  ls -la server/ 2>/dev/null || echo "No server directory"
  exit 1
fi
echo "Starting OpenCode server on port 3000..."
exec node server/server.js serve --port 3000 --hostname 0.0.0.0
`

async function fetchFile(url: string, log: (line: string) => void): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

async function discoverServerFiles(baseUrl: string, log: (line: string) => void): Promise<string[]> {
  const files: string[] = []

  const indexJs = await fetchFile(`${baseUrl}/server/server.js`, log)
  if (!indexJs) throw new Error("server/server.js not found - build may not have completed")
  files.push("server/server.js")

  // Discover chunk files by trying common patterns
  // The bundler creates chunk-*.js files that are imported by server.js
  log("Discovering server chunks...")

  // Try to fetch manifest/listing
  const manifest = await fetchFile(`${baseUrl}/server/manifest.json`, log)
  if (manifest) {
    try {
      const text = new TextDecoder().decode(manifest)
      const data = JSON.parse(text)
      if (data.chunks) {
        for (const chunk of data.chunks) {
          files.push(`server/${chunk}`)
        }
      }
    } catch {
      // ignore
    }
  }

  return files
}

async function mountServer(container: WebContainer, baseUrl: string, log: (line: string) => void) {
  const fileTree: Record<string, { file: { contents: Uint8Array } }> = {}

  fileTree["start.sh"] = { file: { contents: new TextEncoder().encode(STARTUP_SCRIPT) } }

  // Fetch main entry
  const indexJs = await fetchFile(`${baseUrl}/server/server.js`, log)
  if (!indexJs) throw new Error("server/server.js not found")
  fileTree["server/server.js"] = { file: { contents: indexJs } }
  log("Fetched server/server.js")

  // Fetch WASM files needed by the server
  const wasmFiles = [
    "photon_rs_bg-wasm_fingerprint.wasm",
    "tree-sitter.wasm",
    "tree-sitter-bash.wasm",
    "tree-sitter-powershell.wasm",
  ]
  for (const wasm of wasmFiles) {
    const data = await fetchFile(`${baseUrl}/server/${wasm}`, log)
    if (data) {
      fileTree[`server/${wasm}`] = { file: { contents: data } }
      log(`Fetched ${wasm}`)
    }
  }

  // Fetch chunk files - try to discover them from the main server.js
  const serverText = new TextDecoder().decode(indexJs)
  const chunkImports = [...serverText.matchAll(/from\s*["']\.\/(chunk-[^"']+)["']/g)]
  for (const match of chunkImports) {
    const chunkName = match[1]
    const data = await fetchFile(`${baseUrl}/server/${chunkName}`, log)
    if (data) {
      fileTree[`server/${chunkName}`] = { file: { contents: data } }
    }
  }

  // Also try fetching chunk files referenced with .js extension
  const chunkRefs = [...serverText.matchAll(/["'](chunk-[a-z0-9]+\.js)["']/g)]
  for (const match of chunkRefs) {
    const chunkName = match[1]
    if (!fileTree[`server/${chunkName}`]) {
      const data = await fetchFile(`${baseUrl}/server/${chunkName}`, log)
      if (data) {
        fileTree[`server/${chunkName}`] = { file: { contents: data } }
      }
    }
  }

  log(`Mounting ${Object.keys(fileTree).length} files...`)
  await container.mount(fileTree, { mode: "keep" })
  log("Files mounted")
}

export async function bootOpenCode(container: WebContainer, callbacks?: BootCallbacks) {
  const emit = (state: BootState) => callbacks?.onState?.(state)
  const log = (line: string) => callbacks?.onOutput?.(line)
  const err = (error: string) => callbacks?.onError?.(error)

  try {
    emit("mounting")
    const baseUrl = window.location.origin

    await mountServer(container, baseUrl, log)

    const chmodProcess = await container.spawn("chmod", ["+x", "start.sh"])
    await chmodProcess.exit

    emit("starting")
    log("Starting OpenCode server...")

    const serverProcess = await container.spawn("sh", ["start.sh"])

    serverProcess.output.pipeTo(
      new WritableStream({
        write(data) {
          log(data)
        },
      }),
    )

    const unsub = container.on("server-ready", (port, url) => {
      log(`Server ready on port ${port}: ${url}`)
      emit("ready")
      unsub()
    })

    return {
      stop: async () => {
        unsub()
        await serverProcess.kill()
      },
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    err(message)
    emit("error")
    throw e
  }
}
