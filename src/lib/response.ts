import { abs, c, type C } from './complex.ts'
import { sosFilter, type Filter } from './filtering.ts'
import { polyRoots } from './poly.ts'
import type { Sos } from './iir.ts'

export interface Analysis {
  /** Frequency axis in Hz, 0..fs/2. */
  freq: number[]
  mag: number[]
  magDb: number[]
  /** Unwrapped phase, radians. */
  phase: number[]
  /** Group delay, samples (NaN where undefined). */
  groupDelay: number[]
  impulse: number[]
  step: number[]
  poles: C[]
  zeros: C[]
  stable: boolean
}

/** Evaluate sum p_k e^{-jwk} and sum k p_k e^{-jwk}. */
function polyAt(p: ArrayLike<number>, w: number): { v: C; d: C } {
  let vr = 0
  let vi = 0
  let dr = 0
  let di = 0
  for (let k = 0; k < p.length; k++) {
    const cr = Math.cos(w * k)
    const ci = -Math.sin(w * k)
    vr += p[k]! * cr
    vi += p[k]! * ci
    dr += k * p[k]! * cr
    di += k * p[k]! * ci
  }
  return { v: c(vr, vi), d: c(dr, di) }
}

/** Complex response H(e^{jw}) and group delay for one numerator/denominator pair. */
export function responseAt(b: ArrayLike<number>, a: ArrayLike<number>, w: number): { h: C; gd: number } {
  const n = polyAt(b, w)
  const d = polyAt(a, w)
  const dm = d.v.re * d.v.re + d.v.im * d.v.im
  const nm = n.v.re * n.v.re + n.v.im * n.v.im
  const h = { re: (n.v.re * d.v.re + n.v.im * d.v.im) / dm, im: (n.v.im * d.v.re - n.v.re * d.v.im) / dm }
  // tau = Re(P'/P) for numerator minus denominator, with P' = sum k p_k e^{-jwk}.
  const gn = nm < 1e-24 ? NaN : (n.d.re * n.v.re + n.d.im * n.v.im) / nm
  const gdn = (d.d.re * d.v.re + d.d.im * d.v.im) / dm
  return { h, gd: gn - gdn }
}

/** Frequency response of any filter at normalised angular frequencies w (rad/sample). */
export function freqz(f: Filter, ws: ArrayLike<number>): { h: C[]; gd: number[] } {
  const h: C[] = []
  const gd: number[] = []
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!
    if (f.kind === 'fir') {
      const r = responseAt(f.b, [1], w)
      h.push(r.h)
      gd.push(r.gd)
    } else {
      let hr = 1
      let hi = 0
      let g = 0
      for (const s of f.sos) {
        const r = responseAt([s[0]!, s[1]!, s[2]!], [s[3]!, s[4]!, s[5]!], w)
        const nr = hr * r.h.re - hi * r.h.im
        hi = hr * r.h.im + hi * r.h.re
        hr = nr
        g += r.gd
      }
      h.push(c(hr, hi))
      gd.push(g)
    }
  }
  return { h, gd }
}

export function unwrap(phase: number[]): number[] {
  const out = [...phase]
  let off = 0
  for (let i = 1; i < phase.length; i++) {
    const d = phase[i]! - phase[i - 1]!
    if (d > Math.PI) off -= 2 * Math.PI * Math.ceil((d - Math.PI) / (2 * Math.PI))
    else if (d < -Math.PI) off += 2 * Math.PI * Math.ceil((-d - Math.PI) / (2 * Math.PI))
    out[i] = phase[i]! + off
  }
  return out
}

export function polesZeros(f: Filter): { poles: C[]; zeros: C[] } {
  if (f.kind === 'iir') {
    const poles: C[] = []
    const zeros: C[] = []
    for (const s of f.sos) {
      // p0 z^2 + p1 z + p2: trailing zero coefficients become roots at the origin.
      zeros.push(...polyRoots([s[0]!, s[1]!, s[2]!]))
      poles.push(...polyRoots([s[3]!, s[4]!, s[5]!]))
    }
    return { poles, zeros }
  }
  const n = f.b.length
  if (n > 400) return { poles: [], zeros: [] }
  const zeros = polyRoots(f.b)
  const poles: C[] = Array.from({ length: n - 1 }, () => c(0, 0))
  return { poles, zeros }
}

export function isStableSos(sos: Sos): boolean {
  return sos.every((s) => {
    const a1 = s[4]!
    const a2 = s[5]!
    return Math.abs(a2) < 1 && Math.abs(a1) < 1 + a2
  })
}

/** Truncate a decaying response once it stays below `rel` of its peak. */
function trimTail(x: number[], rel: number, min: number): number {
  const peak = Math.max(...x.map(Math.abs), 1e-30)
  let last = x.length - 1
  while (last > min && Math.abs(x[last]!) < rel * peak) last--
  return Math.min(x.length, Math.max(min, Math.ceil((last + 1) * 1.1)))
}

export function analyze(f: Filter, fs: number, points = 2048): Analysis {
  const ws = new Float64Array(points)
  const freq = new Array<number>(points)
  for (let i = 0; i < points; i++) {
    ws[i] = (Math.PI * i) / (points - 1)
    freq[i] = (fs / 2) * (i / (points - 1))
  }
  const { h, gd } = freqz(f, ws)
  const mag = h.map(abs)
  const magDb = mag.map((m) => 20 * Math.log10(Math.max(m, 1e-12)))
  const phase = unwrap(h.map((z) => Math.atan2(z.im, z.re)))
  let impulse: number[]
  let step: number[]
  if (f.kind === 'fir') {
    impulse = [...f.b]
  } else {
    const len = 8192
    const d = new Float64Array(len)
    d[0] = 1
    const full = Array.from(sosFilter(f.sos, d))
    impulse = full.slice(0, trimTail(full, 1e-4, 64))
  }
  step = []
  let acc = 0
  for (const v of impulse) step.push((acc += v))
  const { poles, zeros } = polesZeros(f)
  const stable = f.kind === 'fir' ? true : isStableSos(f.sos)
  return { freq, mag, magDb, phase, groupDelay: gd, impulse, step, poles, zeros, stable }
}

/** Filter order (number of delays). */
export function filterOrder(f: Filter): number {
  return f.kind === 'fir' ? f.b.length - 1 : f.sos.reduce((n, s) => n + (s[5] !== 0 ? 2 : s[4] !== 0 ? 1 : 0), 0)
}
