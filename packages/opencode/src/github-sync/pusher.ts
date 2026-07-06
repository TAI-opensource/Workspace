import { Effect, Service, Layer, Context } from "effect"
import { Octokit } from "@octokit/rest"
import type { GitHubSyncConfig, SyncData } from "./types"

interface Interface {
  readonly push: (config: GitHubSyncConfig, data: SyncData[]) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GitHubSyncPusher") {}
export { Service as GitHubSyncPusher }

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const push = (config: GitHubSyncConfig, data: SyncData[]) =>
      Effect.gen(function* () {
        const octokit = new Octokit({ auth: config.token })
        const [owner, repo] = config.repository.split("/")

        // Get latest commit
        const { data: ref } = yield* Effect.tryPromise(() =>
          octokit.git.getRef({
            owner,
            repo,
            ref: `heads/${config.branch}`,
          }),
        )

        const lastCommitSha = ref.object.sha

        // Create tree with changes
        const treeItems = data.map((item) => ({
          path: `opencode/${item.type}s/${item.id}.json`,
          mode: "100644" as const,
          type: "blob" as const,
          content: JSON.stringify(item.data, null, 2),
        }))

        const { data: tree } = yield* Effect.tryPromise(() =>
          octokit.git.createTree({
            owner,
            repo,
            base_tree: lastCommitSha,
            tree: treeItems,
          }),
        )

        // Create commit
        const { data: commit } = yield* Effect.tryPromise(() =>
          octokit.git.createCommit({
            owner,
            repo,
            message: `Sync OpenCode data - ${new Date().toISOString()}`,
            tree: tree.sha,
            parents: [lastCommitSha],
          }),
        )

        // Update ref
        yield* Effect.tryPromise(() =>
          octokit.git.updateRef({
            owner,
            repo,
            ref: `heads/${config.branch}`,
            sha: commit.sha,
          }),
        )

        return commit.sha
      })

    return { push }
  }),
)
