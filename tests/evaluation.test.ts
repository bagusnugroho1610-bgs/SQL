import { describe, expect, it } from 'vitest'
import { compareResults } from '../src/evaluation/compare'
import type { QueryResult } from '../src/engine/sqlEngine'

const result = (values: unknown[][], columns = ['name', 'total']): QueryResult => ({ columns, values, rowCount: values.length, durationMs: 1, truncated: false })

describe('compareResults', () => {
  it('distinguishes NULL from zero, empty text and the string NULL', () => {
    expect(compareResults(result([[null]]), result([[null]])).passed).toBe(true)
    for (const value of [0, '', 'NULL', undefined]) {
      expect(compareResults(result([[value]]), result([[null]])).passed).toBe(false)
    }
  })
  it('rejects different duplicate distributions with identical row counts', () => {
    expect(compareResults(result([['A'], ['A'], ['B']]), result([['A'], ['B'], ['B']])).passed).toBe(false)
  })
  it('uses numeric tolerance without coercing strings', () => {
    expect(compareResults(result([[0.00000005]]), result([[0]])).passed).toBe(true)
    expect(compareResults(result([[100.01]]), result([[100]])).passed).toBe(false)
    expect(compareResults(result([['100']]), result([[100]])).passed).toBe(false)
    expect(compareResults(result([[-100.00000001]]), result([[-100]])).passed).toBe(true)
  })
  it('matches multisets even when numeric tolerance makes candidates overlap', () => {
    const actual = result([[0.00000009], [0]])
    const expected = result([[0], [0.00000018]])
    expect(compareResults(actual, expected).passed).toBe(true)
    expect(compareResults(result([...actual.values].reverse()), expected).passed).toBe(true)
  })
  it('checks column order and widths but accepts case-insensitive aliases', () => {
    expect(compareResults(result([[1, 2]], ['NAME', 'TOTAL']), result([[1, 2]])).passed).toBe(true)
    expect(compareResults(result([[1, 2]], ['total', 'name']), result([[1, 2]])).passed).toBe(false)
    expect(compareResults(result([[1]], ['name']), result([[1, 2]])).passed).toBe(false)
    expect(compareResults(result([[1]]), result([[1, 2]])).passed).toBe(false)
    expect(compareResults(result([]), result([])).passed).toBe(true)
    expect(compareResults(result([]), { ...result([]), truncated: true }).passed).toBe(false)
  })
  it('membandingkan multiset dan mempertahankan duplikasi', () => {
    expect(compareResults(result([['A', 2], ['A', 2]]), result([['A', 2], ['A', 2]])).passed).toBe(true)
    expect(compareResults(result([['A', 2]]), result([['A', 2], ['A', 2]])).passed).toBe(false)
  })
  it('menerima perbedaan angka dalam toleransi', () => {
    expect(compareResults(result([['A', 100.00000001]]), result([['A', 100]])).passed).toBe(true)
  })
  it('membedakan urutan ketika soal memerlukannya', () => {
    expect(compareResults(result([['B', 2], ['A', 1]]), result([['A', 1], ['B', 2]]), true).passed).toBe(false)
    expect(compareResults(result([['B', 2], ['A', 1]]), result([['A', 1], ['B', 2]])).passed).toBe(true)
  })
  it('menolak hasil terpotong dan kolom yang salah', () => {
    expect(compareResults({ ...result([]), truncated: true }, result([])).passed).toBe(false)
    expect(compareResults(result([[1]], ['wrong']), result([[1]], ['right'])).passed).toBe(false)
  })
})
