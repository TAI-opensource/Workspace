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
import { readdir, stat, watch as fsWatch } from "node:fs/promises"
import type { FSWatcher } from "node:fs"

export const Event = FileSystemWatcher.Event

export const hasNativeBinding = () => false

export interface Interface {}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileWatcher") {}

interface FileState {
  path: string
  mtime: number
  isDirectory: boolean
}

async function scanDirectory(dir: string, ignorePatterns: string[]): Promise<Map<string, FileState>> {
  const files = new Map<string, FileState>()

  async function scan(currentDir: string) {
    try {
      const entries = await readdir(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        const relativePath = path.relative(dir, fullPath)

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

function isIgnored(filePath: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => filePath.includes(pattern))
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

    const initialFiles = yield* Effect.promise(() => scanDirectory(location.directory, ignorePatterns))
    let fileStates = initialFiles

    let watcher: FSWatcher | null = null

    try {
      watcher = fsWatch(location.directory, { recursive: true })

      Effect.runFork(
        Effect.fn("watcher.processEvents")(function* () {
          const asyncIter = watcher![Symbol.asyncIterator]()

          while (true) {
            const next = yield* Effect.promise(() => asyncIter.next())
            if (next.done) break

            const event = next.value
            if (!event.filename) continue

            const fullPath = path.join(location.directory, event.filename)

            if (isIgnored(fullPath, ignorePatterns)) continue

            if (event.eventType === "rename") {
              try {
                await stat(fullPath)
                const stats = await stat(fullPath)
                const isDir = stats.isDirectory()
                fileStates.set(fullPath, { path: fullPath, mtime: stats.mtimeMs, isDirectory: isDir })
                Effect.runFork(events.publish(Event.Updated, { file: fullPath, event: "add" }))
              } catch {
                const prev = fileStates.get(fullPath)
                if (prev) {
                  fileStates.delete(fullPath)
                  Effect.runFork(events.publish(Event.Updated, { file: fullPath, event: "unlink" }))
                }
              }
            } else if (event.eventType === "change") {
              try {
                const stats = await stat(fullPath)
                const prev = fileStates.get(fullPath)
                if (prev && prev.mtime !== stats.mtimeMs) {
                  prev.mtime = stats.mtimeMs
                  Effect.runFork(events.publish(Event.Updated, { file: fullPath, event: "change" }))
                } else if (!prev) {
                  fileStates.set(fullPath, { path: fullPath, mtime: stats.mtimeMs, isDirectory: stats.isDirectory() })
                  Effect.runFork(events.publish(Event.Updated, { file: fullPath, event: "add" }))
                }
              } catch {
                // File may have been deleted between rename and change events
              }
            }
          }
        }),
      )
    } catch {
      // fs.watch with recursive may not be supported, fall back to no-op
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        watcher?.close()
      }),
    )

    yield* Effect.logInfo("watcher backend", {
      directory: location.directory,
      platform: "webcontainer",
      backend: "native-fs.watch",
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
