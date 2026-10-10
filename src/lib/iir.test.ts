import { describe, expect, it } from 'vitest'
import { designIir, designIirFromSpec, iirOrder, type Sos } from './iir.ts'
import { applyFilter } from './filtering.ts'
import { freqz, isStableSos, polesZeros } from './response.ts'
import { abs } from './complex.ts'

const W = [0.05, 0.15, 0.25, 0.35, 0.5, 0.7, 0.9]
/** |H| at frequencies given as fractions of Nyquist. */
const magAt = (sos: Sos, ws: number[]) => freqz({ kind: 'iir', sos }, ws.map((w) => w * Math.PI)).h.map(abs)
const db = (x: number) => 20 * Math.log10(x)

// Reference magnitudes at W (fractions of Nyquist) produced with scipy.signal 1.11.
const REF: Record<string, number[]> = {
  butter5lp: [0.999999996, 0.999730429, 0.942364333, 0.369310458, 0.0343220684, 0.00117939289, 3.42288238e-6],
  cheby1_4hp: [0.000332090987, 0.0408450905, 0.891250938, 0.893968615, 0.997575941, 0.948036975, 0.89749259],
  cheby2_6lp: [1.0, 0.999883542, 0.859577611, 0.0578918709, 0.000526496457, 0.00204805777, 0.00243492659],
  ellip5lp: [0.954973176, 0.916956829, 0.905172806, 0.0643658559, 0.00129130604, 0.00316098967, 0.00146457984],
  ellip4bp: [0.00552938941, 0.00754866565, 0.984132882, 0.953421382, 0.944060876, 0.00744195354, 0.00807756703],
  bessel4lp: [0.981377375, 0.833973394, 0.551907278, 0.251601664, 0.0507071831, 0.00382441227, 3.67703523e-5],
  butter3bs: [0.999996621, 0.987777126, 0.0581722693, 0.178992689, 0.989607015, 0.999946341, 0.999999966],
  ellip6lp: [0.993796402, 0.996141265, 0.0138195537, 0.000216377016, 0.000762897278, 0.000371031529, 0.000933936776],
}
// fs = 2 so that frequencies in Hz equal fractions of Nyquist.
const DESIGNS: Record<string, () => Sos> = {
  butter5lp: () => designIir('butter', 'lowpass', 5, 0.3, 0.3, 1, 60, 2),
  cheby1_4hp: () => designIir('cheby1', 'highpass', 4, 0.25, 0.25, 1, 60, 2),
  cheby2_6lp: () => designIir('cheby2', 'lowpass', 6, 0.4, 0.4, 1, 50, 2),
  ellip5lp: () => designIir('ellip', 'lowpass', 5, 0.3, 0.3, 1, 50, 2),
  ellip4bp: () => designIir('ellip', 'bandpass', 4, 0.2, 0.5, 0.5, 40, 2),
  bessel4lp: () => designIir('bessel', 'lowpass', 4, 0.2, 0.2, 1, 60, 2),
  butter3bs: () => designIir('butter', 'bandstop', 3, 0.2, 0.4, 1, 60, 2),
  ellip6lp: () => designIir('ellip', 'lowpass', 6, 0.2, 0.2, 0.5, 60, 2),
}

describe('IIR design matches scipy', () => {
  for (const name of Object.keys(REF)) {
    it(name, () => {
      const m = magAt(DESIGNS[name]!(), W)
      m.forEach((v, i) => expect(Math.abs(v - REF[name]![i]!)).toBeLessThan(1e-6 + 1e-5 * REF[name]![i]!))
    })
  }
})

describe('Butterworth', () => {
  it('is -3 dB at the cutoff (all band types)', () => {
    const fs = 8000
    for (const n of [1, 2, 3, 4, 7, 10]) {
      const lp = designIir('butter', 'lowpass', n, 1000, 1000, 1, 60, fs)
      expect(db(magAt(lp, [1000 / (fs / 2)])[0]!)).toBeCloseTo(-3.0103, 3)
      const hp = designIir('butter', 'highpass', n, 1500, 1500, 1, 60, fs)
      expect(db(magAt(hp, [1500 / (fs / 2)])[0]!)).toBeCloseTo(-3.0103, 3)
      const bp = designIir('butter', 'bandpass', n, 800, 1600, 1, 60, fs)
      for (const f of [800, 1600]) expect(db(magAt(bp, [f / (fs / 2)])[0]!)).toBeCloseTo(-3.0103, 3)
      const bs = designIir('butter', 'bandstop', n, 800, 1600, 1, 60, fs)
      for (const f of [800, 1600]) expect(db(magAt(bs, [f / (fs / 2)])[0]!)).toBeCloseTo(-3.0103, 3)
    }
  })
  it('is maximally flat with unity DC gain and 20N dB/decade roll-off', () => {
    const sos = designIir('butter', 'lowpass', 4, 100, 100, 1, 60, 48000)
    expect(magAt(sos, [1e-6])[0]!).toBeCloseTo(1, 9)
    const a = magAt(sos, [1000 / 24000])[0]!
    const b = magAt(sos, [2000 / 24000])[0]!
    expect(db(a) - db(b)).toBeGreaterThan(23.5) // ~24 dB per octave for N = 4
  })
})

describe('Chebyshev and elliptic ripple', () => {
  const fs = 2
  it('Chebyshev I: ripple stays within rp and touches it at the edge', () => {
    for (const n of [3, 4, 5, 8]) {
      const sos = designIir('cheby1', 'lowpass', n, 0.3, 0.3, 1.5, 60, fs)
      const ws = Array.from({ length: 400 }, (_, i) => (0.3 * i) / 399)
      const m = magAt(sos, ws).map(db)
      expect(Math.max(...m)).toBeLessThan(1e-6)
      expect(Math.min(...m)).toBeGreaterThan(-1.5 - 1e-6)
      expect(m[399]!).toBeCloseTo(-1.5, 4)
    }
  })
  it('Chebyshev II: stopband at least rs beyond the edge', () => {
    const sos = designIir('cheby2', 'lowpass', 6, 0.4, 0.4, 1, 55, fs)
    const ws = Array.from({ length: 200 }, (_, i) => 0.4 + (0.6 * i) / 199)
    expect(Math.max(...magAt(sos, ws).map(db))).toBeLessThan(-55 + 1e-4)
  })
  it('elliptic: passband ripple and stopband floor hold', () => {
    for (const n of [3, 4, 5, 6, 7]) {
      const sos = designIir('ellip', 'lowpass', n, 0.25, 0.25, 0.8, 55, fs)
      const pass = magAt(sos, Array.from({ length: 300 }, (_, i) => (0.25 * i) / 299)).map(db)
      expect(Math.max(...pass)).toBeLessThan(1e-6)
      expect(Math.min(...pass)).toBeGreaterThan(-0.8 - 1e-6)
      // find the stopband edge by scanning: attenuation must reach 55 dB and stay there
      const stop = magAt(sos, Array.from({ length: 800 }, (_, i) => 0.25 + (0.75 * i) / 799)).map(db)
      const firstOk = stop.findIndex((v) => v < -55 + 1e-4)
      expect(firstOk).toBeGreaterThan(-1)
      expect(Math.max(...stop.slice(firstOk))).toBeLessThan(-55 + 1e-4)
    }
  })
})

describe('Bessel', () => {
  it('is -3 dB at the cutoff with a nearly flat group delay in the passband', () => {
    const sos = designIir('bessel', 'lowpass', 5, 200, 200, 1, 60, 8000)
    // The prototype is -3 dB at cutoff; bilinear warping keeps that exact.
    expect(db(magAt(sos, [200 / 4000])[0]!)).toBeCloseTo(-3.0103, 2)
    const ws = Array.from({ length: 30 }, (_, i) => ((0.1 * i) / 29) * Math.PI * (200 / 4000) * 10)
    const gd = freqz({ kind: 'iir', sos }, ws).gd
    expect(Math.max(...gd) / Math.min(...gd)).toBeLessThan(1.02)
  })
})

describe('stability', () => {
  it('every design has all poles inside the unit circle', () => {
    const types = ['butter', 'cheby1', 'cheby2', 'ellip', 'bessel'] as const
    const bands = ['lowpass', 'highpass', 'bandpass', 'bandstop'] as const
    for (const t of types)
      for (const b of bands)
        for (const n of [1, 2, 3, 6, 9]) {
          const sos = designIir(t, b, n, 0.1 * 24000, 0.3 * 24000, 1, 50, 48000)
          expect(isStableSos(sos)).toBe(true)
          for (const p of polesZeros({ kind: 'iir', sos }).poles) expect(abs(p)).toBeLessThan(1)
          expect(sos.every((r) => r.every(Number.isFinite))).toBe(true)
        }
  })
})

describe('order estimation', () => {
  it('matches scipy buttord/cheb1ord/cheb2ord/ellipord', () => {
    expect(iirOrder('butter', 'lowpass', [0.2], [0.3], 3, 40, 2)).toBe(11)
    expect(iirOrder('cheby1', 'lowpass', [0.2], [0.3], 1, 50, 2)).toBe(7)
    expect(iirOrder('cheby2', 'lowpass', [0.2], [0.3], 1, 50, 2)).toBe(7)
    expect(iirOrder('ellip', 'lowpass', [0.2], [0.3], 1, 50, 2)).toBe(5)
    expect(iirOrder('ellip', 'bandpass', [0.2, 0.4], [0.1, 0.5], 1, 40, 2)).toBe(4)
  })
  it('a design from spec meets it', () => {
    const { sos, order } = designIirFromSpec('ellip', 'lowpass', [2000], [3000], 1, 50, 16000)
    expect(order).toBe(5)
    const pass = magAt(sos, Array.from({ length: 100 }, (_, i) => (2000 / 8000) * (i / 99))).map(db)
    expect(Math.min(...pass)).toBeGreaterThan(-1 - 1e-6)
    expect(db(magAt(sos, [3000 / 8000])[0]!)).toBeLessThan(-50 + 1e-3)
    const bw = designIirFromSpec('butter', 'lowpass', [1000], [2000], 3, 40, 16000)
    expect(db(magAt(bw.sos, [1000 / 8000])[0]!)).toBeGreaterThan(-3 - 1e-6)
    expect(db(magAt(bw.sos, [2000 / 8000])[0]!)).toBeLessThan(-40 + 1e-3)
  })
})

describe('filtering a tone', () => {
  const fs = 48000
  const tone = (f: number, n = 48000) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * f * i) / fs))
  const rms = (x: Float32Array, from = 24000) => Math.sqrt(x.slice(from).reduce((s, v) => s + v * v, 0) / (x.length - from))
  it('passes a tone in the passband and rejects one in the stopband', () => {
    const sos = designIir('butter', 'lowpass', 6, 2000, 2000, 1, 60, fs)
    const f = { kind: 'iir', sos } as const
    expect(rms(applyFilter(f, tone(500)))).toBeCloseTo(Math.SQRT1_2, 2)
    expect(rms(applyFilter(f, tone(10000)))).toBeLessThan(Math.SQRT1_2 * 10 ** (-60 / 20))
  })
  it('attenuates a tone at the cutoff by 3 dB', () => {
    const f = { kind: 'iir', sos: designIir('butter', 'lowpass', 4, 3000, 3000, 1, 60, fs) } as const
    expect(rms(applyFilter(f, tone(3000)))).toBeCloseTo(0.5, 2)
  })
})
