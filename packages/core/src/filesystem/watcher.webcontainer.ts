export * as Watcher from "./watcher"

import { makeLocationNode } from "../effect/app-node"
import { Cause, Context, Effect, Layer } from "effect"
import { FileSystemWatcher } from "@opencode-ai/schema/filesystem-watcher"
import path from "path"
import { Config } from "../config"
import { EventV2 } from "../event"
import { Flag } from "../flag/flag"
import { FSUtil } from "../fs-util"
import { Git } from "../git"
import { Location } from "../location"
import { lazy } from "../util/lazy"
import { Ignore } from "./ignore"
import { Protected } from "./protected"
import { readdir, stat } from "node:fs/promises"

export const Event = FileSystemWatcher.Event

export const hasNativeBinding = () => false

export interface Interface {}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileWatcher") {}

interface FileState {
  path: string
  mtime: number
  isDirectory: boolean
}

const POLL_INTERVAL_MS = 1000

async function scanDirectory(dir: string, ignorePatterns: string[]): Promise<Map<string, FileState>> {
  const files = new Map<string, FileState>()

  async function scan(currentDir: string) {
    try {
      const entries = await readdir(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        const relativePath = path.relative(dir, fullPath)

        // Check ignore patterns
        if (ignorePatterns.some((pattern) => relativePath.includes(pattern))) {
          continue
        }

        try {
          const stats = await stat(fullPath)
          files.set(fullPath, {
            path: fullPath,
            mtime: stats.mtimeMs,
            isDirectory: entry.isDirectory(),
          })

          if (entry.isDirectory()) {
            await scan(fullPath)
          }
        } catch {
          // Skip files that can't be stat'd
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  await scan(dir)
  return files
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    if (yield* Flag.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER) return Service.of({})

    const location = yield* Location.Service
    const events = yield* EventV2.Service
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const config = (yield* (yield* Config.Service).entries())
      .filter((entry): entry is Config.Document => entry.type === "document")
      .flatMap((item) => item.info.watcher?.ignore ?? [])

    const ignorePatterns = [...Ignore.PATTERNS, ...config]
    let previousFiles = new Map<string, FileState>()
    let polling = true

    // Initial scan
    const initialFiles = yield* Effect.promise(() => scanDirectory(location.directory, ignorePatterns))
    previousFiles = initialFiles

    // Start polling
    const poll = async () => {
      while (polling) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

        try {
          const currentFiles = await scanDirectory(location.directory, ignorePatterns)

          // Check for new or modified files
          for (const [path, state] of currentFiles) {
            const prev = previousFiles.get(path)
            if (!prev) {
              // New file
              Effect.runFork(events.publish(Event.Updated, { file: path, event: "add" }))
            } else if (prev.mtime !== state.mtime) {
              // Modified file
              Effect.runFork(events.publish(Event.Updated, { file: path, event: "change" }))
            }
          }

          // Check for deleted files
          for (const [path] of previousFiles) {
            if (!currentFiles.has(path)) {
              Effect.runFork(events.publish(Event.Updated, { file: path, event: "unlink" }))
            }
          }

          previousFiles = currentFiles
        } catch (e) {
          // Log error but continue polling
          console.error("File watcher poll error:", e)
        }
      }
    }

    // Start polling in background
    Effect.runFork(
      Effect.sync(() => {
        poll().catch(() => {})
      }),
    )

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        polling = false
      }),
    )

    yield* Effect.logInfo("watcher backend", {
      directory: location.directory,
      platform: "webcontainer",
      backend: "polling",
    })

    return Service.of({})
  }).pipe(
    Effect.catchCause((cause) => {
      return Effect.logError("failed to init watcher service", { cause: Cause.pretty(cause) }).pipe(
        Effect.as(Service.of({})),
      )
    }),
  ),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Location.node, Config.node, Git.node, EventV2.node],
})
