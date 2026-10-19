import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { initialProgress, loadProgress, saveProgress, parseProgress, serializeProgress, validateProgress, MAX_BACKUP_BYTES } from '../src/storage/progress'

const fixture = () => ({
  ...initialProgress(),
  lessons: { l1: { status: 'completed' as const, attempts: 2, passed: true, score: 90, draft: "SELECT '日本語'", hintsUsed: 1, updatedAt: '2025-01-01T00:00:00Z' } },
  portfolio: { s1: { status: 'completed' as const, notes: 'Evidence', query: 'SELECT NULL', result: { columns: ['value'], values: [[null], [12.5], ['text']], queryHash: 'abc', datasetVersion: 'v1' } } },
})

beforeEach(async () => {
  const db = await openDB('sql-analyst-academy', 1, { upgrade(db) { db.createObjectStore('app') } })
  await db.clear('app')
  db.close()
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), removeItem: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

describe('IndexedDB progress and backup boundary', () => {
  it('returns independent defaults for an empty store', async () => {
    const a = await loadProgress()
    a.theme = 'dark'
    expect(await loadProgress()).toEqual(initialProgress())
  })
  it('persists validated snapshots without retaining caller references', async () => {
    const input = fixture()
    const expected = validateProgress(input)
    const saved = saveProgress(input)
    input.lessons.l1.draft = 'mutated'
    input.portfolio.s1.result.values[0][0] = 'mutated'
    await saved
    expect(await loadProgress()).toEqual(expected)
  })
  it('serializes concurrent writes in invocation order', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => saveProgress({ ...initialProgress(), lastLessonId: `l${i}` })))
    expect((await loadProgress()).lastLessonId).toBe('l11')
  })
  it('rejects invalid saves without overwriting data or poisoning later writes', async () => {
    await saveProgress(fixture())
    await expect(saveProgress({ ...initialProgress(), version: 2 } as never)).rejects.toThrow(/tidak valid/)
    expect(await loadProgress()).toEqual(validateProgress(fixture()))
    await saveProgress(initialProgress())
    expect(await loadProgress()).toEqual(initialProgress())
  })
  it('round trips JSON with metadata, Unicode, numeric cells, NULL and legacy defaults', () => {
    const serialized = serializeProgress(fixture())
    expect(JSON.parse(serialized)).toMatchObject({ app: 'SQL Analyst Academy', exportedAt: expect.any(String) })
    expect(parseProgress(serialized)).toEqual(validateProgress(fixture()))
    expect(parseProgress(serialized).lessons.l1).toMatchObject({ solutionViewed: false, understood: false })
    expect(parseProgress(serialized)).not.toHaveProperty('exportedAt')
  })
  it.each([
    'not json', 'null', '[]', '{}',
    JSON.stringify({ ...initialProgress(), version: 2 }),
    JSON.stringify({ ...initialProgress(), lastLessonId: '../bad' }),
    JSON.stringify({ ...initialProgress(), theme: 'unknown' }),
    JSON.stringify({ ...fixture(), lessons: { l1: { ...fixture().lessons.l1, attempts: -1 } } }),
    JSON.stringify({ ...fixture(), lessons: { l1: { ...fixture().lessons.l1, updatedAt: 'invalid' } } }),
  ])('rejects malformed import without changing persisted progress (%#)', async raw => {
    await saveProgress(fixture())
    expect(() => parseProgress(raw)).toThrow()
    expect(await loadProgress()).toEqual(validateProgress(fixture()))
  })
  it('rejects malformed result dimensions, nonfinite values and oversized fields', () => {
    for (const values of [[[1, 2]], [[Infinity]], [[NaN]], [[{}]], [['x'.repeat(50001)]]]) {
      const input = fixture()
      input.portfolio.s1.result.values = values as never
      expect(() => validateProgress(input)).toThrow()
    }
    const input = fixture()
    input.lessons.l1.draft = 'x'.repeat(50001)
    expect(() => serializeProgress(input)).toThrow()
  })
  it('enforces row, activity and entry limits', () => {
    const input = fixture()
    input.portfolio.s1.result.values = Array.from({ length: 301 }, () => [null])
    expect(() => validateProgress(input)).toThrow()
    expect(() => validateProgress({ ...initialProgress(), activities: Array.from({ length: 2001 }, () => ({ id: 'a', text: '', at: '' })) })).toThrow()
    expect(() => validateProgress({ ...initialProgress(), lessons: Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`l${i}`, fixture().lessons.l1])) })).toThrow()
  })
  it('measures import size in UTF-8 bytes, accepting exactly the limit', () => {
    const json = JSON.stringify(initialProgress())
    expect(parseProgress(json + ' '.repeat(MAX_BACKUP_BYTES - Buffer.byteLength(json)))).toEqual(initialProgress())
    expect(() => parseProgress(json + ' '.repeat(MAX_BACKUP_BYTES - Buffer.byteLength(json) + 1))).toThrow(/5 MB/)
    const multibyte = JSON.stringify({ ...initialProgress(), extra: '界'.repeat(Math.ceil(MAX_BACKUP_BYTES / 3)) })
    expect(multibyte.length).toBeLessThan(MAX_BACKUP_BYTES)
    expect(() => parseProgress(multibyte)).toThrow(/5 MB/)
  })
  it('migrates legacy data once, only removing it after persistence', async () => {
    const removeItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => serializeProgress(fixture())), removeItem })
    expect(await loadProgress()).toEqual(validateProgress(fixture()))
    expect(removeItem).toHaveBeenCalledWith('sql-analyst-academy-progress')
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('must not read legacy twice') } })
    expect(await loadProgress()).toEqual(validateProgress(fixture()))
  })
  it('does not silently replace corrupt saved records or invalid legacy backups', async () => {
    const removeItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => 'broken', removeItem })
    await expect(loadProgress()).rejects.toThrow(/JSON/)
    expect(removeItem).not.toHaveBeenCalled()
    const db = await openDB('sql-analyst-academy', 1)
    await db.put('app', { version: 999 }, 'progress')
    await expect(loadProgress()).rejects.toThrow(/tidak valid/)
    expect(await db.get('app', 'progress')).toEqual({ version: 999 })
    db.close()
  })
})
