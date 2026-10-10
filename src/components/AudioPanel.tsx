import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../i18n.ts'
import type { Filter } from '../lib/filtering.ts'
import { demoSignal, type Spectrogram } from '../lib/spectrogram.ts'
import { encodeWav } from '../lib/wav.ts'
import { callDsp } from '../useDsp.ts'
import { Check, Sel } from './Fields.tsx'
import SpectrogramView from './SpectrogramView.tsx'

interface Props {
  filter: Filter | null
  stable: boolean
  designRate: number
  onUseRate: (rate: number) => void
  compensate: boolean
  onCompensate: (v: boolean) => void
  wavBits: 16 | 32
  onWavBits: (b: 16 | 32) => void
  themeKey: string
}

interface Source {
  name: string
  channels: Float32Array[]
  rate: number
}

const mono = (chs: Float32Array[]): Float32Array => {
  if (chs.length === 1) return chs[0]!.slice()
  const out = new Float32Array(chs[0]!.length)
  for (const c of chs) for (let i = 0; i < out.length; i++) out[i]! += c[i]! / chs.length
  return out
}

export default function AudioPanel({ filter, stable, designRate, onUseRate, compensate, onCompensate, wavBits, onWavBits, themeKey }: Props) {
  const t = useT()
  const [src, setSrc] = useState<Source | null>(null)
  const [filtered, setFiltered] = useState<Float32Array[] | null>(null)
  const [spA, setSpA] = useState<Spectrogram | null>(null)
  const [spB, setSpB] = useState<Spectrogram | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [ab, setAb] = useState<'a' | 'b'>('b')
  const [pos, setPos] = useState(0)
  const ctxRef = useRef<AudioContext | null>(null)
  const nodes = useRef<{ ga: GainNode; gb: GainNode; sources: AudioBufferSourceNode[] } | null>(null)
  const startedAt = useRef(0)
  const posRef = useRef(0)
  const playingRef = useRef(false)
  const duration = src ? src.channels[0]!.length / src.rate : 0

  const getCtx = () => (ctxRef.current ??= new AudioContext())

  const stopNodes = useCallback(() => {
    const n = nodes.current
    nodes.current = null
    if (n) {
      for (const s of n.sources) {
        s.onended = null
        try {
          s.stop()
        } catch {
          // already stopped
        }
        s.disconnect()
      }
      n.ga.disconnect()
      n.gb.disconnect()
    }
  }, [])

  const stop = useCallback(() => {
    stopNodes()
    playingRef.current = false
    setPlaying(false)
  }, [stopNodes])

  useEffect(() => () => {
    stopNodes()
    void ctxRef.current?.close()
    ctxRef.current = null
  }, [stopNodes])

  const toBuffer = (ctx: AudioContext, chs: Float32Array[], rate: number) => {
    const b = ctx.createBuffer(chs.length, chs[0]!.length, rate)
    chs.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i))
    return b
  }

  const play = useCallback(
    async (offset: number, abNow: 'a' | 'b') => {
      if (!src) return
      const ctx = getCtx()
      if (ctx.state === 'suspended') await ctx.resume()
      stopNodes()
      const ga = ctx.createGain()
      const gb = ctx.createGain()
      ga.gain.value = abNow === 'a' ? 1 : 0
      gb.gain.value = abNow === 'b' ? 1 : 0
      ga.connect(ctx.destination)
      gb.connect(ctx.destination)
      const sources: AudioBufferSourceNode[] = []
      const mk = (chs: Float32Array[], g: GainNode) => {
        const s = ctx.createBufferSource()
        s.buffer = toBuffer(ctx, chs, src.rate)
        s.connect(g)
        sources.push(s)
        return s
      }
      const a = mk(src.channels, ga)
      const b = filtered ? mk(filtered, gb) : null
      const off = Math.max(0, Math.min(offset, duration - 0.01))
      const when = ctx.currentTime + 0.02
      a.start(when, off)
      b?.start(when, off)
      a.onended = () => {
        if (nodes.current?.sources[0] === a) {
          nodes.current = null
          playingRef.current = false
          setPlaying(false)
          posRef.current = 0
          setPos(0)
        }
      }
      startedAt.current = when - off
      nodes.current = { ga, gb, sources }
      playingRef.current = true
      setPlaying(true)
    },
    [src, filtered, duration, stopNodes],
  )

  // Playhead.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const ctx = ctxRef.current
      if (ctx && playingRef.current) {
        posRef.current = Math.max(0, ctx.currentTime - startedAt.current)
        setPos(posRef.current)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // A/B switch without restarting playback.
  useEffect(() => {
    const n = nodes.current
    const ctx = ctxRef.current
    if (!n || !ctx) return
    n.ga.gain.setTargetAtTime(ab === 'a' ? 1 : 0, ctx.currentTime, 0.005)
    n.gb.gain.setTargetAtTime(ab === 'b' ? 1 : 0, ctx.currentTime, 0.005)
  }, [ab])

  // New filtered audio while playing: continue from the same position.
  const abRef = useRef(ab)
  useEffect(() => {
    abRef.current = ab
  }, [ab])
  useEffect(() => {
    if (playingRef.current) void play(posRef.current, abRef.current)
  }, [filtered, play])

  // Spectrogram of the original.
  useEffect(() => {
    setSpA(null)
    if (!src) return
    let live = true
    const data = mono(src.channels)
    callDsp({ type: 'spectrogram', data, fs: src.rate }, [data.buffer])
      .then((r) => live && setSpA(r.spectrogram ?? null))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [src])

  // Filter the audio whenever the filter or the source changes.
  useEffect(() => {
    if (!src || !filter || !stable) {
      setFiltered(null)
      setSpB(null)
      return
    }
    let live = true
    setBusy(true)
    const timer = setTimeout(() => {
      const chs = src.channels.map((c) => c.slice())
      callDsp({ type: 'process', filter, channels: chs, compensate }, chs.map((c) => c.buffer))
        .then(async (r) => {
          if (!live || !r.channels) return
          const out = r.channels
          const m = mono(out)
          const sp = await callDsp({ type: 'spectrogram', data: m, fs: src.rate }, [m.buffer])
          if (!live) return
          setFiltered(out)
          setSpB(sp.spectrogram ?? null)
          setBusy(false)
        })
        .catch((e: Error) => {
          if (live) {
            setError(e.message)
            setBusy(false)
          }
        })
    }, 150)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [src, filter, stable, compensate])

  const load = async (file: File | undefined) => {
    if (!file) return
    setError('')
    stop()
    try {
      const ab = await file.arrayBuffer()
      const buf = await getCtx().decodeAudioData(ab)
      const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => Float32Array.from(buf.getChannelData(i)))
      setFiltered(null)
      setSpB(null)
      posRef.current = 0
      setPos(0)
      setSrc({ name: file.name, channels, rate: buf.sampleRate })
      onUseRate(buf.sampleRate)
    } catch {
      setError(t('Could not decode this audio file.'))
    }
  }

  const loadDemo = () => {
    stop()
    setError('')
    const rate = designRate >= 8000 && designRate <= 96000 ? designRate : 48000
    setFiltered(null)
    setSpB(null)
    posRef.current = 0
    setPos(0)
    setSrc({ name: 'demo', channels: [demoSignal(rate)], rate })
    onUseRate(rate)
  }

  const download = () => {
    if (!filtered || !src) return
    const wav = encodeWav(filtered, src.rate, wavBits)
    const url = URL.createObjectURL(new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${src.name.replace(/\.[^.]+$/, '')}-filtered.wav`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const top = useMemo(() => {
    if (!spA) return 0
    let m = -200
    for (let i = 0; i < spA.data.length; i++) if (spA.data[i]! > m) m = spA.data[i]!
    return m
  }, [spA])

  return (
    <section className="box">
      <h3>{t('Audio')}</h3>
      <div className="row">
        <label className="filebtn">
          <input type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a" onChange={(e) => void load(e.target.files?.[0])} />
          <span className="button">{t('Load audio file')}</span>
        </label>
        <button onClick={loadDemo}>{t('Use demo signal')}</button>
        {src && (
          <span className="hint">
            {src.name}: {src.channels.length} ch, {src.rate} Hz, {duration.toFixed(1)} s
          </span>
        )}
      </div>
      <p className="hint">{t('Files are decoded and filtered in your browser; nothing is uploaded.')}</p>
      {error && <p className="err-text">{error}</p>}
      {!stable && <p className="err-text">{t('The filter is unstable, so audio processing is disabled.')}</p>}
      {src && src.rate !== designRate && (
        <p className="warn-text">
          {t('The design sample rate ({0} Hz) differs from the audio ({1} Hz).', designRate, src.rate)}{' '}
          <button className="small" onClick={() => onUseRate(src.rate)}>
            {t('Use the audio rate')}
          </button>
        </p>
      )}
      {src && (
        <>
          <div className="row">
            <button onClick={() => (playing ? stop() : void play(posRef.current, ab))} disabled={!src}>
              {playing ? t('Stop') : t('Play')}
            </button>
            <div className="seg" role="group" aria-label={t('A/B comparison')}>
              <button className={ab === 'a' ? 'on' : ''} onClick={() => setAb('a')} aria-pressed={ab === 'a'}>
                A: {t('Original')}
              </button>
              <button className={ab === 'b' ? 'on' : ''} onClick={() => setAb('b')} aria-pressed={ab === 'b'} disabled={!filtered}>
                B: {t('Filtered')}
              </button>
            </div>
            <input
              type="range"
              className="seek"
              min={0}
              max={Math.max(duration, 0.01)}
              step={0.01}
              value={Math.min(pos, duration)}
              aria-label={t('Position')}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                posRef.current = v
                setPos(v)
                if (playingRef.current) void play(v, ab)
              }}
            />
            <span className="hint mono">
              {pos.toFixed(1)} / {duration.toFixed(1)} s
            </span>
          </div>
          <div className="row">
            <Check label={t('Compensate the delay of linear-phase FIR filters')} checked={compensate} onChange={onCompensate} />
          </div>
          <div className="specs">
            <SpectrogramView title={t('Spectrogram: original')} sp={spA} top={top} range={90} position={duration ? pos / duration : 0} themeKey={themeKey} empty={t('Computing…')} onSeek={(f) => { const v = f * duration; posRef.current = v; setPos(v); if (playingRef.current) void play(v, ab) }} />
            <SpectrogramView title={t('Spectrogram: filtered')} sp={spB} top={top} range={90} position={duration ? pos / duration : 0} themeKey={themeKey} busy={busy} empty={t('Computing…')} />
          </div>
          <div className="row">
            <Sel label={t('WAV format')} value={String(wavBits) as '16' | '32'} options={[['16', t('16-bit PCM')], ['32', t('32-bit float')]]} onChange={(v) => onWavBits(v === '32' ? 32 : 16)} />
            <button onClick={download} disabled={!filtered}>
              {t('Export filtered WAV')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
