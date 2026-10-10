import { designFrequencySampling, designKaiserFir, designWindowFir, needsOddTaps, type FirResponse } from './fir.ts'
import type { Filter } from './filtering.ts'
import { designIir, designIirFromSpec, zpk2sos, type BandType, type IirType } from './iir.ts'
import { N, type Note } from './note.ts'
import { designRemez, designRemezToSpec, ripples, type RemezSpec } from './remez.ts'
import { rbjCascade, type RbjBand } from './rbj.ts'
import { freqz } from './response.ts'
import { abs, c, conj, type C } from './complex.ts'
import type { WindowName } from './window.ts'

export type Family = 'fir-window' | 'fir-remez' | 'fir-freq' | 'iir' | 'rbj' | 'manual'

export interface ManualItem {
  id: number
  kind: 'pole' | 'zero'
  /** Position in the z-plane; complex items stand for a conjugate pair, items with im = 0 are real. */
  re: number
  im: number
}

export interface Spec {
  family: Family
  /** Sample rate, Hz. */
  fs: number
  response: FirResponse
  /** Cutoff / band edges in Hz. */
  f1: number
  f2: number
  // FIR
  taps: number
  /** Kaiser auto / Remez auto: derive length from attenuation and transition width. */
  auto: boolean
  window: WindowName
  beta: number
  atten: number
  transition: number
  ripple: number
  transValue: number
  // IIR
  iirType: IirType
  order: number
  rp: number
  rs: number
  /** Order from edge specification instead of a fixed order. */
  fromSpec: boolean
  s1: number
  s2: number
  // RBJ / manual
  rbj: RbjBand[]
  manual: ManualItem[]
}

export const DEFAULT_SPEC: Spec = {
  family: 'fir-window',
  fs: 48000,
  response: 'lowpass',
  f1: 4000,
  f2: 8000,
  taps: 101,
  auto: true,
  window: 'hamming',
  beta: 8.6,
  atten: 60,
  transition: 1000,
  ripple: 0.5,
  transValue: 0.5,
  iirType: 'butter',
  order: 4,
  rp: 1,
  rs: 60,
  fromSpec: false,
  s1: 6000,
  s2: 12000,
  rbj: [
    { type: 'lowShelf', f0: 120, q: 0.7, gainDb: 4 },
    { type: 'peaking', f0: 1000, q: 1.2, gainDb: -6 },
    { type: 'highShelf', f0: 8000, q: 0.7, gainDb: 3 },
  ],
  manual: [
    { id: 1, kind: 'zero', re: -1, im: 0 },
    { id: 2, kind: 'zero', re: -1, im: 0 },
    { id: 3, kind: 'pole', re: 0.55, im: 0.5 },
    { id: 4, kind: 'pole', re: 0.75, im: 0 },
  ],
}

export type DesignOutput = { ok: true; filter: Filter; notes: Note[] } | { ok: false; error: Note }

class DesignError extends Error {
  note: Note
  constructor(note: Note) {
    super(note[0])
    this.note = note
  }
}
const fail: (...note: Note) => never = (...note) => {
  throw new DesignError(note)
}

const isBand = (r: FirResponse): r is BandType => r === 'lowpass' || r === 'highpass' || r === 'bandpass' || r === 'bandstop'
const twoEdges = (r: FirResponse) => r === 'bandpass' || r === 'bandstop'

/** Convert manual poles/zeros to a normalised (peak gain 1) SOS cascade. */
export function manualToFilter(items: ManualItem[]): Filter {
  const z: C[] = []
  const p: C[] = []
  for (const it of items) {
    const list = it.kind === 'zero' ? z : p
    if (Math.abs(it.im) > 1e-9) list.push(c(it.re, it.im), conj(c(it.re, it.im)))
    else list.push(c(it.re, 0))
  }
  const sos = zpk2sos(z, p, 1)
  const ws = Array.from({ length: 1024 }, (_, i) => (Math.PI * i) / 1023)
  const { h } = freqz({ kind: 'iir', sos }, ws)
  const peak = Math.max(...h.map(abs))
  if (isFinite(peak) && peak > 1e-12) for (let j = 0; j < 3; j++) sos[0]![j]! /= peak
  return { kind: 'iir', sos }
}

function validateEdges(s: Spec, margin = 0): void {
  const nyq = s.fs / 2
  if (!(s.fs >= 1000 && s.fs <= 768000)) fail(N('Sample rate must be between 1 kHz and 768 kHz.'))
  if (s.response === 'differentiator' || s.response === 'hilbert') return
  if (!(s.f1 - margin > 0 && s.f1 + margin < nyq)) fail(N('Frequencies must lie between 0 and the Nyquist frequency ({0} Hz).'), nyq)
  if (twoEdges(s.response)) {
    if (!(s.f2 > s.f1 + 2 * margin)) fail(N('The upper edge must be above the lower edge.'))
    if (!(s.f2 + margin < nyq)) fail(N('Frequencies must lie between 0 and the Nyquist frequency ({0} Hz).'), nyq)
  }
}

export function design(s: Spec): DesignOutput {
  try {
    return designUnsafe(s)
  } catch (e) {
    if (e instanceof DesignError) return { ok: false, error: e.note }
    return { ok: false, error: [N('Design failed: {0}'), e instanceof Error ? e.message : String(e)] }
  }
}

function designUnsafe(s: Spec): DesignOutput {
  const notes: Note[] = []
  const nyq = s.fs / 2
  if (!(s.fs >= 1000 && s.fs <= 768000)) fail(N('Sample rate must be between 1 kHz and 768 kHz.'))
  switch (s.family) {
    case 'fir-window': {
      validateEdges(s)
      let h: number[]
      if (s.auto && isBand(s.response)) {
        if (!(s.transition > 0 && s.atten > 0)) fail(N('Attenuation and transition width must be positive.'))
        validateEdges(s, s.transition / 2)
        const r = designKaiserFir(s.response, s.f1, s.f2, s.atten, s.transition, s.fs)
        if (r.taps > 20001) fail(N('Too many taps ({0}). Widen the transition band.'), r.taps)
        h = r.h
        notes.push([N('Kaiser window: beta = {0}, {1} taps.'), r.beta.toFixed(2), r.taps])
      } else {
        const taps = Math.round(s.taps)
        if (!(taps >= 3 && taps <= 4001)) fail(N('Taps must be between 3 and 4001.'))
        h = designWindowFir({ response: s.response, taps, window: s.window, beta: s.beta, f1: s.f1 / s.fs, f2: s.f2 / s.fs })
        if (h.length !== taps) notes.push([N('Length raised to {0}: this response needs an odd number of taps.'), h.length])
      }
      return { ok: true, filter: { kind: 'fir', b: h }, notes }
    }
    case 'fir-remez': {
      const spec: RemezSpec = { kind: s.response, f1: s.f1, f2: s.f2, transition: s.transition, passRipple: s.ripple, stopAtten: s.atten, fs: s.fs }
      if (isBand(s.response)) {
        validateEdges(s, s.transition / 2)
        if (!(s.transition > 0 && s.ripple > 0 && s.atten > 0)) fail(N('Ripple, attenuation and transition width must be positive.'))
      } else if (!(s.f1 >= 0 && s.f2 > s.f1 && s.f2 <= nyq)) fail(N('The band must satisfy 0 <= low < high <= Nyquist.'))
      let taps = Math.round(s.taps)
      let result
      if (s.auto && isBand(s.response)) {
        const r = designRemezToSpec(spec)
        result = r.result
        taps = r.taps
        if (!r.met) notes.push([N('The specification was not met within {0} taps.'), taps])
      } else {
        if (!(taps >= 5 && taps <= 1001)) fail(N('Taps must be between 5 and 1001.'))
        result = designRemez(spec, taps)
        if (needsOddTaps(s.response) && taps % 2 === 0) taps++
      }
      if (!result.converged) notes.push([N('The exchange did not fully converge; the result may be slightly off equiripple.')])
      if (isBand(s.response)) {
        const { dp, ds } = ripples(s.ripple, s.atten)
        const rp = 20 * Math.log10((1 + result.delta * dp) / (1 - result.delta * dp))
        notes.push([N('{0} taps, equiripple: passband ripple {1} dB, stopband attenuation {2} dB.'), taps, rp.toFixed(3), (-20 * Math.log10(result.delta * ds)).toFixed(1)])
      } else notes.push([N('{0} taps, equiripple weighted error {1}.'), taps, result.delta.toPrecision(3)])
      return { ok: true, filter: { kind: 'fir', b: result.h }, notes }
    }
    case 'fir-freq': {
      if (!isBand(s.response)) fail(N('Frequency sampling supports lowpass, highpass, bandpass and bandstop.'))
      validateEdges(s)
      const taps = Math.round(s.taps)
      if (!(taps >= 3 && taps <= 4001)) fail(N('Taps must be between 3 and 4001.'))
      const h = designFrequencySampling(s.response as BandType, taps, s.f1 / s.fs, s.f2 / s.fs, s.transValue)
      if (h.length !== taps) notes.push([N('Length raised to {0}: this response needs an odd number of taps.'), h.length])
      return { ok: true, filter: { kind: 'fir', b: h }, notes }
    }
    case 'iir': {
      if (!isBand(s.response)) fail(N('IIR design supports lowpass, highpass, bandpass and bandstop.'))
      const band = s.response
      validateEdges(s)
      if (!(s.rp > 0 && s.rp < 20)) fail(N('Passband ripple must be between 0 and 20 dB.'))
      if (!(s.rs > s.rp)) fail(N('Stopband attenuation must exceed the passband ripple.'))
      const edges = twoEdges(band) ? [s.f1, s.f2] : [s.f1]
      let sos
      if (s.fromSpec && s.iirType !== 'bessel') {
        const stops = twoEdges(band) ? [s.s1, s.s2] : [s.s1]
        if (stops.some((f) => !(f > 0 && f < nyq))) fail(N('Frequencies must lie between 0 and the Nyquist frequency ({0} Hz).'), nyq)
        const ok =
          band === 'lowpass' ? s.s1 > s.f1 : band === 'highpass' ? s.s1 < s.f1 : band === 'bandpass' ? s.s1 < s.f1 && s.s2 > s.f2 : s.s1 > s.f1 && s.s2 < s.f2
        if (!ok) fail(N('Each stopband edge must lie on the stopband side of its passband edge.'))
        const r = designIirFromSpec(s.iirType, band, edges, stops, s.rp, s.rs, s.fs)
        if (r.order > 30) fail(N('Required order {0} is too high.'), r.order)
        sos = r.sos
        notes.push([N('Minimum order {0} meets the specification.'), r.order])
      } else {
        const order = Math.round(s.order)
        if (!(order >= 1 && order <= 30)) fail(N('Order must be between 1 and 30.'))
        sos = designIir(s.iirType, band, order, s.f1, twoEdges(band) ? s.f2 : s.f1, s.rp, s.rs, s.fs)
      }
      notes.push([N('{0} second-order sections.'), sos.length])
      return { ok: true, filter: { kind: 'iir', sos }, notes }
    }
    case 'rbj': {
      if (!s.rbj.length) fail(N('Add at least one band.'))
      for (const b of s.rbj) {
        if (!(b.f0 > 0 && b.f0 < nyq)) fail(N('Frequencies must lie between 0 and the Nyquist frequency ({0} Hz).'), nyq)
        if (!(b.q > 0.05 && b.q <= 50)) fail(N('Q must be between 0.05 and 50.'))
      }
      return { ok: true, filter: { kind: 'iir', sos: rbjCascade(s.rbj, s.fs) }, notes }
    }
    case 'manual': {
      if (!s.manual.length) fail(N('Add at least one pole or zero.'))
      const filter = manualToFilter(s.manual)
      notes.push([N('Gain normalised so the peak is 0 dB.')])
      return { ok: true, filter, notes }
    }
  }
}
