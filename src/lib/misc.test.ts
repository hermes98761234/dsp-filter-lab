import { describe, expect, it } from 'vitest'
import { polyFromRoots, polyRoots } from './poly.ts'
import { ellipj, ellipk, ellipF } from './special.ts'
import { fft } from './fft.ts'
import { spectrogram } from './spectrogram.ts'
import { encodeWav } from './wav.ts'
import { rbjBiquad, rbjCascade } from './rbj.ts'
import { analyze, filterOrder, freqz, polesZeros, unwrap } from './response.ts'
import { design, DEFAULT_SPEC, manualToFilter, type Spec } from './design.ts'
import { exportFilter, toFixed, sanitizeName, type ExportOptions } from './export.ts'
import { abs } from './complex.ts'
import { zpk2sos } from './iir.ts'
import { c } from './complex.ts'
import { applyFilter, sosFilter } from './filtering.ts'

const gainDb = (row: number[], fs: number, f: number) => {
  const { h } = freqz({ kind: 'iir', sos: [row] }, [(2 * Math.PI * f) / fs])
  return 20 * Math.log10(abs(h[0]!))
}

describe('polynomials', () => {
  it('finds roots of (x-1)(x+2)(x^2+1)', () => {
    const coef = polyFromRoots([c(1), c(-2), c(0, 1), c(0, -1)])
    expect(coef.map((x) => Math.round(x * 1e9) / 1e9)).toEqual([1, 1, -1, 1, -2])
    const rd = (x: number) => Math.round(x * 1e8) / 1e8 + 0
    const r = polyRoots(coef).map((z) => [rd(z.re), rd(z.im)]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!)
    expect(r).toEqual([
      [-2, 0],
      [0, -1],
      [0, 1],
      [1, 0],
    ])
  })
  it('handles roots at the origin', () => {
    const r = polyRoots([1, 0, 0])
    expect(r).toHaveLength(2)
    expect(r.every((z) => z.re === 0 && z.im === 0)).toBe(true)
  })
})

describe('special functions', () => {
  it('K(m) and Jacobi functions agree with reference values', () => {
    expect(ellipk(0.3)).toBeCloseTo(1.713889448178791, 12)
    expect(ellipk(0)).toBeCloseTo(Math.PI / 2, 14)
    const j = ellipj(0.7, 0.3)
    expect(j.sn).toBeCloseTo(0.6323047763108646, 12)
    expect(j.cn).toBeCloseTo(0.7747197363269298, 12)
    expect(j.dn).toBeCloseTo(0.9381136396814304, 12)
    expect(ellipj(1.2, 0.9999).sn).toBeCloseTo(0.8336662976126131, 9)
    // F(pi/2 | m) = K(m)
    expect(ellipF(Math.PI / 2, 0.3)).toBeCloseTo(ellipk(0.3), 10)
  })
})

describe('FFT, spectrogram', () => {
  it('FFT of a cosine puts energy in the right bins and round-trips', () => {
    const n = 64
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / n))
    const im = new Float64Array(n)
    const orig = Float64Array.from(re)
    fft(re, im)
    expect(re[5]).toBeCloseTo(n / 2, 9)
    expect(re[n - 5]).toBeCloseTo(n / 2, 9)
    expect(Math.abs(re[6]!)).toBeLessThan(1e-9)
    fft(re, im, true)
    re.forEach((v, i) => expect(v).toBeCloseTo(orig[i]!, 9))
  })
  it('spectrogram peak sits at the tone frequency', () => {
    const fs = 8000
    const x = Float32Array.from({ length: 16000 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / fs))
    const sp = spectrogram(x, fs, 512, 50)
    const col = sp.data.slice(0, sp.bins)
    const peak = col.indexOf(Math.max(...col))
    expect((peak * fs) / 512).toBeCloseTo(1000, -1)
    expect(Math.max(...col)).toBeCloseTo(0, 0) // a full-scale sine reads 0 dB
  })
})

describe('WAV encoder', () => {
  it('writes a valid 16-bit PCM header and clips', () => {
    const w = encodeWav([Float32Array.from([0, 0.5, -0.5, 2])], 44100, 16)
    const v = new DataView(w.buffer)
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...w.slice(8, 12))).toBe('WAVE')
    expect(v.getUint16(20, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(44100)
    expect(v.getUint32(40, true)).toBe(8)
    expect(w.length).toBe(44 + 8)
    expect(v.getInt16(44 + 2, true)).toBe(16384)
    expect(v.getInt16(44 + 6, true)).toBe(32767)
  })
  it('interleaves stereo float32', () => {
    const w = encodeWav([Float32Array.from([1, 2]), Float32Array.from([3, 4])], 48000, 32)
    const v = new DataView(w.buffer)
    expect(v.getUint16(20, true)).toBe(3)
    expect([0, 1, 2, 3].map((i) => v.getFloat32(44 + 4 * i, true))).toEqual([1, 3, 2, 4])
  })
})

describe('RBJ cookbook', () => {
  const fs = 48000
  it('peaking EQ has exactly the requested gain at f0 and unity far away', () => {
    for (const g of [-12, -3, 6, 15]) {
      const row = rbjBiquad('peaking', fs, 1000, 2, g)
      expect(gainDb(row, fs, 1000)).toBeCloseTo(g, 9)
      expect(gainDb(row, fs, 20)).toBeCloseTo(0, 1)
      expect(gainDb(row, fs, 22000)).toBeCloseTo(0, 1)
    }
  })
  it('shelves reach their gain at the extremes and half gain at f0', () => {
    const lo = rbjBiquad('lowShelf', fs, 200, 0.707, 9)
    expect(gainDb(lo, fs, 5)).toBeCloseTo(9, 1)
    expect(gainDb(lo, fs, 10000)).toBeCloseTo(0, 1)
    expect(gainDb(lo, fs, 200)).toBeCloseTo(4.5, 1)
    const hi = rbjBiquad('highShelf', fs, 6000, 0.707, -8)
    expect(gainDb(hi, fs, 23000)).toBeCloseTo(-8, 0)
    expect(gainDb(hi, fs, 100)).toBeCloseTo(0, 1)
  })
  it('notch is a null at f0; band-pass peaks at 0 dB; all-pass has unity magnitude', () => {
    expect(gainDb(rbjBiquad('notch', fs, 1000, 5, 0), fs, 1000)).toBeLessThan(-100)
    expect(gainDb(rbjBiquad('bandpass', fs, 1000, 5, 0), fs, 1000)).toBeCloseTo(0, 9)
    expect(gainDb(rbjBiquad('allpass', fs, 1000, 1, 0), fs, 3333)).toBeCloseTo(0, 9)
    expect(gainDb(rbjBiquad('lowpass', fs, 1000, Math.SQRT1_2, 0), fs, 1000)).toBeCloseTo(-3.0103, 3)
    expect(gainDb(rbjBiquad('highpass', fs, 1000, Math.SQRT1_2, 0), fs, 1000)).toBeCloseTo(-3.0103, 3)
  })
  it('a cascade multiplies the responses', () => {
    const bands = [
      { type: 'peaking' as const, f0: 500, q: 1, gainDb: 6 },
      { type: 'peaking' as const, f0: 500, q: 1, gainDb: 3 },
    ]
    const sos = rbjCascade(bands, fs)
    const { h } = freqz({ kind: 'iir', sos }, [(2 * Math.PI * 500) / fs])
    expect(20 * Math.log10(abs(h[0]!))).toBeCloseTo(9, 9)
  })
})

describe('analysis', () => {
  it('unwraps phase jumps', () => {
    const w = unwrap([0, 3, -3, -0.2])
    expect(w[2]).toBeCloseTo(-3 + 2 * Math.PI, 12)
  })
  it('a symmetric FIR has constant group delay (N-1)/2', () => {
    const b = [1, 2, 3, 2, 1]
    const a = analyze({ kind: 'fir', b }, 1000, 64)
    expect(a.groupDelay[10]).toBeCloseTo(2, 9)
    expect(a.groupDelay[40]).toBeCloseTo(2, 9)
  })
  it('group delay of a first-order pole matches the analytic value', () => {
    // y[n] = x[n] + 0.5 y[n-1]: tau(0) = p/(1-p) = 1
    const a = analyze({ kind: 'iir', sos: [[1, 0, 0, 1, -0.5, 0]] }, 1000, 64)
    expect(a.groupDelay[0]).toBeCloseTo(1, 9)
    expect(a.stable).toBe(true)
    expect(a.impulse[3]).toBeCloseTo(0.125, 12)
    expect(a.step[a.step.length - 1]).toBeCloseTo(2, 3)
  })
  it('detects an unstable section', () => {
    expect(analyze({ kind: 'iir', sos: [[1, 0, 0, 1, -1.2, 1.2]] }, 1000, 16).stable).toBe(false)
  })
  it('reports poles and zeros of an FIR and a biquad', () => {
    const { zeros, poles } = polesZeros({ kind: 'fir', b: [1, 0, 1] })
    expect(zeros.map((z) => Math.round(Math.abs(z.im) * 1e6) / 1e6)).toEqual([1, 1])
    expect(poles).toHaveLength(2)
    expect(filterOrder({ kind: 'fir', b: [1, 0, 1] })).toBe(2)
  })
  it('zpk2sos reproduces the transfer function', () => {
    const sos = zpk2sos([c(-1), c(-1)], [c(0.5, 0.3), c(0.5, -0.3)], 0.25)
    expect(sos).toHaveLength(1)
    const { h } = freqz({ kind: 'iir', sos }, [0])
    // H(1) = 0.25 * (2)^2 / |1 - p|^2
    expect(h[0]!.re).toBeCloseTo((0.25 * 4) / (0.25 + 0.09), 9)
  })
})

describe('design dispatcher', () => {
  const base = DEFAULT_SPEC
  it('designs every family with the defaults', () => {
    for (const family of ['fir-window', 'fir-remez', 'fir-freq', 'iir', 'rbj', 'manual'] as const) {
      const r = design({ ...base, family })
      expect(r.ok).toBe(true)
    }
  })
  it('reports readable errors for invalid input', () => {
    const r = design({ ...base, f1: 30000 })
    expect(r.ok).toBe(false)
    expect(design({ ...base, family: 'iir', rs: 0.5, rp: 1 }).ok).toBe(false)
    expect(design({ ...base, family: 'fir-window', auto: false, taps: 2 }).ok).toBe(false)
  })
  it('IIR from spec picks the minimum order and every response type designs', () => {
    for (const response of ['lowpass', 'highpass', 'bandpass', 'bandstop'] as const)
      for (const iirType of ['butter', 'cheby1', 'cheby2', 'ellip', 'bessel'] as const) {
        const spec: Spec = { ...base, family: 'iir', response, iirType, f1: 3000, f2: 6000, s1: response === 'lowpass' || response === 'bandstop' ? 4500 : 1500, s2: response === 'bandstop' ? 4800 : 8000 }
        expect(design(spec).ok).toBe(true)
        expect(design({ ...spec, fromSpec: true }).ok).toBe(true)
      }
  })
  it('manual poles and zeros give a unit-peak stable filter', () => {
    const f = manualToFilter(base.manual)
    const a = analyze(f, 48000, 512)
    expect(Math.max(...a.mag)).toBeCloseTo(1, 9)
    expect(a.stable).toBe(true)
  })
  it('all FIR responses design through the Kaiser, Remez and frequency-sampling paths', () => {
    for (const response of ['lowpass', 'highpass', 'bandpass', 'bandstop'] as const) {
      for (const family of ['fir-window', 'fir-remez', 'fir-freq'] as const) {
        expect(design({ ...base, family, response, f1: 6000, f2: 12000, transition: 2000, taps: 61 }).ok).toBe(true)
      }
    }
    expect(design({ ...base, family: 'fir-window', response: 'hilbert', auto: false, taps: 63 }).ok).toBe(true)
    expect(design({ ...base, family: 'fir-remez', response: 'differentiator', f1: 500, f2: 20000, taps: 32, auto: false }).ok).toBe(true)
    expect(design({ ...base, family: 'fir-remez', response: 'hilbert', f1: 500, f2: 23000, taps: 31, auto: false }).ok).toBe(true)
  })
})

describe('filtering', () => {
  it('sosFilter of an impulse reproduces the biquad recursion', () => {
    const y = sosFilter([[1, 0, 0, 1, -0.5, 0]], [1, 0, 0, 0])
    expect(Array.from(y)).toEqual([1, 0.5, 0.25, 0.125])
  })
  it('FIR delay compensation lines up a symmetric filter', () => {
    const y = applyFilter({ kind: 'fir', b: [0, 0, 1, 0, 0] }, [1, 2, 3, 4, 5])
    expect(Array.from(y)).toEqual([1, 2, 3, 4, 5])
    const raw = applyFilter({ kind: 'fir', b: [0, 0, 1, 0, 0] }, [1, 2, 3, 4, 5], false)
    expect(Array.from(raw)).toEqual([0, 0, 1, 2, 3])
  })
})

describe('coefficient export', () => {
  const opts: ExportOptions = { name: 'my filter', fs: 48000, precision: 'float', cmsis: false, label: 'test' }
  const fir = { kind: 'fir' as const, b: [0.25, 0.5, 0.25] }
  const iir = { kind: 'iir' as const, sos: [[0.5, 1, 0.5, 1, -0.2, 0.1]] }
  it('sanitises names', () => {
    expect(sanitizeName('my filter!')).toBe('my_filter_')
    expect(sanitizeName('1abc')).toBe('_1abc')
  })
  it('writes a C array', () => {
    const s = exportFilter(fir, 'c', { ...opts, name: 'lp' })
    expect(s).toContain('#define LP_NUM_TAPS 3')
    expect(s).toContain('static const float lp_coeffs[LP_NUM_TAPS] = {')
    expect(s).toContain('0.25f, 0.5f, 0.25f')
    const d = exportFilter(iir, 'c', { ...opts, name: 'eq', precision: 'double' })
    expect(d).toContain('static const double eq_sos[EQ_NUM_SECTIONS][5]')
    expect(d).toContain('{0.5, 1.0, 0.5, -0.2, 0.1}')
  })
  it('writes scipy-ready Python', () => {
    expect(exportFilter(fir, 'python', opts)).toContain('signal.lfilter(b, 1.0, x)')
    const p = exportFilter(iir, 'python', opts)
    expect(p).toContain('signal.sosfilt(sos, x)')
    expect(p).toContain('[0.5, 1, 0.5, 1, -0.2, 0.1]')
  })
  it('writes CSV', () => {
    expect(exportFilter(fir, 'csv', opts)).toBe('index,coefficient\n0,0.25\n1,0.5\n2,0.25\n')
    expect(exportFilter(iir, 'csv', opts)).toBe('section,b0,b1,b2,a0,a1,a2\n0,0.5,1,0.5,1,-0.2,0.1\n')
  })
  it('quantises to Q15 / Q31 with a block exponent when needed', () => {
    const q = toFixed(fir, 15)
    expect(q.shift).toBe(0)
    expect(q.ints).toEqual([8192, 16384, 8192])
    expect(q.maxError).toBe(0)
    const big = toFixed(iir, 15)
    expect(big.shift).toBe(1) // |b1| = 1 needs one bit of headroom
    expect(big.ints[1]).toBe(16384)
    expect(big.ints[3]).toBe(Math.round((-0.2 / 2) * 32768))
    const q31 = toFixed({ kind: 'fir', b: [0.123456789] }, 31)
    expect(q31.ints[0]).toBe(Math.round(0.123456789 * 2 ** 31))
    expect(q31.maxError).toBeLessThan(2 ** -31)
    // saturation
    expect(toFixed({ kind: 'fir', b: [0.99999999] }, 15).ints[0]).toBe(32767)
  })
  it('emits fixed-point C with CMSIS layout', () => {
    const s = exportFilter(iir, 'q15', { ...opts, name: 'bq', cmsis: true })
    expect(s).toContain('int16_t bq_sos_q15[BQ_NUM_SECTIONS * 6]')
    expect(s).toContain('#define BQ_POST_SHIFT 1')
    expect(s).toContain('8192, 0, 16384, 8192, 3277, -1638')
    expect(exportFilter(fir, 'q31', opts)).toContain('int32_t my_filter_coeffs_q31[MY_FILTER_NUM_TAPS]')
  })
  it('quantised response stays close for a designed filter', () => {
    const r = design({ ...DEFAULT_SPEC, family: 'fir-window' })
    if (!r.ok || r.filter.kind !== 'fir') throw new Error('design failed')
    const q = toFixed(r.filter, 15)
    expect(q.maxError).toBeLessThan(2 ** -16 + 1e-12)
  })
})
