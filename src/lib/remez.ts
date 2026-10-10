/**
 * Parks–McClellan equiripple FIR design (Remez exchange).
 *
 * The four linear-phase types are reduced to a weighted Chebyshev approximation by a cosine series:
 *   I   odd length, symmetric:       A = sum a_k cos(k w)
 *   II  even length, symmetric:      A = cos(w/2) * sum b_k cos(k w)
 *   III odd length, antisymmetric:   A = sin(w)   * sum c_k cos(k w)
 *   IV  even length, antisymmetric:  A = sin(w/2) * sum d_k cos(k w)
 * Antisymmetric filters use the convention H(w) = -j e^{-jwM} A(w), so a Hilbert transformer has A = +1.
 */

export interface RemezBand {
  /** Band edges in cycles/sample, 0..0.5. */
  f0: number
  f1: number
  /** Desired amplitude at f0 and at f1 (linear interpolation in between). */
  d0: number
  d1: number
  /** Error weight. */
  w: number
  /** Weight the error relative to the desired amplitude (differentiators). */
  relative?: boolean
}

export interface RemezResult {
  h: number[]
  /** Weighted peak error at convergence. */
  delta: number
  iterations: number
  converged: boolean
}

export function remez(numtaps: number, bands: RemezBand[], antisymmetric = false, density = 16, maxIter = 100): RemezResult {
  const odd = numtaps % 2 === 1
  const type = antisymmetric ? (odd ? 3 : 4) : odd ? 1 : 2
  const nf = type === 1 ? (numtaps + 1) / 2 : type === 3 ? (numtaps - 1) / 2 : numtaps / 2
  if (nf < 2) throw new Error('Too few taps')
  const delf = 0.5 / (density * nf)

  // Dense frequency grid.
  const gf: number[] = []
  const gd: number[] = []
  const gw: number[] = []
  const bandStart: number[] = []
  const bandEnd: number[] = []
  for (const b of bands) {
    let lo = b.f0
    let hi = b.f1
    if (antisymmetric && lo < delf) lo = delf
    if ((type === 2 || type === 3) && hi > 0.5 - delf) hi = 0.5 - delf
    if (hi < lo) continue
    const n = Math.max(1, Math.round((hi - lo) / delf))
    bandStart.push(gf.length)
    for (let i = 0; i <= n; i++) {
      const f = lo + ((hi - lo) * i) / n
      const t = b.f1 > b.f0 ? (f - b.f0) / (b.f1 - b.f0) : 0
      const d = b.d0 + (b.d1 - b.d0) * t
      gf.push(f)
      gd.push(d)
      gw.push(b.w * (b.relative ? 1 / Math.max(Math.abs(d), 1e-9) : 1))
    }
    bandEnd.push(gf.length - 1)
  }
  const G = gf.length
  if (G < nf + 1) throw new Error('Grid too small for this length')

  // Move the symmetry factor of types II-IV into the desired response and the weight.
  for (let i = 0; i < G; i++) {
    const w = 2 * Math.PI * gf[i]!
    const q = type === 1 ? 1 : type === 2 ? Math.cos(w / 2) : type === 3 ? Math.sin(w) : Math.sin(w / 2)
    gd[i]! /= q
    gw[i]! *= q
  }
  const gx = gf.map((f) => Math.cos(2 * Math.PI * f))

  // Initial extremal set: evenly spread over the grid.
  let ext: number[] = []
  // The interior points are nudged by one grid step: for symmetric problems (Hilbert) an exactly symmetric
  // start makes the first delta vanish and the exchange has nothing to work with.
  for (let i = 0; i <= nf; i++) ext.push(Math.min(G - 1, Math.round((i * (G - 1)) / nf) + (i > 0 && i < nf && G > 4 * nf ? 1 : 0)))

  const err = new Float64Array(G)
  const amp = new Float64Array(G)
  let delta = 0
  let iterations = 0
  let converged = false
  let xe: number[] = []
  let ye: number[] = []
  let bw: number[] = []

  const interpAt = (x: number): number => {
    let num = 0
    let den = 0
    for (let i = 0; i < nf; i++) {
      const dx = x - xe[i]!
      if (dx === 0) return ye[i]!
      const t = bw[i]! / dx
      num += t * ye[i]!
      den += t
    }
    return num / den
  }

  for (iterations = 1; iterations <= maxIter; iterations++) {
    xe = ext.map((k) => gx[k]!)
    // delta from the barycentric weights over all nf+1 points.
    const l = xe.map((xi, i) => {
      let p = 1
      for (let j = 0; j <= nf; j++) if (j !== i) p *= xi - xe[j]!
      return 1 / p
    })
    let num = 0
    let den = 0
    for (let i = 0; i <= nf; i++) {
      const s = i % 2 === 0 ? 1 : -1
      num += l[i]! * gd[ext[i]!]!
      den += (l[i]! * s) / gw[ext[i]!]!
    }
    delta = num / den
    ye = ext.map((k, i) => gd[k]! - ((i % 2 === 0 ? 1 : -1) * delta) / gw[k]!)
    bw = xe.slice(0, nf).map((xi, i) => {
      let p = 1
      for (let j = 0; j < nf; j++) if (j !== i) p *= xi - xe[j]!
      return 1 / p
    })
    for (let k = 0; k < G; k++) {
      amp[k] = interpAt(gx[k]!)
      err[k] = gw[k]! * (gd[k]! - amp[k]!)
    }

    // Candidate extrema: local peaks of |err| within each band.
    const cand: number[] = []
    for (let b = 0; b < bandStart.length; b++) {
      for (let k = bandStart[b]!; k <= bandEnd[b]!; k++) {
        const e = err[k]!
        const left = k > bandStart[b]! ? err[k - 1]! : null
        const right = k < bandEnd[b]! ? err[k + 1]! : null
        const isMax = e > 0 && (left === null || e >= left) && (right === null || e >= right)
        const isMin = e < 0 && (left === null || e <= left) && (right === null || e <= right)
        if (isMax || isMin) cand.push(k)
      }
    }
    // Enforce alternating signs, keeping the larger of consecutive same-sign peaks.
    let alt: number[] = []
    for (const k of cand) {
      const last = alt[alt.length - 1]
      if (last !== undefined && Math.sign(err[last]!) === Math.sign(err[k]!)) {
        if (Math.abs(err[k]!) > Math.abs(err[last]!)) alt[alt.length - 1] = k
      } else alt.push(k)
    }
    // Trim to nf+1 extrema.
    while (alt.length > nf + 1) {
      if (alt.length === nf + 2) {
        alt = Math.abs(err[alt[0]!]!) < Math.abs(err[alt[alt.length - 1]!]!) ? alt.slice(1) : alt.slice(0, -1)
        continue
      }
      let wi = 0
      for (let i = 1; i < alt.length; i++) if (Math.abs(err[alt[i]!]!) < Math.abs(err[alt[wi]!]!)) wi = i
      if (wi === 0) alt = alt.slice(1)
      else if (wi === alt.length - 1) alt = alt.slice(0, -1)
      else {
        // Drop the smallest interior peak together with its smaller neighbour so alternation is kept.
        const a = Math.abs(err[alt[wi - 1]!]!)
        const b = Math.abs(err[alt[wi + 1]!]!)
        alt.splice(a < b ? wi - 1 : wi, 2)
      }
    }
    if (alt.length < nf + 1) break
    let emax = 0
    let emin = Infinity
    for (const k of alt) {
      const e = Math.abs(err[k]!)
      emax = Math.max(emax, e)
      emin = Math.min(emin, e)
    }
    const same = alt.every((k, i) => k === ext[i])
    ext = alt
    if (same || (emax - emin) / emax < 1e-7) {
      converged = true
      break
    }
  }

  // Recover the cosine-series coefficients by sampling the interpolant on a uniform grid.
  const L = Math.max(8, 4 * nf)
  const coef = new Array<number>(nf).fill(0)
  for (let i = 0; i < L; i++) {
    const w = (2 * Math.PI * i) / L
    const a = interpAt(Math.cos(w))
    for (let k = 0; k < nf; k++) coef[k]! += (k === 0 ? 1 : 2) * a * Math.cos(k * w)
  }
  for (let k = 0; k < nf; k++) coef[k]! /= L

  const h = new Array<number>(numtaps).fill(0)
  if (type === 1) {
    const M = nf - 1
    h[M] = coef[0]!
    for (let k = 1; k < nf; k++) h[M + k] = h[M - k] = coef[k]! / 2
  } else if (type === 2) {
    const half = numtaps / 2
    for (let n = 0; n < nf; n++) {
      const cn = n === 0 ? coef[0]! + (nf > 1 ? coef[1]! / 2 : 0) : (coef[n]! + (n + 1 < nf ? coef[n + 1]! : 0)) / 2
      h[half + n] = h[half - 1 - n] = cn / 2
    }
  } else if (type === 3) {
    const M = nf
    const e = new Array<number>(M + 2).fill(0)
    for (let k = 0; k < nf; k++) {
      if (k === 0) e[1]! += coef[0]!
      else {
        e[k + 1]! += coef[k]! / 2
        if (k - 1 >= 1) e[k - 1]! -= coef[k]! / 2
      }
    }
    for (let m = 1; m <= M; m++) {
      h[M + m] = e[m]! / 2
      h[M - m] = -e[m]! / 2
    }
  } else {
    const half = numtaps / 2
    const e = new Array<number>(nf).fill(0)
    for (let k = 0; k < nf; k++) {
      if (k === 0) e[0]! += coef[0]!
      else {
        e[k]! += coef[k]! / 2
        e[k - 1]! -= coef[k]! / 2
      }
    }
    for (let n = 0; n < nf; n++) {
      h[half + n] = e[n]! / 2
      h[half - 1 - n] = -e[n]! / 2
    }
  }
  return { h, delta: Math.abs(delta), iterations, converged }
}

export type RemezKind = 'lowpass' | 'highpass' | 'bandpass' | 'bandstop' | 'differentiator' | 'hilbert'

export interface RemezSpec {
  kind: RemezKind
  /** Edges in Hz; transition is centred on each edge (ignored for differentiator/hilbert, which use f1..f2 as the band). */
  f1: number
  f2: number
  /** Transition width in Hz. */
  transition: number
  /** Passband ripple, peak-to-peak dB. */
  passRipple: number
  /** Stopband attenuation, dB. */
  stopAtten: number
  fs: number
}

/** Peak deviations implied by a ripple/attenuation specification. */
export function ripples(passRippleDb: number, stopAttenDb: number): { dp: number; ds: number } {
  const r = 10 ** (passRippleDb / 20)
  return { dp: (r - 1) / (r + 1), ds: 10 ** (-stopAttenDb / 20) }
}

export function remezBands(s: RemezSpec): { bands: RemezBand[]; antisymmetric: boolean } {
  const { dp, ds } = ripples(s.passRipple, s.stopAtten)
  const wp = 1 / dp
  const ws = 1 / ds
  const nyq = s.fs / 2
  const n = (f: number) => Math.min(0.5, Math.max(0, f / s.fs))
  const h = s.transition / 2
  const band = (a: number, b: number, d: number, w: number): RemezBand => ({ f0: n(a), f1: n(b), d0: d, d1: d, w })
  switch (s.kind) {
    case 'lowpass':
      return { bands: [band(0, s.f1 - h, 1, wp), band(s.f1 + h, nyq, 0, ws)], antisymmetric: false }
    case 'highpass':
      return { bands: [band(0, s.f1 - h, 0, ws), band(s.f1 + h, nyq, 1, wp)], antisymmetric: false }
    case 'bandpass':
      return { bands: [band(0, s.f1 - h, 0, ws), band(s.f1 + h, s.f2 - h, 1, wp), band(s.f2 + h, nyq, 0, ws)], antisymmetric: false }
    case 'bandstop':
      return { bands: [band(0, s.f1 - h, 1, wp), band(s.f1 + h, s.f2 - h, 0, ws), band(s.f2 + h, nyq, 1, wp)], antisymmetric: false }
    case 'differentiator':
      return { bands: [{ f0: n(s.f1), f1: n(s.f2), d0: 2 * Math.PI * n(s.f1), d1: 2 * Math.PI * n(s.f2), w: 1, relative: true }], antisymmetric: true }
    case 'hilbert':
      return { bands: [band(s.f1, s.f2, 1, 1)], antisymmetric: true }
  }
}

export function designRemez(s: RemezSpec, taps: number): RemezResult {
  const { bands, antisymmetric } = remezBands(s)
  const oddOnly = s.kind === 'highpass' || s.kind === 'bandstop'
  const t = oddOnly && taps % 2 === 0 ? taps + 1 : taps
  const r = remez(t, bands, antisymmetric)
  if (s.kind === 'differentiator') r.h = r.h.map((x) => -x)
  return r
}

/** Kaiser's estimate of the Remez length for a lowpass-like spec. */
export function remezLengthEstimate(passRippleDb: number, stopAttenDb: number, transitionNorm: number): number {
  const { dp, ds } = ripples(passRippleDb, stopAttenDb)
  return Math.ceil((-10 * Math.log10(dp * ds) - 13) / (14.6 * transitionNorm) + 1)
}

/** Smallest odd/even-appropriate length for which the equiripple error meets the spec (weighted error <= 1). */
export function designRemezToSpec(s: RemezSpec, maxTaps = 1001): { result: RemezResult; taps: number; met: boolean } {
  const start = Math.max(5, Math.min(maxTaps, remezLengthEstimate(s.passRipple, s.stopAtten, s.transition / s.fs)))
  const step = s.kind === 'highpass' || s.kind === 'bandstop' ? 2 : 1
  let taps = s.kind === 'highpass' || s.kind === 'bandstop' ? start | 1 : start
  let best = designRemez(s, taps)
  if (best.delta <= 1) {
    // Shrink while it still meets the spec.
    for (let i = 0; i < 25 && taps - step >= 5; i++) {
      const r = designRemez(s, taps - step)
      if (r.delta > 1) break
      taps -= step
      best = r
    }
    return { result: best, taps, met: true }
  }
  for (let i = 0; i < 40 && taps + step <= maxTaps; i++) {
    taps += step
    best = designRemez(s, taps)
    if (best.delta <= 1) return { result: best, taps, met: true }
  }
  return { result: best, taps, met: false }
}
