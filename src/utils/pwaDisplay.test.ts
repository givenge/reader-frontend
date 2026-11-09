import { beforeEach, describe, expect, it, vi } from 'vitest'

const statusBarMeta = 'apple-mobile-web-app-status-bar-style'

function createStyleDeclaration() {
  const values = new Map<string, string>()
  return {
    getPropertyValue: (name: string) => values.get(name) || '',
    setProperty: (name: string, value: string) => values.set(name, value),
  }
}

/** Minimal meta-tag stand-ins so applySystemTheme can run in a plain node test. */
function createDocumentMock() {
  const metas = new Map<string, Record<string, unknown>>()
  const created: string[] = []
  const resolvedKey = (element: Record<string, unknown>) => `${String(element.name)}|${String(element.media || '')}`
  const head = {
    appendChild: (element: Record<string, unknown>) => {
      metas.set(resolvedKey(element), element)
      created.push(String(element.name))
      return element
    },
    replaceChild: (element: Record<string, unknown>, previous: Record<string, unknown>) => {
      metas.delete(resolvedKey(previous))
      metas.set(resolvedKey(element), element)
      created.push(String(element.name))
      return previous
    },
  }
  const documentMock: Record<string, unknown> = {
    documentElement: { style: createStyleDeclaration(), setAttribute: vi.fn() },
    body: { style: createStyleDeclaration() },
    head,
    getElementById: () => null,
    createElement: () => {
      const element: Record<string, unknown> = { name: '', media: '', content: '' }
      element.setAttribute = (key: string, value: string) => { element[key] = value }
      Object.defineProperty(element, 'parentNode', { get: () => metas.get(resolvedKey(element)) ? head : null })
      return element
    },
    querySelector: (selector: string) => {
      const match = selector.match(/meta\[name="([^"]+)"\](?:\[media="([^"]*)"\])?/)
      if (!match) return null
      return metas.get(`${match[1]}|${match[2] || ''}`) || null
    },
  }
  return {
    documentMock,
    created,
    metaContent: (name: string, media = '') => (metas.get(`${name}|${media}`) as { content?: string } | undefined)?.content,
    hasMeta: (name: string, media = '') => metas.has(`${name}|${media}`),
  }
}

describe('system theme status bar handling', () => {
  it('never rewrites the iOS status bar style when the reading theme changes', async () => {
    const { documentMock, created, hasMeta, metaContent } = createDocumentMock()
    vi.stubGlobal('document', documentMock)
    vi.stubGlobal('window', { matchMedia: vi.fn(() => ({ matches: false })) })
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback())

    const { applySystemTheme } = await import('./systemUi')
    applySystemTheme('dark', '#141414')

    // The immersive value from index.html survives; nothing writes 'default' back.
    expect(created).not.toContain(statusBarMeta)
    expect(hasMeta(statusBarMeta)).toBe(false)
    expect(metaContent(statusBarMeta)).not.toBe('default')
  })
})

describe('PWA fullscreen capability detection', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the shipped manifest in a display mode that hides the system status bar', async () => {
    const raw = (await import('../../public/site.webmanifest?raw')).default
    const manifest = JSON.parse(raw)
    expect(manifest.display_override?.[0]).toBe('fullscreen')
    expect(manifest.display).toBe('standalone')
  })

  it('never claims fullscreen capability on iPhone, even when a request method exists', async () => {
    const { canRequestFullscreenDisplay, isIosWebkit } = await import('./pwaDisplay')
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 })
    vi.stubGlobal('document', { documentElement: { requestFullscreen: vi.fn() } })

    expect(isIosWebkit()).toBe(true)
    expect(canRequestFullscreenDisplay()).toBe(false)
  })

  it('never claims fullscreen capability on iPad, even though it is not covered by the iPhone rule alone', async () => {
    const { canRequestFullscreenDisplay, isIosWebkit } = await import('./pwaDisplay')
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', maxTouchPoints: 5 })
    vi.stubGlobal('document', { documentElement: { requestFullscreen: vi.fn() } })

    expect(isIosWebkit()).toBe(true)
    expect(canRequestFullscreenDisplay()).toBe(false)
  })

  it('reports capability on desktop Chromium', async () => {
    const { canRequestFullscreenDisplay, isIosWebkit } = await import('./pwaDisplay')
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36', maxTouchPoints: 0 })
    vi.stubGlobal('document', { documentElement: { requestFullscreen: vi.fn() } })

    expect(isIosWebkit()).toBe(false)
    expect(canRequestFullscreenDisplay()).toBe(true)
  })

  it('tracks the live fullscreen element, including the webkit-prefixed one', async () => {
    const { isFullscreenApiActive } = await import('./pwaDisplay')
    vi.stubGlobal('document', { fullscreenElement: null, webkitFullscreenElement: null })
    expect(isFullscreenApiActive()).toBe(false)

    vi.stubGlobal('document', { fullscreenElement: { tagName: 'HTML' }, webkitFullscreenElement: null })
    expect(isFullscreenApiActive()).toBe(true)

    vi.stubGlobal('document', { fullscreenElement: null, webkitFullscreenElement: { tagName: 'HTML' } })
    expect(isFullscreenApiActive()).toBe(true)
  })

  it('does not claim success when the Fullscreen API is unavailable', async () => {
    const { enterFullscreenDisplay } = await import('./pwa')
    vi.stubGlobal('document', { documentElement: {}, fullscreenElement: null })

    await expect(enterFullscreenDisplay()).resolves.toBe(false)
  })

  it('never tries to enter fullscreen on iOS, even if a method appears available', async () => {
    const { enterFullscreenDisplay } = await import('./pwa')
    const requestFullscreen = vi.fn()
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 })
    vi.stubGlobal('document', { documentElement: { requestFullscreen }, fullscreenElement: null })

    await expect(enterFullscreenDisplay()).resolves.toBe(false)
    expect(requestFullscreen).not.toHaveBeenCalled()
  })

  it('reports success only after the browser actually entered fullscreen', async () => {
    const { enterFullscreenDisplay } = await import('./pwa')
    const documentMock: Record<string, unknown> = { documentElement: {}, fullscreenElement: null }
    documentMock.documentElement = {
      requestFullscreen: async () => { documentMock.fullscreenElement = documentMock.documentElement },
    }
    vi.stubGlobal('document', documentMock)

    await expect(enterFullscreenDisplay()).resolves.toBe(true)
  })

  it('can exit a Fullscreen API session when the browser supports it', async () => {
    const { exitFullscreenDisplay } = await import('./pwa')
    const documentMock: Record<string, unknown> = {
      documentElement: {},
      fullscreenElement: {},
      exitFullscreen: async () => { documentMock.fullscreenElement = null },
    }
    vi.stubGlobal('document', documentMock)

    await expect(exitFullscreenDisplay()).resolves.toBe(true)
    expect(documentMock.fullscreenElement).toBeNull()
  })

  it('stays out of fullscreen when the browser rejects the request', async () => {
    const { enterFullscreenDisplay } = await import('./pwa')
    vi.stubGlobal('document', {
      documentElement: { requestFullscreen: async () => { throw new Error('denied') } },
      fullscreenElement: null,
    })

    await expect(enterFullscreenDisplay()).resolves.toBe(false)
  })
})
