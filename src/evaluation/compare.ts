import type { QueryResult } from '../engine/sqlEngine'

export interface Comparison { passed: boolean; message: string }

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b))
  }
  return a === b
}

/** Compare multisets, not sets: duplicate rows must appear the correct number of times. */
export function compareResults(actual: QueryResult, expected: QueryResult, ordered = false): Comparison {
  if (actual.truncated || expected.truncated) return { passed: false, message: 'Hasil terpotong. Persempit hasil sebelum evaluasi; potongan tidak dianggap jawaban lengkap.' }
  if (actual.columns.length !== expected.columns.length) return { passed: false, message: `Diperlukan ${expected.columns.length} kolom: ${expected.columns.join(', ')}.` }
  if (!expected.columns.every((column, i) => column.toLowerCase() === actual.columns[i].toLowerCase())) {
    return { passed: false, message: `Periksa nama, alias, dan urutan kolom. Diharapkan: ${expected.columns.join(', ')}.` }
  }
  if (actual.values.length !== expected.values.length) return { passed: false, message: `Jumlah baris belum tepat: hasil Anda ${actual.values.length}, diharapkan ${expected.values.length}. Periksa filter dan duplikasi JOIN.` }
  const sameRow = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, i) => sameValue(value, b[i]))
  if (ordered) {
    const passed = actual.values.every((row, i) => sameRow(row, expected.values[i]))
    return { passed, message: passed ? 'Nilai, kolom, jumlah baris, dan urutan sesuai.' : 'Nilai atau urutan belum sesuai. Periksa ORDER BY dan perhitungan.' }
  }
  // Approximate numeric equality is not transitive. Greedy removal can consume
  // the only candidate for a later row; use a one-to-one bipartite matching.
  const candidates = actual.values.map(row => expected.values.flatMap((candidate, i) => sameRow(row, candidate) ? [i] : []))
  const matched = new Array<number>(expected.values.length).fill(-1)
  const assign = (row: number, visited: Set<number>): boolean => {
    for (const column of candidates[row]) {
      if (visited.has(column)) continue
      visited.add(column)
      if (matched[column] === -1 || assign(matched[column], visited)) {
        matched[column] = row
        return true
      }
    }
    return false
  }
  for (let row = 0; row < actual.values.length; row++) {
    if (!assign(row, new Set())) return { passed: false, message: 'Ada nilai atau jumlah duplikasi yang belum sesuai. Periksa perhitungan dan relasi tabel.' }
  }
  return { passed: true, message: 'Hasil sesuai, termasuk nilai NULL dan jumlah duplikasi. Bentuk kueri boleh berbeda dari referensi.' }
}
