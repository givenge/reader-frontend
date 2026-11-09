import { describe, expect, it, vi } from 'vitest'
import { normalizePositionTimestamp, selectSavedReadingPosition } from './readerPosition'
import { restoreChapterReadingPosition } from './readerPositionRestore'

import type { SavedReadingPosition } from './readerPosition'

const localPosition: SavedReadingPosition = {
  chapterIndex: 4,
  progress: 0.2,
  paragraphIndex: 18,
  paragraphProgress: 0.35,
  updatedAt: 1_700_000_000_000,
}

const serverPosition: SavedReadingPosition = {
  chapterIndex: 4,
  progress: 0.75,
  updatedAt: 1_800_000_000_000,
}

describe('readerPosition', () => {
  it('prefers a local paragraph anchor over a newer server ratio', () => {
    expect(selectSavedReadingPosition(localPosition, serverPosition, 4)).toEqual({
      position: localPosition,
      source: 'local',
    })
  })

  it('uses the newer server chapter ratio when local data has no paragraph anchor', () => {
    const localRatio = { chapterIndex: 4, progress: 0.1, updatedAt: 1_700_000_000_000 }
    expect(selectSavedReadingPosition(localRatio, serverPosition, 4)).toEqual({
      position: serverPosition,
      source: 'server',
    })
  })

  it('ignores positions from a different chapter and normalizes legacy timestamps', () => {
    expect(selectSavedReadingPosition({ ...localPosition, chapterIndex: 3 }, serverPosition, 4)).toEqual({
      position: serverPosition,
      source: 'server',
    })
    expect(normalizePositionTimestamp(1_700_000_000)).toBe(1_700_000_000_000)
  })


describe('restoreChapterReadingPosition', () => {
  it('scrolls to the saved chapter ratio after content dimensions are available', () => {
    const scrollTo = vi.fn()
    const container = { scrollHeight: 2200, clientHeight: 200, scrollTop: 0, scrollTo }
    const saved = { chapterIndex: 4, progress: 0.5, updatedAt: 1_800_000_000_000 }

    expect(restoreChapterReadingPosition(container, saved, 60)).toBe(1000)
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' })
  })

  it('uses the local paragraph anchor instead of the server ratio', () => {
    const scrollTo = vi.fn()
    const container = { scrollHeight: 2200, clientHeight: 200, scrollTop: 400, scrollTo }
    const saved = { ...localPosition, progress: 0.8 }
    const paragraph = { offsetHeight: 40, getBoundingClientRect: () => ({ top: 350 }) }

    expect(restoreChapterReadingPosition(container, saved, 60, paragraph, 100)).toBe(604)
    expect(scrollTo).toHaveBeenCalledWith({ top: 604, behavior: 'auto' })
  })
})

})
