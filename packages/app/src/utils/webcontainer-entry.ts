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
if [ ! -f "server.js" ]; then
  echo "ERROR: Server file not found at server.js"
  ls -la
  exit 1
fi
echo "Installing runtime dependencies..."
npm install wa-sqlite drizzle-orm 2>&1
echo "Dependencies installed. Listing node_modules:"
ls node_modules/ 2>/dev/null | head -20
echo "Starting OpenCode server on port 3000..."
node -e "
process.on('uncaughtException', (err) => { console.error('[UNCAUGHT]', err.message); process.exit(1); });
process.on('unhandledRejection', (err) => { console.error('[UNHANDLED]', err); process.exit(1); });
" 2>&1
exec node server.js serve --port 3000 --hostname 0.0.0.0
`

async function fetchFile(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

const MAX_DISCOVERY_DEPTH = 3

async function discoverFiles(
  baseUrl: string,
  filename: string,
  text: string,
  discovered: Map<string, string>,
  log: (line: string) => void,
  depth: number = 0,
): Promise<void> {
  if (discovered.has(filename)) return
  if (depth > MAX_DISCOVERY_DEPTH) return

  discovered.set(filename, text)

  // Discover .wasm imports
  const wasmRefs = [...text.matchAll(/["']\.\/([^"']+\.wasm)["']/g)]
  for (const match of wasmRefs) {
    const wasmName = match[1]
    if (!discovered.has(wasmName)) {
      const data = await fetchFile(`${baseUrl}/server/${wasmName}`)
      if (data) {
        discovered.set(wasmName, "") // placeholder, WASM is binary
        log(`Discovered WASM: ${wasmName}`)
      }
    }
  }

  // Only discover chunk imports if within depth limit
  if (depth < MAX_DISCOVERY_DEPTH) {
    const chunkRefs = [...text.matchAll(/["']\.\/(chunk-[^"']+)["']/g)]
    for (const match of chunkRefs) {
      const chunkName = match[1]
      if (!discovered.has(chunkName)) {
        const data = await fetchFile(`${baseUrl}/server/${chunkName}`)
        if (data) {
          log(`Discovered chunk: ${chunkName}`)
          await discoverFiles(baseUrl, chunkName, new TextDecoder().decode(data), discovered, log, depth + 1)
        }
      }
    }
  }
}

async function mountServer(
  container: WebContainer,
  baseUrl: string,
  log: (line: string) => void,
) {
  const fileTree: Record<string, { file: { contents: Uint8Array } }> = {}

  fileTree["start.sh"] = {
    file: { contents: new TextEncoder().encode(STARTUP_SCRIPT) },
  }

  // package.json for npm install
  fileTree["package.json"] = {
    file: {
      contents: new TextEncoder().encode(
        JSON.stringify({
          name: "opencode-server",
          private: true,
          dependencies: {
            "wa-sqlite": "*",
            "drizzle-orm": "*",
          },
        }),
      ),
    },
  }

  // Fetch and parse server.js
  const serverJs = await fetchFile(`${baseUrl}/server/server.js`)
  if (!serverJs) throw new Error("server/server.js not found")

  log("Discovered server.js")

  // Discover all files recursively from server.js (depth-limited)
  const discovered = new Map<string, string>()
  await discoverFiles(
    baseUrl,
    "server.js",
    new TextDecoder().decode(serverJs),
    discovered,
    log,
  )

  log(`Discovered ${discovered.size} files`)

  // Fetch WASM files separately (they're binary, not text)
  for (const [filename] of discovered) {
    if (filename.endsWith(".wasm")) {
      const data = await fetchFile(`${baseUrl}/server/${filename}`)
      if (data) {
        fileTree[filename] = { file: { contents: data } }
        log(`Fetched ${filename} (${(data.byteLength / 1024).toFixed(0)} KB)`)
      }
    }
  }

  // Mount text files (JS chunks)
  for (const [filename, text] of discovered) {
    if (!filename.endsWith(".wasm") && text) {
      fileTree[filename] = {
        file: { contents: new TextEncoder().encode(text) },
      }
    }
  }

  const fileCount = Object.keys(fileTree).length
  log(`Mounting ${fileCount} files...`)
  await container.mount(fileTree, { mode: "keep" })
  log(`Mounted ${fileCount} files successfully`)
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

    // Monitor process exit
    serverProcess.exit.then((code) => {
      log(`[process] Server exited with code ${code}`)
      if (code !== 0) {
        err(`Server process exited with code ${code}`)
      }
    })

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
