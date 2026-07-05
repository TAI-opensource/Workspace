import SQLite from "wa-sqlite"

type Database = ReturnType<typeof SQLite.open>

export class WebContainerSQLite {
  private db: Database | null = null
  private sqlite: typeof SQLite | null = null

  async init() {
    this.sqlite = await SQLite()
    this.db = await this.sqlite.open(":memory:")
    return this
  }

  async exec(sql: string, params?: any[]): Promise<any[]> {
    if (!this.db || !this.sqlite) throw new Error("Database not initialized")

    const results: any[] = []
    const rows = await this.sqlite.exec(this.db, sql, params)
    for (const row of rows) {
      results.push(row)
    }
    return results
  }

  async run(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowid: number }> {
    if (!this.db || !this.sqlite) throw new Error("Database not initialized")

    const result = await this.sqlite.exec(this.db, sql, params)
    return {
      changes: result.length,
      lastInsertRowid: result.length > 0 ? result[0].lastInsertRowid : 0,
    }
  }

  async close() {
    if (this.db && this.sqlite) {
      await this.sqlite.close(this.db)
      this.db = null
      this.sqlite = null
    }
  }

  async getTables(): Promise<string[]> {
    const rows = await this.exec(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    return rows.map((row: any) => row.name)
  }

  async getSchema(): Promise<string> {
    const rows = await this.exec(
      "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name"
    )
    return rows.map((row: any) => row.sql).join("\n")
  }
}

export async function createWebContainerSQLite(): Promise<WebContainerSQLite> {
  const db = new WebContainerSQLite()
  return await db.init()
}
