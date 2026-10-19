import { createRequire } from 'node:module'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { allLessons, findLesson, modules } from '../src/content/curriculum'
import { type DatasetId, seedDatabase, tables } from '../src/data/datasets'
import { SqlEngine, type QueryResult } from '../src/engine/sqlEngine'
import { compareResults } from '../src/evaluation/compare'

let SQL: SqlJsStatic
beforeAll(async () => {
  const require = createRequire(import.meta.url)
  SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
})

type Cell = string | number | null
type Row = Record<string, Cell>
const num = (row: Row, key: string) => Number(row[key])
const text = (row: Row, key: string) => String(row[key])
const asc = (a: Cell, b: Cell) => a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const round = (value: number) => Math.round(value * 100) / 100
const unique = (values: Cell[]) => [...new Set(values)]
const result = (columns: string[], values: Cell[][]): QueryResult => ({ columns, values, rowCount: values.length, truncated: false, durationMs: 0 })

/** Independent exercise oracle: only raw tables are read with SQL; business logic is computed in JS. */
function exerciseOracle(engine: SqlEngine, id: string): QueryResult {
  const read = (table: string): Row[] => {
    // Retail details exceed the engine display cap; use bounded, ordered pages.
    const rows: Row[] = []
    for (let offset = 0; ; offset += 250) {
      const page = engine.query(`SELECT * FROM ${table} ORDER BY 1 LIMIT 250 OFFSET ${offset}`)
      rows.push(...page.values.map(values => Object.fromEntries(page.columns.map((key, i) => [key, values[i] as Cell]))))
      if (page.rowCount < 250) return rows
    }
  }
  const customers = read('customers')
  const products = read('products')
  const orders = read('orders')
  const details = read('order_details')
  const categories = read('categories')
  const completed = orders.filter(o => o.status === 'completed')
  const completedIds = new Set(completed.map(o => o.order_id))
  const completedDetails = details.filter(d => completedIds.has(d.order_id))
  const net = (d: Row) => num(d, 'quantity') * num(d, 'unit_price') - num(d, 'discount')
  const orderNet = (o: Row) => sum(details.filter(d => d.order_id === o.order_id).map(net))
  const byId = (rows: Row[], key: string, value: Cell) => rows.find(row => row[key] === value)!
  const months = unique(completed.map(o => text(o, 'order_date').slice(0, 7))).sort(asc)
  const monthly = months.map(month => {
    const rows = completed.filter(o => text(o, 'order_date').startsWith(String(month)))
    return [month, rows.length, sum(rows.map(orderNet))] as Cell[]
  })
  const categoryRevenue = categories.map(c => {
    const ids = new Set(products.filter(p => p.category_id === c.category_id).map(p => p.product_id))
    const rows = completedDetails.filter(d => ids.has(d.product_id))
    return { category: c, rows, revenue: sum(rows.map(net)) }
  }).filter(c => c.rows.length).sort((a, b) => b.revenue - a.revenue || num(a.category, 'category_id') - num(b.category, 'category_id'))
  switch (id) {
    case 'l1': return result(['name', 'price'], [...products].sort((a, b) => num(b, 'price') - num(a, 'price') || num(a, 'product_id') - num(b, 'product_id')).slice(0, 5).map(p => [p.name, p.price]))
    case 'l2': return result(['name', 'city'], customers.filter(c => c.city === 'Jakarta' || c.city === 'Bandung').sort((a, b) => asc(a.name, b.name) || num(a, 'customer_id') - num(b, 'customer_id')).map(c => [c.name, c.city]))
    case 'l3': return result(['status', 'jumlah_pesanan'], unique(orders.map(o => o.status)).map(status => [status, orders.filter(o => o.status === status).length] as Cell[]).sort((a, b) => Number(b[1]) - Number(a[1]) || asc(a[0], b[0])))
    case 'l4': return result(['order_id', 'name', 'order_date'], [...completed].sort((a, b) => asc(a.order_date, b.order_date) || num(a, 'order_id') - num(b, 'order_id')).slice(0, 10).map(o => [o.order_id, byId(customers, 'customer_id', o.customer_id).name, o.order_date]))
    case 'l5': return result(['product_id', 'revenue'], unique(details.map(d => d.product_id)).map(id => [id, sum(details.filter(d => d.product_id === id).map(net))] as Cell[]).sort((a, b) => Number(b[1]) - Number(a[1]) || Number(a[0]) - Number(b[0])).slice(0, 3))
    case 'l6':
    case 'l7': return result(['bulan', 'transaksi', 'revenue'], monthly)
    case 'l8': return result(['baris', 'pesanan', 'pelanggan'], [[orders.length, unique(orders.map(o => o.order_id)).length, unique(orders.map(o => o.customer_id)).length]])
    case 'l9': return result(['name'], tables.map(t => [t.name]).sort((a, b) => asc(a[0], b[0])))
    case 'l10': return result(['kota'], unique(customers.map(c => c.city).filter(c => c !== null)).sort(asc).map(c => [c]))
    case 'l11': return result(['product_id', 'name', 'price'], products.filter(p => num(p, 'price') >= 35000 && num(p, 'price') <= 150000 && p.category_id !== 1).sort((a, b) => num(a, 'price') - num(b, 'price') || num(a, 'product_id') - num(b, 'product_id')).map(p => [p.product_id, p.name, p.price]))
    case 'l12': return result(['product_id', 'name'], products.filter(p => text(p, 'name').toLowerCase().includes('a')).map(p => [p.product_id, p.name]))
    case 'l13': return result(['customer_id', 'name'], customers.filter(c => c.city === null || c.email === null).map(c => [c.customer_id, c.name]))
    case 'l14': return result(['customer_id', 'jumlah'], customers.map(c => [c.customer_id, completed.filter(o => o.customer_id === c.customer_id).length] as Cell[]).filter(row => Number(row[1]) >= 2).sort((a, b) => Number(b[1]) - Number(a[1]) || Number(a[0]) - Number(b[0])))
    case 'l15': return result(['customer_id', 'email_bersih', 'panjang'], customers.filter(c => c.email !== null).map(c => [c.customer_id, text(c, 'email').trim().toLowerCase(), text(c, 'email').trim().length]))
    case 'l16': return result(['product_id', 'harga_promo', 'segmen'], products.map(p => [p.product_id, Math.round(num(p, 'price') * 0.9), num(p, 'price') >= 100000 ? 'premium' : 'reguler']))
    case 'l17': {
      const q1 = orders.filter(o => text(o, 'order_date') >= '2025-01-01' && text(o, 'order_date') < '2025-04-01')
      return result(['bulan', 'jumlah'], unique(q1.map(o => text(o, 'order_date').slice(0, 7))).sort(asc).map(month => [month, q1.filter(o => text(o, 'order_date').startsWith(String(month))).length]))
    }
    case 'l18': return result(['customer_id', 'name', 'transaksi'], customers.map(c => [c.customer_id, c.name, completed.filter(o => o.customer_id === c.customer_id).length]))
    case 'l19': return result(['id', 'kiri_id', 'kanan_id'], [[1, 1, null], [2, 2, 2], [3, null, 3]])
    case 'l20': return result(['customer_id', 'name', 'referrer'], customers.map(c => [c.customer_id, c.name, c.referrer_id === null ? null : byId(customers, 'customer_id', c.referrer_id).name]))
    case 'l21': return result(['transaksi', 'revenue'], [[completed.length, sum(completedDetails.map(net))]])
    case 'l22': {
      const average = sum(products.map(p => num(p, 'price'))) / products.length
      return result(['product_id', 'name', 'price'], products.filter(p => num(p, 'price') > average).sort((a, b) => num(b, 'price') - num(a, 'price') || num(a, 'product_id') - num(b, 'product_id')).map(p => [p.product_id, p.name, p.price]))
    }
    case 'l23': return result(['category_id', 'product_id', 'price', 'nomor', 'peringkat'], categories.flatMap(c => {
      const group = products.filter(p => p.category_id === c.category_id).sort((a, b) => num(b, 'price') - num(a, 'price') || num(a, 'product_id') - num(b, 'product_id'))
      return group.map((p, i) => [c.category_id, p.product_id, p.price, i + 1, 1 + group.filter(other => num(other, 'price') > num(p, 'price')).length])
    }))
    case 'l24': {
      let running = 0
      return result(['bulan', 'revenue', 'kumulatif', 'growth_persen'], monthly.map((row, i) => {
        const revenue = Number(row[2])
        running += revenue
        const previous = i ? Number(monthly[i - 1][2]) : 0
        return [row[0], revenue, running, previous ? round(100 * (revenue - previous) / previous) : null]
      }))
    }
    case 'l25': return result(['customer_id', 'total', 'completed', 'persen_completed'], customers.flatMap(c => {
      const total = orders.filter(o => o.customer_id === c.customer_id).length
      const count = completed.filter(o => o.customer_id === c.customer_id).length
      return total ? [[c.customer_id, total, count, round(100 * count / total)]] : []
    }))
    case 'l26': {
      const emails = customers.filter(c => c.email !== null && text(c, 'email').trim() !== '').map(c => text(c, 'email').trim().toLowerCase())
      return result(['email_bersih', 'jumlah'], unique(emails).sort(asc).map(email => [email, emails.filter(e => e === email).length] as Cell[]).filter(row => Number(row[1]) > 1))
    }
    case 'l27': return result(['pelanggan', 'kota_hilang', 'email_hilang', 'awal_daftar', 'akhir_daftar'], [[customers.length, customers.filter(c => c.city === null).length, customers.filter(c => c.email === null).length, customers.map(c => c.joined_at).sort(asc)[0], customers.map(c => c.joined_at).sort(asc).at(-1)!]])
    case 'l28': {
      const segments = customers.map(c => completed.filter(o => o.customer_id === c.customer_id).length).map(n => n === 0 ? 'belum' : n === 1 ? 'sekali' : 'berulang')
      return result(['segmen', 'pelanggan'], unique(segments).sort(asc).map(s => [s, segments.filter(value => value === s).length]))
    }
    case 'l29': return result(['category_id', 'name', 'revenue', 'persen'], categoryRevenue.map(c => [c.category.category_id, c.category.name, c.revenue, round(100 * c.revenue / sum(categoryRevenue.map(row => row.revenue)))]))
    case 'l30': {
      const city = (o: Row) => byId(customers, 'customer_id', o.customer_id).city ?? 'Tidak diketahui'
      return result(['kota', 'transaksi', 'revenue'], unique(completed.map(city)).map(name => {
        const rows = completed.filter(o => city(o) === name)
        return [name, rows.length, sum(rows.map(orderNet))] as Cell[]
      }).sort((a, b) => Number(b[2]) - Number(a[2]) || asc(a[0], b[0])))
    }
    case 'l31': return result(['awal', 'akhir', 'transaksi'], [[completed.map(o => o.order_date).sort(asc)[0], completed.map(o => o.order_date).sort(asc).at(-1)!, completed.length]])
    case 'l32': return result(['category_id', 'name', 'revenue'], categoryRevenue.map(c => [c.category.category_id, c.category.name, c.revenue]))
    case 'l33': {
      const direct = sum(completedDetails.map(net))
      const grouped = sum(monthly.map(row => Number(row[2])))
      return result(['langsung', 'bulanan', 'selisih'], [[direct, grouped, direct - grouped]])
    }
    default: throw new Error(`Missing independent oracle for ${id}`)
  }
}

describe('curriculum content contract', () => {
  it('contains 33 unique lessons in seven sequential modules and preserves legacy module IDs', () => {
    expect(modules.map(m => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'])
    expect(modules.map(m => m.number)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(allLessons).toHaveLength(33)
    expect(new Set(allLessons.map(l => l.id)).size).toBe(33)
    for (let i = 1; i <= 7; i++) expect(findLesson(`l${i}`).moduleId).toBe(`m${i}`)
    expect(findLesson('unknown')).toBe(allLessons[0])
  })
  it.each(allLessons)('$id has complete content, explicit evaluation metadata, and a non-answer starter', lesson => {
    expect(lesson.duration).toMatch(/^\d+–\d+ min$/)
    expect(['Pemula', 'Pemula+', 'Menengah']).toContain(lesson.level)
    for (const field of ['title', 'objective', 'syntax', 'example', 'explanation', 'exercise', 'solution', 'criteria', 'starter'] as const) {
      expect(lesson[field].trim().length, `${lesson.id}.${field}`).toBeGreaterThan(8)
    }
    for (const field of ['theory', 'hints', 'summary'] as const) {
      expect(lesson[field].length).toBeGreaterThanOrEqual(2)
      for (const paragraph of lesson[field]) expect(paragraph.trim().length).toBeGreaterThan(15)
    }
    expect(lesson.theory.join(' ').length).toBeGreaterThan(200)
    expect(typeof lesson.ordered).toBe('boolean')
    expect(lesson.dataset).toBe(Number(lesson.moduleId.slice(1)) < 6 ? 'small' : 'retail')
    expect(modules.find(m => m.id === lesson.moduleId)?.lessons).toContain(lesson)
    expect(lesson.example).not.toBe(lesson.solution)
    expect(lesson.starter).not.toBe(lesson.solution)
    if (lesson.moduleId === 'm7') {
      expect(lesson.manual).toBeDefined()
      expect(Object.keys(lesson.manual!).sort()).toEqual(['prompt', 'rubric', 'sample'])
      expect(lesson.manual!.prompt.length).toBeGreaterThan(60)
      expect(lesson.manual!.rubric.length).toBeGreaterThanOrEqual(4)
      expect(lesson.manual!.sample.length).toBeGreaterThan(200)
      expect(lesson.solution.trim()).toMatch(/^(SELECT|WITH)\b/i)
    } else expect(lesson.manual).toBeUndefined()
  })
})

for (const dataset of ['small', 'retail'] as const satisfies readonly DatasetId[]) {
  for (const variant of [0, 1, 3]) {
    describe(`${dataset} variant ${variant}: every lesson with real SQL.js`, () => {
      it.each(allLessons)('$id: example executes read-only and agrees with uncapped SQLite', lesson => {
        const engine = new SqlEngine(SQL, dataset, variant)
        const raw = new SQL.Database()
        try {
          seedDatabase(raw, dataset, variant)
          const before = engine.query('SELECT SUM(price) AS total FROM products')
          const actual = engine.query(lesson.example)
          const expected = raw.exec(lesson.example)[0]
          expect(actual.truncated).toBe(false)
          expect(actual.rowCount).toBeGreaterThan(0)
          expect(actual.columns).toEqual(expected.columns)
          expect(actual.values).toEqual(expected.values)
          expect(compareResults(engine.query('SELECT SUM(price) AS total FROM products'), before).passed).toBe(true)
          // The demonstration must not already answer the exercise, even with different SQL text.
          expect(compareResults(actual, engine.query(lesson.solution), lesson.ordered).passed).toBe(false)
        } finally { engine.close(); raw.close() }
      })
      it.each(allLessons)('$id: solution matches independently computed business results and starter does not pass', lesson => {
        const engine = new SqlEngine(SQL, dataset, variant)
        try {
          const actual = engine.query(lesson.solution)
          const expected = exerciseOracle(engine, lesson.id)
          expect(actual.truncated).toBe(false)
          expect(actual.rowCount).toBeGreaterThan(0)
          expect(compareResults(actual, expected, lesson.ordered)).toMatchObject({ passed: true })
          expect(compareResults(engine.query(lesson.starter), actual, lesson.ordered).passed).toBe(false)
          // Evaluate a syntactically different but equivalent learner submission through the real API.
          const equivalent = engine.query(`/* Jawaban alternatif */\n${lesson.solution.replace(/;\s*$/, '')}\n;`)
          expect(compareResults(equivalent, expected, lesson.ordered).passed).toBe(true)
          const badAlias = { ...actual, columns: ['wrong_alias', ...actual.columns.slice(1)] }
          expect(compareResults(badAlias, expected, lesson.ordered).passed).toBe(false)
          if (actual.rowCount > 1) {
            const reversed = { ...actual, values: [...actual.values].reverse() }
            expect(compareResults(reversed, expected, lesson.ordered).passed).toBe(!lesson.ordered)
            const missing = { ...actual, values: actual.values.slice(1), rowCount: actual.rowCount - 1 }
            expect(compareResults(missing, expected, lesson.ordered).passed).toBe(false)
          }
          const corrupted = { ...actual, values: actual.values.map((row, i) => i ? row : ['incorrect', ...row.slice(1)]) }
          expect(compareResults(corrupted, expected, lesson.ordered).passed).toBe(false)
        } finally { engine.close() }
      })
    })
  }
}

describe('targeted curriculum regression checks', () => {
  const run = (id: string, dataset: DatasetId = 'small', variant = 0) => {
    const engine = new SqlEngine(SQL, dataset, variant)
    try { return engine.query(findLesson(id).solution) } finally { engine.close() }
  }
  it('preserves legacy top-products, city filter, status totals and CTE scope', () => {
    expect(run('l1').values).toEqual([['Keyboard Compact', 325000], ['Lampu Meja', 175000], ['Mouse Wireless', 150000], ['Tumbler 500ml', 120000], ['Tas Kanvas', 95000]])
    expect(run('l2').values).toEqual([['Ayu', 'Jakarta'], ['Bima', 'Bandung'], ['Dedi', 'Jakarta']])
    expect(run('l3').values).toEqual([['completed', 4], ['cancelled', 1], ['pending', 1]])
    expect(run('l5').values).toEqual([[4, 340000], [1, 185000], [11, 150000]])
  })
  it('subtracts total line discounts once, excludes other statuses, and responds to variants', () => {
    expect(run('l21').values).toEqual([[4, 722000]])
    expect(run('l21', 'small', 1).values).toEqual([[5, 927000]])
    expect(run('l21', 'small', 3).values).toEqual([[5, 1057000]])
    expect(run('l1', 'retail', 1).values).not.toEqual(run('l1', 'retail', 0).values)
  })
  it('keeps NULLs, zero-activity customers, and duplicate emails meaningful', () => {
    expect(run('l13').values).toEqual([[3, 'Citra'], [5, 'Eka']])
    expect(run('l18').values).toEqual([[1, 'Ayu', 2], [2, 'Bima', 1], [3, 'Citra', 0], [4, 'Dedi', 1], [5, 'Eka', 0], [6, 'Farah', 0]])
    expect(run('l26').values).toEqual([['ayu@example.test', 2]])
    expect(run('l19').values).toEqual([[1, 1, null], [2, 2, 2], [3, null, 3]])
  })
  it('documents and implements RANK ties and UNION duplicate removal in examples', () => {
    const engine = new SqlEngine(SQL, 'small', 0)
    try {
      expect(engine.query(findLesson('l23').example).values).toEqual([[1, 90, 1], [2, 90, 1], [3, 80, 3]])
      expect(engine.query(findLesson('l20').example).values).toEqual([[3], [5]])
      expect(engine.query(findLesson('l19').example).values).toEqual([[2, 2], [null, 3]])
    } finally { engine.close() }
  })
  it('has chronological running totals and NULL first-month growth', () => {
    expect(run('l24').values).toEqual([['2025-01', 324000, 324000, null], ['2025-02', 130000, 454000, -59.88], ['2025-03', 268000, 722000, 106.15]])
    const retail = run('l24', 'retail')
    expect(retail.rowCount).toBe(12)
    expect(retail.values[0][3]).toBeNull()
    expect(retail.values.at(-1)![2]).toBe(run('l21', 'retail').values[0][1])
  })
  it('reconciles monthly, category, city and portfolio totals for each dataset and variant', () => {
    for (const dataset of ['small', 'retail'] as const) for (const variant of [0, 1, 3]) {
      const [transactions, revenue] = run('l21', dataset, variant).values[0] as number[]
      const monthly = run('l6', dataset, variant)
      const cities = run('l30', dataset, variant)
      expect(sum(monthly.values.map(row => Number(row[1])))).toBe(transactions)
      expect(sum(cities.values.map(row => Number(row[1])))).toBe(transactions)
      expect(sum(monthly.values.map(row => Number(row[2])))).toBe(revenue)
      expect(sum(cities.values.map(row => Number(row[2])))).toBe(revenue)
      expect(sum(run('l29', dataset, variant).values.map(row => Number(row[2])))).toBe(revenue)
      expect(run('l33', dataset, variant).values).toEqual([[revenue, revenue, 0]])
      expect(compareResults(run('l7', dataset, variant), monthly, true).passed).toBe(true)
      expect(sum(run('l28', dataset, variant).values.map(row => Number(row[1])))).toBe(dataset === 'retail' ? 84 : variant ? 7 : 6)
    }
  })
  it('accepts structurally different valid SQL rather than requiring reference query text', () => {
    const alternatives: Record<string, string> = {
      l2: "SELECT name, city FROM customers WHERE city = 'Jakarta' OR city = 'Bandung' ORDER BY name, customer_id",
      l18: "SELECT c.customer_id, c.name, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.customer_id AND o.status = 'completed') AS transaksi FROM customers c ORDER BY c.customer_id",
      l21: "WITH per_order AS (SELECT o.order_id, SUM(d.quantity * d.unit_price - d.discount) AS nilai FROM orders o JOIN order_details d USING(order_id) WHERE o.status = 'completed' GROUP BY o.order_id) SELECT COUNT(*) AS transaksi, SUM(nilai) AS revenue FROM per_order",
      l22: 'WITH rata AS (SELECT AVG(price) AS batas FROM products) SELECT product_id, name, price FROM products CROSS JOIN rata WHERE price > batas ORDER BY price DESC, product_id',
    }
    for (const dataset of ['small', 'retail'] as const) for (const variant of [0, 1, 3]) {
      const engine = new SqlEngine(SQL, dataset, variant)
      try {
        for (const [id, sql] of Object.entries(alternatives)) {
          expect(compareResults(engine.query(sql), engine.query(findLesson(id).solution), findLesson(id).ordered).passed).toBe(true)
        }
      } finally { engine.close() }
    }
  })
})
