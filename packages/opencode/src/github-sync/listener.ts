import { Effect, Service, Layer, Context } from "effect"
import type { SyncData } from "./types"

interface Interface {
  readonly getPendingChanges: () => Effect.Effect<SyncData[]>
  readonly clearPendingChanges: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GitHubSyncListener") {}
export { Service as GitHubSyncListener }

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let pendingChanges: SyncData[] = []

    const getPendingChanges = Effect.succeed(pendingChanges)

    const clearPendingChanges = Effect.sync(() => {
      pendingChanges = []
    })

    return { getPendingChanges, clearPendingChanges }
  }),
)
