import type { SqlRequest } from './sql.worker'

export type RunSql = <T>(action: Record<string, unknown>) => Promise<T>
type Reply = { id: number; ok: boolean; data?: unknown; error?: string }
type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Owns worker lifetime. A timeout terminates computation, not just its promise. */
export class SqlClient {
  private worker: Worker | null = null
  private sequence = 0
  private disposed = false
  private pending = new Map<number, Pending>()
  private readonly timeoutMs: number

  constructor(timeoutMs = 5000) {
    this.timeoutMs = timeoutMs
  }

  private start(): Worker {
    if (this.disposed) throw new Error('Sesi SQL telah ditutup.')
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./sql.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const request = this.pending.get(event.data.id)
      if (!request) return
      clearTimeout(request.timer)
      this.pending.delete(event.data.id)
      if (event.data.ok) request.resolve(event.data.data)
      else request.reject(new Error(event.data.error ?? 'Eksekusi SQL gagal.'))
    }
    worker.onerror = (event) => {
      event.preventDefault()
      this.stop(new Error('Mesin SQL berhenti. Coba jalankan kembali; dataset akan dimuat ulang.'))
    }
    worker.onmessageerror = () => this.stop(new Error('Respons mesin SQL tidak dapat dibaca. Coba kembali.'))
    return worker
  }

  private stop(reason: Error): void {
    this.worker?.terminate()
    this.worker = null
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(reason)
    }
    this.pending.clear()
  }

  request<T>(action: Omit<SqlRequest, 'id'> | Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let worker: Worker
      try { worker = this.start() } catch (reason) { reject(reason); return }
      const id = ++this.sequence
      const timer = setTimeout(() => {
        this.stop(new Error(`Batas waktu ${this.timeoutMs / 1000} detik tercapai. Kueri dihentikan dan mesin direset. Sederhanakan kueri lalu jalankan kembali; progres tetap aman.`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      try { worker.postMessage({ ...action, id }) } catch (reason) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(reason)
      }
    })
  }

  dispose(): void {
    this.disposed = true
    this.stop(new Error('Sesi SQL ditutup.'))
  }
}
