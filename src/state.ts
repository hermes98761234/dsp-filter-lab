import { DEFAULT_SPEC, type Spec } from './lib/design.ts'
import type { ExportFormat } from './lib/export.ts'

export type Lang = 'en' | 'uk'
export type Theme = 'auto' | 'light' | 'dark'

export interface AppState {
  spec: Spec
  lang: Lang
  theme: Theme
  magScale: 'db' | 'linear'
  freqScale: 'linear' | 'log'
  format: ExportFormat
  precision: 'float' | 'double'
  cmsis: boolean
  exportName: string
  wavBits: 16 | 32
  compensate: boolean
}

const KEY = 'dsp-filter-lab:v1'

export function defaultLang(): Lang {
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('uk') ? 'uk' : 'en'
}

export const DEFAULT_STATE: AppState = {
  spec: DEFAULT_SPEC,
  lang: 'en',
  theme: 'auto',
  magScale: 'db',
  freqScale: 'linear',
  format: 'c',
  precision: 'float',
  cmsis: false,
  exportName: 'filter',
  wavBits: 16,
  compensate: true,
}

export function loadState(): AppState {
  const base = { ...DEFAULT_STATE, lang: defaultLang() }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return base
    const s = JSON.parse(raw) as Partial<AppState>
    return { ...base, ...s, spec: { ...DEFAULT_SPEC, ...(s.spec ?? {}) } }
  } catch {
    return base
  }
}

export function saveState(s: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // storage may be unavailable (private mode); settings just won't persist
  }
}
