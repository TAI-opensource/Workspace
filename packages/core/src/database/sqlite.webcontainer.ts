import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { identity } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as Client from "effect/unstable/sql/SqlClient"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import * as Statement from "effect/unstable/sql/Statement"
import { Sqlite } from "./sqlite"

const ATTR_DB_SYSTEM_NAME = "db.system.name"

const TypeId = "~@opencode-ai/core/database/SqliteWebContainer" as const
type TypeId = typeof TypeId

interface SqliteClient extends Client.SqlClient {
  readonly [TypeId]: TypeId
  readonly config: Config
  readonly updateValues: never
}

interface Config {
  readonly filename: string
  readonly readonly?: boolean
  readonly create?: boolean
  readonly readwrite?: boolean
  readonly disableWAL?: boolean
  readonly timeout?: number
  readonly spanAttributes?: Record<string, unknown>
  readonly transformResultNames?: (str: string) => string
  readonly transformQueryNames?: (str: string) => string
}

interface SqliteConnection extends Connection {}

let sqliteModule: any = null
let dbInstance: any = null

async function getSqlite() {
  if (sqliteModule) return sqliteModule
  const SQLite = (await import("wa-sqlite")).default
  sqliteModule = SQLite
  return sqliteModule
}

async function getDb(filename: string) {
  if (dbInstance) return dbInstance
  const SQLite = await getSqlite()
  dbInstance = await SQLite.open(filename === ":memory:" ? undefined : filename)
  return dbInstance
}

async function execQuery(db: any, sql: string, params: any[] = []): Promise<any[]> {
  const results: any[] = []
  try {
    for await (const row of db.exec(sql, params)) {
      results.push(row)
    }
  } catch (e) {
    // wa-sqlite exec returns an iterator, not a promise
    const iter = db.exec(sql, params)
    let result = iter.next()
    while (!result.done) {
      results.push(result.value)
      result = iter.next()
    }
  }
  return results
}

const make = (options: Config) =>
  Effect.gen(function* () {
    const db = yield* Effect.promise(() => getDb(options.filename))

    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames)
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined

    const run = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<Array<Record<string, unknown>>, SqlError>((fiber) => {
        try {
          const results: any[] = []
          const iter = db.exec(query, [...params])
          let result = iter.next()
          while (!result.done) {
            results.push(result.value)
            result = iter.next()
          }
          return Effect.succeed(results as Array<Record<string, unknown>>)
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
            }),
          )
        }
      })

    const runValues = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<ReadonlyArray<ReadonlyArray<unknown>>, SqlError>((fiber) => {
        try {
          const results: any[] = []
          const iter = db.exec(query, [...params])
          let result = iter.next()
          while (!result.done) {
            results.push(Object.values(result.value))
            result = iter.next()
          }
          return Effect.succeed(results as unknown as ReadonlyArray<ReadonlyArray<unknown>>)
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
            }),
          )
        }
      })

    const connection = identity<SqliteConnection>({
      execute(query, params, transformRows) {
        return transformRows ? Effect.map(run(query, params), transformRows) : run(query, params)
      },
      executeRaw(query, params) {
        return run(query, params)
      },
      executeValues(query, params) {
        return runValues(query, params)
      },
      executeUnprepared(query, params, transformRows) {
        return this.execute(query, params, transformRows)
      },
      executeStream() {
        return Stream.die("executeStream not implemented")
      },
    })

    const semaphore = yield* Semaphore.make(1)
    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection))
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!
      const scope = Context.getUnsafe(fiber.context, Scope.Scope)
      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () => Scope.addFinalizer(scope, semaphore.release(1))),
        connection,
      )
    })

    const client = Object.assign(
      (yield* Client.make({
        acquirer,
        compiler,
        transactionAcquirer,
        spanAttributes: [
          ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
          [ATTR_DB_SYSTEM_NAME, "sqlite"],
        ],
        transformRows,
      })) as SqliteClient,
      {
        [TypeId]: TypeId,
        config: options,
      },
    )

    return client
  })

const nativeLayer = (config: Config) =>
  Layer.effect(
    Sqlite.Native,
    Effect.gen(function* () {
      const db = yield* Effect.promise(() => getDb(config.filename))
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (dbInstance) {
            dbInstance.close()
            dbInstance = null
          }
        }),
      )
      return db
    }),
  )

const sqliteLayer = (config: Config) => Layer.effect(Client.SqlClient, make(config))

const drizzleLayer = Layer.effect(
  Sqlite.Drizzle,
  Effect.gen(function* () {
    const db = yield* Effect.promise(async () => {
      const { default: initSqlJs } = await import("wa-sqlite")
      const SQLite = await initSqlJs()
      const waDb = await SQLite.open(config.filename === ":memory:" ? undefined : config.filename)

      // Create a compatible interface for drizzle
      const compatibleDb = {
        exec: (sql: string) => {
          const results: any[] = []
          const iter = waDb.exec(sql)
          let result = iter.next()
          while (!result.done) {
            results.push(result.value)
            result = iter.next()
          }
          return results
        },
        prepare: (sql: string) => ({
          run: (...params: any[]) => {
            const results: any[] = []
            const iter = waDb.exec(sql, params)
            let result = iter.next()
            while (!result.done) {
              results.push(result.value)
              result = iter.next()
            }
            return { changes: results.length }
          },
          all: (...params: any[]) => {
            const results: any[] = []
            const iter = waDb.exec(sql, params)
            let result = iter.next()
            while (!result.done) {
              results.push(result.value)
              result = iter.next()
            }
            return results
          },
          get: (...params: any[]) => {
            const iter = waDb.exec(sql, params)
            const result = iter.next()
            return result.done ? undefined : result.value
          },
        }),
      }

      const { drizzle } = await import("drizzle-orm/better-sqlite3")
      return drizzle(compatibleDb)
    })
    return db as unknown as Sqlite.DrizzleClient
  }),
)

export const layer = (config: Config) => {
  const native = nativeLayer(config)
  return Layer.merge(native, Layer.merge(sqliteLayer(config), drizzleLayer).pipe(Layer.provide(native))).pipe(
    Layer.provide(Reactivity.layer),
  )
}
