import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBookIntroStore, INTRO_FETCH_CONCURRENCY } from './bookIntro'
import { getBookInfo } from '../api/bookshelf'
import { INTRO_CACHE_STORAGE_KEY } from '../utils/bookIntro'
import type { Book, SearchBook } from '../types'

vi.mock('../api/bookshelf', () => ({
  getBookInfo: vi.fn(),
}))

const getBookInfoMock = vi.mocked(getBookInfo)
const ORIGIN = 'https://source.example'

function installBrowserGlobals() {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
  })
  return values
}

function book(id: string, extra: Partial<SearchBook> = {}): SearchBook {
  return { name: `书${id}`, author: '作者', bookUrl: `${ORIGIN}/${id}`, origin: ORIGIN, ...extra }
}

function info(bookUrl: string, intro: string): Book {
  return { name: '书', author: '作者', bookUrl, origin: ORIGIN, intro }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('book intro store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installBrowserGlobals()
    setActivePinia(createPinia())
    getBookInfoMock.mockReset()
  })

  it('loads an intro once per book and reuses it', async () => {
    getBookInfoMock.mockResolvedValue(info(`${ORIGIN}/1`, '<p>深空彼岸&nbsp;简介正文</p>'))
    const store = useBookIntroStore()

    store.requestIntro(book('1'))
    store.requestIntro(book('1'))
    await vi.waitFor(() => expect(store.stateFor(ORIGIN, `${ORIGIN}/1`)).toBe('done'))

    expect(getBookInfoMock).toHaveBeenCalledTimes(1)
    expect(getBookInfoMock).toHaveBeenCalledWith(`${ORIGIN}/1`, ORIGIN)
    expect(store.introFor(ORIGIN, `${ORIGIN}/1`)).toBe('深空彼岸 简介正文')
  })

  it('skips books that already carry an intro from the list', async () => {
    const store = useBookIntroStore()

    store.requestIntro(book('2', { intro: '列表自带的简介' }))

    expect(getBookInfoMock).not.toHaveBeenCalled()
    expect(store.stateFor(ORIGIN, `${ORIGIN}/2`)).toBe('idle')
  })

  it('keeps the number of upstream lookups bounded', async () => {
    const pending: Array<ReturnType<typeof deferred<Book>>> = []
    getBookInfoMock.mockImplementation(() => {
      const task = deferred<Book>()
      pending.push(task)
      return task.promise
    })
    const store = useBookIntroStore()

    for (let index = 0; index < INTRO_FETCH_CONCURRENCY + 2; index++) {
      store.requestIntro(book(String(index)))
    }

    expect(getBookInfoMock).toHaveBeenCalledTimes(INTRO_FETCH_CONCURRENCY)
    expect(store.stateFor(ORIGIN, `${ORIGIN}/${INTRO_FETCH_CONCURRENCY + 1}`)).toBe('loading')

    pending[0]!.resolve(info(`${ORIGIN}/0`, '简介'))
    await vi.waitFor(() => expect(getBookInfoMock).toHaveBeenCalledTimes(INTRO_FETCH_CONCURRENCY + 1))

    pending.slice(1).forEach((task, index) => task.resolve(info(`${ORIGIN}/${index + 1}`, '简介')))
    await flush()
  })

  it('stops asking for books whose source returns no intro', async () => {
    getBookInfoMock.mockResolvedValue(info(`${ORIGIN}/3`, '   '))
    const store = useBookIntroStore()

    store.requestIntro(book('3'))
    await vi.waitFor(() => expect(store.stateFor(ORIGIN, `${ORIGIN}/3`)).toBe('missing'))
    store.requestIntro(book('3'))
    await flush()

    expect(getBookInfoMock).toHaveBeenCalledTimes(1)
  })

  it('backs off after a failed lookup', async () => {
    getBookInfoMock.mockRejectedValue(new Error('offline'))
    const store = useBookIntroStore()

    store.requestIntro(book('4'))
    await vi.waitFor(() => expect(store.stateFor(ORIGIN, `${ORIGIN}/4`)).toBe('error'))
    store.requestIntro(book('4'))
    await flush()

    expect(getBookInfoMock).toHaveBeenCalledTimes(1)
  })

  it('persists loaded intros for the next visit', async () => {
    vi.useFakeTimers()
    try {
      const values = installBrowserGlobals()
      getBookInfoMock.mockResolvedValue(info(`${ORIGIN}/5`, '缓存下来的简介'))
      const store = useBookIntroStore()

      store.requestIntro(book('5'))
      await vi.advanceTimersByTimeAsync(500)

      expect(values.get(INTRO_CACHE_STORAGE_KEY)).toContain('缓存下来的简介')

      setActivePinia(createPinia())
      const nextStore = useBookIntroStore()
      expect(nextStore.introFor(ORIGIN, `${ORIGIN}/5`)).toBe('缓存下来的简介')

      nextStore.requestIntro(book('5'))
      await vi.advanceTimersByTimeAsync(500)
      expect(getBookInfoMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
