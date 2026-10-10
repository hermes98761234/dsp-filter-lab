import { useEffect, useRef, useState } from 'react'

export interface PZPoint {
  re: number
  im: number
  kind: 'pole' | 'zero'
  /** Draggable points carry the id of the manual item they belong to. */
  id?: number
}

interface Props {
  title: string
  points: PZPoint[]
  themeKey: string
  selectedId?: number | null
  onSelect?: (id: number | null) => void
  onDrag?: (id: number, re: number, im: number) => void
  label: string
}

export default function PoleZero(p: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [w, setW] = useState(360)
  const drag = useRef<number | null>(null)
  const maxR = Math.max(1.25, ...p.points.map((q) => Math.hypot(q.re, q.im) * 1.1))
  const R = Math.min(maxR, 4)
  const h = Math.min(w, 330)
  const scale = (Math.min(w, h) - 40) / (2 * R)
  const cx = w / 2
  const cy = h / 2

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(200, el.clientWidth)))
    ro.observe(el)
    setW(Math.max(200, el.clientWidth))
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = cv.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const g = canvas.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const css = getComputedStyle(canvas)
    const col = (n: string) => css.getPropertyValue(n).trim()
    g.fillStyle = col('--chart-bg')
    g.fillRect(0, 0, w, h)
    g.strokeStyle = col('--grid')
    g.lineWidth = 1
    g.beginPath()
    for (let v = Math.ceil(-R); v <= R; v++) {
      g.moveTo(cx + v * scale + 0.5, 0)
      g.lineTo(cx + v * scale + 0.5, h)
      g.moveTo(0, cy + v * scale + 0.5)
      g.lineTo(w, cy + v * scale + 0.5)
    }
    g.stroke()
    g.strokeStyle = col('--grid-strong')
    g.beginPath()
    g.moveTo(0, cy + 0.5)
    g.lineTo(w, cy + 0.5)
    g.moveTo(cx + 0.5, 0)
    g.lineTo(cx + 0.5, h)
    g.stroke()
    g.strokeStyle = col('--chart-fg')
    g.lineWidth = 1.5
    g.beginPath()
    g.arc(cx, cy, scale, 0, 2 * Math.PI)
    g.stroke()
    g.font = '11px system-ui, sans-serif'
    g.fillStyle = col('--chart-fg')
    g.textAlign = 'left'
    g.textBaseline = 'top'
    g.fillText('Re', w - 18, cy + 4)
    g.fillText('Im', cx + 4, 2)
    g.fillText('1', cx + scale + 3, cy + 4)
    g.fillText('-1', cx - scale - 14, cy + 4)

    // Count coincident points for a multiplicity label.
    const groups = new Map<string, { pt: PZPoint; n: number }>()
    for (const q of p.points) {
      const key = `${q.kind}:${q.re.toFixed(3)}:${q.im.toFixed(3)}`
      const e = groups.get(key)
      if (e) e.n++
      else groups.set(key, { pt: q, n: 1 })
    }
    for (const { pt, n } of groups.values()) {
      const x = cx + pt.re * scale
      const y = cy - pt.im * scale
      const unstable = pt.kind === 'pole' && Math.hypot(pt.re, pt.im) >= 1 - 1e-9
      const sel = pt.id !== undefined && pt.id === p.selectedId
      g.strokeStyle = unstable ? col('--err') : pt.kind === 'pole' ? col('--accent') : col('--ok')
      g.lineWidth = sel ? 3 : 2
      g.beginPath()
      if (pt.kind === 'zero') g.arc(x, y, 5, 0, 2 * Math.PI)
      else {
        g.moveTo(x - 5, y - 5)
        g.lineTo(x + 5, y + 5)
        g.moveTo(x + 5, y - 5)
        g.lineTo(x - 5, y + 5)
      }
      g.stroke()
      if (n > 1) {
        g.fillStyle = col('--fg')
        g.textAlign = 'left'
        g.textBaseline = 'bottom'
        g.fillText(String(n), x + 6, y - 5)
      }
    }
  }, [p.points, p.themeKey, p.selectedId, w, h, R, scale, cx, cy])

  const pos = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect()
    return { re: (e.clientX - r.left - cx) / scale, im: -(e.clientY - r.top - cy) / scale }
  }

  return (
    <div className="plot" ref={wrap}>
      <div className="plot-head">
        <span className="plot-title">{p.title}</span>
        <span className="plot-read">{p.label}</span>
      </div>
      <canvas
        ref={cv}
        style={{ width: '100%', height: h, display: 'block', touchAction: p.onDrag ? 'none' : 'pan-y', cursor: p.onDrag ? 'crosshair' : 'default' }}
        role="img"
        aria-label={p.title}
        onPointerDown={(e) => {
          if (!p.onDrag) return
          const q = pos(e)
          let best: number | null = null
          let bd = 14 / scale
          for (const pt of p.points) {
            if (pt.id === undefined) continue
            // Complex items also have a mirrored (id-less) twin; compare against the upper-half representative.
            const d = Math.hypot(pt.re - q.re, pt.im - q.im)
            if (d < bd) {
              bd = d
              best = pt.id
            }
          }
          drag.current = best
          p.onSelect?.(best)
          if (best !== null) e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return
          const q = pos(e)
          p.onDrag?.(drag.current, q.re, q.im)
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
    </div>
  )
}
