import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncViewportSize } from './viewport'

function createStyleDeclaration() {
  const values = new Map<string, string>()
  return {
    getPropertyValue: (name: string) => values.get(name) || '',
    setProperty: (name: string, value: string) => values.set(name, value),
  }
}

describe('viewport sizing', () => {
  const rootStyle = createStyleDeclaration()
  const bodyStyle = createStyleDeclaration()
  const root = { style: rootStyle, clientHeight: 800, clientWidth: 390 }
  const body = { style: bodyStyle }
  const viewport = { height: 670, width: 390, offsetTop: 0, offsetLeft: 0, addEventListener: vi.fn() }
  const windowMock = {
    innerHeight: 800,
    innerWidth: 390,
    visualViewport: viewport,
    dispatchEvent: vi.fn(),
  }

  beforeEach(() => {
    vi.stubGlobal('window', windowMock)
    vi.stubGlobal('document', { documentElement: root, body, activeElement: null })
    vi.stubGlobal('navigator', { userAgent: 'test', maxTouchPoints: 0 })
    rootStyle.setProperty('height', '')
    bodyStyle.setProperty('height', '')
    windowMock.dispatchEvent.mockClear()
  })

  it('keeps layout and visual viewport heights distinct for reader sizing', () => {
    syncViewportSize()

    expect(rootStyle.getPropertyValue('--app-height')).toBe('800px')
    expect(rootStyle.getPropertyValue('--app-visual-height')).toBe('670px')
    expect(rootStyle.getPropertyValue('height')).toBe('800px')
    expect(bodyStyle.getPropertyValue('height')).toBe('800px')
  })

  it('updates visual height after viewport resize without changing shared layout height', () => {
    syncViewportSize()
    viewport.height = 720

    syncViewportSize()

    expect(rootStyle.getPropertyValue('--app-height')).toBe('800px')
    expect(rootStyle.getPropertyValue('--app-visual-height')).toBe('720px')
    expect(bodyStyle.getPropertyValue('height')).toBe('800px')
  })
})
