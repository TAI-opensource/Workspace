import { createSimpleContext } from "@opencode-ai/ui/context"
import { createSignal, onCleanup, onMount, type ParentProps } from "solid-js"

export type WebContainerState = "idle" | "booting" | "ready" | "error" | "unsupported"

type WebContainerAPI = import("@webcontainer/api").WebContainer

type WebContainerContext = {
  state: () => WebContainerState
  container: () => WebContainerAPI | null
  error: () => string | null
  boot: () => Promise<void>
}

export const { use: useWebContainer, provider: WebContainerProvider } = createSimpleContext({
  name: "WebContainer",
  init: () => {
    const [state, setState] = createSignal<WebContainerState>("idle")
    const [container, setContainer] = createSignal<WebContainerAPI | null>(null)
    const [error, setError] = createSignal<string | null>(null)

    let booted = false

    const boot = async () => {
      if (booted) return
      booted = true

      if (typeof SharedArrayBuffer === "undefined") {
        setState("unsupported")
        setError("SharedArrayBuffer is not available. The app requires cross-origin isolation headers.")
        return
      }

      try {
        setState("booting")
        const { WebContainer } = await import("@webcontainer/api")
        const instance = await WebContainer.boot()
        setContainer(instance)
        setState("ready")
      } catch (e) {
        setState("error")
        setError(e instanceof Error ? e.message : String(e))
      }
    }

    onMount(() => {
      boot()
    })

    onCleanup(() => {
      container()?.teardown()
    })

    return {
      state,
      container,
      error,
      boot,
    }
  },
})

export function WebContainerShell(props: ParentProps & { class?: string }) {
  const wc = useWebContainer()

  return (
    <div class={props.class}>
      {wc.state() === "idle" || wc.state() === "booting" ? (
        <div class="flex items-center justify-center h-full">
          <div class="flex flex-col items-center gap-3">
            <div class="w-8 h-8 border-2 border-text-weak border-t-transparent rounded-full animate-spin" />
            <span class="text-12-regular text-text-weak">Starting WebContainer...</span>
          </div>
        </div>
      ) : wc.state() === "unsupported" ? (
        <div class="flex items-center justify-center h-full">
          <div class="flex flex-col items-center gap-3 max-w-md text-center">
            <span class="text-14-medium text-text-base">WebContainer is not supported</span>
            <span class="text-12-regular text-text-weak">{wc.error()}</span>
          </div>
        </div>
      ) : wc.state() === "error" ? (
        <div class="flex items-center justify-center h-full">
          <div class="flex flex-col items-center gap-3 max-w-md text-center">
            <span class="text-14-medium text-text-base">Failed to start WebContainer</span>
            <span class="text-12-regular text-text-weak">{wc.error()}</span>
            <button
              type="button"
              class="px-4 py-2 rounded-lg bg-info-base text-text-inverted text-14-medium"
              onClick={() => wc.boot()}
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        props.children
      )}
    </div>
  )
}
