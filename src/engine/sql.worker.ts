import { createEngine, type SqlEngine } from './sqlEngine'
import type { DatasetId } from '../data/datasets'
import { compareResults } from '../evaluation/compare'

export type SqlRequest =
  | { id: number; action: 'query'; dataset: DatasetId; sql: string }
  | { id: number; action: 'evaluate'; dataset: DatasetId; sql: string; reference: string; ordered: boolean }
  | { id: number; action: 'schema' | 'reset' | 'export'; dataset: DatasetId }

const engines = new Map<string, SqlEngine>()
async function engineFor(dataset: DatasetId, variant = 0) {
  const key = `${dataset}:${variant}`
  let engine = engines.get(key)
  if (!engine) {
    engine = await createEngine(dataset, variant)
    engines.set(key, engine)
  }
  return engine
}

async function handle(request: SqlRequest): Promise<unknown> {
  const engine = await engineFor(request.dataset)
  switch (request.action) {
    case 'query': return engine.query(request.sql)
    case 'schema': return engine.schema()
    case 'export': return engine.exportBinary()
    case 'reset': {
      for (const [key, existing] of engines) {
        if (key.startsWith(`${request.dataset}:`)) {
          existing.close()
          engines.delete(key)
        }
      }
      await engineFor(request.dataset)
      return true
    }
    case 'evaluate': {
      const actual = engine.query(request.sql)
      const expected = engine.query(request.reference)
      const comparison = compareResults(actual, expected, request.ordered)
      if (!comparison.passed) return { ...comparison, result: actual }
      if (request.dataset === 'small') {
        const alternate = await engineFor('small', 1)
        const alternateComparison = compareResults(alternate.query(request.sql), alternate.query(request.reference), request.ordered)
        if (!alternateComparison.passed) {
          return { passed: false, message: 'Hasil dataset utama benar, tetapi belum sesuai saat data berubah. Hindari menuliskan hasil sebagai konstanta; gunakan kolom dan relasi tabel.', result: actual }
        }
      }
      return { ...comparison, result: actual }
    }
  }
}

// Serial execution also prevents concurrent initialization of the same database.
let queue = Promise.resolve()
self.onmessage = (event: MessageEvent<SqlRequest>) => {
  const request = event.data
  queue = queue.then(async () => {
    try {
      self.postMessage({ id: request.id, ok: true, data: await handle(request) })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Eksekusi SQL gagal.'
      self.postMessage({ id: request.id, ok: false, error: message })
    }
  })
}
