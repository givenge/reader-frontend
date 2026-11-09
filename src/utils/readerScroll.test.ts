import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONTINUOUS_PREFETCH_VIEWPORTS,
  CONTINUOUS_PRUNE_IDLE_MS,
  createDebouncedTask,
  getSafePruneBeforeIndex,
  shouldPrefetchContinuousChapter,
} from './readerScroll'

describe('reader scroll helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces pruning until the scroll has been idle and supports cancellation', () => {
    vi.useFakeTimers()
    const prune = vi.fn()
    const debounced = createDebouncedTask(prune, CONTINUOUS_PRUNE_IDLE_MS)

    debounced.schedule()
    vi.advanceTimersByTime(CONTINUOUS_PRUNE_IDLE_MS - 1)
    expect(prune).not.toHaveBeenCalled()

    debounced.schedule()
    vi.advanceTimersByTime(CONTINUOUS_PRUNE_IDLE_MS - 1)
    expect(prune).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(prune).toHaveBeenCalledTimes(1)

    debounced.schedule()
    debounced.cancel()
    vi.advanceTimersByTime(CONTINUOUS_PRUNE_IDLE_MS)
    expect(prune).toHaveBeenCalledTimes(1)
  })

  it('keeps a read chapter intersecting the current viewport when pruning', () => {
    const sections = [
      { index: 2, bottom: 80 },
      { index: 3, bottom: 240 },
      { index: 4, bottom: 520 },
      { index: 5, bottom: 900 },
    ]

    expect(getSafePruneBeforeIndex(sections, 5, 100)).toBe(3)
    expect(getSafePruneBeforeIndex(sections, 5, 250)).toBe(4)
    expect(getSafePruneBeforeIndex(sections, 5, 520)).toBe(5)
  })

  it('prefetches next continuous chapter at least one and a half viewports early', () => {
    const viewportHeight = 800
    const threshold = viewportHeight * CONTINUOUS_PREFETCH_VIEWPORTS

    expect(shouldPrefetchContinuousChapter(threshold, viewportHeight)).toBe(true)
    expect(shouldPrefetchContinuousChapter(threshold + 1, viewportHeight)).toBe(false)
    expect(shouldPrefetchContinuousChapter(0, 0)).toBe(false)
  })
})
