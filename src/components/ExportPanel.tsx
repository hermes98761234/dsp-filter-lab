import { useMemo, useState } from 'react'
import { useT } from '../i18n.ts'
import { N } from '../lib/note.ts'
import { EXPORT_FORMATS, exportFilter, sanitizeName, toFixed, type ExportFormat } from '../lib/export.ts'
import type { Filter } from '../lib/filtering.ts'
import { Check, Sel } from './Fields.tsx'

const FORMAT_LABEL: Record<ExportFormat, string> = {
  c: N('C array'),
  python: N('Python (scipy)'),
  csv: N('CSV'),
  q15: N('Q15 fixed-point (C)'),
  q31: N('Q31 fixed-point (C)'),
}
const EXT: Record<ExportFormat, string> = { c: 'h', python: 'py', csv: 'csv', q15: 'h', q31: 'h' }

interface Props {
  filter: Filter | null
  fs: number
  label: string
  format: ExportFormat
  onFormat: (f: ExportFormat) => void
  precision: 'float' | 'double'
  onPrecision: (p: 'float' | 'double') => void
  cmsis: boolean
  onCmsis: (v: boolean) => void
  name: string
  onName: (s: string) => void
}

export default function ExportPanel({ filter, fs, label, format, onFormat, precision, onPrecision, cmsis, onCmsis, name, onName }: Props) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const text = useMemo(() => (filter ? exportFilter(filter, format, { name, fs, precision, cmsis, label }) : ''), [filter, format, name, fs, precision, cmsis, label])
  const fixed = useMemo(() => (filter && (format === 'q15' || format === 'q31') ? toFixed(filter, format === 'q15' ? 15 : 31) : null), [filter, format])
  const fixedFormat = format === 'q15' || format === 'q31'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked; the text stays selectable
    }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${sanitizeName(name)}.${EXT[format]}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  return (
    <section className="box">
      <h3>{t('Export coefficients')}</h3>
      <div className="row">
        <Sel label={t('Format')} value={format} options={EXPORT_FORMATS.map((f) => [f, t(FORMAT_LABEL[f])])} onChange={onFormat} />
        {format === 'c' && <Sel label={t('Precision')} value={precision} options={[['float', 'float'], ['double', 'double']]} onChange={onPrecision} />}
        {fixedFormat && <Check label={t('CMSIS-DSP layout')} checked={cmsis} onChange={onCmsis} />}
        <label className="field">
          <span>{t('Name')}</span>
          <input value={name} onChange={(e) => onName(e.target.value)} spellCheck={false} />
        </label>
      </div>
      {fixed && (
        <p className="hint">
          {t('Block exponent: {0} bit(s). Largest coefficient error: {1}.', fixed.shift, fixed.maxError.toExponential(2))}
        </p>
      )}
      <textarea className="code" readOnly value={text} rows={12} spellCheck={false} aria-label={t('Exported coefficients')} />
      <div className="row">
        <button onClick={() => void copy()} disabled={!filter}>
          {copied ? t('Copied') : t('Copy')}
        </button>
        <button onClick={download} disabled={!filter}>
          {t('Download')}
        </button>
      </div>
    </section>
  )
}
