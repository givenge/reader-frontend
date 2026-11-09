export const INTRO_CACHE_STORAGE_KEY = 'reader.bookIntro.cache.v1'
export const INTRO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const INTRO_CACHE_LIMIT = 500

export interface BookIntroCacheEntry {
  intro: string
  at: number
}

/** Cache identity for one book inside one book source. */
export function introCacheKey(origin?: string | null, bookUrl?: string | null) {
  const source = String(origin || '').trim()
  const url = String(bookUrl || '').trim()
  return source || url ? `${source}::${url}` : ''
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
}

function decodeEntities(text: string) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    const named = ENTITY_MAP[code.toLowerCase()]
    if (named !== undefined) return named
    if (code.startsWith('#')) {
      const value = code[1]?.toLowerCase() === 'x'
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10)
      if (Number.isFinite(value) && value > 0 && value <= 0x10ffff) return String.fromCodePoint(value)
    }
    return match
  })
}

const SUMMARY_LABEL = /(?:^|\n)\s*[^\n]{0,6}?(?:简介|簡介|内容简介|書籍簡介)\s*[:：]\s*/

/**
 * Book source `intro` rules often return a whole info template ("书名：… 简介：…"),
 * so prefer the section behind a 简介 label when one exists.
 */
export function preferSummarySection(text: string) {
  const match = SUMMARY_LABEL.exec(text)
  if (!match) return text
  const summary = text.slice(match.index + match[0].length).trim()
  return summary.length >= 8 ? summary : text
}

/** Normalizes rule output into plain multi-line text safe to render in a card. */
export function cleanIntroText(raw?: string | null): string {
  const text = decodeEntities(String(raw ?? ''))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
  if (!text) return ''
  return preferSummarySection(text)
}

function cacheStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** Drops expired entries and keeps the most recent `INTRO_CACHE_LIMIT` books. */
export function pruneIntroCache(
  entries: Record<string, BookIntroCacheEntry>,
  now = Date.now(),
  ttl = INTRO_CACHE_TTL_MS,
  limit = INTRO_CACHE_LIMIT,
) {
  const fresh = Object.entries(entries)
    .filter(([, entry]) => entry && typeof entry.intro === 'string' && now - Number(entry.at || 0) < ttl)
    .sort((left, right) => Number(right[1].at || 0) - Number(left[1].at || 0))
    .slice(0, limit)
  return Object.fromEntries(fresh)
}

export function readIntroCache(now = Date.now(), storage = cacheStorage()): Record<string, BookIntroCacheEntry> {
  if (!storage) return {}
  try {
    const raw = storage.getItem(INTRO_CACHE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return pruneIntroCache(parsed as Record<string, BookIntroCacheEntry>, now)
  } catch {
    return {}
  }
}

export function writeIntroCache(entries: Record<string, BookIntroCacheEntry>, storage = cacheStorage()) {
  if (!storage) return
  try {
    storage.setItem(INTRO_CACHE_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Quota or private-mode failures must not break browsing.
  }
}
