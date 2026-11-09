// @ts-expect-error Node built-in types are intentionally excluded from the app TS config.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const readerSource = readFileSync(new URL('./ReaderView.vue', import.meta.url), 'utf8')

function cssRule(source: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`))?.[1] || ''
}

describe('reader viewport layout', () => {
  it('sizes the reader parent and root from the same visual viewport', () => {
    expect(cssRule(appSource, '.app-main.without-header')).toMatch(/height:\s*var\(--app-visual-height,\s*var\(--app-height,\s*100dvh\)\)/)
    expect(cssRule(readerSource, '.reader-view')).toMatch(/height:\s*var\(--app-visual-height,\s*var\(--app-height,\s*100dvh\)\)/)
    expect(cssRule(readerSource, '.reader-view')).not.toMatch(/padding-top:/)
  })

  it('keeps the themed safe-area background outside reader flow', () => {
    expect(readerSource).toMatch(/class="reader-safe-area"[^>]*:style="\{ background: theme\.body \}"/)
    expect(cssRule(readerSource, '.reader-safe-area')).toMatch(/position:\s*absolute/)
    expect(cssRule(readerSource, '.reader-safe-area')).toMatch(/height:\s*var\(--safe-area-top\)/)
    expect(cssRule(readerSource, '.reader-scroll-container')).toMatch(/min-height:\s*0/)
    expect(cssRule(readerSource, '.reader-scroll-container')).toMatch(/padding-top:\s*var\(--safe-area-top\)/)
  })
})
