import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { seedDatabase, type DatasetId, tables, DATASET_VERSION } from '../data/datasets'

export interface QueryResult {
  columns: string[]
  values: unknown[][]
  rowCount: number
  durationMs: number
  truncated: boolean
}

const MAX_QUERY_LENGTH = 12_000
const MAX_ROWS = 300
const blocked = /\b(ATTACH|DETACH|VACUUM|PRAGMA|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE|REINDEX|ANALYZE|LOAD_EXTENSION)\b/i
let sqlPromise: Promise<SqlJsStatic> | undefined

function getSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({ locateFile: () => wasmUrl })
  return sqlPromise
}

export async function createEngine(dataset: DatasetId = 'small', variant = 0) {
  const SQL = await getSql()
  return new SqlEngine(SQL, dataset, variant)
}

export class SqlEngine {
  private closed = false
  private db: Database
  private readonly SQL: SqlJsStatic
  readonly dataset: DatasetId
  readonly variant: number

  constructor(SQL: SqlJsStatic, dataset: DatasetId, variant: number) {
    this.SQL = SQL
    this.dataset = dataset
    this.variant = variant
    this.db = this.freshDatabase()
  }

  private freshDatabase(): Database {
    const db = new this.SQL.Database()
    try {
      seedDatabase(db, this.dataset, this.variant)
      db.run('PRAGMA query_only = ON')
      return db
    } catch (error) {
      db.close()
      throw error
    }
  }

  query(sql: string): QueryResult {
    if (this.closed) throw new Error('Mesin SQL sudah ditutup. Muat ulang playground.')
    const trimmed = sql.trim()
    if (!trimmed) throw new Error('Tulis kueri SQL terlebih dahulu.')
    if (trimmed.length > MAX_QUERY_LENGTH) throw new Error(`Kueri terlalu panjang. Batasnya ${MAX_QUERY_LENGTH.toLocaleString('id-ID')} karakter.`)
    // Mask literals, quoted identifiers, and comments before checking statement structure.
    // SQLite query_only is the independent database-level write protection.
    const structure = trimmed.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]/g, ' ').trim()
    if (!/^(SELECT|WITH|VALUES)\b/i.test(structure) || blocked.test(structure)) {
      throw new Error('Playground hanya mengizinkan pembacaan data: SELECT, WITH, atau VALUES.')
    }
    if (structure.replace(/;\s*$/, '').includes(';')) {
      throw new Error('Jalankan satu pernyataan SQL pada satu waktu.')
    }
    const started = performance.now()
    const statement = this.db.prepare(trimmed)
    try {
      const columns = statement.getColumnNames()
      const values: unknown[][] = []
      while (values.length < MAX_ROWS && statement.step()) values.push(statement.get())
      const truncated = values.length === MAX_ROWS && statement.step()
      return {
        columns, values, rowCount: values.length,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
        truncated,
      }
    } finally {
      statement.free()
    }
  }

  schema() {
    return tables.map((table) => ({
      ...table,
      sample: this.query(`SELECT * FROM ${table.name} LIMIT 3`).values,
    }))
  }

  exportBinary(): Uint8Array {
    // sql.js reopens the connection during export, clearing connection PRAGMAs.
    try {
      return this.db.export()
    } finally {
      this.db.run('PRAGMA foreign_keys = ON')
      this.db.run('PRAGMA query_only = ON')
    }
  }
  reset() {
    const replacement = this.freshDatabase()
    this.db.close()
    this.db = replacement
    this.closed = false
  }
  close() { this.closed = true; this.db.close() }
}

export { DATASET_VERSION }
