import { describe, expect, it } from 'vitest'
import {
  INTRO_CACHE_STORAGE_KEY,
  cleanIntroText,
  introCacheKey,
  preferSummarySection,
  pruneIntroCache,
  readIntroCache,
  writeIntroCache,
  type BookIntroCacheEntry,
} from './bookIntro'

function fakeStorage() {
  const values = new Map<string, string>()
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    } as unknown as Storage,
  }
}

describe('introCacheKey', () => {
  it('keeps one cache slot per book and source', () => {
    expect(introCacheKey('https://a.com', 'https://a.com/1')).toBe('https://a.com::https://a.com/1')
    expect(introCacheKey('https://a.com', 'https://a.com/1')).not.toBe(introCacheKey('https://b.com', 'https://a.com/1'))
  })

  it('returns an empty key without a book url', () => {
    expect(introCacheKey('', '')).toBe('')
  })
})

describe('cleanIntroText', () => {
  it('flattens markup, entities and stray whitespace', () => {
    expect(cleanIntroText('<p>Hello&nbsp; world</p><br>第二行')).toBe('Hello world\n第二行')
    expect(cleanIntroText('  &nbsp;&nbsp;\n\n作者：辰东\n\n\n' + '简介正文')).toBe('作者：辰东\n简介正文')
    expect(cleanIntroText(undefined)).toBe('')
  })

  it('prefers the 简介 section of an info template', () => {
    const template = '&nbsp;&nbsp;\n📕书名：深空彼岸\n👩‍💻作者：辰东\n📖简介：深空彼岸是一本很长很长的科幻小说，值得一读。'
    expect(cleanIntroText(template)).toBe('深空彼岸是一本很长很长的科幻小说，值得一读。')
  })
})

describe('preferSummarySection', () => {
  it('keeps the original text when the label has no real summary', () => {
    expect(preferSummarySection('简介：')).toBe('简介：')
    expect(preferSummarySection('简介：太短')).toBe('简介：太短')
  })

  it('keeps the original text when no label exists', () => {
    expect(preferSummarySection('一本普通的书')).toBe('一本普通的书')
  })
})

describe('intro cache storage', () => {
  it('drops expired and excess entries', () => {
    const now = 1_000_000_000_000
    const entries: Record<string, BookIntroCacheEntry> = {
      fresh: { intro: 'A', at: now - 1000 },
      stale: { intro: 'B', at: now - 10 * 24 * 60 * 60 * 1000 },
      older: { intro: 'C', at: now - 5000 },
    }
    expect(Object.keys(pruneIntroCache(entries, now, 24 * 60 * 60 * 1000, 5))).toEqual(['fresh', 'older'])
    expect(Object.keys(pruneIntroCache(entries, now, 24 * 60 * 60 * 1000, 1))).toEqual(['fresh'])
  })

  it('round-trips through storage and survives corrupted payloads', () => {
    const { storage, values } = fakeStorage()
    writeIntroCache({ 'https://a.com::https://a.com/1': { intro: '简介', at: Date.now() } }, storage)
    expect(readIntroCache(Date.now(), storage)['https://a.com::https://a.com/1']?.intro).toBe('简介')

    values.set(INTRO_CACHE_STORAGE_KEY, '{not json')
    expect(readIntroCache(Date.now(), storage)).toEqual({})
  })
})
