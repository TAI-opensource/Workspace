import type { WebContainer } from "@webcontainer/api"

type BootState = "idle" | "mounting" | "installing" | "building" | "starting" | "ready" | "error"

type BootCallbacks = {
  onState?: (state: BootState) => void
  onOutput?: (line: string) => void
  onError?: (error: string) => void
}

// The server startup script that runs inside WebContainer
const SERVER_STARTUP_SCRIPT = `
#!/bin/bash
set -e

echo "=== OpenCode WebContainer Server ==="
echo "Starting server..."

# Check if node is available
if ! command -v node &> /dev/null; then
  echo "ERROR: node is not available"
  exit 1
fi

# Check if the server file exists
if [ ! -f "packages/opencode/dist/index.js" ]; then
  echo "ERROR: Server file not found at packages/opencode/dist/index.js"
  echo "Available files:"
  ls -la
  exit 1
fi

# Start the server
echo "Starting OpenCode server on port 3000..."
exec node packages/opencode/dist/index.js serve --port 3000 --hostname 0.0.0.0
`

export async function bootOpenCode(container: WebContainer, callbacks?: BootCallbacks) {
  const emit = (state: BootState) => callbacks?.onState?.(state)
  const log = (line: string) => callbacks?.onOutput?.(line)
  const err = (error: string) => callbacks?.onError?.(error)

  try {
    emit("mounting")
    log("Preparing WebContainer environment...")

    // Create the startup script
    await container.mount({
      "start.sh": { file: { contents: SERVER_STARTUP_SCRIPT } },
    })

    // Make the script executable
    const chmodProcess = await container.spawn("chmod", ["+x", "start.sh"])
    await chmodProcess.exit

    emit("installing")
    log("Checking for pre-built server...")

    // Check if we have a pre-built server
    const checkProcess = await container.spawn("sh", ["-c", "ls packages/opencode/dist/index.js 2>/dev/null || echo 'NO_PREBUILT'"])
    let hasPrebuilt = false

    checkProcess.output.pipeTo(
      new WritableStream({
        write(data) {
          if (data.includes("NO_PREBUILT")) {
            hasPrebuilt = false
          } else if (data.includes("index.js")) {
            hasPrebuilt = true
          }
        },
      }),
    )
    await checkProcess.exit

    if (!hasPrebuilt) {
      log("No pre-built server found. Building from source...")
      emit("building")

      // Clone the repository
      log("Cloning OpenCode repository...")
      const cloneProcess = await container.spawn("sh", [
        "-c",
        `
        # Clone the repo
        git clone --depth 1 https://github.com/anomalyco/opencode.git /tmp/opencode 2>&1 || {
          echo "Git clone failed, trying to download tarball..."
          curl -L https://github.com/anomalyco/opencode/archive/refs/heads/dev.tar.gz | tar xz -C /tmp 2>&1
          mv /tmp/opencode-dev /tmp/opencode 2>/dev/null || true
        }
        
        # Copy files to workspace
        cp -r /tmp/opencode/* . 2>/dev/null || true
        cp -r /tmp/opencode/.* . 2>/dev/null || true
        
        echo "Repository ready"
        `,
      ])

      cloneProcess.output.pipeTo(
        new WritableStream({
          write(data) {
            log(data)
          },
        }),
      )

      const cloneExit = await cloneProcess.exit
      if (cloneExit !== 0) {
        throw new Error(`Failed to clone repository: exit code ${cloneExit}`)
      }

      // Install dependencies
      log("Installing dependencies (this may take a few minutes)...")
      const installProcess = await container.spawn("sh", [
        "-c",
        `
        # Install bun first
        curl -fsSL https://bun.sh/install | bash 2>&1 || true
        export PATH="$HOME/.bun/bin:$PATH"
        
        # Install dependencies
        bun install 2>&1
        `,
      ])

      installProcess.output.pipeTo(
        new WritableStream({
          write(data) {
            log(data)
          },
        }),
      )

      const installExit = await installProcess.exit
      if (installExit !== 0) {
        throw new Error(`Failed to install dependencies: exit code ${installExit}`)
      }

      // Build the server
      log("Building the server (this may take a few minutes)...")
      const buildProcess = await container.spawn("sh", [
        "-c",
        `
        export PATH="$HOME/.bun/bin:$PATH"
        bun run --cwd packages/opencode build 2>&1
        `,
      ])

      buildProcess.output.pipeTo(
        new WritableStream({
          write(data) {
            log(data)
          },
        }),
      )

      const buildExit = await buildProcess.exit
      if (buildExit !== 0) {
        throw new Error(`Failed to build server: exit code ${buildExit}`)
      }
    } else {
      log("Found pre-built server, skipping build...")
    }

    emit("starting")
    log("Starting OpenCode server...")

    // Start the server
    const serverProcess = await container.spawn("sh", ["start.sh"])

    serverProcess.output.pipeTo(
      new WritableStream({
        write(data) {
          log(data)
          if (data.includes("listening on")) {
            emit("ready")
          }
        },
      }),
    )

    // Listen for the server-ready event
    const unsub = container.on("server-ready", (port, url) => {
      log(`Server ready on port ${port}: ${url}`)
      emit("ready")
      unsub()
    })

    return {
      stop: async () => {
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

export async function mountWorkspace(container: WebContainer, files: Record<string, string>) {
  const fileTree: Record<string, { file: { contents: string } }> = {}
  for (const [path, content] of Object.entries(files)) {
    fileTree[path] = { file: { contents: content } }
  }
  await container.mount(fileTree, { mode: "keep" })
}

export async function readFile(container: WebContainer, path: string): Promise<string> {
  return await container.fs.readFile(path, "utf-8")
}

export async function writeFile(container: WebContainer, path: string, content: string): Promise<void> {
  await container.fs.writeFile(path, content)
}

export async function listDir(container: WebContainer, path: string): Promise<string[]> {
  return await container.fs.readdir(path)
}
