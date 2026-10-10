import type { Filter } from './filtering.ts'

export type ExportFormat = 'c' | 'python' | 'csv' | 'q15' | 'q31'
export const EXPORT_FORMATS: ExportFormat[] = ['c', 'python', 'csv', 'q15', 'q31']

export interface ExportOptions {
  /** C identifier prefix. */
  name: string
  fs: number
  precision: 'float' | 'double'
  /** Fixed-point only: negate the feedback coefficients and pad as CMSIS-DSP expects. */
  cmsis: boolean
  /** Human description for the header comment. */
  label: string
}

export const sanitizeName = (s: string): string => {
  const r = s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1')
  return r || 'filter'
}

const num = (x: number, digits: number): string => {
  const s = Number(x.toPrecision(digits)).toString()
  return s === '-0' ? '0' : s
}

const wrapList = (items: string[], perLine: number, indent = '  '): string => {
  const lines: string[] = []
  for (let i = 0; i < items.length; i += perLine) lines.push(indent + items.slice(i, i + perLine).join(', '))
  return lines.join(',\n')
}

/** Biquad rows as [b0, b1, b2, a1, a2] (a0 = 1). */
const rows5 = (sos: number[][]): number[][] => sos.map((s) => [s[0]!, s[1]!, s[2]!, s[4]!, s[5]!])

export interface Fixed {
  /** Integer coefficients in the same order as the float ones. */
  ints: number[]
  bits: 15 | 31
  /** Coefficients were divided by 2^shift before scaling; multiply results back by 2^shift. */
  shift: number
  /** Largest absolute coefficient error after quantisation (in the original scale). */
  maxError: number
  /** The filter with quantised coefficients, for plotting the effect. */
  filter: Filter
}

/** Quantise coefficients to Qx.15 / Qx.31 with one common power-of-two block exponent. */
export function toFixed(f: Filter, bits: 15 | 31): Fixed {
  const flat = f.kind === 'fir' ? f.b : rows5(f.sos).flat()
  const maxAbs = Math.max(...flat.map(Math.abs), 0)
  const shift = maxAbs >= 1 ? Math.floor(Math.log2(maxAbs)) + 1 : 0
  const one = 2 ** bits
  const hi = one - 1
  const ints = flat.map((x) => Math.max(-one, Math.min(hi, Math.round((x / 2 ** shift) * one))))
  const back = ints.map((q) => (q / one) * 2 ** shift)
  const maxError = Math.max(...back.map((v, i) => Math.abs(v - flat[i]!)), 0)
  let filter: Filter
  if (f.kind === 'fir') filter = { kind: 'fir', b: back }
  else
    filter = {
      kind: 'iir',
      sos: f.sos.map((_row, i) => [back[5 * i]!, back[5 * i + 1]!, back[5 * i + 2]!, 1, back[5 * i + 3]!, back[5 * i + 4]!]),
    }
  return { ints, bits, shift, maxError, filter }
}

export function exportFilter(f: Filter, format: ExportFormat, o: ExportOptions): string {
  const name = sanitizeName(o.name)
  const NAME = name.toUpperCase()
  const digits = o.precision === 'double' ? 17 : 9
  const header = `${o.label}, fs = ${o.fs} Hz`
  switch (format) {
    case 'c': {
      const ty = o.precision
      const suffix = o.precision === 'float' ? 'f' : ''
      const lit = (x: number) => {
        const s = num(x, digits)
        return (/^-?\d+$/.test(s) ? s + '.0' : s) + suffix
      }
      if (f.kind === 'fir') {
        return `/* ${header} */\n#define ${NAME}_NUM_TAPS ${f.b.length}\n\nstatic const ${ty} ${name}_coeffs[${NAME}_NUM_TAPS] = {\n${wrapList(f.b.map(lit), 4)}\n};\n\n/* y[n] = sum_k coeffs[k] * x[n-k] */\n`
      }
      const rows = rows5(f.sos).map((r) => '  {' + r.map(lit).join(', ') + '}')
      return `/* ${header} */\n#define ${NAME}_NUM_SECTIONS ${f.sos.length}\n\n/* Each row: b0, b1, b2, a1, a2 (a0 = 1).\n * y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2] */\nstatic const ${ty} ${name}_sos[${NAME}_NUM_SECTIONS][5] = {\n${rows.join(',\n')}\n};\n`
    }
    case 'python': {
      const py = (x: number) => num(x, 17)
      if (f.kind === 'fir') {
        return `# ${header}\nimport numpy as np\nfrom scipy import signal\n\nfs = ${o.fs}\nb = np.array([\n${wrapList(f.b.map(py), 4, '    ')},\n])\n\n# y = signal.lfilter(b, 1.0, x)\n# w, h = signal.freqz(b, worN=2048, fs=fs)\n`
      }
      const rows = f.sos.map((s) => '    [' + s.map((x, i) => (i === 3 ? '1' : py(x))).join(', ') + ']')
      return `# ${header}\nimport numpy as np\nfrom scipy import signal\n\nfs = ${o.fs}\n# Rows: b0, b1, b2, a0, a1, a2\nsos = np.array([\n${rows.join(',\n')},\n])\n\n# y = signal.sosfilt(sos, x)\n# w, h = signal.sosfreqz(sos, worN=2048, fs=fs)\n`
    }
    case 'csv': {
      if (f.kind === 'fir') return 'index,coefficient\n' + f.b.map((x, i) => `${i},${num(x, 17)}`).join('\n') + '\n'
      return 'section,b0,b1,b2,a0,a1,a2\n' + f.sos.map((s, i) => `${i},${s.map((x, j) => (j === 3 ? '1' : num(x, 17))).join(',')}`).join('\n') + '\n'
    }
    case 'q15':
    case 'q31': {
      const bits = format === 'q15' ? 15 : 31
      const q = toFixed(f, bits)
      const ty = bits === 15 ? 'int16_t' : 'int32_t'
      const Q = `Q${bits === 15 ? '15' : '31'}`
      const note = q.shift ? `Coefficients were divided by 2^${q.shift}; scale the output back by ${q.shift} bit(s) (CMSIS postShift = ${q.shift}).` : 'No block scaling needed (postShift = 0).'
      if (f.kind === 'fir') {
        return `/* ${header} */\n/* ${Q} FIR coefficients, max coefficient error ${q.maxError.toExponential(2)}. ${note} */\n#define ${NAME}_NUM_TAPS ${f.b.length}\n#define ${NAME}_POST_SHIFT ${q.shift}\n\nstatic const ${ty} ${name}_coeffs_${format}[${NAME}_NUM_TAPS] = {\n${wrapList(q.ints.map(String), 8)}\n};\n`
      }
      const rows: string[] = []
      for (let i = 0; i < f.sos.length; i++) {
        const r = q.ints.slice(5 * i, 5 * i + 5)
        const [b0, b1, b2, a1, a2] = r as [number, number, number, number, number]
        const fb: [number, number] = o.cmsis ? [-a1, -a2] : [a1, a2]
        const row = o.cmsis && bits === 15 ? [b0, 0, b1, b2, ...fb] : [b0, b1, b2, ...fb]
        rows.push('  ' + row.join(', '))
      }
      const width = o.cmsis && bits === 15 ? 6 : 5
      const sign = o.cmsis
        ? 'CMSIS-DSP layout: feedback coefficients negated (y += a1*y[n-1] + a2*y[n-2])' + (bits === 15 ? ', with a zero pad after b0' : '')
        : 'Each row: b0, b1, b2, a1, a2 (a0 = 1), y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]'
      return `/* ${header} */\n/* ${Q} biquad cascade, max coefficient error ${q.maxError.toExponential(2)}. ${note}\n * ${sign} */\n#define ${NAME}_NUM_SECTIONS ${f.sos.length}\n#define ${NAME}_POST_SHIFT ${q.shift}\n\nstatic const ${ty} ${name}_sos_${format}[${NAME}_NUM_SECTIONS * ${width}] = {\n${rows.join(',\n')}\n};\n`
    }
  }
}
