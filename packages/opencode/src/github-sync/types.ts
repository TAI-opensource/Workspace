export interface GitHubSyncConfig {
  token: string
  repository: string // owner/repo
  branch: string
  syncInterval: number
  autoSync: boolean
}

export interface GitHubSyncState {
  status: "disconnected" | "connecting" | "connected" | "error"
  lastSyncAt: Date | null
  lastCommitSha: string | null
  error: string | null
}

export interface SyncData {
  type: "session" | "message" | "part" | "settings"
  id: string
  data: unknown
  action: "create" | "update" | "delete"
}

export interface GitHubSyncConfigRow {
  id: string
  session_id: string
  repo_owner: string
  repo_name: string
  branch: string
  last_commit_sha: string | null
  last_sync_at: number | null
  auto_sync: boolean
  sync_interval: number
  time_created: number
  time_updated: number
}
