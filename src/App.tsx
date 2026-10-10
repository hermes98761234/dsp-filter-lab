import { useEffect, useMemo, useState } from 'react'
import { LangContext, tr, trNote, type T } from './i18n.ts'
import { loadState, saveState, type AppState } from './state.ts'
import { DEFAULT_SPEC, type Spec } from './lib/design.ts'
import type { Filter } from './lib/filtering.ts'
import { filterOrder, type Analysis } from './lib/response.ts'
import { N } from './lib/note.ts'
import type { Note } from './lib/note.ts'
import type { AnalyzeResult } from './dsp.worker.ts'
import { callDsp } from './useDsp.ts'
import AudioPanel from './components/AudioPanel.tsx'
import DesignPanel from './components/DesignPanel.tsx'
import ExportPanel from './components/ExportPanel.tsx'
import Plot from './components/Plot.tsx'
import PoleZero, { type PZPoint } from './components/PoleZero.tsx'
import { Sel } from './components/Fields.tsx'

const FAMILY_LABEL: Record<Spec['family'], string> = {
  'fir-window': 'FIR window',
  'fir-remez': 'FIR Parks-McClellan',
  'fir-freq': 'FIR frequency sampling',
  iir: 'IIR',
  rbj: 'RBJ EQ',
  manual: 'IIR manual',
}

const hz = (v: number) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toPrecision(3)}k` : String(+v.toPrecision(3)))

/** Robust y-range for curves that may have spikes (group delay). */
function robustRange(values: number[]): [number, number] {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return [0, 1]
  const lo = v[Math.floor(v.length * 0.01)]!
  const hi = v[Math.min(v.length - 1, Math.floor(v.length * 0.99))]!
  const pad = Math.max((hi - lo) * 0.1, 0.5)
  return [lo - pad, hi + pad]
}

function dbRange(db: number[]): [number, number] {
  const fin = db.filter(Number.isFinite)
  const mx = Math.max(...fin)
  const mn = Math.min(...fin)
  const hi = Math.ceil((mx + 3) / 10) * 10
  const lo = Math.max(Math.floor((mn - 3) / 10) * 10, hi - 120)
  return [Math.min(lo, hi - 20), hi]
}

export default function App() {
  const [state, setState] = useState<AppState>(loadState)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const { spec, lang, theme } = state
  const t: T = (s, ...a) => tr(lang, s, ...a)
  const update = (patch: Partial<AppState>) => setState((s) => ({ ...s, ...patch }))
  const setSpec = (sp: Spec) => update({ spec: sp })

  useEffect(() => saveState(state), [state])
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSystemDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'auto') delete root.dataset.theme
    else root.dataset.theme = theme
    root.lang = lang
  }, [theme, lang])
  const dark = theme === 'dark' || (theme === 'auto' && systemDark)
  const themeKey = dark ? 'dark' : 'light'

  // Design + analysis run in the worker; the debounce keeps typing smooth.
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      callDsp({ type: 'analyze', spec })
        .then((r) => live && r.analyze && setResult(r.analyze))
        .catch((e: Error) => live && setResult({ out: { ok: false, error: [N('Design failed: {0}'), e.message] }, analysis: null }))
    }, 70)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [spec])

  const filter: Filter | null = result?.out.ok ? result.out.filter : null
  const a: Analysis | null = result?.analysis ?? null
  const notes: Note[] = result?.out.ok ? result.out.notes : []
  const error: Note | null = result && !result.out.ok ? result.out.error : null

  const copyToManual = () => {
    if (!a || filter?.kind !== 'iir') return
    let id = 1
    const items: Spec['manual'] = []
    for (const [list, kind] of [[a.zeros, 'zero'], [a.poles, 'pole']] as const) {
      const used = new Set<number>()
      list.forEach((z, i) => {
        if (used.has(i)) return
        if (Math.abs(z.im) < 1e-7) items.push({ id: id++, kind, re: z.re, im: 0 })
        else if (z.im > 0) items.push({ id: id++, kind, re: z.re, im: z.im })
      })
    }
    update({ spec: { ...spec, family: 'manual', manual: items } })
  }

  const markers = useMemo(() => {
    if (!['fir-window', 'fir-remez', 'fir-freq', 'iir'].includes(spec.family)) return []
    if (spec.response === 'differentiator' || spec.response === 'hilbert') return []
    const m = [{ x: spec.f1 }]
    if (spec.response === 'bandpass' || spec.response === 'bandstop') m.push({ x: spec.f2 })
    return m
  }, [spec.family, spec.response, spec.f1, spec.f2])

  const plots = useMemo(() => {
    if (!a) return null
    const log = state.freqScale === 'log'
    const xMin = log ? Math.max(10, spec.fs / 2000) : 0
    const xMax = spec.fs / 2
    const db = state.magScale === 'db'
    const [ylo, yhi] = db ? dbRange(a.magDb) : [0, Math.max(...a.mag) * 1.08]
    const [glo, ghi] = robustRange(a.groupDelay)
    // Drop the spikes at transmission zeros so they do not draw vertical lines across the plot.
    const bound = (ghi - glo) * 3 + 2
    const mid = (ghi + glo) / 2
    const gd = a.groupDelay.map((g) => (Math.abs(g - mid) > bound ? NaN : g))
    const n = a.impulse.length
    const idx = Array.from({ length: n }, (_, i) => i)
    return { log, xMin, xMax, db, ylo, yhi, glo, ghi, idx, gd }
  }, [a, state.freqScale, state.magScale, spec.fs])

  const manual = spec.family === 'manual'
  const pzPoints: PZPoint[] = useMemo(() => {
    if (manual) {
      return spec.manual.flatMap((m) => {
        const pts: PZPoint[] = [{ re: m.re, im: m.im, kind: m.kind, id: m.id }]
        if (Math.abs(m.im) > 1e-9) pts.push({ re: m.re, im: -m.im, kind: m.kind })
        return pts
      })
    }
    return a ? [...a.zeros.map((z): PZPoint => ({ re: z.re, im: z.im, kind: 'zero' })), ...a.poles.map((z): PZPoint => ({ re: z.re, im: z.im, kind: 'pole' }))] : []
  }, [manual, spec.manual, a])

  const onDrag = (id: number, re: number, im: number) =>
    setSpec({
      ...spec,
      manual: spec.manual.map((m) => (m.id !== id ? m : m.im === 0 ? { ...m, re: Math.max(-3, Math.min(3, re)) } : { ...m, re: Math.max(-3, Math.min(3, re)), im: Math.max(0.005, Math.min(3, Math.abs(im))) })),
    })

  const summary = (() => {
    if (!filter || !a) return null
    const chips: string[] = []
    if (filter.kind === 'fir') {
      chips.push(t('{0} taps (order {1})', filter.b.length, filter.b.length - 1))
      const gd = (filter.b.length - 1) / 2
      chips.push(t('Group delay {0} samples ({1} ms)', +gd.toFixed(1), +((gd / spec.fs) * 1000).toFixed(2)))
    } else {
      chips.push(t('{0} biquad sections (order {1})', filter.sos.length, filterOrder(filter)))
    }
    return { chips, stable: a.stable }
  })()

  const familyLabel = `${FAMILY_LABEL[spec.family]}${['rbj', 'manual'].includes(spec.family) ? '' : ' ' + spec.response}${spec.family === 'iir' ? ' ' + spec.iirType : ''}`

  return (
    <LangContext.Provider value={lang}>
      <div className="app">
        <header className="toolbar">
          <span className="brand">{t('DSP Filter Lab')}</span>
          <span className="hint">{t('Design FIR and IIR filters, inspect their responses and try them on audio.')}</span>
          <span className="spacer" />
          <label className="inline">
            {t('Language')}
            <select value={lang} onChange={(e) => update({ lang: e.target.value as AppState['lang'] })}>
              <option value="en">English</option>
              <option value="uk">Українська</option>
            </select>
          </label>
          <label className="inline">
            {t('Theme')}
            <select value={theme} onChange={(e) => update({ theme: e.target.value as AppState['theme'] })}>
              <option value="auto">{t('System')}</option>
              <option value="light">{t('Light')}</option>
              <option value="dark">{t('Dark')}</option>
            </select>
          </label>
        </header>
        <div className="body">
          <aside className="side">
            <div className="panel">
              <DesignPanel spec={spec} onChange={setSpec} onCopyToManual={copyToManual} canCopy={filter?.kind === 'iir' && !manual} selected={selected} onSelect={setSelected} />
              <button className="link small" onClick={() => setSpec({ ...DEFAULT_SPEC, family: spec.family, fs: spec.fs })}>
                {t('Reset parameters')}
              </button>
            </div>
          </aside>
          <main className="main">
            <section className="box summary">
              {error && <p className="err-text">{trNote(t, error)}</p>}
              {summary && (
                <div className="chips">
                  {summary.chips.map((c) => (
                    <span className="chip" key={c}>
                      {c}
                    </span>
                  ))}
                  {filter?.kind === 'iir' && <span className={`chip ${summary.stable ? 'ok' : 'bad'}`}>{summary.stable ? t('Stable: all poles inside the unit circle') : t('Unstable: a pole is outside the unit circle')}</span>}
                </div>
              )}
              {notes.map((n, i) => (
                <p className="hint" key={i}>
                  {trNote(t, n)}
                </p>
              ))}
            </section>

            <section className="box">
              <div className="row">
                <h3>{t('Responses')}</h3>
                <span className="spacer" />
                <Sel label={t('Magnitude')} value={state.magScale} options={[['db', 'dB'], ['linear', t('Linear')]]} onChange={(magScale) => update({ magScale })} />
                <Sel label={t('Frequency axis')} value={state.freqScale} options={[['linear', t('Linear')], ['log', t('Logarithmic')]]} onChange={(freqScale) => update({ freqScale })} />
              </div>
              {a && plots && (
                <div className="plots">
                  <Plot
                    title={plots.db ? t('Magnitude (dB)') : t('Magnitude (linear)')}
                    series={[{ x: a.freq, y: plots.db ? a.magDb : a.mag }]}
                    xLabel="Hz"
                    yLabel={plots.db ? 'dB' : '|H|'}
                    logX={plots.log}
                    xMin={plots.xMin}
                    xMax={plots.xMax}
                    yMin={plots.ylo}
                    yMax={plots.yhi}
                    markers={markers}
                    themeKey={themeKey}
                    xFormat={hz}
                  />
                  <Plot title={t('Phase (unwrapped)')} series={[{ x: a.freq, y: a.phase }]} xLabel="Hz" yLabel="rad" logX={plots.log} xMin={plots.xMin} xMax={plots.xMax} themeKey={themeKey} xFormat={hz} />
                  <Plot title={t('Group delay')} series={[{ x: a.freq, y: plots.gd }]} height={330} xLabel="Hz" yLabel={t('samples')} logX={plots.log} xMin={plots.xMin} xMax={plots.xMax} yMin={plots.glo} yMax={plots.ghi} themeKey={themeKey} xFormat={hz} />
                  <PoleZero
                    title={t('Pole-zero plot')}
                    points={pzPoints}
                    themeKey={themeKey}
                    selectedId={selected}
                    onSelect={manual ? setSelected : undefined}
                    onDrag={manual ? onDrag : undefined}
                    label={a.poles.length + a.zeros.length === 0 && !manual ? t('Too many roots to show') : t('x pole, o zero')}
                  />
                  <Plot title={t('Impulse response')} series={[{ x: plots.idx, y: a.impulse }]} xLabel={t('samples')} yLabel="h[n]" stem={a.impulse.length <= 400} themeKey={themeKey} />
                  <Plot title={t('Step response')} series={[{ x: plots.idx, y: a.step }]} xLabel={t('samples')} yLabel="s[n]" stem={a.step.length <= 400} themeKey={themeKey} />
                </div>
              )}
            </section>

            <AudioPanel
              filter={filter}
              stable={a?.stable ?? true}
              designRate={spec.fs}
              onUseRate={(fs) => setState((s) => (s.spec.fs === fs ? s : { ...s, spec: { ...s.spec, fs } }))}
              compensate={state.compensate}
              onCompensate={(compensate) => update({ compensate })}
              wavBits={state.wavBits}
              onWavBits={(wavBits) => update({ wavBits })}
              themeKey={themeKey}
            />

            <ExportPanel
              filter={filter}
              fs={spec.fs}
              label={familyLabel}
              format={state.format}
              onFormat={(format) => update({ format })}
              precision={state.precision}
              onPrecision={(precision) => update({ precision })}
              cmsis={state.cmsis}
              onCmsis={(cmsis) => update({ cmsis })}
              name={state.exportName}
              onName={(exportName) => update({ exportName })}
            />
          </main>
        </div>
        <p className="hint foot">
          {t('Everything runs in your browser; no data leaves your device.')}{' '}
          <a href="https://github.com/hermes98761234/dsp-filter-lab">{t('Source on GitHub')}</a>
        </p>
      </div>
    </LangContext.Provider>
  )
}
