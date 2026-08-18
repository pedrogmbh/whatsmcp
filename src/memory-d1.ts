import { Database, type SQLQueryBindings } from "bun:sqlite";

class MemoryStatement {
  constructor(
    private readonly db: Database,
    private readonly sql: string,
    private readonly values: SQLQueryBindings[] = [],
  ) {}

  bind(...values: SQLQueryBindings[]): MemoryStatement {
    return new MemoryStatement(this.db, this.sql, values);
  }

  async run(): Promise<D1Result> {
    this.db.query(this.sql).run(...this.values);
    const row = this.db.query("SELECT changes() AS n").get() as { n: number };
    return {
      success: true,
      meta: { changes: row.n },
    } as D1Result;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = this.db.query(this.sql).all(...this.values) as T[];
    return { success: true, results, meta: {} } as D1Result<T>;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.query(this.sql).get(...this.values) as T | null) ?? null;
  }
}

/** In-memory D1 stand-in for `bun:test`. Do not import from the Worker entry. */
export function createMemoryD1(schemaSql: string): D1Database {
  const db = new Database(":memory:");
  db.exec(schemaSql);
  return {
    prepare(sql: string) {
      return new MemoryStatement(db, sql) as unknown as D1PreparedStatement;
    },
  } as D1Database;
}
