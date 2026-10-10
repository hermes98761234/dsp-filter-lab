import { useEffect, useRef, useState } from 'react'
import type { Spectrogram } from '../lib/spectrogram.ts'
import { fmtNum, linearTicks } from './plotUtil.ts'

const STOPS: [number, number, number][] = [
  [0, 0, 4],
  [40, 11, 84],
  [101, 21, 110],
  [159, 42, 99],
  [212, 72, 66],
  [245, 125, 21],
  [250, 193, 39],
  [252, 255, 164],
]

const LUT = (() => {
  const out = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * (STOPS.length - 1)
    const k = Math.min(STOPS.length - 2, Math.floor(x))
    const f = x - k
    for (let c = 0; c < 3; c++) out[i * 3 + c] = STOPS[k]![c]! * (1 - f) + STOPS[k + 1]![c]! * f
  }
  return out
})()

interface Props {
  title: string
  sp: Spectrogram | null
  /** Level (dB) mapped to the brightest colour. */
  top: number
  range: number
  /** Playhead position, 0..1. */
  position: number
  themeKey: string
  busy?: boolean
  empty: string
  onSeek?: (frac: number) => void
}

const M = { l: 46, r: 8, t: 6, b: 22 }

export default function SpectrogramView({ title, sp, top, range, position, themeKey, busy, empty, onSeek }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [w, setW] = useState(400)
  const h = 190

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
    const pw = w - M.l - M.r
    const ph = h - M.t - M.b
    g.font = '11px system-ui, sans-serif'
    g.fillStyle = col('--chart-fg')
    if (!sp) {
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(empty, w / 2, h / 2)
      return
    }
    const img = new ImageData(sp.cols, sp.bins)
    for (let c = 0; c < sp.cols; c++) {
      for (let k = 0; k < sp.bins; k++) {
        const v = Math.max(0, Math.min(1, (sp.data[c * sp.bins + k]! - (top - range)) / range))
        const li = Math.round(v * 255) * 3
        const o = ((sp.bins - 1 - k) * sp.cols + c) * 4
        img.data[o] = LUT[li]!
        img.data[o + 1] = LUT[li + 1]!
        img.data[o + 2] = LUT[li + 2]!
        img.data[o + 3] = 255
      }
    }
    const off = document.createElement('canvas')
    off.width = sp.cols
    off.height = sp.bins
    off.getContext('2d')!.putImageData(img, 0, 0)
    g.imageSmoothingEnabled = true
    g.drawImage(off, M.l, M.t, pw, ph)
    g.strokeStyle = col('--grid-strong')
    g.strokeRect(M.l + 0.5, M.t + 0.5, pw, ph)
    g.fillStyle = col('--chart-fg')
    g.textAlign = 'right'
    g.textBaseline = 'middle'
    const nyq = sp.fs / 2
    for (const f of linearTicks(0, nyq, 5)) g.fillText(f >= 1000 ? `${fmtNum(f / 1000)}k` : String(f), M.l - 4, M.t + ph - (f / nyq) * ph)
    g.textAlign = 'center'
    g.textBaseline = 'top'
    for (const s of linearTicks(0, sp.duration, Math.max(3, pw / 90))) g.fillText(`${fmtNum(s)}s`, M.l + (s / sp.duration) * pw, M.t + ph + 4)
    if (position > 0 && position <= 1) {
      g.strokeStyle = '#fff'
      g.lineWidth = 1.5
      const x = M.l + position * pw
      g.beginPath()
      g.moveTo(x, M.t)
      g.lineTo(x, M.t + ph)
      g.stroke()
    }
  }, [sp, top, range, position, themeKey, w, empty])

  return (
    <div className="plot" ref={wrap}>
      <div className="plot-head">
        <span className="plot-title">{title}</span>
        <span className="plot-read">{busy ? '…' : ''}</span>
      </div>
      <canvas
        ref={cv}
        style={{ width: '100%', height: h, display: 'block', cursor: onSeek && sp ? 'pointer' : 'default' }}
        role="img"
        aria-label={title}
        onClick={(e) => {
          if (!onSeek || !sp) return
          const r = e.currentTarget.getBoundingClientRect()
          onSeek(Math.max(0, Math.min(1, (e.clientX - r.left - M.l) / (r.width - M.l - M.r))))
        }}
      />
    </div>
  )
}
