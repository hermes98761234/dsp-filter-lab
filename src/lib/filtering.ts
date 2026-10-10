import { fft, nextPow2 } from './fft.ts'
import type { Sos } from './iir.ts'

export type Filter = { kind: 'fir'; b: number[] } | { kind: 'iir'; sos: Sos }

/** Cascaded biquads, transposed direct form II, in double precision. */
export function sosFilter(sos: Sos, x: ArrayLike<number>): Float64Array {
  const n = x.length
  let y = Float64Array.from(x as ArrayLike<number>)
  for (const s of sos) {
    const [b0, b1, b2, , a1, a2] = s as [number, number, number, number, number, number]
    let z1 = 0
    let z2 = 0
    for (let i = 0; i < n; i++) {
      const xi = y[i]!
      const out = b0 * xi + z1
      z1 = b1 * xi - a1 * out + z2
      z2 = b2 * xi - a2 * out
      y[i] = out
    }
  }
  if (y.length !== n) y = y.slice(0, n)
  return y
}

/** Full linear convolution of x with h (length x+h-1): direct for short filters, FFT overlap-add for long ones. */
export function convolve(x: ArrayLike<number>, h: ArrayLike<number>): Float64Array {
  const nx = x.length
  const nh = h.length
  const out = new Float64Array(nx + nh - 1)
  if (nh <= 24) {
    for (let i = 0; i < nx; i++) {
      const xi = x[i]!
      for (let k = 0; k < nh; k++) out[i + k]! += xi * h[k]!
    }
    return out
  }
  const size = nextPow2(Math.max(4 * nh, 1024))
  const block = size - nh + 1
  const hr = new Float64Array(size)
  const hi = new Float64Array(size)
  for (let k = 0; k < nh; k++) hr[k] = h[k]!
  fft(hr, hi)
  const xr = new Float64Array(size)
  const xi = new Float64Array(size)
  for (let start = 0; start < nx; start += block) {
    xr.fill(0)
    xi.fill(0)
    const len = Math.min(block, nx - start)
    for (let i = 0; i < len; i++) xr[i] = x[start + i]!
    fft(xr, xi)
    for (let i = 0; i < size; i++) {
      const r = xr[i]! * hr[i]! - xi[i]! * hi[i]!
      const im = xr[i]! * hi[i]! + xi[i]! * hr[i]!
      xr[i] = r
      xi[i] = im
    }
    fft(xr, xi, true)
    const upto = Math.min(len + nh - 1, out.length - start)
    for (let i = 0; i < upto; i++) out[start + i]! += xr[i]!
  }
  return out
}

/**
 * Filter a signal. For FIR filters, `compensateDelay` shifts the output back by the group delay
 * (N-1)/2 of a linear-phase filter so it lines up with the input.
 */
export function applyFilter(f: Filter, x: ArrayLike<number>, compensateDelay = true): Float32Array {
  if (f.kind === 'iir') return Float32Array.from(sosFilter(f.sos, x))
  const full = convolve(x, f.b)
  const shift = compensateDelay ? Math.floor((f.b.length - 1) / 2) : 0
  const out = new Float32Array(x.length)
  for (let i = 0; i < out.length; i++) out[i] = full[i + shift] ?? 0
  return out
}
