function niceStep(range: number, target: number): number {
  const raw = range / target
  const p = 10 ** Math.floor(Math.log10(raw))
  const f = raw / p
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p
}

export function linearTicks(lo: number, hi: number, target: number): number[] {
  if (!(hi > lo)) return [lo]
  const step = niceStep(hi - lo, target)
  const out: number[] = []
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}

export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = []
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e
      if (v >= lo * 0.9999 && v <= hi * 1.0001) out.push(v)
    }
  }
  return out
}

export function fmtNum(v: number): string {
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e4) return `${+(v / 1000).toPrecision(3)}k`
  if (a >= 100) return String(Math.round(v))
  if (a >= 1) return String(+v.toPrecision(3))
  if (a >= 0.001) return String(+v.toPrecision(2))
  return v.toExponential(0)
}


/** Format a tick label with just enough decimals for the tick spacing. */
export function fmtTick(v: number, step: number): string {
  if (v === 0) return '0'
  if (Math.abs(v) >= 1e4) return fmtNum(v)
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  return dec > 0 ? v.toFixed(Math.min(dec, 6)) : String(Math.round(v))
}
