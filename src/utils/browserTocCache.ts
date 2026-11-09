import { getChapterList } from '../api/bookshelf'
import type { Book, BookChapter } from '../types'
import { deleteBrowserCachedChapterLists, getBrowserCachedChapterList, setBrowserCachedChapterList } from './browserCache'

export type BrowserTocBook = Pick<Book, 'bookUrl' | 'origin' | 'tocUrl'>

/** Loads a remote TOC from the browser cache, falling back to the server's D1 cache. */
export async function getCachedChapterList(book: BrowserTocBook, options: { refresh?: boolean } = {}): Promise<BookChapter[]> {
  const params = {
    bookUrl: book.bookUrl,
    tocUrl: book.tocUrl || book.bookUrl,
    bookSourceUrl: book.origin,
  }
  const cacheIdentity = { bookUrl: params.bookUrl, tocUrl: params.tocUrl, origin: params.bookSourceUrl }

  if (!options.refresh) {
    const cached = await getBrowserCachedChapterList(cacheIdentity).catch(() => null)
    if (cached !== null) return cached
  }

  const chapters = await getChapterList({ ...params, refresh: options.refresh === true })
  if (options.refresh) await deleteBrowserCachedChapterLists(book.bookUrl).catch(() => undefined)
  await Promise.resolve(setBrowserCachedChapterList({ ...cacheIdentity, chapters })).catch(() => undefined)
  return chapters
}
