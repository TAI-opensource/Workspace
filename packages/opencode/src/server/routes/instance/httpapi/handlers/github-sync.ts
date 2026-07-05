import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { GitHubSyncApi } from "../groups/github-sync"
import { GitHubSyncService } from "@/github-sync/service"

export const githubSyncHandlers = HttpApiBuilder.group(GitHubSyncApi, "github-sync", (handlers) =>
  Effect.gen(function* () {
    const githubSync = yield* GitHubSyncService

    return handlers
      .handle("connect", ({ payload }) => githubSync.connect(payload))
      .handle("status", () => githubSync.getStatus())
      .handle("syncNow", () => githubSync.syncNow())
      .handle("disconnect", () => githubSync.disconnect())
  }),
)
