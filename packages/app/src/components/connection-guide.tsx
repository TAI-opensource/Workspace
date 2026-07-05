import { createSignal, Show } from "solid-js"
import { Splash } from "@opencode-ai/ui/logo"
import { useLanguage } from "@/context/language"

export function ConnectionGuide(props: { onRetry?: () => void; error?: unknown }) {
  const language = useLanguage()
  const [tab, setTab] = createSignal<"desktop" | "android">("desktop")
  const [copied, setCopied] = createSignal<string | null>(null)

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const t = (key: string) => language.t(key as any)

  const desktopSteps = [
    { label: t("connection.guide.step.installBun"), cmd: "curl -fsSL https://bun.sh/install | bash" },
    { label: t("connection.guide.step.cloneRepo"), cmd: "git clone https://github.com/TAI-opensource/Workspace.git" },
    { label: t("connection.guide.step.enterDir"), cmd: "cd Workspace" },
    { label: t("connection.guide.step.installDeps"), cmd: "bun install" },
    { label: t("connection.guide.step.startServer"), cmd: "bun run dev" },
  ]

  const androidSteps = [
    { label: t("connection.guide.step.installTermux"), cmd: "https://f-droid.org/packages/com.termux/" },
    { label: t("connection.guide.step.installTermuxDeps"), cmd: "pkg install bun git nodejs" },
    { label: t("connection.guide.step.cloneRepo"), cmd: "git clone https://github.com/TAI-opensource/Workspace.git" },
    { label: t("connection.guide.step.enterDir"), cmd: "cd Workspace" },
    { label: t("connection.guide.step.installDeps"), cmd: "bun install" },
    { label: t("connection.guide.step.startServer"), cmd: "bun run dev" },
  ]

  const steps = tab() === "desktop" ? desktopSteps : androidSteps

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base gap-6 p-6 overflow-y-auto">
      <div class="flex flex-col items-center max-w-lg text-center">
        <Splash class="w-12 h-15 mb-4 opacity-60" />
        <h1 class="text-18-semibold text-text-strong mb-2">{t("connection.guide.title")}</h1>
        <p class="text-14-regular text-text-weak">
          {t("connection.guide.subtitle")}
        </p>
      </div>

      <div class="flex gap-2 w-full max-w-lg">
        <button
          type="button"
          class={`flex-1 px-4 py-2 rounded-lg text-14-medium transition-colors ${
            tab() === "desktop"
              ? "bg-surface-raised-base text-text-strong"
              : "bg-surface-base text-text-weak hover:text-text-base"
          }`}
          onClick={() => setTab("desktop")}
        >
          {t("connection.guide.tab.desktop")}
        </button>
        <button
          type="button"
          class={`flex-1 px-4 py-2 rounded-lg text-14-medium transition-colors ${
            tab() === "android"
              ? "bg-surface-raised-base text-text-strong"
              : "bg-surface-base text-text-weak hover:text-text-base"
          }`}
          onClick={() => setTab("android")}
        >
          {t("connection.guide.tab.android")}
        </button>
      </div>

      <div class="w-full max-w-lg bg-surface-base rounded-xl p-4 flex flex-col gap-3">
        <Show when={tab() === "android"}>
          <div class="bg-surface-raised-base rounded-lg p-3 text-12-regular text-text-weak">
            <span class="text-text-base font-medium">{t("connection.guide.android.tip").split(":")[0]}:</span>{" "}
            {t("connection.guide.android.tip").split(":").slice(1).join(":").trim().replace("F-Droid", "")}{" "}
            <a href="https://f-droid.org/" target="_blank" rel="noopener" class="text-info-base underline">
              F-Droid
            </a>{" "}
            ({t("connection.guide.android.tip").includes("Play Store") ? "" : ""})
          </div>
        </Show>

        {steps.map((step, i) => (
          <div class="flex flex-col gap-1">
            <span class="text-12-medium text-text-weak">
              {i + 1}. {step.label}
            </span>
            <div class="flex items-center gap-2 bg-surface-raised-base rounded-lg px-3 py-2">
              <code class="flex-1 text-12-regular text-text-base font-mono break-all">{step.cmd}</code>
              <button
                type="button"
                class="shrink-0 px-2 py-1 rounded text-12-medium text-text-weak hover:text-text-base hover:bg-surface-raised-base-hover transition-colors"
                onClick={() => copyToClipboard(step.cmd, `${tab()}-${i}`)}
              >
                {copied() === `${tab()}-${i}` ? t("connection.guide.step.copied") : t("connection.guide.step.copy")}
              </button>
            </div>
          </div>
        ))}
      </div>

      <Show when={props.error}>
        <div class="w-full max-w-lg bg-surface-base rounded-xl p-4">
          <p class="text-12-regular text-text-weak break-all">
            {String(props.error)}
          </p>
        </div>
      </Show>

      <Show when={props.onRetry}>
        <button
          type="button"
          class="px-6 py-2 rounded-lg bg-info-base text-text-inverted text-14-medium hover:opacity-90 transition-opacity"
          onClick={() => props.onRetry?.()}
        >
          {t("connection.guide.retry")}
        </button>
      </Show>

      <p class="text-12-regular text-text-weak text-center max-w-md">
        {t("connection.guide.footer")}
      </p>
    </div>
  )
}
