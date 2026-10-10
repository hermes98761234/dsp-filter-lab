import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tr, UK } from './i18n.ts'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : []
  })
}

/** Every string literal passed to t('...') or marked with N('...') in the source. */
function used(): Set<string> {
  const out = new Set<string>()
  const re = /\b(?:t|N)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
  for (const file of sources(join(import.meta.dirname, '.'))) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(re)) out.add(m[2]!.replace(/\\'/g, "'"))
  }
  return out
}

const placeholders = (s: string) => [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort()

describe('i18n', () => {
  it('translates every string used in the UI', () => {
    const missing = [...used()].filter((s) => !(s in UK))
    expect(missing).toEqual([])
  })
  it('has no stale or empty entries and keeps placeholders', () => {
    const u = used()
    for (const [en, uk] of Object.entries(UK)) {
      expect(uk.trim(), en).not.toBe('')
      expect(placeholders(uk), en).toEqual(placeholders(en))
      expect(u.has(en), `unused key: ${en}`).toBe(true)
    }
  })
  it('interpolates placeholders', () => {
    expect(tr('en', '{0} taps (order {1})', 5, 4)).toBe('5 taps (order 4)')
    expect(tr('uk', 'Theme')).toBe(UK['Theme']!)
    expect(tr('uk', 'untranslated {0}', 1)).toBe('untranslated 1')
  })
})
