import { describe, expect, it } from 'vitest'
import { shouldUseMobileReaderLayout } from './readerPageMode'

describe('reader page mode', () => {
  it('adapts to the viewport when automatic mode is selected', () => {
    expect(shouldUseMobileReaderLayout('auto', true)).toBe(true)
    expect(shouldUseMobileReaderLayout('auto', false)).toBe(false)
  })

  it('forces the mobile reader layout when the viewport would otherwise use desktop', () => {
    expect(shouldUseMobileReaderLayout('mobile', false)).toBe(true)
  })
})
