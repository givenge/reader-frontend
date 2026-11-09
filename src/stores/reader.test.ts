import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppStore } from './app'
import { useReaderStore } from './reader'
import { getBookContent, getChapterList, getShelfBook, saveBookProgress } from '../api/bookshelf'
import { deleteBrowserCachedChapterLists, getBrowserCachedChapter, getBrowserCachedChapterList, setBrowserCachedChapter, setBrowserCachedChapterList } from '../utils/browserCache'

vi.mock('../api/bookshelf', () => ({
  getChapterList: vi.fn(),
  getBookContent: vi.fn(),
  getShelfBook: vi.fn(),
  saveBookProgress: vi.fn(),
  setBookSource: vi.fn(),
}))

vi.mock('../api/bookmark', () => ({
  getBookmarks: vi.fn(),
  saveBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
  deleteBookmarks: vi.fn(),
}))

vi.mock('../api/replaceRule', () => ({
  getReplaceRules: vi.fn(),
}))

vi.mock('../utils/browserCache', () => ({
  deleteBrowserCachedChapterLists: vi.fn(),
  getBrowserCachedChapter: vi.fn(),
  getBrowserCachedChapterList: vi.fn(),
  setBrowserCachedChapter: vi.fn(),
  setBrowserCachedChapterList: vi.fn(),
}))

vi.mock('../api/readingStats', () => ({
  getReadingStats: vi.fn(async () => ({ totalSeconds: 0, openedBooks: 0, readChapters: 0, completedBooks: 0, deviceCount: 0, updatedAt: 0 })),
  saveReadingStats: vi.fn(async () => ({ totalSeconds: 0, openedBooks: 0, readChapters: 0, completedBooks: 0, deviceCount: 0, updatedAt: 0 })),
  saveReadingStatsKeepalive: vi.fn(),
}))

vi.mock('../utils/recentBooks', () => ({
  saveRecentReadBook: vi.fn(),
}))

vi.mock('../utils/openaiSpeech', () => ({
  DEFAULT_OPENAI_BASE_URL: 'https://api.openai.com/v1',
  requestOpenAISpeechAudio: vi.fn(),
}))

describe('reader local txt chapters', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
      clear: vi.fn(() => storage.clear()),
    })
    vi.mocked(getChapterList).mockReset()
    vi.mocked(getChapterList).mockResolvedValue([])
    vi.mocked(getShelfBook).mockReset()
    vi.mocked(getShelfBook).mockResolvedValue(null as never)
    vi.mocked(getBookContent).mockReset()
    vi.mocked(getBookContent).mockResolvedValue('')
    vi.mocked(saveBookProgress).mockReset()
    vi.mocked(saveBookProgress).mockResolvedValue('')
    vi.mocked(getBrowserCachedChapterList).mockReset()
    vi.mocked(getBrowserCachedChapterList).mockResolvedValue(null)
    vi.mocked(setBrowserCachedChapterList).mockReset()
    vi.mocked(setBrowserCachedChapterList).mockResolvedValue(undefined)
    vi.mocked(deleteBrowserCachedChapterLists).mockReset()
    vi.mocked(deleteBrowserCachedChapterLists).mockResolvedValue(undefined)

    vi.mocked(getBrowserCachedChapter).mockReset()
    vi.mocked(setBrowserCachedChapter).mockReset()
    vi.mocked(setBrowserCachedChapter).mockResolvedValue(undefined)
  })

  it('restores the chapter progress ratio saved by the server', async () => {
    vi.mocked(getChapterList).mockResolvedValue([
      { title: '第一章', url: 'chapter-0', index: 0 },
    ])
    vi.mocked(getBookContent).mockResolvedValue('本地正文')
    vi.mocked(getBrowserCachedChapter).mockResolvedValue(null)
    const appStore = useAppStore()
    appStore.setOnlineStatus(true)
    const readerStore = useReaderStore()
    const book = {
      name: '服务端进度书',
      author: '作者',
      origin: 'source',
      bookUrl: 'book-progress',
      durChapterIndex: 0,
      durChapterPos: 4321,
    }

    await readerStore.loadBook(book)
    await readerStore.loadChapter(0)
    await readerStore.flushProgressToServer(true)

    expect(readerStore.chapterScrollProgress).toBeCloseTo(0.4321)
    expect(saveBookProgress).not.toHaveBeenCalled()
  })

  it('explicitly starts at the saved chapter beginning without persisting progress before render', async () => {
    vi.mocked(getChapterList).mockResolvedValue([
      { title: '第一章', url: 'chapter-0', index: 0 },
    ])
    vi.mocked(getBookContent).mockResolvedValue('本地正文')
    vi.mocked(getBrowserCachedChapter).mockResolvedValue(null)
    const appStore = useAppStore()
    appStore.setOnlineStatus(true)
    const readerStore = useReaderStore()
    await readerStore.loadBook({
      name: '显式章首书',
      author: '作者',
      origin: 'source',
      bookUrl: 'book-explicit-start',
      durChapterIndex: 0,
      durChapterPos: 4321,
    })

    await readerStore.loadChapter(0, false, { intent: 'start' })

    expect(readerStore.chapterScrollProgress).toBe(0)
    expect(readerStore.book?.durChapterPos).toBe(0)
    expect(readerStore.chapterLoadIntent).toBe('start')
    expect(saveBookProgress).not.toHaveBeenCalled()
  })

  it('keeps resume semantics on forced chapter refresh', async () => {
    vi.mocked(getChapterList).mockResolvedValue([
      { title: '第一章', url: 'chapter-0', index: 0 },
    ])
    vi.mocked(getBookContent).mockResolvedValue('刷新后的正文')
    vi.mocked(getBrowserCachedChapter).mockResolvedValue(null)
    const appStore = useAppStore()
    appStore.setOnlineStatus(true)
    const readerStore = useReaderStore()
    await readerStore.loadBook({
      name: '强制刷新续读书',
      author: '作者',
      origin: 'source',
      bookUrl: 'book-force-resume',
      durChapterIndex: 0,
      durChapterPos: 4321,
    })

    await readerStore.loadChapter(0, true)

    expect(readerStore.chapterScrollProgress).toBeCloseTo(0.4321)
    expect(saveBookProgress).not.toHaveBeenCalled()
  })


  it('hydrates stale shelf entry progress before loading the default chapter', async () => {
    const staleBook = {
      name: '跨设备进度书',
      author: '作者',
      origin: 'source',
      bookUrl: 'book-stale-progress',
      durChapterIndex: 0,
      durChapterPos: 0,
      browserCachedChapterCount: 5,
    }
    const freshBook = {
      ...staleBook,
      durChapterIndex: 1,
      durChapterPos: 4321,
      durChapterTitle: '第二章',
      durChapterTime: 1_800_000_000_000,
    }
    vi.mocked(getShelfBook).mockResolvedValue(freshBook)
    vi.mocked(getChapterList).mockResolvedValue([
      { title: '第一章', url: 'chapter-0', index: 0 },
      { title: '第二章', url: 'chapter-1', index: 1 },
    ])
    vi.mocked(getBookContent).mockResolvedValue('第二章正文')
    vi.mocked(getBrowserCachedChapter).mockResolvedValue(null)
    const appStore = useAppStore()
    appStore.setOnlineStatus(true)
    const readerStore = useReaderStore()
    const bookshelf = (await import('./bookshelf')).useBookshelfStore()
    bookshelf.books = [{ ...staleBook }]

    const loadedBook = await readerStore.loadBook(staleBook)
    await readerStore.loadChapter(readerStore.currentIndex)

    expect(getShelfBook).toHaveBeenCalledWith(staleBook.bookUrl)
    expect(loadedBook?.durChapterIndex).toBe(1)
    expect(readerStore.currentIndex).toBe(1)
    expect(readerStore.chapterScrollProgress).toBeCloseTo(0.4321)
    expect(readerStore.book?.durChapterPos).toBe(4321)
    expect(bookshelf.books[0].durChapterPos).toBe(4321)
    expect(readerStore.book?.browserCachedChapterCount).toBe(5)
  })

  it('ignores stale book hydrations that resolve after a newer request', async () => {
    const firstBook = {
      name: '旧请求', author: '作者', origin: 'source', bookUrl: 'book-first', durChapterIndex: 0,
    }
    const secondBook = {
      name: '新请求', author: '作者', origin: 'source', bookUrl: 'book-second', durChapterIndex: 1,
    }
    let resolveFirst: ((book: typeof firstBook) => void) | undefined
    vi.mocked(getShelfBook)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = (book) => resolve(book) }))
      .mockResolvedValueOnce(secondBook)
    vi.mocked(getChapterList).mockResolvedValue([
      { title: '第一章', url: 'chapter-0', index: 0 },
      { title: '第二章', url: 'chapter-1', index: 1 },
    ])
    const readerStore = useReaderStore()

    const firstLoad = readerStore.loadBook(firstBook)
    const secondLoad = readerStore.loadBook(secondBook)
    await expect(secondLoad).resolves.toMatchObject({ bookUrl: secondBook.bookUrl })
    resolveFirst?.(firstBook)

    await expect(firstLoad).resolves.toBeNull()
    expect(readerStore.book?.bookUrl).toBe(secondBook.bookUrl)
    expect(getChapterList).toHaveBeenCalledTimes(1)
    expect(getChapterList).toHaveBeenCalledWith({
      bookUrl: secondBook.bookUrl,
      tocUrl: secondBook.bookUrl,
      bookSourceUrl: secondBook.origin,
      refresh: false,
    })
  })

  it('falls back to the caller book when shelf hydration fails', async () => {
    const staleBook = {
      name: '兜底书', author: '作者', origin: 'source', bookUrl: 'book-fallback', durChapterIndex: 2,
    }
    vi.mocked(getShelfBook).mockRejectedValueOnce(new Error('network error'))
    vi.mocked(getChapterList).mockResolvedValue([
      { title: '第一章', url: 'chapter-0', index: 0 },
      { title: '第二章', url: 'chapter-1', index: 1 },
      { title: '第三章', url: 'chapter-2', index: 2 },
    ])
    const readerStore = useReaderStore()

    await expect(readerStore.loadBook(staleBook)).resolves.toMatchObject({ bookUrl: staleBook.bookUrl })
    expect(readerStore.currentIndex).toBe(2)
  })

  it('retains support for legacy decoded server progress values', async () => {
    vi.mocked(getChapterList).mockResolvedValue([
      { title: '第一章', url: 'chapter-0', index: 0 },
    ])
    vi.mocked(getBookContent).mockResolvedValue('本地正文')
    vi.mocked(getBrowserCachedChapter).mockResolvedValue(null)
    const appStore = useAppStore()
    appStore.setOnlineStatus(true)
    const readerStore = useReaderStore()
    const book = {
      name: '旧格式进度书',
      author: '作者',
      origin: 'source',
      bookUrl: 'book-legacy-progress',
      durChapterIndex: 0,
      durChapterPos: 0.25,
    }

    await readerStore.loadBook(book)
    await readerStore.loadChapter(0)

    expect(readerStore.chapterScrollProgress).toBe(0.25)
  })

  it('persists progress and syncs active/shelf books for a subsequent store reload', async () => {
    const savedServerBook = {
      name: '服务端进度书',
      author: '作者',
      origin: 'source',
      bookUrl: 'book-progress-save',
      durChapterIndex: 0,
      durChapterPos: 0,
    }
    vi.mocked(getShelfBook).mockImplementation(async () => ({ ...savedServerBook }))
    vi.mocked(saveBookProgress).mockImplementation(async ({ index, position }) => {
      savedServerBook.durChapterIndex = index
      savedServerBook.durChapterPos = position ?? 0
      return ''
    })
    vi.mocked(getChapterList).mockResolvedValue([
      { title: '第一章', url: 'chapter-0', index: 0 },
    ])
    vi.mocked(getBookContent).mockResolvedValue('本地正文')
    vi.mocked(getBrowserCachedChapter).mockResolvedValue(null)
    const appStore = useAppStore()
    appStore.setOnlineStatus(true)
    const readerStore = useReaderStore()
    const bookshelf = (await import('./bookshelf')).useBookshelfStore()
    readerStore.book = { ...savedServerBook }
    bookshelf.books = [{ ...savedServerBook }]
    readerStore.chapters = [{ title: '第一章', url: 'chapter-0', index: 0 }]
    readerStore.setChapterScrollProgress(0.4321)

    await readerStore.flushProgressToServer(true)

    expect(saveBookProgress).toHaveBeenCalledWith({
      bookUrl: 'book-progress-save',
      index: 0,
      position: 4321,
    })
    expect(readerStore.book?.durChapterPos).toBe(4321)
    expect(bookshelf.books[0].durChapterPos).toBe(4321)

    setActivePinia(createPinia())
    useAppStore().setOnlineStatus(true)
    const reloadedReaderStore = useReaderStore()
    await reloadedReaderStore.loadBook({ ...savedServerBook, durChapterPos: 0 })
    await reloadedReaderStore.loadChapter(reloadedReaderStore.currentIndex)
    expect(reloadedReaderStore.chapterScrollProgress).toBeCloseTo(0.4321)
  })

  it('fetches uploaded local txt content from backend even when browser reports offline', async () => {
    vi.mocked(getBookContent).mockResolvedValue('本地正文')
    vi.mocked(getBrowserCachedChapter).mockResolvedValue(null)
    const appStore = useAppStore()
    const readerStore = useReaderStore()
    appStore.setOnlineStatus(false)
    readerStore.book = {
      name: '本地书',
      author: '本地导入',
      origin: 'local-txt',
      bookUrl: 'local-txt:abc123',
    }
    readerStore.chapters = [
      { title: '第一章', url: 'local-txt:abc123#0', index: 0 },
    ]

    await expect(readerStore.fetchChapterContent(0)).resolves.toBe('本地正文')

    expect(getBrowserCachedChapter).not.toHaveBeenCalled()
    expect(getBookContent).toHaveBeenCalledWith({
      chapterUrl: 'local-txt:abc123#0',
      bookSourceUrl: 'local-txt',
      refresh: 0,
    })
  })
})
