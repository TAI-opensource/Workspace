import type { WebContainer } from "@webcontainer/api"

type BootState = "idle" | "mounting" | "installing" | "starting" | "ready" | "error"

type BootCallbacks = {
  onState?: (state: BootState) => void
  onOutput?: (line: string) => void
  onError?: (error: string) => void
}

type Manifest = Record<string, "js" | "wasm">

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\].*?\x07/g, "")
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
          type: "module",
          dependencies: {
            "wa-sqlite": "*",
            "drizzle-orm": "*",
            "jsonc-parser": "*",
          },
        }),
      ),
    },
  }

  const manifestData = await fetchFile(`${baseUrl}/server/manifest.json`)
  if (!manifestData) throw new Error("server/manifest.json not found")

  const manifest: Manifest = JSON.parse(new TextDecoder().decode(manifestData))
  const filenames = Object.keys(manifest)
  log(`Manifest: ${filenames.length} files to fetch`)

  let fetched = 0
  const total = filenames.length

  const results = await Promise.all(
    filenames.map(async (filename) => {
      const data = await fetchFile(`${baseUrl}/server/${filename}`)
      if (!data) {
        log(`Failed to fetch: ${filename}`)
        return null
      }
      fetched++
      if (fetched % 20 === 0 || fetched === total) {
        log(`Fetched ${fetched}/${total} files...`)
      }
      return { filename, data, type: manifest[filename] }
    }),
  )

  for (const result of results) {
    if (result) {
      fileTree[result.filename] = { file: { contents: result.data } }
    }
  }

  const fileCount = Object.keys(fileTree).length
  log(`Mounting ${fileCount} files...`)
  await container.mount(fileTree, { mode: "keep" })
  log(`Mounted ${fileCount} files successfully`)

  // Create workspace directory for projects
  await container.fs.mkdir("/workspace", { recursive: true })
  log("Created /workspace directory")
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
          const clean = stripAnsi(data).trim()
          if (clean && clean.length > 1) log(`[npm] ${clean}`)
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
      "webcontainer-serve.js",
    ])

    serverProcess.output.pipeTo(
      new WritableStream({
        write(data) {
          log(stripAnsi(data))
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
