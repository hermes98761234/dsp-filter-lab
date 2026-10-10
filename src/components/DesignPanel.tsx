import { useT } from '../i18n.ts'
import { N } from '../lib/note.ts'
import type { Family, Spec } from '../lib/design.ts'
import type { FirResponse } from '../lib/fir.ts'
import type { IirType } from '../lib/iir.ts'
import { RBJ_TYPES, rbjUsesGain, type RbjBand, type RbjType } from '../lib/rbj.ts'
import { WINDOWS, type WindowName } from '../lib/window.ts'
import { Check, Num, Sel } from './Fields.tsx'

const FAMILIES: [Family, string][] = [
  ['fir-window', N('FIR: window / Kaiser')],
  ['fir-remez', N('FIR: Parks-McClellan equiripple')],
  ['fir-freq', N('FIR: frequency sampling')],
  ['iir', N('IIR: Butterworth, Chebyshev, elliptic, Bessel')],
  ['rbj', N('Audio EQ biquads (RBJ cookbook)')],
  ['manual', N('Manual poles and zeros')],
]
const RESPONSES: [FirResponse, string][] = [
  ['lowpass', N('Lowpass')],
  ['highpass', N('Highpass')],
  ['bandpass', N('Bandpass')],
  ['bandstop', N('Bandstop')],
  ['differentiator', N('Differentiator')],
  ['hilbert', N('Hilbert transformer')],
]
const IIR_TYPES: [IirType, string][] = [
  ['butter', N('Butterworth')],
  ['cheby1', N('Chebyshev I')],
  ['cheby2', N('Chebyshev II')],
  ['ellip', N('Elliptic (Cauer)')],
  ['bessel', N('Bessel')],
]
const RBJ_LABEL: Record<RbjType, string> = {
  peaking: N('Peaking'),
  lowShelf: N('Low shelf'),
  highShelf: N('High shelf'),
  notch: N('Notch'),
  lowpass: N('Lowpass'),
  highpass: N('Highpass'),
  bandpass: N('Bandpass'),
  allpass: N('Allpass'),
}
const WIN_LABEL: Record<WindowName, string> = {
  rectangular: N('Rectangular'),
  bartlett: N('Bartlett'),
  hann: N('Hann'),
  hamming: N('Hamming'),
  blackman: N('Blackman'),
  'blackman-harris': N('Blackman-Harris'),
  nuttall: N('Nuttall'),
  kaiser: N('Kaiser'),
}

interface Props {
  spec: Spec
  onChange: (s: Spec) => void
  onCopyToManual: () => void
  canCopy: boolean
  selected: number | null
  onSelect: (id: number | null) => void
}

export default function DesignPanel({ spec, onChange, onCopyToManual, canCopy, selected, onSelect }: Props) {
  const t = useT()
  const set = (patch: Partial<Spec>) => onChange({ ...spec, ...patch })
  const bandOnly = spec.family === 'iir' || spec.family === 'fir-freq'
  const isBand = ['lowpass', 'highpass', 'bandpass', 'bandstop'].includes(spec.response)
  const two = spec.response === 'bandpass' || spec.response === 'bandstop'
  const nyq = spec.fs / 2

  const setFamily = (family: Family) => {
    const patch: Partial<Spec> = { family }
    if ((family === 'iir' || family === 'fir-freq') && !['lowpass', 'highpass', 'bandpass', 'bandstop'].includes(spec.response)) patch.response = 'lowpass'
    if (family === 'fir-remez' && !isBand) {
      patch.auto = false
    }
    onChange({ ...spec, ...patch })
  }

  const setResponse = (response: FirResponse) => {
    const patch: Partial<Spec> = { response }
    const band = ['lowpass', 'highpass', 'bandpass', 'bandstop'].includes(response)
    if (!band) {
      patch.auto = false
      if (spec.family === 'fir-remez') {
        patch.f1 = Math.round(nyq * 0.02)
        patch.f2 = Math.round(nyq * 0.96)
        patch.taps = response === 'hilbert' ? 63 : 32
      }
    }
    onChange({ ...spec, ...patch })
  }

  const edgeLabels = (): [string, string] => {
    if (spec.family === 'iir') {
      const hint =
        spec.fromSpec && spec.iirType !== 'bessel'
          ? N('Passband edge')
          : spec.iirType === 'butter' || spec.iirType === 'bessel'
            ? N('Cutoff, -3 dB')
            : spec.iirType === 'cheby2'
              ? N('Stopband edge')
              : N('Passband edge')
      if (two) return [`${t(hint)} ${t('low')}`, `${t(hint)} ${t('high')}`]
      return [t(hint), '']
    }
    if (spec.response === 'differentiator' || spec.response === 'hilbert') return [t('Band start'), t('Band end')]
    if (two) return [t('Lower cutoff'), t('Upper cutoff')]
    return [t('Cutoff'), '']
  }
  const [l1, l2] = edgeLabels()
  const showEdges = isBand || (spec.family === 'fir-remez' && !isBand)

  return (
    <div className="design">
      <Sel label={t('Method')} value={spec.family} options={FAMILIES.map(([v, l]) => [v, t(l)])} onChange={setFamily} />
      <div className="grid2">
        <Num label={t('Sample rate')} unit="Hz" value={spec.fs} min={1000} max={768000} onChange={(fs) => set({ fs })} />
        {spec.family !== 'rbj' && spec.family !== 'manual' && (
          <Sel label={t('Response')} value={spec.response} options={RESPONSES.filter(([v]) => !bandOnly || ['lowpass', 'highpass', 'bandpass', 'bandstop'].includes(v)).map(([v, l]) => [v, t(l)])} onChange={setResponse} />
        )}
      </div>

      {spec.family !== 'rbj' && spec.family !== 'manual' && (
        <>
          {showEdges && (
            <div className="grid2">
              <Num label={l1} unit="Hz" value={spec.f1} onChange={(f1) => set({ f1 })} />
              {(two || (spec.family === 'fir-remez' && !isBand)) && <Num label={l2} unit="Hz" value={spec.f2} onChange={(f2) => set({ f2 })} />}
            </div>
          )}
        </>
      )}

      {spec.family === 'fir-window' && (
        <>
          {isBand && <Check label={t('Kaiser: derive length and beta from attenuation and transition width')} checked={spec.auto} onChange={(auto) => set({ auto })} />}
          {spec.auto && isBand ? (
            <div className="grid2">
              <Num label={t('Stopband attenuation')} unit="dB" value={spec.atten} onChange={(atten) => set({ atten })} />
              <Num label={t('Transition width')} unit="Hz" value={spec.transition} onChange={(transition) => set({ transition })} />
            </div>
          ) : (
            <div className="grid2">
              <Sel label={t('Window')} value={spec.window} options={WINDOWS.map((w) => [w, t(WIN_LABEL[w])])} onChange={(window) => set({ window })} />
              <Num label={t('Taps')} value={spec.taps} step={1} min={3} max={4001} onChange={(taps) => set({ taps: Math.round(taps) })} />
              {spec.window === 'kaiser' && <Num label="Kaiser β" value={spec.beta} onChange={(beta) => set({ beta })} />}
            </div>
          )}
        </>
      )}

      {spec.family === 'fir-remez' && (
        <>
          {isBand && (
            <>
              <Check label={t('Choose the shortest length that meets the specification')} checked={spec.auto} onChange={(auto) => set({ auto })} />
              <div className="grid2">
                <Num label={t('Transition width')} unit="Hz" value={spec.transition} onChange={(transition) => set({ transition })} />
                <Num label={t('Passband ripple')} unit="dB" value={spec.ripple} onChange={(ripple) => set({ ripple })} />
                <Num label={t('Stopband attenuation')} unit="dB" value={spec.atten} onChange={(atten) => set({ atten })} />
              </div>
            </>
          )}
          {!(spec.auto && isBand) && <Num label={t('Taps')} value={spec.taps} step={1} min={5} max={1001} onChange={(taps) => set({ taps: Math.round(taps) })} />}
        </>
      )}

      {spec.family === 'fir-freq' && (
        <div className="grid2">
          <Num label={t('Taps')} value={spec.taps} step={1} min={3} max={4001} onChange={(taps) => set({ taps: Math.round(taps) })} />
          <Num label={t('Transition sample')} value={spec.transValue} step={0.05} min={0} max={1} onChange={(transValue) => set({ transValue })} />
        </div>
      )}

      {spec.family === 'iir' && (
        <>
          <Sel label={t('Approximation')} value={spec.iirType} options={IIR_TYPES.map(([v, l]) => [v, t(l)])} onChange={(iirType) => set({ iirType, fromSpec: iirType === 'bessel' ? false : spec.fromSpec })} />
          {spec.iirType !== 'bessel' && <Check label={t('Pick the minimum order from the stopband edges')} checked={spec.fromSpec} onChange={(fromSpec) => set({ fromSpec })} />}
          {spec.fromSpec && spec.iirType !== 'bessel' && (
            <div className="grid2">
              <Num label={two ? `${t('Stopband edge')} ${t('low')}` : t('Stopband edge')} unit="Hz" value={spec.s1} onChange={(s1) => set({ s1 })} />
              {two && <Num label={`${t('Stopband edge')} ${t('high')}`} unit="Hz" value={spec.s2} onChange={(s2) => set({ s2 })} />}
            </div>
          )}
          <div className="grid2">
            {!spec.fromSpec && <Num label={two ? t('Order (per band edge)') : t('Order')} value={spec.order} step={1} min={1} max={30} onChange={(order) => set({ order: Math.round(order) })} />}
            {(spec.fromSpec || spec.iirType === 'cheby1' || spec.iirType === 'ellip') && <Num label={spec.iirType === 'butter' ? t('Passband loss') : t('Passband ripple')} unit="dB" value={spec.rp} onChange={(rp) => set({ rp })} />}
            {(spec.fromSpec || spec.iirType === 'cheby2' || spec.iirType === 'ellip') && <Num label={t('Stopband attenuation')} unit="dB" value={spec.rs} onChange={(rs) => set({ rs })} />}
          </div>
        </>
      )}

      {spec.family === 'rbj' && (
        <div>
          {spec.rbj.map((b, i) => {
            const upd = (patch: Partial<RbjBand>) => set({ rbj: spec.rbj.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
            return (
              <div className="card" key={i}>
                <div className="row">
                  <Sel label={t('Type')} value={b.type} options={RBJ_TYPES.map((v) => [v, t(RBJ_LABEL[v])])} onChange={(type) => upd({ type })} />
                  <span className="spacer" />
                  <button className="small danger" onClick={() => set({ rbj: spec.rbj.filter((_, j) => j !== i) })} aria-label={t('Remove')}>
                    {t('Remove')}
                  </button>
                </div>
                <div className="grid3">
                  <Num label={t('Frequency')} unit="Hz" value={b.f0} onChange={(f0) => upd({ f0 })} />
                  <Num label="Q" value={b.q} onChange={(q) => upd({ q })} />
                  {rbjUsesGain(b.type) && <Num label={t('Gain')} unit="dB" value={b.gainDb} onChange={(gainDb) => upd({ gainDb })} />}
                </div>
              </div>
            )
          })}
          <button disabled={spec.rbj.length >= 12} onClick={() => set({ rbj: [...spec.rbj, { type: 'peaking', f0: 2000, q: 1, gainDb: 3 }] })}>
            {t('Add band')}
          </button>
        </div>
      )}

      {spec.family === 'manual' && (
        <div>
          <p className="hint">{t('Drag poles (x) and zeros (o) in the z-plane plot. Complex items move together with their conjugate; items on the real axis stay real.')}</p>
          <div className="row">
            <button onClick={() => addItem('pole', true)}>{t('Add pole pair')}</button>
            <button onClick={() => addItem('zero', true)}>{t('Add zero pair')}</button>
            <button onClick={() => addItem('pole', false)}>{t('Add real pole')}</button>
            <button onClick={() => addItem('zero', false)}>{t('Add real zero')}</button>
          </div>
          <div className="row">
            <button className="danger" disabled={selected === null} onClick={() => { set({ manual: spec.manual.filter((m) => m.id !== selected) }); onSelect(null) }}>
              {t('Delete selected')}
            </button>
            <button disabled={!canCopy} onClick={onCopyToManual} title={t('Load the poles and zeros of the current IIR design')}>
              {t('Start from current design')}
            </button>
          </div>
        </div>
      )}
    </div>
  )

  function addItem(kind: 'pole' | 'zero', pair: boolean) {
    const id = Math.max(0, ...spec.manual.map((m) => m.id)) + 1
    const re = kind === 'pole' ? 0.4 : -0.3
    set({ manual: [...spec.manual, { id, kind, re: pair ? re : kind === 'pole' ? 0.5 : -1, im: pair ? 0.5 : 0 }] })
    onSelect(id)
  }
}
