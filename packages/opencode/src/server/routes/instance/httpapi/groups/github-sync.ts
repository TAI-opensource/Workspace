import { Effect, Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { described } from "./metadata"

const root = "/github-sync"

const GitHubSyncConfigSchema = Schema.Struct({
  token: Schema.String,
  repository: Schema.String,
  branch: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed("main"))),
  syncInterval: Schema.Number.pipe(Schema.withConstructorDefault(Effect.succeed(300))),
  autoSync: Schema.Boolean.pipe(Schema.withConstructorDefault(Effect.succeed(true))),
})

const GitHubSyncStatusSchema = Schema.Struct({
  status: Schema.Literal("disconnected", "connecting", "connected", "error"),
  lastSyncAt: Schema.NullOr(Schema.String),
  lastCommitSha: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
})

export const GitHubSyncPaths = {
  connect: `${root}/connect`,
  status: `${root}/status`,
  syncNow: `${root}/sync-now`,
  disconnect: `${root}/disconnect`,
} as const

export const GitHubSyncApi = HttpApi.make("github-sync")
  .add(
    HttpApiGroup.make("github-sync")
      .add(
        HttpApiEndpoint.post("connect", GitHubSyncPaths.connect, {
          payload: GitHubSyncConfigSchema,
          success: described(Schema.Void, "GitHub connected"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "github-sync.connect",
            summary: "Connect to GitHub",
            description: "Connect OpenCode to a GitHub repository for sync.",
          }),
        ),
        HttpApiEndpoint.get("status", GitHubSyncPaths.status, {
          success: described(GitHubSyncStatusSchema, "GitHub sync status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "github-sync.status",
            summary: "Get GitHub sync status",
            description: "Get the current status of GitHub sync.",
          }),
        ),
        HttpApiEndpoint.post("syncNow", GitHubSyncPaths.syncNow, {
          success: described(Schema.Void, "Sync started"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "github-sync.syncNow",
            summary: "Sync now",
            description: "Trigger an immediate sync to GitHub.",
          }),
        ),
        HttpApiEndpoint.del("disconnect", GitHubSyncPaths.disconnect, {
          success: described(Schema.Void, "GitHub disconnected"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "github-sync.disconnect",
            summary: "Disconnect from GitHub",
            description: "Disconnect OpenCode from GitHub sync.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "github-sync",
          description: "GitHub sync routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode GitHub sync HttpApi",
      version: "0.0.1",
      description: "GitHub sync HttpApi surface for instance routes.",
    }),
  )
