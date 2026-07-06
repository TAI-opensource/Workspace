import { Component, Show, createSignal, onMount } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { useLanguage } from "@/context/language"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { showToast } from "@/utils/toast"
import { useServer } from "@/context/server"
import "./settings-v2.css"

export const SettingsGitHubSyncV2: Component = () => {
  const language = useLanguage()
  const server = useServer()

  const [enabled, setEnabled] = createSignal(false)
  const [token, setToken] = createSignal("")
  const [repo, setRepo] = createSignal("")
  const [branch, setBranch] = createSignal("main")
  const [interval, setInterval] = createSignal("300")
  const [status, setStatus] = createSignal("disconnected")

  const intervalOptions = [
    { value: "60", label: "Every minute" },
    { value: "300", label: "Every 5 minutes" },
    { value: "900", label: "Every 15 minutes" },
    { value: "1800", label: "Every 30 minutes" },
    { value: "3600", label: "Every hour" },
  ]
  const [lastSync, setLastSync] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)

  onMount(async () => {
    try {
      const response = await server.fetch("/github-sync/status")
      const data = await response.json()
      setStatus(data.status)
      setLastSync(data.lastSyncAt)
      setEnabled(data.status === "connected")
    } catch {
      // Ignore errors on mount
    }
  })

  const connectGitHub = async () => {
    setLoading(true)
    try {
      await server.fetch("/github-sync/connect", {
        method: "POST",
        body: JSON.stringify({
          token: token(),
          repository: repo(),
          branch: branch(),
          syncInterval: parseInt(interval()),
          autoSync: true,
        }),
      })
      setStatus("connected")
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "GitHub connected",
        description: "GitHub Sync is now enabled.",
      })
    } catch (error) {
      showToast({
        variant: "error",
        icon: "circle-x",
        title: "Connection failed",
        description: error instanceof Error ? error.message : "Failed to connect to GitHub",
      })
    } finally {
      setLoading(false)
    }
  }

  const syncNow = async () => {
    setLoading(true)
    try {
      await server.fetch("/github-sync/sync-now", { method: "POST" })
      setLastSync(new Date().toISOString())
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Sync completed",
        description: "Data has been synced to GitHub.",
      })
    } catch (error) {
      showToast({
        variant: "error",
        icon: "circle-x",
        title: "Sync failed",
        description: error instanceof Error ? error.message : "Failed to sync",
      })
    } finally {
      setLoading(false)
    }
  }

  const disconnectGitHub = async () => {
    await server.fetch("/github-sync/disconnect", { method: "DELETE" })
    setStatus("disconnected")
    setEnabled(false)
    setToken("")
    setRepo("")
    showToast({
      variant: "success",
      icon: "circle-check",
      title: "GitHub disconnected",
      description: "GitHub Sync has been disabled.",
    })
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">GitHub Sync</h2>
      </div>

      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <SettingsListV2>
            <SettingsRowV2
              title="Enable GitHub Sync"
              description="Sync your sessions and settings with GitHub"
            >
              <div data-action="settings-github-sync-enable">
                <Switch checked={enabled()} onChange={setEnabled} />
              </div>
            </SettingsRowV2>

            <Show when={enabled()}>
              <SettingsRowV2
                title="Personal Access Token"
                description="GitHub personal access token for authentication"
              >
                <div class="w-full sm:w-[220px]">
                  <TextInputV2
                    data-action="settings-github-token"
                    type="password"
                    appearance="base"
                    value={token()}
                    onInput={(e) => setToken(e.currentTarget.value)}
                    placeholder="ghp_xxxxxxxxxxxx"
                    spellcheck={false}
                    autocorrect="off"
                    autocomplete="off"
                    autocapitalize="off"
                    aria-label="Personal Access Token"
                  />
                </div>
              </SettingsRowV2>

              <SettingsRowV2
                title="Repository"
                description="GitHub repository to sync with (owner/repo format)"
              >
                <div class="w-full sm:w-[220px]">
                  <TextInputV2
                    data-action="settings-github-repo"
                    type="text"
                    appearance="base"
                    value={repo()}
                    onInput={(e) => setRepo(e.currentTarget.value)}
                    placeholder="owner/repository"
                    spellcheck={false}
                    autocorrect="off"
                    autocomplete="off"
                    autocapitalize="off"
                    aria-label="Repository"
                  />
                </div>
              </SettingsRowV2>

              <SettingsRowV2
                title="Branch"
                description="Branch to sync to"
              >
                <div class="w-full sm:w-[220px]">
                  <TextInputV2
                    data-action="settings-github-branch"
                    type="text"
                    appearance="base"
                    value={branch()}
                    onInput={(e) => setBranch(e.currentTarget.value)}
                    placeholder="main"
                    spellcheck={false}
                    autocorrect="off"
                    autocomplete="off"
                    autocapitalize="off"
                    aria-label="Branch"
                  />
                </div>
              </SettingsRowV2>

              <SettingsRowV2
                title="Sync Interval"
                description="How often to sync automatically"
              >
                <SelectV2
                  appearance="inline"
                  placement="bottom-end"
                  gutter={6}
                  options={intervalOptions}
                  current={intervalOptions.find((o) => o.value === interval())}
                  value={(o) => o.value}
                  label={(o) => o.label}
                  onSelect={(option) => option && setInterval(option.value)}
                />
              </SettingsRowV2>

              <SettingsRowV2
                title="Connect to GitHub"
                description="Connect your GitHub account to enable sync"
              >
                <ButtonV2
                  size="normal"
                  variant="neutral"
                  onClick={connectGitHub}
                  disabled={!token() || !repo() || loading()}
                >
                  {loading() ? "Connecting..." : "Connect"}
                </ButtonV2>
              </SettingsRowV2>
            </Show>

            <Show when={status() === "connected"}>
              <SettingsRowV2
                title="Status"
                description={`Last sync: ${lastSync() ? new Date(lastSync()!).toLocaleString() : "Never"}`}
              >
                <div class="flex gap-2">
                  <ButtonV2
                    size="normal"
                    variant="neutral"
                    onClick={syncNow}
                    disabled={loading()}
                  >
                    {loading() ? "Syncing..." : "Sync Now"}
                  </ButtonV2>
                  <ButtonV2
                    size="normal"
                    variant="neutral"
                    onClick={() => window.open(`https://github.com/${repo()}`, "_blank")}
                  >
                    View on GitHub
                  </ButtonV2>
                  <ButtonV2
                    size="normal"
                    variant="danger"
                    onClick={disconnectGitHub}
                  >
                    Disconnect
                  </ButtonV2>
                </div>
              </SettingsRowV2>
            </Show>
          </SettingsListV2>
        </div>
      </div>
    </>
  )
}
