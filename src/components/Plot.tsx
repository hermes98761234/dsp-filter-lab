import { useEffect, useRef, useState } from 'react'
import { fmtNum, fmtTick, linearTicks, logTicks } from './plotUtil.ts'

export interface Series {
  x: ArrayLike<number>
  y: ArrayLike<number>
  color?: string
  label?: string
  dashed?: boolean
}

export interface Marker {
  x: number
  label?: string
}

interface Props {
  title: string
  series: Series[]
  xLabel: string
  yLabel: string
  logX?: boolean
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
  /** Draw as lollipops (discrete-time signals). */
  stem?: boolean
  markers?: Marker[]
  height?: number
  /** Changes whenever the colour theme changes so the canvas redraws. */
  themeKey: string
  xFormat?: (v: number) => string
  yFormat?: (v: number) => string
}

const M = { l: 54, r: 12, t: 10, b: 32 }

function finiteRange(series: Series[], key: 'x' | 'y'): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const s of series) {
    const a = s[key]
    for (let i = 0; i < a.length; i++) {
      const v = a[i]!
      if (Number.isFinite(v)) {
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    }
  }
  return lo <= hi ? [lo, hi] : [0, 1]
}

export default function Plot(p: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 400, h: p.height ?? 220 })
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: Math.max(200, el.clientWidth), h: p.height ?? 220 }))
    ro.observe(el)
    setSize({ w: Math.max(200, el.clientWidth), h: p.height ?? 220 })
    return () => ro.disconnect()
  }, [p.height])

  // Data -> pixel mapping (shared by drawing and hover readout).
  const [dx0, dx1] = finiteRange(p.series, 'x')
  const [dy0, dy1] = finiteRange(p.series, 'y')
  let x0 = p.xMin ?? dx0
  let x1 = p.xMax ?? dx1
  if (p.logX) x0 = Math.max(x0, x1 / 1e4, 1e-9)
  if (x1 <= x0) x1 = x0 + 1
  let y0 = p.yMin ?? dy0
  let y1 = p.yMax ?? dy1
  if (p.yMin === undefined || p.yMax === undefined) {
    const pad = (y1 - y0) * 0.08 || 1
    if (p.yMin === undefined) y0 -= pad
    if (p.yMax === undefined) y1 += pad
  }
  if (y1 <= y0) y1 = y0 + 1
  const pw = size.w - M.l - M.r
  const ph = size.h - M.t - M.b
  const toX = (v: number) => M.l + (p.logX ? (Math.log(v / x0) / Math.log(x1 / x0)) * pw : ((v - x0) / (x1 - x0)) * pw)
  const toY = (v: number) => M.t + ph - ((v - y0) / (y1 - y0)) * ph
  const fromX = (px: number) => (p.logX ? x0 * (x1 / x0) ** ((px - M.l) / pw) : x0 + ((px - M.l) / pw) * (x1 - x0))

  useEffect(() => {
    const canvas = cv.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    const g = canvas.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const css = getComputedStyle(canvas)
    const col = (n: string) => css.getPropertyValue(n).trim()
    g.fillStyle = col('--chart-bg')
    g.fillRect(0, 0, size.w, size.h)
    g.font = '11px system-ui, sans-serif'
    g.textBaseline = 'middle'
    const xt = p.logX ? logTicks(x0, x1) : linearTicks(x0, x1, Math.max(3, pw / 80))
    const yt = linearTicks(y0, y1, Math.max(3, ph / 36))
    g.lineWidth = 1
    g.strokeStyle = col('--grid')
    g.beginPath()
    for (const v of xt) {
      const px = Math.round(toX(v)) + 0.5
      g.moveTo(px, M.t)
      g.lineTo(px, M.t + ph)
    }
    for (const v of yt) {
      const py = Math.round(toY(v)) + 0.5
      g.moveTo(M.l, py)
      g.lineTo(M.l + pw, py)
    }
    g.stroke()
    g.strokeStyle = col('--grid-strong')
    g.strokeRect(M.l + 0.5, M.t + 0.5, pw, ph)
    g.fillStyle = col('--chart-fg')
    g.textAlign = 'center'
    g.textBaseline = 'top'
    const xf = p.xFormat ?? fmtNum
    const ystep = yt.length > 1 ? yt[1]! - yt[0]! : 1
    const yf = p.yFormat ?? ((v: number) => fmtTick(v, ystep))
    for (const v of xt) g.fillText(xf(v), toX(v), M.t + ph + 4)
    g.textAlign = 'right'
    g.textBaseline = 'middle'
    for (const v of yt) g.fillText(yf(v), M.l - 5, toY(v))
    g.textAlign = 'right'
    g.textBaseline = 'bottom'
    g.fillText(p.xLabel, size.w - M.r, size.h - 1)
    g.save()
    g.translate(11, M.t + ph / 2)
    g.rotate(-Math.PI / 2)
    g.textAlign = 'center'
    g.textBaseline = 'top'
    g.fillText(p.yLabel, 0, -4)
    g.restore()

    g.save()
    g.beginPath()
    g.rect(M.l, M.t, pw, ph)
    g.clip()
    for (const m of p.markers ?? []) {
      if (m.x < x0 || m.x > x1) continue
      g.strokeStyle = col('--ref-line')
      g.setLineDash([4, 3])
      g.beginPath()
      g.moveTo(Math.round(toX(m.x)) + 0.5, M.t)
      g.lineTo(Math.round(toX(m.x)) + 0.5, M.t + ph)
      g.stroke()
    }
    g.setLineDash([])
    p.series.forEach((s, si) => {
      const color = s.color ?? (si === 0 ? col('--accent') : col('--warn'))
      g.strokeStyle = color
      g.fillStyle = color
      g.lineWidth = 1.6
      g.setLineDash(s.dashed ? [5, 3] : [])
      if (p.stem) {
        const zero = toY(Math.min(Math.max(0, y0), y1))
        g.lineWidth = 1
        g.beginPath()
        for (let i = 0; i < s.x.length; i++) {
          const px = toX(s.x[i]!)
          g.moveTo(px, zero)
          g.lineTo(px, toY(s.y[i]!))
        }
        g.stroke()
        if (s.x.length <= 200) {
          for (let i = 0; i < s.x.length; i++) {
            g.beginPath()
            g.arc(toX(s.x[i]!), toY(s.y[i]!), 2.2, 0, 2 * Math.PI)
            g.fill()
          }
        }
      } else {
        g.beginPath()
        let pen = false
        for (let i = 0; i < s.x.length; i++) {
          const xv = s.x[i]!
          const yv = s.y[i]!
          if (!Number.isFinite(yv) || (p.logX && xv <= 0)) {
            pen = false
            continue
          }
          const px = toX(xv)
          const py = toY(yv)
          if (pen) g.lineTo(px, py)
          else g.moveTo(px, py)
          pen = true
        }
        g.stroke()
      }
    })
    g.setLineDash([])
    if (hover) {
      g.strokeStyle = col('--muted')
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(Math.round(hover.px) + 0.5, M.t)
      g.lineTo(Math.round(hover.px) + 0.5, M.t + ph)
      g.stroke()
    }
    g.restore()
  }, [p.series, p.themeKey, size, hover, x0, x1, y0, y1, p.logX, p.stem, p.markers, p.xLabel, p.yLabel])

  // Readout for the series point nearest to the pointer.
  let readout = ''
  if (hover && p.series[0]) {
    const xv = fromX(hover.px)
    const s = p.series[0]
    let best = 0
    let bd = Infinity
    for (let i = 0; i < s.x.length; i++) {
      const d = Math.abs(s.x[i]! - xv)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    const yv = s.y[best]!
    readout = `${(p.xFormat ?? fmtNum)(+s.x[best]!.toPrecision(4))}, ${Number.isFinite(yv) ? +yv.toPrecision(4) : '—'}`
  }

  return (
    <div className="plot" ref={wrap}>
      <div className="plot-head">
        <span className="plot-title">{p.title}</span>
        <span className="plot-read">{readout}</span>
      </div>
      <canvas
        ref={cv}
        style={{ width: '100%', height: size.h, display: 'block', touchAction: 'pan-y' }}
        role="img"
        aria-label={p.title}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const px = e.clientX - r.left
          setHover(px >= M.l && px <= M.l + pw ? { px, py: e.clientY - r.top } : null)
        }}
        onPointerLeave={() => setHover(null)}
      />
    </div>
  )
}
