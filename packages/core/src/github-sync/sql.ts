import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/sql"
import { Timestamps } from "../database/schema.sql"

export const SessionGithubSyncTable = sqliteTable(
  "session_github_sync",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    repo_owner: text().notNull(),
    repo_name: text().notNull(),
    branch: text().notNull().default("main"),
    last_commit_sha: text(),
    last_sync_at: integer(),
    auto_sync: integer({ mode: "boolean" }).notNull().default(true),
    sync_interval: integer().notNull().default(300),
    ...Timestamps,
  },
  (table) => [index("session_github_sync_session_idx").on(table.session_id)],
)
