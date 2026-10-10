import type { Sos } from './iir.ts'

export type RbjType = 'peaking' | 'lowShelf' | 'highShelf' | 'notch' | 'lowpass' | 'highpass' | 'bandpass' | 'allpass'

export const RBJ_TYPES: RbjType[] = ['peaking', 'lowShelf', 'highShelf', 'notch', 'lowpass', 'highpass', 'bandpass', 'allpass']

export interface RbjBand {
  type: RbjType
  f0: number
  q: number
  gainDb: number
}

/** Robert Bristow-Johnson's Audio EQ Cookbook biquads, as one SOS row [b0 b1 b2 1 a1 a2]. */
export function rbjBiquad(type: RbjType, fs: number, f0: number, q: number, gainDb: number): number[] {
  const A = 10 ** (gainDb / 40)
  const w0 = (2 * Math.PI * f0) / fs
  const cs = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const sA = 2 * Math.sqrt(A) * alpha
  let b: number[]
  let a: number[]
  switch (type) {
    case 'lowpass':
      b = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2]
      a = [1 + alpha, -2 * cs, 1 - alpha]
      break
    case 'highpass':
      b = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2]
      a = [1 + alpha, -2 * cs, 1 - alpha]
      break
    case 'bandpass':
      b = [alpha, 0, -alpha]
      a = [1 + alpha, -2 * cs, 1 - alpha]
      break
    case 'notch':
      b = [1, -2 * cs, 1]
      a = [1 + alpha, -2 * cs, 1 - alpha]
      break
    case 'allpass':
      b = [1 - alpha, -2 * cs, 1 + alpha]
      a = [1 + alpha, -2 * cs, 1 - alpha]
      break
    case 'peaking':
      b = [1 + alpha * A, -2 * cs, 1 - alpha * A]
      a = [1 + alpha / A, -2 * cs, 1 - alpha / A]
      break
    case 'lowShelf':
      b = [A * (A + 1 - (A - 1) * cs + sA), 2 * A * (A - 1 - (A + 1) * cs), A * (A + 1 - (A - 1) * cs - sA)]
      a = [A + 1 + (A - 1) * cs + sA, -2 * (A - 1 + (A + 1) * cs), A + 1 + (A - 1) * cs - sA]
      break
    case 'highShelf':
      b = [A * (A + 1 + (A - 1) * cs + sA), -2 * A * (A - 1 + (A + 1) * cs), A * (A + 1 + (A - 1) * cs - sA)]
      a = [A + 1 - (A - 1) * cs + sA, 2 * (A - 1 - (A + 1) * cs), A + 1 - (A - 1) * cs - sA]
      break
  }
  const a0 = a[0]!
  return [b[0]! / a0, b[1]! / a0, b[2]! / a0, 1, a[1]! / a0, a[2]! / a0]
}

export function rbjCascade(bands: RbjBand[], fs: number): Sos {
  return bands.map((b) => rbjBiquad(b.type, fs, b.f0, b.q, b.gainDb))
}

/** Does this band type use the gain parameter? */
export const rbjUsesGain = (t: RbjType): boolean => t === 'peaking' || t === 'lowShelf' || t === 'highShelf'
