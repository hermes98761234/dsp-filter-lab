import { abs, type C } from './complex.ts'

/**
 * Roots of a real polynomial, coefficients highest degree first (numpy order).
 * Aberth–Ehrlich simultaneous iteration, then a few Newton polish steps.
 */
export function polyRoots(coef: number[]): C[] {
  let start = 0
  while (start < coef.length && coef[start] === 0) start++
  let end = coef.length
  let zeroRoots = 0
  while (end > start && coef[end - 1] === 0) {
    end--
    zeroRoots++
  }
  const a = coef.slice(start, end)
  const n = a.length - 1
  const roots: C[] = []
  if (n >= 1) {
    const lead = a[0]!
    const m = a.map((x) => x / lead)
    // Initial guesses on a circle with the geometric-mean radius.
    const r0 = Math.max(Math.abs(m[n]!), 1e-12) ** (1 / n)
    const z: C[] = []
    for (let i = 0; i < n; i++) {
      const th = (2 * Math.PI * i) / n + 0.4
      z.push({ re: r0 * Math.cos(th), im: r0 * Math.sin(th) })
    }
    const evalP = (x: C): [C, C] => {
      let pr = m[0]!
      let pi = 0
      let dr = 0
      let di = 0
      for (let k = 1; k <= n; k++) {
        const ndr = dr * x.re - di * x.im + pr
        const ndi = dr * x.im + di * x.re + pi
        dr = ndr
        di = ndi
        const npr = pr * x.re - pi * x.im + m[k]!
        const npi = pr * x.im + pi * x.re
        pr = npr
        pi = npi
      }
      return [
        { re: pr, im: pi },
        { re: dr, im: di },
      ]
    }
    for (let it = 0; it < 500; it++) {
      let maxStep = 0
      for (let i = 0; i < n; i++) {
        const [p, dp] = evalP(z[i]!)
        const dpm = dp.re * dp.re + dp.im * dp.im
        if (dpm === 0) {
          z[i] = { re: z[i]!.re + 1e-6, im: z[i]!.im + 1e-6 }
          maxStep = 1
          continue
        }
        // ratio = p / dp
        const rr = (p.re * dp.re + p.im * dp.im) / dpm
        const ri = (p.im * dp.re - p.re * dp.im) / dpm
        let sr = 0
        let si = 0
        for (let j = 0; j < n; j++) {
          if (j === i) continue
          const dx = z[i]!.re - z[j]!.re
          const dy = z[i]!.im - z[j]!.im
          const dm = dx * dx + dy * dy || 1e-300
          sr += dx / dm
          si += -dy / dm
        }
        // w = ratio / (1 - ratio * s)
        const tr = 1 - (rr * sr - ri * si)
        const ti = -(rr * si + ri * sr)
        const tm = tr * tr + ti * ti || 1e-300
        const wr = (rr * tr + ri * ti) / tm
        const wi = (ri * tr - rr * ti) / tm
        z[i] = { re: z[i]!.re - wr, im: z[i]!.im - wi }
        maxStep = Math.max(maxStep, Math.hypot(wr, wi) / (1 + abs(z[i]!)))
      }
      if (maxStep < 1e-15) break
    }
    roots.push(...z)
  }
  for (let i = 0; i < zeroRoots; i++) roots.push({ re: 0, im: 0 })
  return roots
}

/** Real coefficients (highest degree first, monic) of the polynomial with the given conjugate-closed roots. */
export function polyFromRoots(roots: C[]): number[] {
  let re = [1]
  let im = [0]
  for (const r of roots) {
    const nre = new Array<number>(re.length + 1).fill(0)
    const nim = new Array<number>(im.length + 1).fill(0)
    for (let i = 0; i < re.length; i++) {
      nre[i]! += re[i]!
      nim[i]! += im[i]!
      // multiply by -r
      nre[i + 1]! += -(re[i]! * r.re - im[i]! * r.im)
      nim[i + 1]! += -(re[i]! * r.im + im[i]! * r.re)
    }
    re = nre
    im = nim
  }
  return re
}
