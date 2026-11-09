import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookChapter } from '../types'
import { getChapterList } from '../api/bookshelf'
import { deleteBrowserCachedChapterLists, getBrowserCachedChapterList, setBrowserCachedChapterList } from './browserCache'
import { getCachedChapterList } from './browserTocCache'

vi.mock('../api/bookshelf', () => ({ getChapterList: vi.fn() }))
vi.mock('./browserCache', () => ({
  deleteBrowserCachedChapterLists: vi.fn(),
  getBrowserCachedChapterList: vi.fn(),
  setBrowserCachedChapterList: vi.fn(),
}))

const book = { bookUrl: 'book', tocUrl: 'toc', origin: 'source' }
const chapters: BookChapter[] = [{ title: '第一章', url: 'chapter-1', index: 0 }]

describe('getCachedChapterList', () => {
  beforeEach(() => {
    vi.mocked(getChapterList).mockReset()
    vi.mocked(deleteBrowserCachedChapterLists).mockReset()
    vi.mocked(deleteBrowserCachedChapterLists).mockResolvedValue(undefined)
    vi.mocked(getBrowserCachedChapterList).mockReset()
    vi.mocked(deleteBrowserCachedChapterLists).mockReset()
    vi.mocked(deleteBrowserCachedChapterLists).mockResolvedValue(undefined)
    vi.mocked(setBrowserCachedChapterList).mockReset()
    vi.mocked(setBrowserCachedChapterList).mockResolvedValue(undefined)
  })

  it('returns the browser TOC hit without calling the API', async () => {
    vi.mocked(getBrowserCachedChapterList).mockResolvedValue(chapters)

    await expect(getCachedChapterList(book)).resolves.toEqual(chapters)
    expect(getChapterList).not.toHaveBeenCalled()
  })

  it('calls the non-refresh API on browser miss and stores its response', async () => {
    vi.mocked(getBrowserCachedChapterList).mockResolvedValue(null)
    vi.mocked(getChapterList).mockResolvedValue(chapters)

    await expect(getCachedChapterList(book)).resolves.toEqual(chapters)
    expect(getChapterList).toHaveBeenCalledWith({ bookUrl: 'book', tocUrl: 'toc', bookSourceUrl: 'source', refresh: false })
    expect(setBrowserCachedChapterList).toHaveBeenCalledWith({ bookUrl: 'book', tocUrl: 'toc', origin: 'source', chapters })
  })

  it('refreshes upstream and overwrites browser cache without consulting its old value', async () => {
    const refreshed = [{ title: '更新章节', url: 'chapter-2', index: 0 }]
    vi.mocked(getChapterList).mockResolvedValue(refreshed)

    await expect(getCachedChapterList(book, { refresh: true })).resolves.toEqual(refreshed)
    expect(getBrowserCachedChapterList).not.toHaveBeenCalled()
    expect(getChapterList).toHaveBeenCalledWith({ bookUrl: 'book', tocUrl: 'toc', bookSourceUrl: 'source', refresh: true })
    expect(setBrowserCachedChapterList).toHaveBeenCalledWith({ bookUrl: 'book', tocUrl: 'toc', origin: 'source', chapters: refreshed })
  })

  it('treats an empty cached list as a hit', async () => {
    vi.mocked(getBrowserCachedChapterList).mockResolvedValue([])

    await expect(getCachedChapterList(book)).resolves.toEqual([])
    expect(getChapterList).not.toHaveBeenCalled()
  })

  it('uses a browser cache identity that includes the source and TOC URLs', async () => {
    vi.mocked(getBrowserCachedChapterList).mockResolvedValue(null)
    vi.mocked(getChapterList).mockResolvedValue(chapters)

    await getCachedChapterList({ ...book, origin: 'different-source' })

    expect(getBrowserCachedChapterList).toHaveBeenCalledWith({ bookUrl: 'book', tocUrl: 'toc', origin: 'different-source' })
    expect(getChapterList).toHaveBeenCalledWith({ bookUrl: 'book', tocUrl: 'toc', bookSourceUrl: 'different-source', refresh: false })
  })
})
