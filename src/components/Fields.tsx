import { useEffect, useState, type ReactNode } from 'react'

interface NumProps {
  label: ReactNode
  value: number
  onChange: (v: number) => void
  unit?: string
  step?: number | 'any'
  min?: number
  max?: number
}

/** Number input that keeps what you type until it parses, so partial entries such as "0." are not rewritten. */
export function Num({ label, value, onChange, unit, step = 'any', min, max }: NumProps) {
  const [txt, setTxt] = useState(String(value))
  useEffect(() => {
    setTxt((cur) => (parseFloat(cur) === value ? cur : String(value)))
  }, [value])
  return (
    <label className="field">
      <span>
        {label}
        {unit ? ` (${unit})` : ''}
      </span>
      <input
        type="number"
        inputMode="decimal"
        value={txt}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          setTxt(e.target.value)
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
      />
    </label>
  )
}

interface SelProps<T extends string> {
  label: ReactNode
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}

export function Sel<T extends string>({ label, value, options, onChange }: SelProps<T>) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Check({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}
