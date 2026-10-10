import { abs, add, c, conj, div, inv, mul, neg, prod, scale, sqrt, sub, type C } from './complex.ts'
import { polyRoots } from './poly.ts'
import { ellipF, ellipj, ellipk, ellipkm1 } from './special.ts'

/** Second-order sections, scipy layout: rows [b0, b1, b2, 1, a1, a2]. */
export type Sos = number[][]

export interface Zpk {
  z: C[]
  p: C[]
  k: number
}

export type IirType = 'butter' | 'cheby1' | 'cheby2' | 'ellip' | 'bessel'
export type BandType = 'lowpass' | 'highpass' | 'bandpass' | 'bandstop'

const range = (from: number, to: number, step: number): number[] => {
  const r: number[] = []
  for (let x = from; step > 0 ? x < to : x > to; x += step) r.push(x)
  return r
}

const realProd = (list: C[]): number => prod(list).re

// ---------------------------------------------------------------- analog lowpass prototypes (cutoff 1 rad/s)

export function butterap(n: number): Zpk {
  const p = range(-n + 1, n, 2).map((m) => c(-Math.cos((Math.PI * m) / (2 * n)), -Math.sin((Math.PI * m) / (2 * n))))
  return { z: [], p, k: 1 }
}

/** Chebyshev type I: passband edge at 1 rad/s with `rp` dB ripple. */
export function cheb1ap(n: number, rp: number): Zpk {
  const eps = Math.sqrt(10 ** (0.1 * rp) - 1)
  const mu = Math.asinh(1 / eps) / n
  const p = range(-n + 1, n, 2).map((m) => {
    const th = (Math.PI * m) / (2 * n)
    // -sinh(mu + j th)
    return c(-Math.sinh(mu) * Math.cos(th), -Math.cosh(mu) * Math.sin(th))
  })
  let k = realProd(p.map(neg))
  if (n % 2 === 0) k /= Math.sqrt(1 + eps * eps)
  return { z: [], p, k }
}

/** Chebyshev type II: stopband edge at 1 rad/s with `rs` dB attenuation. */
export function cheb2ap(n: number, rs: number): Zpk {
  const de = 1 / Math.sqrt(10 ** (0.1 * rs) - 1)
  const mu = Math.asinh(1 / de) / n
  const ms = range(-n + 1, n, 2)
  const z: C[] = ms
    .filter((m) => !(n % 2 === 1 && m === 0))
    .map((m) => {
      // -conj(j / sin(m pi / 2n)) = j / sin(...)
      const s = Math.sin((Math.PI * m) / (2 * n))
      return c(0, 1 / s)
    })
  const p = ms.map((m) => {
    const th = (Math.PI * m) / (2 * n)
    const q = c(-Math.sinh(mu) * Math.cos(th), -Math.cosh(mu) * Math.sin(th))
    return inv(q)
  })
  const k = realProd(p.map(neg)) / realProd(z.map(neg))
  return { z, p, k }
}

function ellipdeg(n: number, m1: number): number {
  const k1 = ellipk(m1)
  const k1p = ellipkm1(m1)
  const q1 = Math.exp((-Math.PI * k1p) / k1)
  const q = q1 ** (1 / n)
  let num = 0
  for (let m = 0; m <= 7; m++) num += q ** (m * (m + 1))
  let den = 1
  for (let m = 1; m <= 8; m++) den += 2 * q ** (m * m)
  return 16 * q * (num / den) ** 4
}

/** Elliptic (Cauer): passband edge at 1 rad/s, `rp` dB ripple, `rs` dB stopband attenuation. */
export function ellipap(n: number, rp: number, rs: number): Zpk {
  const eps = Math.sqrt(10 ** (0.1 * rp) - 1)
  if (n === 1) {
    const p = -Math.sqrt(1 / (10 ** (0.1 * rp) - 1))
    return { z: [], p: [c(p)], k: -p }
  }
  const epsSt = Math.sqrt(10 ** (0.1 * rs) - 1)
  const m1 = (eps / epsSt) ** 2
  const m = ellipdeg(n, m1)
  const capk = ellipk(m)
  const js = range(1 - (n % 2), n, 2)
  const sj = js.map((j) => ellipj((j * capk) / n, m))
  const zHalf: C[] = sj.filter((e) => Math.abs(e.sn) > 2e-16).map((e) => c(0, 1 / (Math.sqrt(m) * e.sn)))
  const z = [...zHalf, ...zHalf.map(conj)]
  // sc(u | 1 - m1) = 1/eps (imaginary-modulus transformation of the inverse sn)
  const r = ellipF(Math.atan(1 / eps), 1 - m1)
  const v0 = (capk * r) / (n * ellipk(m1))
  const v = ellipj(v0, 1 - m)
  let p: C[] = sj.map((e) => {
    const den = 1 - (e.dn * v.sn) ** 2
    return c(-(e.cn * e.dn * v.sn * v.cn) / den, -(e.sn * v.dn) / den)
  })
  if (n % 2 === 1) {
    const norm = Math.sqrt(p.reduce((s, x) => s + x.re * x.re + x.im * x.im, 0))
    const extra = p.filter((x) => Math.abs(x.im) > 2e-16 * norm).map(conj)
    p = [...p, ...extra]
  } else {
    p = [...p, ...p.map(conj)]
  }
  let k = realProd(p.map(neg)) / realProd(z.map(neg))
  if (n % 2 === 0) k /= Math.sqrt(1 + eps * eps)
  return { z, p, k }
}

/** Bessel–Thomson prototype normalised to a -3 dB magnitude cutoff of 1 rad/s. */
export function besselap(n: number): Zpk {
  // Reverse Bessel polynomial coefficients, highest degree first.
  const fact = (x: number) => {
    let r = 1
    for (let i = 2; i <= x; i++) r *= i
    return r
  }
  const coef: number[] = []
  for (let k = n; k >= 0; k--) coef.push(fact(2 * n - k) / (fact(n - k) * fact(k) * 2 ** (n - k)))
  const p0 = polyRoots(coef)
  const gain0 = coef[n]!
  const mag = (a: number): number => {
    // |H(j)| with poles scaled by a: H = gain0 * a^n / prod(s - a p)
    let m = gain0 * a ** n
    for (const q of p0) m /= Math.hypot(-a * q.re, 1 - a * q.im)
    return m
  }
  let lo = 1e-3
  let hi = 1e3
  for (let i = 0; i < 100; i++) {
    const mid = Math.sqrt(lo * hi)
    if (mag(mid) < Math.SQRT1_2) lo = mid
    else hi = mid
  }
  const a = Math.sqrt(lo * hi)
  const p = p0.map((q) => scale(q, a))
  return { z: [], p, k: realProd(p.map(neg)) }
}

export function prototype(type: IirType, n: number, rp: number, rs: number): Zpk {
  switch (type) {
    case 'butter':
      return butterap(n)
    case 'cheby1':
      return cheb1ap(n, rp)
    case 'cheby2':
      return cheb2ap(n, rs)
    case 'ellip':
      return ellipap(n, rp, rs)
    case 'bessel':
      return besselap(n)
  }
}

// ---------------------------------------------------------------- analog frequency transformations

export function lp2lp({ z, p, k }: Zpk, wo: number): Zpk {
  const deg = p.length - z.length
  return { z: z.map((x) => scale(x, wo)), p: p.map((x) => scale(x, wo)), k: k * wo ** deg }
}

export function lp2hp({ z, p, k }: Zpk, wo: number): Zpk {
  const deg = p.length - z.length
  const zh = z.map((x) => div(c(wo), x))
  const ph = p.map((x) => div(c(wo), x))
  for (let i = 0; i < deg; i++) zh.push(c(0))
  return { z: zh, p: ph, k: k * (realProd(z.map(neg)) / realProd(p.map(neg))) }
}

function splitQuad(x: C, wo: number): C[] {
  const d = sqrt(sub(mul(x, x), c(wo * wo)))
  return [add(x, d), sub(x, d)]
}

export function lp2bp({ z, p, k }: Zpk, wo: number, bw: number): Zpk {
  const deg = p.length - z.length
  const zl = z.map((x) => scale(x, bw / 2))
  const pl = p.map((x) => scale(x, bw / 2))
  const zb = zl.flatMap((x) => splitQuad(x, wo))
  const pb = pl.flatMap((x) => splitQuad(x, wo))
  for (let i = 0; i < deg; i++) zb.push(c(0))
  return { z: zb, p: pb, k: k * bw ** deg }
}

export function lp2bs({ z, p, k }: Zpk, wo: number, bw: number): Zpk {
  const deg = p.length - z.length
  const zh = z.map((x) => div(c(bw / 2), x))
  const ph = p.map((x) => div(c(bw / 2), x))
  const zb = zh.flatMap((x) => splitQuad(x, wo))
  const pb = ph.flatMap((x) => splitQuad(x, wo))
  for (let i = 0; i < deg; i++) zb.push(c(0, wo), c(0, -wo))
  return { z: zb, p: pb, k: k * (realProd(z.map(neg)) / realProd(p.map(neg))) }
}

/** Bilinear transform s = (z - 1)/(z + 1) (sample-rate scaling already folded into the warped frequencies). */
export function bilinear({ z, p, k }: Zpk): Zpk {
  const deg = p.length - z.length
  const map = (x: C) => div(add(c(1), x), sub(c(1), x))
  const zz = z.map(map)
  for (let i = 0; i < deg; i++) zz.push(c(-1))
  const gain = realProd(z.map((x) => sub(c(1), x))) / realProd(p.map((x) => sub(c(1), x)))
  return { z: zz, p: p.map(map), k: k * gain }
}

// ---------------------------------------------------------------- zpk -> second-order sections

interface Split {
  pairs: C[] // upper-half-plane member of each conjugate pair
  reals: number[]
}

function splitRoots(roots: C[]): Split {
  const pairs: C[] = []
  const reals: number[] = []
  for (const r of roots) {
    const tol = 1e-8 * (1 + abs(r))
    if (Math.abs(r.im) <= tol) reals.push(r.re)
    else if (r.im > 0) pairs.push(r)
  }
  return { pairs, reals }
}

export function zpk2sos(zr: C[], pr: C[], k: number): Sos {
  const zs = splitRoots(zr)
  const ps = splitRoots(pr)
  interface Sec {
    den: [number, number]
    radius: number
    at: C
    kind: 'pair' | 'real'
  }
  const secs: Sec[] = ps.pairs.map((q) => ({ den: [-2 * q.re, q.re * q.re + q.im * q.im], radius: abs(q), at: q, kind: 'pair' }))
  const rr = [...ps.reals].sort((a, b) => Math.abs(b) - Math.abs(a))
  for (let i = 0; i < rr.length; i += 2) {
    const a = rr[i]!
    const b = rr[i + 1]
    if (b === undefined) secs.push({ den: [-a, 0], radius: Math.abs(a), at: c(a), kind: 'real' })
    else secs.push({ den: [-(a + b), a * b], radius: Math.max(Math.abs(a), Math.abs(b)), at: c((a + b) / 2), kind: 'real' })
  }
  // Highest-Q (closest to the unit circle) sections first get their pick of zeros, then run low-Q first.
  secs.sort((a, b) => b.radius - a.radius)
  const zPairs = [...zs.pairs]
  const zReals = [...zs.reals]
  const nearest = <T,>(list: T[], at: C, pos: (x: T) => C): number => {
    let best = -1
    let bd = Infinity
    list.forEach((x, i) => {
      const d = abs(sub(pos(x), at))
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return best
  }
  const numFor: Array<[number, number, number]> = []
  for (const s of secs) {
    let num: [number, number, number] = [1, 0, 0]
    const takePair = () => {
      const i = nearest(zPairs, s.at, (x) => x)
      const q = zPairs.splice(i, 1)[0]!
      return [1, -2 * q.re, q.re * q.re + q.im * q.im] as [number, number, number]
    }
    const takeReals = () => {
      const picked: number[] = []
      for (let j = 0; j < 2 && zReals.length; j++) {
        const i = nearest(zReals, s.at, (x) => c(x))
        picked.push(zReals.splice(i, 1)[0]!)
      }
      if (picked.length === 2) return [1, -(picked[0]! + picked[1]!), picked[0]! * picked[1]!] as [number, number, number]
      return [1, -picked[0]!, 0] as [number, number, number]
    }
    if (s.kind === 'pair' && zPairs.length) num = takePair()
    else if (zReals.length) num = takeReals()
    else if (zPairs.length) num = takePair()
    numFor.push(num)
  }
  const sos: Sos = secs.map((s, i) => [...numFor[i]!, 1, s.den[0], s.den[1]])
  sos.reverse()
  if (sos.length === 0) sos.push([k, 0, 0, 1, 0, 0])
  else for (let j = 0; j < 3; j++) sos[0]![j]! *= k
  return sos
}

// ---------------------------------------------------------------- design entry points

const warp = (f: number, fs: number) => Math.tan((Math.PI * f) / fs)

function transformAndSample(proto: Zpk, band: BandType, w1: number, w2: number): Sos {
  let a: Zpk
  switch (band) {
    case 'lowpass':
      a = lp2lp(proto, w1)
      break
    case 'highpass':
      a = lp2hp(proto, w1)
      break
    case 'bandpass':
      a = lp2bp(proto, Math.sqrt(w1 * w2), w2 - w1)
      break
    case 'bandstop':
      a = lp2bs(proto, Math.sqrt(w1 * w2), w2 - w1)
      break
  }
  const d = bilinear(a)
  return zpk2sos(d.z, d.p, d.k)
}

/**
 * Classic IIR design of a given order, scipy `iirfilter` conventions:
 * Butterworth/Bessel: -3 dB edge; Chebyshev I/elliptic: passband edge; Chebyshev II: stopband edge.
 * For bandpass/bandstop the prototype order is `order`, so the filter has 2*order poles.
 */
export function designIir(type: IirType, band: BandType, order: number, f1: number, f2: number, rp: number, rs: number, fs: number): Sos {
  const proto = prototype(type, order, rp, rs)
  return transformAndSample(proto, band, warp(f1, fs), warp(f2, fs))
}

const dbRatio = (a: number) => 10 ** (a / 10) - 1

/** Normalised selectivity (stopband edge / passband edge of the equivalent lowpass). */
export function selectivity(band: BandType, wp: number[], ws: number[]): number {
  switch (band) {
    case 'lowpass':
      return ws[0]! / wp[0]!
    case 'highpass':
      return wp[0]! / ws[0]!
    case 'bandpass': {
      const w0 = wp[0]! * wp[1]!
      const bw = wp[1]! - wp[0]!
      return Math.min(...ws.map((w) => Math.abs((w * w - w0) / (bw * w))))
    }
    case 'bandstop': {
      const w0 = wp[0]! * wp[1]!
      const bw = wp[1]! - wp[0]!
      return Math.min(...ws.map((w) => Math.abs((w * bw) / (w0 - w * w))))
    }
  }
}

/** Smallest prototype order meeting the spec (Butterworth, Chebyshev, elliptic). Edges in Hz. */
export function iirOrder(type: Exclude<IirType, 'bessel'>, band: BandType, fp: number[], fstop: number[], ap: number, as: number, fs: number): number {
  const nat = selectivity(band, fp.map((f) => warp(f, fs)), fstop.map((f) => warp(f, fs)))
  const ratio = dbRatio(as) / dbRatio(ap)
  let n: number
  if (type === 'butter') n = Math.log(ratio) / (2 * Math.log(nat))
  else if (type === 'ellip') {
    const k = 1 / nat
    const k1 = Math.sqrt(1 / ratio)
    n = (ellipk(k * k) * ellipkm1(k1 * k1)) / (ellipkm1(k * k) * ellipk(k1 * k1))
  } else n = Math.acosh(Math.sqrt(ratio)) / Math.acosh(nat)
  return Math.max(1, Math.ceil(n - 1e-9))
}

/**
 * Design from edge specification: passband edges `fp` (ripple at most `ap` dB) and stopband edges `fstop`
 * (at least `as` dB). Picks the minimum order and returns the SOS.
 */
export function designIirFromSpec(type: Exclude<IirType, 'bessel'>, band: BandType, fp: number[], fstop: number[], ap: number, as: number, fs: number): { sos: Sos; order: number } {
  const order = iirOrder(type, band, fp, fstop, ap, as, fs)
  const wp = fp.map((f) => warp(f, fs))
  const ws = fstop.map((f) => warp(f, fs))
  const nat = selectivity(band, wp, ws)
  let proto = prototype(type, order, ap, as)
  if (type === 'butter') proto = lp2lp(proto, dbRatio(ap) ** (-1 / (2 * order)))
  else if (type === 'cheby2') proto = lp2lp(proto, nat)
  return { sos: transformAndSample(proto, band, wp[0]!, wp[1] ?? wp[0]!), order }
}
