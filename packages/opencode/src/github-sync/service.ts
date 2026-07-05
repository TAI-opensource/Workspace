import { Effect, Service, Layer, Context } from "effect"
import { Octokit } from "@octokit/rest"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { SessionGithubSyncTable } from "@opencode-ai/core/github-sync/sql"
import type { GitHubSyncConfig, GitHubSyncState, SyncData, GitHubSyncConfigRow } from "./types"
import { GitHubSyncListener } from "./listener"
import { GitHubSyncPusher } from "./pusher"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { EventV2Bridge } from "@/event-v2-bridge"
import type { SessionID } from "@/session/schema"

interface Interface {
  readonly connect: (config: GitHubSyncConfig) => Effect.Effect<void>
  readonly disconnect: Effect.Effect<void>
  readonly syncNow: Effect.Effect<void>
  readonly getStatus: Effect.Effect<GitHubSyncState>
  readonly getConfig: Effect.Effect<GitHubSyncConfig | null>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GitHubSync") {}

type State = {
  config: GitHubSyncConfig | null
  state: GitHubSyncState
  queue: Map<SessionID, SyncData[]>
  scope: import("effect").Scope.Closeable
}

const state: InstanceState.InstanceState<State> = InstanceState.make<State>(
  Effect.fn("GitHubSync.state")(function* (_ctx) {
    const cache: State = {
      config: null,
      state: {
        status: "disconnected",
        lastSyncAt: null,
        lastCommitSha: null,
        error: null,
      },
      queue: new Map(),
      scope: yield* import("effect").Scope.make(),
    }

    yield* Effect.addFinalizer(() =>
      import("effect").Scope.close(cache.scope, import("effect").Exit.void).pipe(
        Effect.andThen(
          Effect.sync(() => {
            cache.queue.clear()
            cache.config = null
          }),
        ),
      ),
    )

    return cache
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const pusher = yield* GitHubSyncPusher

    function sync(sessionID: SessionID, data: SyncData[]) {
      return Effect.gen(function* () {
        const s = yield* InstanceState.get(state)
        if (!s.config || s.state.status !== "connected") return

        const existing = s.queue.get(sessionID)
        if (existing) {
          for (const item of data) {
            existing.push(item)
          }
          return
        }

        s.queue.set(sessionID, [...data])
        yield* flush(sessionID).pipe(
          Effect.delay(1000),
          Effect.catchCause((cause) => Effect.logError("github-sync flush failed", { sessionID, cause })),
          Effect.forkIn(s.scope),
        )
      })
    }

    const flush = Effect.fn("GitHubSync.flush")(function* (sessionID: SessionID) {
      const s = yield* InstanceState.get(state)
      const data = s.queue.get(sessionID)
      if (!data || data.length === 0 || !s.config) return

      s.queue.delete(sessionID)

      try {
        const commitSha = yield* pusher.push(s.config, data)
        s.state = {
          ...s.state,
          lastSyncAt: new Date(),
          lastCommitSha: commitSha,
        }
      } catch (error) {
        s.state = {
          ...s.state,
          error: error instanceof Error ? error.message : "Sync failed",
        }
      }
    })

    // Watch for session events
    const watch = <D extends import("@opencode-ai/core/event").EventV2.Definition>(
      def: D,
      fn: (data: import("@opencode-ai/core/event").EventV2.Data<D>) => Effect.Effect<void, unknown>,
    ) =>
      events.listen((event) => {
        if (event.type !== def.type || event.location?.directory !== _ctx.directory) return Effect.void
        return fn(event.data as import("@opencode-ai/core/event").EventV2.Data<D>).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("github-sync subscriber failed", { type: def.type, cause }),
          ),
        )
      })

    yield* watch(Session.Event.Updated, (data) =>
      Effect.gen(function* () {
        const info = data.info
        yield* sync(info.id, [{ type: "session", id: info.id, data: info, action: "update" }])
      }),
    )

    yield* watch(MessageV2.Event.Updated, (data) =>
      Effect.gen(function* () {
        const info = data.info
        yield* sync(info.sessionID, [{ type: "message", id: info.id, data: info, action: "update" }])
      }),
    )

    yield* watch(MessageV2.Event.PartUpdated, (data) =>
      sync(data.part.sessionID, [{ type: "part", id: data.part.id, data: data.part, action: "update" }]),
    )

    yield* watch(Session.Event.Deleted, (data) =>
      Effect.gen(function* () {
        const s = yield* InstanceState.get(state)
        s.queue.delete(data.sessionID)
      }),
    )

    const connect = (config: GitHubSyncConfig) =>
      Effect.gen(function* () {
        // Validate token
        const octokit = new Octokit({ auth: config.token })
        yield* Effect.tryPromise(() => octokit.users.getAuthenticated())

        // Validate repository
        const [owner, repo] = config.repository.split("/")
        yield* Effect.tryPromise(() => octokit.repos.get({ owner, repo }))

        // Save configuration
        const s = yield* InstanceState.get(state)
        s.config = config
        s.state = {
          ...s.state,
          status: "connected",
          error: null,
        }

        // Save to database
        yield* Effect.tryPromise(() =>
          db
            .insert(SessionGithubSyncTable)
            .values({
              id: crypto.randomUUID(),
              session_id: "global",
              repo_owner: owner,
              repo_name: repo,
              branch: config.branch,
              auto_sync: config.autoSync,
              sync_interval: config.syncInterval,
              time_created: Date.now(),
              time_updated: Date.now(),
            })
            .onConflictDoUpdate({
              target: SessionGithubSyncTable.session_id,
              set: {
                repo_owner: owner,
                repo_name: repo,
                branch: config.branch,
                auto_sync: config.autoSync,
                sync_interval: config.syncInterval,
                time_updated: Date.now(),
              },
            }),
        )
      })

    const disconnect = Effect.gen(function* () {
      const s = yield* InstanceState.get(state)
      s.config = null
      s.state = {
        status: "disconnected",
        lastSyncAt: null,
        lastCommitSha: null,
        error: null,
      }
      s.queue.clear()

      // Remove from database
      yield* Effect.tryPromise(() =>
        db.delete(SessionGithubSyncTable).where(eq(SessionGithubSyncTable.session_id, "global")),
      )
    })

    const syncNow = Effect.gen(function* () {
      const s = yield* InstanceState.get(state)
      if (!s.config || s.state.status !== "connected") return

      // Flush all pending changes
      for (const sessionID of s.queue.keys()) {
        yield* flush(sessionID)
      }
    })

    const getStatus = Effect.gen(function* () {
      const s = yield* InstanceState.get(state)
      return s.state
    })

    const getConfig = Effect.gen(function* () {
      const s = yield* InstanceState.get(state)
      return s.config
    })

    return { connect, disconnect, syncNow, getStatus, getConfig }
  }),
)
