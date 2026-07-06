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
echo "Starting OpenCode server on port 3000..."
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

async function discoverFiles(
  baseUrl: string,
  filename: string,
  text: string,
  discovered: Map<string, string>,
  log: (line: string) => void,
): Promise<void> {
  if (discovered.has(filename)) return

  discovered.set(filename, text)

  // Discover .wasm imports
  const wasmRefs = [...text.matchAll(/["']\.\/([^"']+\.wasm)["']/g)]
  for (const match of wasmRefs) {
    const wasmName = match[1]
    if (!discovered.has(wasmName)) {
      const data = await fetchFile(`${baseUrl}/server/${wasmName}`)
      if (data) {
        const wasmText = new TextDecoder().decode(data)
        discovered.set(wasmName, wasmText) // store as Uint8Array for binary
        log(`Discovered WASM: ${wasmName}`)
      }
    }
  }

  // Discover chunk imports
  const chunkRefs = [...text.matchAll(/["']\.\/(chunk-[^"']+)["']/g)]
  for (const match of chunkRefs) {
    const chunkName = match[1]
    if (!discovered.has(chunkName)) {
      const data = await fetchFile(`${baseUrl}/server/${chunkName}`)
      if (data) {
        log(`Discovered chunk: ${chunkName}`)
        await discoverFiles(baseUrl, chunkName, new TextDecoder().decode(data), discovered, log)
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

  // Fetch and parse server.js
  const serverJs = await fetchFile(`${baseUrl}/server/server.js`)
  if (!serverJs) throw new Error("server/server.js not found")

  log("Discovered server.js")

  // Discover all files recursively from server.js
  const discovered = new Map<string, string>()
  await discoverFiles(
    baseUrl,
    "server.js",
    new TextDecoder().decode(serverJs),
    discovered,
    log,
  )

  // Fetch WASM files separately (they're binary, not text)
  for (const [filename] of discovered) {
    if (filename.endsWith(".wasm")) {
      const data = await fetchFile(`${baseUrl}/server/${filename}`)
      if (data) {
        fileTree[filename] = { file: { contents: data } }
        log(`Fetched ${filename}`)
      }
    }
  }

  // Mount text files (JS chunks)
  for (const [filename, text] of discovered) {
    if (!filename.endsWith(".wasm")) {
      fileTree[filename] = {
        file: { contents: new TextEncoder().encode(text) },
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
