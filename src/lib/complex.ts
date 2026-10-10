/** Minimal complex arithmetic on plain objects. */
export interface C {
  re: number
  im: number
}

export const c = (re: number, im = 0): C => ({ re, im })
export const add = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im })
export const sub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im })
export const mul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re })
export const scale = (a: C, s: number): C => ({ re: a.re * s, im: a.im * s })
export const conj = (a: C): C => ({ re: a.re, im: -a.im })
export const abs = (a: C): number => Math.hypot(a.re, a.im)
export const arg = (a: C): number => Math.atan2(a.im, a.re)
export const neg = (a: C): C => ({ re: -a.re, im: -a.im })

export function div(a: C, b: C): C {
  const d = b.re * b.re + b.im * b.im
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}

export function inv(a: C): C {
  return div({ re: 1, im: 0 }, a)
}

/** Principal square root. */
export function sqrt(a: C): C {
  const m = abs(a)
  if (m === 0) return { re: 0, im: 0 }
  const re = Math.sqrt((m + a.re) / 2)
  const im = Math.sqrt(Math.max(0, (m - a.re) / 2))
  return { re, im: a.im < 0 ? -im : im }
}

export function expj(theta: number): C {
  return { re: Math.cos(theta), im: Math.sin(theta) }
}

export function cexp(a: C): C {
  const e = Math.exp(a.re)
  return { re: e * Math.cos(a.im), im: e * Math.sin(a.im) }
}

/** Product of a list of complex numbers. */
export function prod(list: C[]): C {
  let r: C = { re: 1, im: 0 }
  for (const x of list) r = mul(r, x)
  return r
}
