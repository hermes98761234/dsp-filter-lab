import { kaiserParams, makeWindow, type WindowName } from './window.ts'

export type FirResponse = 'lowpass' | 'highpass' | 'bandpass' | 'bandstop' | 'differentiator' | 'hilbert'

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x))

/** Amplitude |H| of an FIR at normalised frequency f (cycles/sample). */
export function firGainAt(h: number[], f: number): number {
  let re = 0
  let im = 0
  for (let n = 0; n < h.length; n++) {
    re += h[n]! * Math.cos(2 * Math.PI * f * n)
    im -= h[n]! * Math.sin(2 * Math.PI * f * n)
  }
  return Math.hypot(re, im)
}

/** Ideal (infinite) impulse response sampled around the centre of an n-tap filter. Edges in cycles/sample. */
export function idealImpulse(response: FirResponse, n: number, f1: number, f2: number): number[] {
  const mid = (n - 1) / 2
  const h = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const m = i - mid
    const lp = (fc: number) => 2 * fc * sinc(2 * fc * m)
    const delta = Math.abs(m) < 1e-9 ? 1 : 0
    switch (response) {
      case 'lowpass':
        h[i] = lp(f1)
        break
      case 'highpass':
        h[i] = delta - lp(f1)
        break
      case 'bandpass':
        h[i] = lp(f2) - lp(f1)
        break
      case 'bandstop':
        h[i] = delta - (lp(f2) - lp(f1))
        break
      case 'differentiator':
        h[i] = Math.abs(m) < 1e-9 ? 0 : Math.cos(Math.PI * m) / m - Math.sin(Math.PI * m) / (Math.PI * m * m)
        break
      case 'hilbert':
        h[i] = Math.abs(m) < 1e-9 ? 0 : (1 - Math.cos(Math.PI * m)) / (Math.PI * m)
        break
    }
  }
  return h
}

/** Taps must be odd for responses that are non-zero at Nyquist. */
export function needsOddTaps(response: FirResponse): boolean {
  return response === 'highpass' || response === 'bandstop'
}

/** Scale so the passband reference gain is exactly one (DC for lowpass/bandstop, Nyquist for highpass, band centre for bandpass). */
function normalise(h: number[], response: FirResponse, f1: number, f2: number): number[] {
  let ref: number
  switch (response) {
    case 'lowpass':
    case 'bandstop':
      ref = 0
      break
    case 'highpass':
      ref = 0.5
      break
    case 'bandpass':
      ref = (f1 + f2) / 2
      break
    default:
      return h
  }
  const g = firGainAt(h, ref)
  return g > 1e-12 ? h.map((x) => x / g) : h
}

export interface WindowFirOptions {
  response: FirResponse
  taps: number
  window: WindowName
  beta?: number
  /** Edges in cycles/sample (0..0.5). */
  f1: number
  f2: number
}

export function designWindowFir(o: WindowFirOptions): number[] {
  const taps = needsOddTaps(o.response) && o.taps % 2 === 0 ? o.taps + 1 : o.taps
  const ideal = idealImpulse(o.response, taps, o.f1, o.f2)
  const w = makeWindow(o.window, taps, o.beta)
  return normalise(
    ideal.map((x, i) => x * w[i]!),
    o.response,
    o.f1,
    o.f2,
  )
}

/** Kaiser-window design from attenuation (dB) and transition width (Hz); edges are mid-transition. */
export function designKaiserFir(response: 'lowpass' | 'highpass' | 'bandpass' | 'bandstop', f1: number, f2: number, atten: number, transition: number, fs: number): { h: number[]; beta: number; taps: number } {
  const { beta, taps: t } = kaiserParams(atten, transition / fs)
  const taps = needsOddTaps(response) && t % 2 === 0 ? t + 1 : t
  const h = designWindowFir({ response, taps, window: 'kaiser', beta, f1: f1 / fs, f2: f2 / fs })
  return { h, beta, taps }
}

/**
 * Frequency-sampling design (type I, odd length). The desired brick-wall amplitude is sampled at N points;
 * `transitionValue` (0..1) is placed on the first stopband sample next to each passband edge.
 */
export function designFrequencySampling(response: 'lowpass' | 'highpass' | 'bandpass' | 'bandstop', taps: number, f1: number, f2: number, transitionValue = 0.5): number[] {
  const n = taps % 2 === 0 ? taps + 1 : taps
  const M = (n - 1) / 2
  const inPass = (f: number): boolean => {
    switch (response) {
      case 'lowpass':
        return f <= f1
      case 'highpass':
        return f >= f1
      case 'bandpass':
        return f >= f1 && f <= f2
      case 'bandstop':
        return f <= f1 || f >= f2
    }
  }
  const amp: number[] = []
  for (let k = 0; k <= M; k++) amp.push(inPass(k / n) ? 1 : 0)
  const tr = [...amp]
  for (let k = 0; k <= M; k++) {
    if (amp[k] === 0 && ((k > 0 && amp[k - 1] === 1) || (k < M && amp[k + 1] === 1))) tr[k] = transitionValue
  }
  const h = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    let s = tr[0]!
    for (let k = 1; k <= M; k++) s += 2 * tr[k]! * Math.cos((2 * Math.PI * k * (i - M)) / n)
    h[i] = s / n
  }
  return h
}
