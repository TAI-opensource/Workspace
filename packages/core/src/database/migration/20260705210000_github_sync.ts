import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260705210000_github_sync",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_github_sync\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`repo_owner\` text NOT NULL,
          \`repo_name\` text NOT NULL,
          \`branch\` text NOT NULL DEFAULT 'main',
          \`last_commit_sha\` text,
          \`last_sync_at\` integer,
          \`auto_sync\` integer NOT NULL DEFAULT 1,
          \`sync_interval\` integer NOT NULL DEFAULT 300,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_github_sync_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_github_sync_session_idx\` ON \`session_github_sync\` (\`session_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
