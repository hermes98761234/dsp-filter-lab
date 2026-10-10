/** Complete and incomplete elliptic integrals and Jacobi elliptic functions (parameter m = k^2). */

/** Complete elliptic integral of the first kind K(m), via the arithmetic–geometric mean. */
export function ellipk(m: number): number {
  if (m >= 1) return Infinity
  let a = 1
  let b = Math.sqrt(1 - m)
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-16 * a; i++) {
    const t = (a + b) / 2
    b = Math.sqrt(a * b)
    a = t
  }
  return Math.PI / (2 * a)
}

/** K(1 - m), accurate also for tiny m. */
export function ellipkm1(m: number): number {
  let a = 1
  let b = Math.sqrt(m)
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-16 * a; i++) {
    const t = (a + b) / 2
    b = Math.sqrt(a * b)
    a = t
  }
  return Math.PI / (2 * a)
}

/** Carlson's symmetric integral R_F. */
function carlsonRF(x: number, y: number, z: number): number {
  for (let i = 0; i < 60; i++) {
    const lam = Math.sqrt(x * y) + Math.sqrt(y * z) + Math.sqrt(z * x)
    x = (x + lam) / 4
    y = (y + lam) / 4
    z = (z + lam) / 4
    const mu = (x + y + z) / 3
    const dx = 1 - x / mu
    const dy = 1 - y / mu
    const dz = 1 - z / mu
    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < 1e-9) {
      const e2 = dx * dy - dz * dz
      const e3 = dx * dy * dz
      return (1 - e2 / 10 + e3 / 14 + (e2 * e2) / 24 - (3 * e2 * e3) / 44) / Math.sqrt(mu)
    }
  }
  return NaN
}

/** Incomplete elliptic integral of the first kind F(phi | m), 0 <= phi <= pi/2. */
export function ellipF(phi: number, m: number): number {
  const s = Math.sin(phi)
  const c = Math.cos(phi)
  return s * carlsonRF(c * c, 1 - m * s * s, 1)
}

/** Jacobi elliptic functions sn, cn, dn for real u and parameter 0 <= m <= 1. */
export function ellipj(u: number, m: number): { sn: number; cn: number; dn: number } {
  if (m < 1e-9) {
    const t = Math.sin(u)
    const b = Math.cos(u)
    const ai = 0.25 * m * (u - t * b)
    return { sn: t - ai * b, cn: b + ai * t, dn: 1 - 0.5 * m * t * t }
  }
  if (m >= 1 - 1e-10) {
    const ai = 0.25 * (1 - m)
    const b = Math.cosh(u)
    const t = Math.tanh(u)
    const phi = 1 / b
    const twon = b * Math.sinh(u)
    const sn = t + (ai * (twon - u)) / (b * b)
    const aj = ai * t * phi
    return { sn, cn: phi - aj * (twon - u), dn: phi + aj * (twon + u) }
  }
  const a: number[] = [1]
  const cc: number[] = [Math.sqrt(m)]
  let b = Math.sqrt(1 - m)
  let twon = 1
  let i = 0
  while (Math.abs(cc[i]! / a[i]!) > 1e-16 && i < 12) {
    const ai = a[i]!
    i++
    cc.push((ai - b) / 2)
    const t = Math.sqrt(ai * b)
    a.push((ai + b) / 2)
    b = t
    twon *= 2
  }
  let phi = twon * a[i]! * u
  let prev = phi
  while (i > 0) {
    const t = (cc[i]! * Math.sin(phi)) / a[i]!
    prev = phi
    phi = (Math.asin(t) + phi) / 2
    i--
  }
  const cn = Math.cos(phi)
  return { sn: Math.sin(phi), cn, dn: cn / Math.cos(phi - prev) }
}
