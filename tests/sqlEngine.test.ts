import { beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { seedDatabase, tables, type DatasetId } from '../src/data/datasets'
import { SqlEngine } from '../src/engine/sqlEngine'

let SQL: SqlJsStatic
beforeAll(async () => {
  const require = createRequire(import.meta.url)
  SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
})

for (const [dataset, variant, counts] of [
  ['small', 0, [4, 6, 12, 6, 9]],
  ['small', 1, [4, 7, 12, 7, 10]],
  ['retail', 0, [4, 84, 12, 360, 900]],
  ['retail', 1, [4, 84, 12, 360, 900]],
] as const) {
  describe(`${dataset} variant ${variant}`, () => {
    it('seeds deterministic counts, valid relationships and enforced foreign keys', () => {
      const db = new SQL.Database()
      try {
        seedDatabase(db, dataset, variant)
        expect(tables.map(t => db.exec(`SELECT COUNT(*) FROM ${t.name}`)[0].values[0][0])).toEqual(counts)
        expect(db.exec('PRAGMA foreign_key_check')).toEqual([])
        expect(db.exec('PRAGMA foreign_keys')[0].values).toEqual([[1]])
        expect(() => db.run("INSERT INTO orders VALUES (9999, 9999, '2025-01-01', 'completed')")).toThrow(/FOREIGN KEY/)
        expect(() => db.run('DELETE FROM categories WHERE category_id = 1')).toThrow(/FOREIGN KEY/)
        expect(db.exec('SELECT price FROM products WHERE product_id = 1')[0].values).toEqual([[65000 + variant * 1000]])
      } finally { db.close() }
    })
    it('exports a real SQLite database and resets to identical data', () => {
      const engine = new SqlEngine(SQL, dataset, variant)
      try {
        const before = engine.query('SELECT * FROM products ORDER BY product_id').values
        const exported = new SQL.Database(engine.exportBinary())
        try {
          expect(exported.exec('SELECT * FROM products ORDER BY product_id')[0].values).toEqual(before)
          expect(exported.exec('PRAGMA foreign_key_check')).toEqual([])
        } finally { exported.close() }
        engine.reset()
        expect(engine.query('SELECT * FROM products ORDER BY product_id').values).toEqual(before)
        expect(engine.schema()).toHaveLength(5)
      } finally { engine.close() }
    })
  })
}

function withEngine(run: (engine: SqlEngine) => void, dataset: DatasetId = 'small', variant = 0) {
  const engine = new SqlEngine(SQL, dataset, variant)
  try { run(engine) } finally { engine.close() }
}

describe('SQL integration and read-only boundary', () => {
  it('computes completed revenue from historical line prices, not catalog prices', () => {
    const query = `SELECT COUNT(DISTINCT o.order_id) AS orders,
      SUM(d.quantity * d.unit_price - d.discount) AS revenue
      FROM orders o JOIN order_details d USING(order_id) WHERE o.status = 'completed'`
    withEngine(e => expect(e.query(query).values).toEqual([[4, 722000]]))
    withEngine(e => expect(e.query(query).values).toEqual([[5, 927000]]), 'small', 1)
  })
  it('executes NULL, duplicate, left join, CTE and window examples', () => withEngine(e => {
    expect(e.query('SELECT name FROM customers WHERE city IS NULL').values).toEqual([['Eka']])
    expect(e.query('SELECT email, COUNT(*) FROM customers GROUP BY email HAVING COUNT(*) > 1').values).toEqual([['ayu@example.test', 2]])
    expect(e.query('SELECT c.name FROM customers c LEFT JOIN orders o USING(customer_id) WHERE o.order_id IS NULL ORDER BY c.name').values).toEqual([['Eka'], ['Farah']])
    expect(e.query('WITH x AS (SELECT 3 AS n UNION ALL SELECT 1) SELECT n, ROW_NUMBER() OVER (ORDER BY n) AS rank FROM x ORDER BY n').values).toEqual([[1, 1], [3, 2]])
  }))
  it('has all twelve retail months and intentionally unserved customers', () => withEngine(e => {
    expect(e.query("SELECT COUNT(DISTINCT strftime('%m', order_date)) FROM orders").values).toEqual([[12]])
    expect(e.query('SELECT COUNT(*) FROM customers WHERE customer_id > 76 AND customer_id NOT IN (SELECT customer_id FROM orders)').values).toEqual([[8]])
  }, 'retail'))
  it.each([
    'DELETE FROM customers', 'PRAGMA query_only = OFF', 'ATTACH DATABASE ":memory:" AS other',
    'CREATE TABLE evil (id)', 'WITH x AS (SELECT 1) DELETE FROM customers',
    'SELECT 1; SELECT 2', 'SELECT 1; /* hidden */ DROP TABLE customers',
    "SELECT load_extension('evil')", 'VACUUM', 'BEGIN',
  ])('rejects unsafe statement: %s', sql => withEngine(e => {
    expect(() => e.query(sql)).toThrow()
    expect(e.query('SELECT COUNT(*) FROM customers').values).toEqual([[6]])
  }))
  it('allows keywords and semicolons inside literals, identifiers and comments', () => withEngine(e => {
    expect(e.query(`/* DELETE */ SELECT 'DROP; it''s safe' AS "UPDATE"; -- INSERT`).values).toEqual([["DROP; it's safe"]])
    expect(e.query('VALUES (1), (NULL)').values).toEqual([[1], [null]])
  }))
  it('enforces SQLite query_only independently, including after binary export', () => withEngine(e => {
    // Deliberate white-box assertion: bypass the text guard to test defense in depth.
    const db = (e as unknown as { db: InstanceType<SqlJsStatic['Database']> }).db
    expect(() => db.run('DELETE FROM customers')).toThrow(/readonly/)
    e.exportBinary()
    expect(db.exec('PRAGMA foreign_keys')[0].values).toEqual([[1]])
    expect(() => db.run('DELETE FROM customers')).toThrow(/readonly/)
  }))
  it('handles invalid SQL, length, empty input and recovers for subsequent queries', () => withEngine(e => {
    for (const sql of ['', ' '.repeat(3), `SELECT '${'x'.repeat(12000)}'`, 'SELECT missing FROM customers']) {
      expect(() => e.query(sql)).toThrow()
    }
    expect(e.query('SELECT 1').values).toEqual([[1]])
  }))
  it('distinguishes exactly 300 rows from truncated results', () => withEngine(e => {
    expect(e.query('SELECT * FROM orders LIMIT 300')).toMatchObject({ rowCount: 300, truncated: false })
    expect(e.query('SELECT * FROM orders')).toMatchObject({ rowCount: 300, truncated: true })
  }, 'retail'))
  it('rejects queries after close and supports reset', () => {
    const e = new SqlEngine(SQL, 'small', 0)
    e.close()
    expect(() => e.query('SELECT 1')).toThrow(/ditutup/)
    e.reset()
    expect(e.query('SELECT 1').values).toEqual([[1]])
    e.close()
  })
})
