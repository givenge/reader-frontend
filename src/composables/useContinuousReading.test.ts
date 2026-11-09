import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { CONTINUOUS_PRUNE_IDLE_MS } from '../utils/readerScroll'
import { useContinuousReading } from './useContinuousReading'

afterEach(() => {
  vi.unstubAllGlobals()
})

function createContinuousReader(progress: number, hideReadChapters = false) {
  const setActiveChapterState = vi.fn()
  const persistProgress = vi.fn()
  const store = {
    chapters: [{ title: '第一章', url: 'chapter-0' }],
    currentIndex: 0,
    chapterScrollProgress: progress,
    fetchChapterContent: vi.fn().mockResolvedValue('章节正文'),
    setActiveChapterState,
    markChapterAsRead: vi.fn(),
    persistProgress,
    isChapterRead: vi.fn().mockReturnValue(false),
  }
  setActiveChapterState.mockImplementation((_index, _content, nextProgress) => {
    store.chapterScrollProgress = nextProgress
  })
  const container = {
    querySelector: vi.fn().mockReturnValue({ offsetTop: 0 }),
    scrollTo: vi.fn(),
  } as unknown as HTMLElement
  vi.stubGlobal('window', {
    setTimeout: (callback: () => void) => {
      callback()
      return 1
    },
  })

  const reader = useContinuousReading(
    store as never,
    (content) => content,
    computed(() => true),
    computed(() => hideReadChapters),
    ref(container),
  )

  return { reader, store, setActiveChapterState, persistProgress }
}

describe('useContinuousReading progress initialization', () => {
  it('preserves the loaded server progress when initializing a chapter', async () => {
    const { reader, store, setActiveChapterState } = createContinuousReader(0.4321)

    await reader.initializeContinuousChapters(0, false)

    expect(setActiveChapterState).toHaveBeenCalledWith(0, '章节正文', 0.4321)
    expect(store.chapterScrollProgress).toBe(0.4321)
    expect(store.persistProgress).toHaveBeenCalledWith(0)
  })

  it('does not persist a resume ratio before DOM position restoration completes', async () => {
    const { reader, store, persistProgress } = createContinuousReader(0.4321)
    Object.assign(store, {
      chapterLoadIntent: 'resume',
      positionRestorePending: true,
      completeChapterLoadIntent: vi.fn(),
    })

    await reader.initializeContinuousChapters(0, false)

    expect(store.chapterScrollProgress).toBe(0.4321)
    expect(persistProgress).not.toHaveBeenCalled()
  })

  it('starts at zero when an explicit chapter switch requests chapter start', async () => {
    const { reader, store, setActiveChapterState } = createContinuousReader(0.4321)

    await reader.initializeContinuousChapters(0, false, 0)

    expect(setActiveChapterState).toHaveBeenCalledWith(0, '章节正文', 0)
    expect(store.chapterScrollProgress).toBe(0)
  })

  it('delays read chapter pruning until scroll idle', () => {
    vi.useFakeTimers()
    const { reader } = createContinuousReader(0, true)
    reader.continuousChapters.value = [
      { index: 0, title: '旧章', content: '', html: '' },
      { index: 1, title: '当前章', content: '', html: '' },
    ]
    reader.schedulePruneReadChapters()

    expect(reader.continuousChapters.value.map(({ index }) => index)).toEqual([0, 1])
    vi.advanceTimersByTime(CONTINUOUS_PRUNE_IDLE_MS - 1)
    expect(reader.continuousChapters.value.map(({ index }) => index)).toEqual([0, 1])
  })
})
