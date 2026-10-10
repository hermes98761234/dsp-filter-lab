import type { Request, Response } from './dsp.worker.ts'

type Distribute<T> = T extends { id: number } ? Omit<T, 'id'> : never

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (r: Response) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./dsp.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<Response>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.error) p.reject(new Error(e.data.error))
      else p.resolve(e.data)
    }
  }
  return worker
}

/** Run a job in the DSP web worker (one shared worker, requests are matched by id). */
export function callDsp(msg: Distribute<Request>, transfer: Transferable[] = []): Promise<Response> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ ...msg, id }, transfer)
  })
}
