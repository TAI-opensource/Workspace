import type { WebContainer } from "@webcontainer/api"

type BootState = "idle" | "mounting" | "installing" | "starting" | "ready" | "error"

type BootCallbacks = {
  onState?: (state: BootState) => void
  onOutput?: (line: string) => void
  onError?: (error: string) => void
}

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

  const wasmRefs = [...text.matchAll(/["']\.\/([^"']+\.wasm)["']/g)]
  for (const match of wasmRefs) {
    const wasmName = match[1]
    if (!discovered.has(wasmName)) {
      const data = await fetchFile(`${baseUrl}/server/${wasmName}`)
      if (data) {
        discovered.set(wasmName, "")
        log(`Discovered WASM: ${wasmName}`)
      }
    }
  }

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

  const serverJs = await fetchFile(`${baseUrl}/server/server.js`)
  if (!serverJs) throw new Error("server/server.js not found")

  log("Discovered server.js")

  const discovered = new Map<string, string>()
  await discoverFiles(
    baseUrl,
    "server.js",
    new TextDecoder().decode(serverJs),
    discovered,
    log,
  )

  log(`Discovered ${discovered.size} files`)

  for (const [filename] of discovered) {
    if (filename.endsWith(".wasm")) {
      const data = await fetchFile(`${baseUrl}/server/${filename}`)
      if (data) {
        fileTree[filename] = { file: { contents: data } }
        log(`Fetched ${filename} (${(data.byteLength / 1024).toFixed(0)} KB)`)
      }
    }
  }

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

    emit("installing")
    log("Installing runtime dependencies (wa-sqlite, drizzle-orm)...")

    const npmInstall = await container.spawn("npm", ["install", "--prefer-offline"])
    npmInstall.output.pipeTo(
      new WritableStream({
        write(data) {
          log(`[npm] ${data}`)
        },
      }),
    )
    const npmExit = await npmInstall.exit
    if (npmExit !== 0) {
      throw new Error(`npm install failed with exit code ${npmExit}`)
    }
    log("Dependencies installed successfully")

    emit("starting")
    log("Starting OpenCode server on port 3000...")

    const serverProcess = await container.spawn("node", [
      "server.js",
      "serve",
      "--port",
      "3000",
      "--hostname",
      "0.0.0.0",
    ])

    serverProcess.output.pipeTo(
      new WritableStream({
        write(data) {
          log(data)
        },
      }),
    )

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
