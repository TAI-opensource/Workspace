import type { WebContainer } from "@webcontainer/api"

type BootState = "idle" | "mounting" | "installing" | "building" | "starting" | "ready" | "error"

type BootCallbacks = {
  onState?: (state: BootState) => void
  onOutput?: (line: string) => void
  onError?: (error: string) => void
}

const STARTUP_SCRIPT = `#!/bin/bash
set -e
echo "=== OpenCode WebContainer Server ==="
if [ ! -f "server/index.js" ]; then
  echo "ERROR: Server file not found at server/index.js"
  ls -la server/ 2>/dev/null || echo "No server directory"
  exit 1
fi
echo "Starting OpenCode server on port 3000..."
exec node server/index.js serve --port 3000 --hostname 0.0.0.0
`

async function fetchFile(url: string, log: (line: string) => void): Promise<Uint8Array> {
  log(`Fetching ${url}...`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}

async function mountServerFiles(container: WebContainer, baseUrl: string, log: (line: string) => void) {
  const fileTree: Record<string, { file: { contents: Uint8Array } }> = {}

  // Mount startup script
  fileTree["start.sh"] = { file: { contents: new TextEncoder().encode(STARTUP_SCRIPT) } }

  // Fetch server files
  const indexJs = await fetchFile(`${baseUrl}/server/index.js`, log)
  fileTree["server/index.js"] = { file: { contents: indexJs } }

  // Try to fetch additional chunks if they exist
  const chunks = ["index-0.js", "index-1.js", "index-2.js"]
  for (const chunk of chunks) {
    try {
      const data = await fetchFile(`${baseUrl}/server/${chunk}`, log)
      fileTree[`server/${chunk}`] = { file: { contents: data } }
    } catch {
      // Chunk doesn't exist, skip
    }
  }

  log(`Mounting ${Object.keys(fileTree).length} files...`)
  await container.mount(fileTree, { mode: "keep" })
  log("Files mounted successfully")
}

export async function bootOpenCode(container: WebContainer, callbacks?: BootCallbacks) {
  const emit = (state: BootState) => callbacks?.onState?.(state)
  const log = (line: string) => callbacks?.onOutput?.(line)
  const err = (error: string) => callbacks?.onError?.(error)

  try {
    emit("mounting")

    // Determine base URL - same origin as the page
    const baseUrl = window.location.origin

    await mountServerFiles(container, baseUrl, log)

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
