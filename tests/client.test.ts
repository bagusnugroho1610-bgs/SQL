import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SqlClient } from '../src/engine/client'

class MockWorker {
  static instances: MockWorker[] = []
  onmessage?: (event: { data: unknown }) => void
  onerror?: (event: { preventDefault: () => void }) => void
  onmessageerror?: () => void
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { MockWorker.instances.push(this) }
  reply(data: unknown) { this.onmessage?.({ data }) }
}
let client: SqlClient
beforeEach(() => {
  vi.useFakeTimers()
  MockWorker.instances = []
  vi.stubGlobal('Worker', MockWorker)
  client = new SqlClient(100)
})
afterEach(() => { client.dispose(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('SQL client worker lifecycle', () => {
  it('matches out-of-order replies and ignores unknown IDs', async () => {
    const first = client.request({ type: 'query' })
    const second = client.request({ type: 'query' })
    const worker = MockWorker.instances[0]
    const ids = worker.postMessage.mock.calls.map(([message]) => message.id)
    worker.reply({ id: 999, ok: true })
    worker.reply({ id: ids[1], ok: true, data: 'second' })
    worker.reply({ id: ids[0], ok: true, data: 'first' })
    expect(await Promise.all([first, second])).toEqual(['first', 'second'])
    expect(vi.getTimerCount()).toBe(0)
  })
  it('timeout terminates computation, rejects all pending work and starts a fresh worker', async () => {
    const requests = [client.request({}), client.request({})]
    const rejected = requests.map(p => expect(p).rejects.toThrow(/Batas waktu/))
    const old = MockWorker.instances[0]
    await vi.advanceTimersByTimeAsync(100)
    await Promise.all(rejected)
    expect(old.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    const next = client.request({})
    const fresh = MockWorker.instances[1]
    old.reply({ id: 1, ok: true, data: 'stale' })
    fresh.reply({ id: fresh.postMessage.mock.calls[0][0].id, ok: true, data: 'restarted' })
    expect(await next).toBe('restarted')
  })
  it('rejects SQL errors while keeping the worker reusable', async () => {
    const pending = client.request({})
    const rejected = expect(pending).rejects.toThrow('syntax error')
    const worker = MockWorker.instances[0]
    worker.reply({ id: 1, ok: false, error: 'syntax error' })
    await rejected
    expect(worker.terminate).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['error', 'messageerror'])('cleans up after worker %s', async kind => {
    const pending = client.request({})
    const rejected = expect(pending).rejects.toThrow()
    const worker = MockWorker.instances[0]
    if (kind === 'error') worker.onerror?.({ preventDefault: vi.fn() })
    else worker.onmessageerror?.()
    await rejected
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cleans up a synchronous postMessage failure', async () => {
    const first = client.request({})
    const worker = MockWorker.instances[0]
    worker.reply({ id: 1, ok: true })
    await first
    worker.postMessage.mockImplementationOnce(() => { throw new Error('clone failed') })
    await expect(client.request({})).rejects.toThrow('clone failed')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('dispose rejects pending requests and prevents restart', async () => {
    const pending = client.request({})
    const rejected = expect(pending).rejects.toThrow(/ditutup/)
    client.dispose()
    await rejected
    await expect(client.request({})).rejects.toThrow(/ditutup/)
    expect(MockWorker.instances).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
