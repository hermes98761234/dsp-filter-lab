import { describe, expect, it } from 'vitest'
import { designFrequencySampling, designKaiserFir, designWindowFir, firGainAt } from './fir.ts'
import { designRemez, designRemezToSpec, remez, ripples, type RemezSpec } from './remez.ts'
import { kaiserParams, makeWindow, besselI0 } from './window.ts'
import { applyFilter, convolve } from './filtering.ts'
import { freqz } from './response.ts'

const db = (x: number) => 20 * Math.log10(x)
const gain = (h: number[], f: number) => firGainAt(h, f)

describe('windows', () => {
  it('match textbook values', () => {
    const h = makeWindow('hamming', 5)
    expect(h[0]).toBeCloseTo(0.08, 12)
    expect(h[2]).toBeCloseTo(1, 12)
    const b = makeWindow('blackman', 5)
    expect(b[0]).toBeCloseTo(0, 12)
    expect(b[1]).toBeCloseTo(0.34, 12)
    expect(makeWindow('hann', 5)[1]).toBeCloseTo(0.5, 12)
    expect(makeWindow('bartlett', 5)).toEqual([0, 0.5, 1, 0.5, 0])
  })
  it('Kaiser window equals the scipy definition', () => {
    // numpy.kaiser(5, 8.6)
    const w = makeWindow('kaiser', 5, 8.6)
    expect(w[0]).toBeCloseTo(1 / besselI0(8.6), 12)
    expect(w[2]).toBeCloseTo(1, 12)
    expect(w[1]).toBeCloseTo(besselI0(8.6 * Math.sqrt(0.75)) / besselI0(8.6), 12)
  })
  it('Kaiser beta formula', () => {
    expect(kaiserParams(60, 0.05).beta).toBeCloseTo(0.1102 * 51.3, 10)
    expect(kaiserParams(40, 0.05).beta).toBeCloseTo(0.5842 * 19 ** 0.4 + 0.07886 * 19, 10)
    expect(kaiserParams(15, 0.05).beta).toBe(0)
  })
})

describe('windowed-sinc FIR', () => {
  it('lowpass is symmetric with unity DC gain and about -6 dB at the cutoff', () => {
    const h = designWindowFir({ response: 'lowpass', taps: 101, window: 'hamming', f1: 0.2, f2: 0 })
    for (let i = 0; i < 50; i++) expect(h[i]).toBeCloseTo(h[100 - i]!, 12)
    expect(gain(h, 0)).toBeCloseTo(1, 12)
    expect(db(gain(h, 0.2))).toBeCloseTo(-6, 0)
    expect(db(gain(h, 0.4))).toBeLessThan(-50)
  })
  it('highpass and bandstop force an odd length', () => {
    expect(designWindowFir({ response: 'highpass', taps: 50, window: 'hann', f1: 0.2, f2: 0 })).toHaveLength(51)
    expect(designWindowFir({ response: 'bandstop', taps: 50, window: 'hann', f1: 0.1, f2: 0.2 })).toHaveLength(51)
  })
  it('bandpass passes the centre and rejects DC and Nyquist', () => {
    const h = designWindowFir({ response: 'bandpass', taps: 121, window: 'blackman', f1: 0.1, f2: 0.2 })
    expect(gain(h, 0.15)).toBeCloseTo(1, 9)
    expect(db(gain(h, 0.01))).toBeLessThan(-60)
    expect(db(gain(h, 0.5))).toBeLessThan(-60)
  })
  it('Kaiser auto design meets the attenuation spec outside the transition band', () => {
    const fs = 16000
    for (const atten of [40, 60, 80]) {
      const { h, taps } = designKaiserFir('lowpass', 3000, 0, atten, 600, fs)
      expect(taps).toBeGreaterThan(10)
      let worst = -Infinity
      for (let f = 3300; f <= 8000; f += 10) worst = Math.max(worst, db(gain(h, f / fs)))
      expect(worst).toBeLessThan(-atten + 1.5)
      let ripple = 0
      for (let f = 0; f <= 2700; f += 10) ripple = Math.max(ripple, Math.abs(gain(h, f / fs) - 1))
      expect(ripple).toBeLessThan(10 ** (-atten / 20) * 3)
    }
  })
  it('Hilbert and differentiator have the right phase and slope', () => {
    const hil = designWindowFir({ response: 'hilbert', taps: 63, window: 'hamming', f1: 0, f2: 0 })
    const M = 31
    const f = 0.2
    const { h } = freqz({ kind: 'fir', b: hil }, [2 * Math.PI * f])
    // remove the linear phase: H e^{jwM} should be -j * 1
    const re = h[0]!.re * Math.cos(2 * Math.PI * f * M) - h[0]!.im * Math.sin(2 * Math.PI * f * M)
    const im = h[0]!.re * Math.sin(2 * Math.PI * f * M) + h[0]!.im * Math.cos(2 * Math.PI * f * M)
    expect(re).toBeCloseTo(0, 2)
    expect(im).toBeCloseTo(-1, 2)
    const dif = designWindowFir({ response: 'differentiator', taps: 41, window: 'hamming', f1: 0, f2: 0 })
    expect(gain(dif, 0.1)).toBeCloseTo(2 * Math.PI * 0.1, 2)
  })
})

describe('frequency sampling', () => {
  it('passes the passband and rejects the stopband', () => {
    const h = designFrequencySampling('lowpass', 65, 0.2, 0, 0.4)
    expect(gain(h, 0.05)).toBeCloseTo(1, 1)
    expect(db(gain(h, 0.4))).toBeLessThan(-30)
    const bp = designFrequencySampling('bandpass', 65, 0.15, 0.3, 0.4)
    expect(gain(bp, 0.22)).toBeCloseTo(1, 1)
    expect(db(gain(bp, 0.45))).toBeLessThan(-30)
  })
  it('interpolates exactly at the sample frequencies', () => {
    const n = 33
    const h = designFrequencySampling('highpass', n, 0.25, 0, 0.5)
    for (let k = 0; k <= 16; k++) {
      const want = k / n >= 0.25 ? 1 : k / n >= 0.25 - 1 / n ? 0.5 : 0
      expect(gain(h, k / n)).toBeCloseTo(want, 9)
    }
  })
})

// scipy.signal.remez references (fs = 1).
const REF_A = [0.0035419293, 0.0012749856, -0.0070470875, -0.012114789, -0.0036412146, 0.0090993196, 0.0056747942, -0.011644172, -0.013854281, 0.0092583719, 0.022789103, -0.0028347917, -0.033031572, -0.010752892, 0.042897876, 0.035772665, -0.051199684, -0.088017941, 0.056726842, 0.3120423, 0.44133159]
const REF_B = [-0.0009990186, 0.0080615053, 0.0061577158, 0.0029569898, -0.003509183, -0.010138363, -0.012057115, -0.00590383, 0.006966901, 0.019821829, 0.023387506, 0.011470732, -0.013674821, -0.039784722, -0.048788473, -0.025466957, 0.033543898, 0.11544908, 0.1947379, 0.24344055]
const REF_D = [0.0041956359, 0, 0.0092821015, 0, 0.018835807, 0, 0.034401008, 0, 0.059551576, 0, 0.10303764, 0, 0.19683154, 0, 0.63135364, 0]
const REF_E = [-8.9231803e-6, 1.7613669e-5, -3.375036e-5, 5.4775072e-5, -9.2168771e-5, 0.00014208887, -0.00022256288, 0.00033639569, -0.00051608841, 0.00079116099, -0.0012502397, 0.0020586865, -0.0036805112, 0.0076386788, -0.022042515, 0.20216493]

describe('Remez exchange', () => {
  it('matches scipy: odd lowpass with weights (type I)', () => {
    const r = remez(41, [
      { f0: 0, f1: 0.2, d0: 1, d1: 1, w: 1 },
      { f0: 0.25, f1: 0.5, d0: 0, d1: 0, w: 10 },
    ])
    expect(r.converged).toBe(true)
    REF_A.forEach((v, i) => expect(r.h[i]).toBeCloseTo(v, 4))
  })
  it('matches scipy: even lowpass (type II)', () => {
    const r = remez(40, [
      { f0: 0, f1: 0.1, d0: 1, d1: 1, w: 1 },
      { f0: 0.15, f1: 0.5, d0: 0, d1: 0, w: 1 },
    ])
    REF_B.forEach((v, i) => expect(r.h[i]).toBeCloseTo(v, 4))
    for (let i = 0; i < 20; i++) expect(r.h[i]).toBeCloseTo(r.h[39 - i]!, 12)
  })
  it('matches scipy: Hilbert transformer (type III)', () => {
    const r = remez(31, [{ f0: 0.05, f1: 0.45, d0: 1, d1: 1, w: 1 }], true)
    REF_D.forEach((v, i) => expect(Math.abs(r.h[i]!)).toBeCloseTo(v, 4))
    // positive-lag half is positive for odd offsets (h[n] = 2/(pi n) pattern)
    expect(r.h[16]).toBeGreaterThan(0)
    expect(r.h[18]).toBeGreaterThan(0)
  })
  it('matches scipy: differentiator (type IV)', () => {
    const r = designRemez({ kind: 'differentiator', f1: 0.05, f2: 0.45, transition: 0, passRipple: 1, stopAtten: 40, fs: 1 }, 32)
    // scipy scales the desired slope by 1/(2 pi); ours is the true derivative (H = j w)
    REF_E.forEach((v, i) => expect(r.h[i]).toBeCloseTo(v * 2 * Math.PI, 4))
  })
  it('is equiripple: the passband and stopband peaks equal the reported error', () => {
    const r = remez(51, [
      { f0: 0, f1: 0.2, d0: 1, d1: 1, w: 1 },
      { f0: 0.26, f1: 0.5, d0: 0, d1: 0, w: 1 },
    ])
    let pk = 0
    let sk = 0
    for (let i = 0; i <= 2000; i++) {
      const f = (0.5 * i) / 2000
      if (f <= 0.2) pk = Math.max(pk, Math.abs(gain(r.h, f) - 1))
      if (f >= 0.26) sk = Math.max(sk, gain(r.h, f))
    }
    expect(pk).toBeCloseTo(r.delta, 4)
    expect(sk).toBeCloseTo(r.delta, 4)
  })
})

describe('Remez designed to a ripple specification', () => {
  const base: RemezSpec = { kind: 'lowpass', f1: 3000, f2: 0, transition: 800, passRipple: 0.2, stopAtten: 60, fs: 16000 }
  const measure = (spec: RemezSpec, h: number[]) => {
    const { fs, transition, f1 } = spec
    let pmax = 0
    let pmin = Infinity
    let smax = 0
    for (let f = 0; f <= fs / 2; f += 5) {
      const g = gain(h, f / fs)
      if (f <= f1 - transition / 2) {
        pmax = Math.max(pmax, g)
        pmin = Math.min(pmin, g)
      } else if (f >= f1 + transition / 2) smax = Math.max(smax, g)
    }
    return { rippleDb: db(pmax / pmin), stopDb: -db(smax) }
  }
  it('lowpass: passband ripple and stopband attenuation within spec', () => {
    const { result, taps, met } = designRemezToSpec(base)
    expect(met).toBe(true)
    expect(taps).toBeGreaterThan(30)
    const m = measure(base, result.h)
    expect(m.rippleDb).toBeLessThan(0.2 + 1e-3)
    expect(m.stopDb).toBeGreaterThan(60 - 0.05)
    // and one tap fewer would not meet it (the search found the minimum)
    expect(designRemez(base, taps - 1).delta).toBeGreaterThan(1)
  })
  it('bandpass and highpass meet their specs', () => {
    const bp: RemezSpec = { kind: 'bandpass', f1: 2000, f2: 4000, transition: 500, passRipple: 0.5, stopAtten: 50, fs: 16000 }
    const r = designRemezToSpec(bp)
    expect(r.met).toBe(true)
    const { dp, ds } = ripples(0.5, 50)
    expect(r.result.delta * dp).toBeLessThanOrEqual(dp + 1e-9)
    expect(r.result.delta * ds).toBeLessThanOrEqual(ds + 1e-9)
    let worstStop = 0
    for (let f = 0; f <= 8000; f += 5) if (f < 1750 || f > 4250) worstStop = Math.max(worstStop, gain(r.result.h, f / 16000))
    expect(-db(worstStop)).toBeGreaterThan(49.9)
    const hp = designRemezToSpec({ ...base, kind: 'highpass' })
    expect(hp.met).toBe(true)
    expect(hp.taps % 2).toBe(1)
  })
  it('ripples() converts dB to linear deviations', () => {
    const { dp, ds } = ripples(1, 40)
    expect(ds).toBeCloseTo(0.01, 12)
    expect(dp).toBeCloseTo((10 ** (1 / 20) - 1) / (10 ** (1 / 20) + 1), 12)
  })
})

describe('convolution and FIR filtering', () => {
  it('FFT overlap-add equals direct convolution', () => {
    const x = Float64Array.from({ length: 3000 }, (_, i) => Math.sin(i * 0.37) + (i % 7) / 7)
    const h = Array.from({ length: 150 }, (_, i) => Math.cos(i * 0.11) / (1 + i))
    const fast = convolve(x, h)
    for (const k of [0, 1, 149, 150, 1500, 3000, 3148]) {
      let s = 0
      for (let j = 0; j < h.length; j++) if (k - j >= 0 && k - j < x.length) s += x[k - j]! * h[j]!
      expect(fast[k]).toBeCloseTo(s, 9)
    }
  })
  it('a linear-phase lowpass passes a tone aligned with the input', () => {
    const fs = 48000
    const h = designWindowFir({ response: 'lowpass', taps: 201, window: 'blackman', f1: 2000 / fs, f2: 0 })
    const x = Float32Array.from({ length: 20000 }, (_, i) => Math.sin((2 * Math.PI * 500 * i) / fs))
    const y = applyFilter({ kind: 'fir', b: h }, x)
    for (let i = 5000; i < 5100; i++) expect(y[i]).toBeCloseTo(x[i]!, 3)
    const hi = Float32Array.from({ length: 20000 }, (_, i) => Math.sin((2 * Math.PI * 9000 * i) / fs))
    const z = applyFilter({ kind: 'fir', b: h }, hi)
    expect(Math.max(...z.slice(5000, 19000).map(Math.abs))).toBeLessThan(1e-3)
  })
})
