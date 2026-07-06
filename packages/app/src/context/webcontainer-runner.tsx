import { createSimpleContext } from "@opencode-ai/ui/context"
import { createSignal, onCleanup, type ParentProps, Show } from "solid-js"
import { useWebContainer } from "@/context/webcontainer"
import { bootOpenCode } from "@/utils/webcontainer-entry"

type RunnerState = "idle" | "booting" | "ready" | "error"

type WebContainerRunnerContext = {
  runnerState: () => RunnerState
  serverUrl: () => string | null
  logs: () => string[]
  error: () => string | null
  start: () => Promise<void>
  stop: () => Promise<void>
}

export const { use: useWebContainerRunner, provider: WebContainerRunnerProvider } = createSimpleContext({
  name: "WebContainerRunner",
  init: () => {
    const wc = useWebContainer()
    const [runnerState, setRunnerState] = createSignal<RunnerState>("idle")
    const [serverUrl, setServerUrl] = createSignal<string | null>(null)
    const [logs, setLogs] = createSignal<string[]>([])
    const [error, setError] = createSignal<string | null>(null)

    let stopFn: (() => Promise<void>) | null = null
    let unsubServerReady: (() => void) | null = null

    const addLog = (line: string) => {
      setLogs((prev) => [...prev.slice(-100), line])
    }

    const start = async () => {
      const container = wc.container()
      if (!container) {
        setError("WebContainer not ready")
        return
      }

      if (runnerState() === "ready") return

      try {
        setRunnerState("booting")
        setError(null)
        setLogs([])

        // Listen for server-ready event BEFORE booting
        unsubServerReady = container.on("server-ready", (port, url) => {
          addLog(`[server-ready] Port ${port}: ${url}`)
          setServerUrl(url)
          setRunnerState("ready")
        })

        const result = await bootOpenCode(container, {
          onState: (state) => {
            addLog(`[state] ${state}`)
          },
          onOutput: (line) => {
            addLog(line)
          },
          onError: (msg) => {
            setError(msg)
          },
        })

        stopFn = result.stop

        // If server-ready wasn't fired yet, show error
        setTimeout(() => {
          if (runnerState() === "booting") {
            setError("Server did not start within 60 seconds. Check the logs below.")
            setRunnerState("error")
          }
        }, 60000)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setRunnerState("error")
      }
    }

    const stop = async () => {
      if (unsubServerReady) {
        unsubServerReady()
        unsubServerReady = null
      }
      if (stopFn) {
        await stopFn()
        stopFn = null
      }
      setRunnerState("idle")
      setServerUrl(null)
    }

    onCleanup(() => {
      stop().catch(() => {})
    })

    return {
      runnerState,
      serverUrl,
      logs,
      error,
      start,
      stop,
    }
  },
})

export function WebContainerRunnerShell(props: ParentProps) {
  const runner = useWebContainerRunner()

  return (
    <Show
      when={runner.runnerState() === "ready"}
      fallback={
        <div class="flex flex-col items-center justify-center h-full gap-4">
          <div class="flex flex-col items-center gap-3">
            <Show
              when={runner.runnerState() === "error"}
              fallback={
                <div class="w-8 h-8 border-2 border-info-base border-t-transparent rounded-full animate-spin" />
              }
            >
              <div class="w-8 h-8 text-error-base text-2xl">!</div>
            </Show>
            <span class="text-14-medium text-text-base">
              {runner.runnerState() === "error"
                ? "Server failed to start"
                : "Starting OpenCode server..."}
            </span>
          </div>

          <Show when={runner.logs().length > 0}>
            <div class="w-full max-w-md h-32 overflow-auto bg-background-base rounded-lg border border-border-base p-2 font-mono text-11-regular text-text-weak">
              {runner.logs().slice(-15).map((line) => (
                <div>{line}</div>
              ))}
            </div>
          </Show>

          <Show when={runner.error()}>
            <div class="text-12-regular text-error-base">{runner.error()}</div>
          </Show>

          <Show when={runner.runnerState() === "error"}>
            <button
              class="px-4 py-2 bg-info-base text-background-base rounded-lg text-14-medium hover:opacity-90"
              onClick={() => runner.stop().then(() => runner.start())}
            >
              Try Again
            </button>
          </Show>
        </div>
      }
    >
      {props.children}
    </Show>
  )
}
