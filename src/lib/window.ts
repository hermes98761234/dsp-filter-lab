export type WindowName = 'rectangular' | 'bartlett' | 'hann' | 'hamming' | 'blackman' | 'blackman-harris' | 'nuttall' | 'kaiser'

export const WINDOWS: WindowName[] = ['rectangular', 'bartlett', 'hann', 'hamming', 'blackman', 'blackman-harris', 'nuttall', 'kaiser']

/** Modified Bessel function of the first kind, order zero (power series). */
export function besselI0(x: number): number {
  let sum = 1
  let term = 1
  const q = (x * x) / 4
  for (let k = 1; k < 500; k++) {
    term *= q / (k * k)
    sum += term
    if (term < sum * 1e-17) break
  }
  return sum
}

const COSINE_SUM: Partial<Record<WindowName, number[]>> = {
  hann: [0.5, 0.5],
  hamming: [0.54, 0.46],
  blackman: [0.42, 0.5, 0.08],
  'blackman-harris': [0.35875, 0.48829, 0.14128, 0.01168],
  nuttall: [0.3635819, 0.4891775, 0.1365995, 0.0106411],
}

/** Symmetric window of length n (suitable for FIR design). */
export function makeWindow(name: WindowName, n: number, beta = 8.6): number[] {
  if (n === 1) return [1]
  const w = new Array<number>(n)
  const den = n - 1
  for (let i = 0; i < n; i++) {
    switch (name) {
      case 'rectangular':
        w[i] = 1
        break
      case 'bartlett':
        w[i] = 1 - Math.abs((2 * i) / den - 1)
        break
      case 'kaiser': {
        const r = (2 * i) / den - 1
        w[i] = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta)
        break
      }
      default: {
        const a = COSINE_SUM[name]!
        let v = 0
        for (let k = 0; k < a.length; k++) v += (k % 2 === 0 ? 1 : -1) * a[k]! * Math.cos((2 * Math.PI * k * i) / den)
        w[i] = v
      }
    }
  }
  return w
}

/** Kaiser's empirical design formulas: stopband attenuation `atten` dB, transition width `dfNorm` (fraction of fs). */
export function kaiserParams(atten: number, dfNorm: number): { beta: number; taps: number } {
  let beta: number
  if (atten > 50) beta = 0.1102 * (atten - 8.7)
  else if (atten >= 21) beta = 0.5842 * (atten - 21) ** 0.4 + 0.07886 * (atten - 21)
  else beta = 0
  const taps = Math.ceil((atten - 7.95) / (14.36 * dfNorm)) + 1
  return { beta, taps: Math.max(3, taps) }
}
