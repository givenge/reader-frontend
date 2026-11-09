import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getBookInfo } from '../api/bookshelf'
import type { Book, SearchBook } from '../types'
import {
  INTRO_CACHE_TTL_MS,
  cleanIntroText,
  introCacheKey,
  readIntroCache,
  writeIntroCache,
  type BookIntroCacheEntry,
} from '../utils/bookIntro'

/** Upstream book info requests are heavy, so only a few books load their intro at a time. */
export const INTRO_FETCH_CONCURRENCY = 3
const INTRO_RETRY_COOLDOWN_MS = 5 * 60 * 1000
const PERSIST_DELAY_MS = 300

export type BookIntroState = 'idle' | 'loading' | 'done' | 'missing' | 'error'

/**
 * Explore / search lists rarely carry an intro, so opening a book's detail modal
 * asks the book source for its book info on demand and remembers the result per
 * book + source.
 */
export const useBookIntroStore = defineStore('bookIntro', () => {
  const entries = ref<Record<string, BookIntroCacheEntry>>(readIntroCache())
  const states = ref<Record<string, BookIntroState>>({})
  const failedAt = ref<Record<string, number>>({})
  const queue: Array<Book | SearchBook> = []
  let activeCount = 0
  let persistTimer: ReturnType<typeof setTimeout> | undefined

  function keyOf(book: Book | SearchBook) {
    return introCacheKey(book.origin, book.bookUrl)
  }

  function introFor(origin?: string, bookUrl?: string) {
    const key = introCacheKey(origin, bookUrl)
    return key ? entries.value[key]?.intro : undefined
  }

  function stateFor(origin?: string, bookUrl?: string): BookIntroState {
    const key = introCacheKey(origin, bookUrl)
    return (key && states.value[key]) || 'idle'
  }

  function isLoading(origin?: string, bookUrl?: string) {
    return stateFor(origin, bookUrl) === 'loading'
  }

  function schedulePersist() {
    if (persistTimer !== undefined) return
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      writeIntroCache(entries.value)
    }, PERSIST_DELAY_MS)
  }

  function isFresh(key: string) {
    const entry = entries.value[key]
    return !!entry && Date.now() - Number(entry.at || 0) < INTRO_CACHE_TTL_MS
  }

  function requestIntro(book: Book | SearchBook) {
    const key = keyOf(book)
    if (!key || !String(book.bookUrl || '').trim()) return

    // The list itself may already provide an intro.
    if (cleanIntroText(book.intro)) return
    if (isFresh(key)) return

    const state = states.value[key]
    if (state === 'loading' || state === 'missing') return
    if (state === 'error' && (failedAt.value[key] || 0) > Date.now()) return
    if (queue.some((item) => keyOf(item) === key)) return

    states.value[key] = 'loading'
    queue.push(book)
    pump()
  }

  function pump() {
    while (activeCount < INTRO_FETCH_CONCURRENCY && queue.length > 0) {
      const book = queue.shift() as Book | SearchBook
      const key = keyOf(book)
      activeCount++
      void fetchIntro(book, key).finally(() => {
        activeCount--
        pump()
      })
    }
  }

  async function fetchIntro(book: Book | SearchBook, key: string) {
    try {
      const info = await getBookInfo(book.bookUrl, book.origin)
      const intro = cleanIntroText(info?.intro)
      if (intro) {
        entries.value[key] = { intro, at: Date.now() }
        states.value[key] = 'done'
        schedulePersist()
      } else {
        states.value[key] = 'missing'
      }
      delete failedAt.value[key]
    } catch {
      states.value[key] = 'error'
      failedAt.value[key] = Date.now() + INTRO_RETRY_COOLDOWN_MS
    }
  }

  return {
    entries,
    introFor,
    stateFor,
    isLoading,
    requestIntro,
  }
})
