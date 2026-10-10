import { design, type DesignOutput, type Spec } from './lib/design.ts'
import { applyFilter, type Filter } from './lib/filtering.ts'
import { analyze, type Analysis } from './lib/response.ts'
import { spectrogram, type Spectrogram } from './lib/spectrogram.ts'

export type Request =
  | { type: 'analyze'; id: number; spec: Spec }
  | { type: 'process'; id: number; filter: Filter; channels: Float32Array[]; compensate: boolean }
  | { type: 'spectrogram'; id: number; data: Float32Array; fs: number }

export type AnalyzeResult = { out: DesignOutput; analysis: Analysis | null }
export type Response = { id: number; error?: string; analyze?: AnalyzeResult; channels?: Float32Array[]; spectrogram?: Spectrogram }

const ctx = self as unknown as {
  postMessage(m: Response, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<Request>) => void) | null
}

ctx.onmessage = (e) => {
  const m = e.data
  try {
    if (m.type === 'analyze') {
      const out = design(m.spec)
      ctx.postMessage({ id: m.id, analyze: { out, analysis: out.ok ? analyze(out.filter, m.spec.fs) : null } })
    } else if (m.type === 'process') {
      const channels = m.channels.map((c) => applyFilter(m.filter, c, m.compensate))
      ctx.postMessage({ id: m.id, channels }, channels.map((c) => c.buffer))
    } else {
      const sp = spectrogram(m.data, m.fs, m.fs > 60000 ? 2048 : 1024)
      ctx.postMessage({ id: m.id, spectrogram: sp }, [sp.data.buffer])
    }
  } catch (err) {
    ctx.postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) })
  }
}
