import type { ReadingStatsCounters, ReadingStatsUpload } from '../api/readingStats'

// 阅读统计客户端模型：服务端是唯一数据源，本地只保留“服务端结果缓存 + 待同步账本”。
// 会话账本记录每个阅读会话的总时长（seconds）与服务端已确认的水位（synced），
// 展示时只累加未确认的增量，因此重复上报、断网重试、同步中途刷新页面都不会翻倍。
const STORAGE_KEY = 'reader-stats-v2'
const LEGACY_STORAGE_KEY = 'reader-stats'
const DEVICE_ID_KEY = 'reader-device-id'
const STATE_VERSION = 2
// 阅读页重载/崩溃后，间隔超过 1 小时视为新的阅读会话。
const RESUME_WINDOW_MS = 60 * 60 * 1000
// 单次上报上限必须与服务端 src/stats.ts 保持一致，超出部分留在账本里下次续传。
export const MAX_SESSIONS_PER_FLUSH = 50
export const MAX_BOOKS_PER_FLUSH = 500
export const MAX_CHAPTERS_PER_FLUSH = 1000
// keepalive 请求体过大时浏览器会直接丢弃，兜底上报只带最近的少量数据。
const KEEPALIVE_LIMITS = { sessions: 10, books: 50, chapters: 200, completed: 50 }
const MAX_IMPORT_ITEMS = 20000
const MAX_SESSION_SECONDS = 7 * 24 * 60 * 60
const MAX_URL_LENGTH = 4096
const MAX_CHAPTER_INDEX = 1000000

export const EMPTY_READING_STATS: ReadingStatsCounters = {
  totalSeconds: 0,
  openedBooks: 0,
  readChapters: 0,
  completedBooks: 0,
  deviceCount: 0,
  updatedAt: 0,
}

export interface ReadingStatsSnapshot extends ReadingStatsCounters {
  /** 尚未被服务端确认的秒数（服务端已收到的部分不计入）。 */
  pendingSeconds: number
  pendingItems: number
  syncing: boolean
  lastSyncedAt: number
  syncError: string
  sessionActive: boolean
}

export interface ReadingStatsSummary {
  totalSeconds: number
  totalTimeText: string
  openedBooks: number
  readChapters: number
  completedBooks: number
  deviceCount: number
  pendingSeconds: number
  hasPending: boolean
  syncing: boolean
  syncError: string
  lastSyncedAt: number
}

export interface ReadingStatsTrackerOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  now?: () => number
  createId?: () => string
  isVisible?: () => boolean
  send?: (upload: ReadingStatsUpload) => Promise<ReadingStatsCounters>
  load?: () => Promise<ReadingStatsCounters>
  sendKeepalive?: (upload: ReadingStatsUpload) => void
  onChange?: (snapshot: ReadingStatsSnapshot) => void
}

// visibleSince 为 null 表示当前暂停计时（切后台/息屏）。
type ActiveSession = { id: string; base: number; visibleSince: number | null; updatedAt: number }
type SessionEntry = { seconds: number; synced: number }

type StoredState = {
  version: number
  account: string
  deviceId: string
  cache: ReadingStatsCounters
  sessions: Record<string, SessionEntry>
  books: Record<string, number>
  completed: Record<string, number>
  chapters: Record<string, number>
  active: ActiveSession | null
  legacyImported: boolean
}

export function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function formatReadingDuration(totalSeconds: number) {
  const totalMinutes = Math.floor(Math.max(0, totalSeconds) / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (!hours && !minutes) return '0分钟'
  return hours ? `${hours}小时${minutes}分钟` : `${minutes}分钟`
}

export function formatReadingStatsSummary(snapshot: ReadingStatsSnapshot): ReadingStatsSummary {
  return {
    totalSeconds: snapshot.totalSeconds,
    totalTimeText: formatReadingDuration(snapshot.totalSeconds),
    openedBooks: snapshot.openedBooks,
    readChapters: snapshot.readChapters,
    completedBooks: snapshot.completedBooks,
    deviceCount: snapshot.deviceCount,
    pendingSeconds: snapshot.pendingSeconds,
    hasPending: snapshot.pendingItems > 0,
    syncing: snapshot.syncing,
    syncError: snapshot.syncError,
    lastSyncedAt: snapshot.lastSyncedAt,
  }
}

export function chapterKey(bookUrl: string, index: number) {
  return `${bookUrl}#${index}`
}

function normalizeChapterKey(value: string) {
  const separator = value.lastIndexOf('#')
  if (separator <= 0) return ''
  const bookUrl = value.slice(0, separator)
  const index = Number(value.slice(separator + 1))
  if (!bookUrl || bookUrl.length > MAX_URL_LENGTH) return ''
  if (!Number.isInteger(index) || index < 0 || index > MAX_CHAPTER_INDEX) return ''
  return chapterKey(bookUrl, index)
}

function normalizeBookUrl(value: string) {
  const url = typeof value === 'string' ? value.trim() : ''
  return url && url.length <= MAX_URL_LENGTH ? url : ''
}

function normalizeDeviceId(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : ''
  return id && id.length <= 128 ? id : ''
}

function positiveInteger(value: unknown) {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function normalizeCounters(value: Partial<ReadingStatsCounters> | null | undefined): ReadingStatsCounters {
  return {
    totalSeconds: positiveInteger(value?.totalSeconds),
    openedBooks: positiveInteger(value?.openedBooks),
    readChapters: positiveInteger(value?.readChapters),
    completedBooks: positiveInteger(value?.completedBooks),
    deviceCount: positiveInteger(value?.deviceCount),
    updatedAt: positiveInteger(value?.updatedAt),
  }
}

function parseKeyQueue(value: unknown, normalize: (input: string) => string) {
  const result: Record<string, number> = {}
  if (!value || typeof value !== 'object') return result
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const normalized = normalize(key)
    if (normalized) result[normalized] = 1
  }
  return result
}

function parseSessions(value: unknown) {
  const sessions: Record<string, SessionEntry> = {}
  if (!value || typeof value !== 'object') return sessions
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const sessionId = id.trim()
    if (!sessionId || sessionId.length > 128) continue
    const record = (raw || {}) as Partial<SessionEntry>
    const seconds = Math.min(positiveInteger(record.seconds), MAX_SESSION_SECONDS)
    if (!seconds) continue
    sessions[sessionId] = { seconds, synced: Math.min(positiveInteger(record.synced), seconds) }
  }
  return sessions
}

function parseActiveSession(value: unknown): ActiveSession | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<ActiveSession>
  const id = normalizeDeviceId(record.id)
  const updatedAt = positiveInteger(record.updatedAt)
  if (!id || !updatedAt) return null
  const visibleSince = Number(record.visibleSince)
  return {
    id,
    base: Math.max(0, Math.floor(Number(record.base) || 0)),
    visibleSince: Number.isFinite(visibleSince) && visibleSince > 0 ? Math.floor(visibleSince) : null,
    updatedAt,
  }
}

export function createReadingStatsTracker(options: ReadingStatsTrackerOptions = {}) {
  const storage = options.storage === undefined
    ? (typeof localStorage === 'undefined' ? null : localStorage)
    : options.storage
  const now = options.now ?? (() => Date.now())
  const makeId = options.createId ?? createId
  const isVisible = options.isVisible ?? (() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  const send = options.send
  const load = options.load
  const sendKeepalive = options.sendKeepalive
  const onChange = options.onChange ?? (() => undefined)

  let syncing = false
  let lastSyncedAt = 0
  let syncError = ''
  let inFlight: Promise<boolean> | null = null
  let lastKeepaliveKey = ''

  function readState(): StoredState {
    let parsed: Partial<StoredState> | null = null
    try {
      const raw = storage?.getItem(STORAGE_KEY)
      if (raw) parsed = JSON.parse(raw) as Partial<StoredState>
    } catch {
      parsed = null
    }
    const deviceId = normalizeDeviceId(parsed?.deviceId)
      || normalizeDeviceId(storage?.getItem(DEVICE_ID_KEY) || '')
      || createId()
    return {
      version: STATE_VERSION,
      account: typeof parsed?.account === 'string' ? parsed.account.slice(0, 128) : '',
      deviceId,
      cache: normalizeCounters(parsed?.cache),
      sessions: parseSessions(parsed?.sessions),
      books: parseKeyQueue(parsed?.books, normalizeBookUrl),
      completed: parseKeyQueue(parsed?.completed, normalizeBookUrl),
      chapters: parseKeyQueue(parsed?.chapters, normalizeChapterKey),
      active: parseActiveSession(parsed?.active),
      legacyImported: parsed?.legacyImported === true,
    }
  }

  const state = readState()

  function persist() {
    // 让进行中的会话账本跟上实时计时，避免 reload 后从过期的秒数继续累加。
    touchActiveEntry()
    if (!storage) return
    try {
      storage.setItem(DEVICE_ID_KEY, state.deviceId)
      storage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // 隐私模式/超出配额时忽略，统计在当前页面内继续工作。
    }
  }

  function activeSeconds(timestamp = now()) {
    const active = state.active
    if (!active) return 0
    const running = active.visibleSince === null ? 0 : Math.max(0, (timestamp - active.visibleSince) / 1000)
    return active.base + running
  }

  function touchActiveEntry() {
    const active = state.active
    if (!active) return
    syncEntry(active.id, activeSeconds())
  }

  function sessionSeconds(sessionId: string) {
    const entry = state.sessions[sessionId]
    const stored = entry ? entry.seconds : 0
    if (state.active?.id === sessionId) return Math.max(stored, Math.floor(activeSeconds()))
    return stored
  }

  /** 服务端尚未确认的总秒数，用于乐观展示。 */
  function unsyncedSeconds() {
    let total = 0
    for (const [sessionId, entry] of Object.entries(state.sessions)) {
      total += Math.max(0, sessionSeconds(sessionId) - entry.synced)
    }
    return total
  }

  function queuedItemCount() {
    let count = 0
    for (const [sessionId, entry] of Object.entries(state.sessions)) {
      if (sessionId !== state.active?.id && sessionSeconds(sessionId) > entry.synced) count += 1
    }
    return count + Object.keys(state.books).length + Object.keys(state.completed).length + Object.keys(state.chapters).length
  }

  function snapshot(): ReadingStatsSnapshot {
    const pendingSeconds = Math.floor(unsyncedSeconds())
    return {
      totalSeconds: state.cache.totalSeconds + pendingSeconds,
      openedBooks: state.cache.openedBooks + Object.keys(state.books).length,
      readChapters: state.cache.readChapters + Object.keys(state.chapters).length,
      completedBooks: state.cache.completedBooks + Object.keys(state.completed).length,
      deviceCount: state.cache.deviceCount,
      updatedAt: state.cache.updatedAt,
      pendingSeconds,
      pendingItems: queuedItemCount() + (state.active ? 1 : 0),
      syncing,
      lastSyncedAt,
      syncError,
      sessionActive: Boolean(state.active),
    }
  }

  function syncEntry(sessionId: string, seconds: number) {
    const entry = state.sessions[sessionId] || { seconds: 0, synced: 0 }
    entry.seconds = Math.max(entry.seconds, Math.min(Math.floor(seconds), MAX_SESSION_SECONDS))
    state.sessions[sessionId] = entry
    return entry
  }

  function dropSettledEntry(sessionId: string) {
    const entry = state.sessions[sessionId]
    if (!entry || state.active?.id === sessionId) return
    if (entry.seconds <= entry.synced) delete state.sessions[sessionId]
  }

  /**
   * 切换账号时丢弃上一个账号的待同步数据，避免把 A 的阅读时长记到 B 头上。
   * 空字符串表示“账号未知”（未登录/尚未拉取用户信息），此时保留数据等待登录后的账号。
   */
  function setAccount(account: string) {
    const next = account.trim()
    if (next === state.account) return
    if (state.account && next) {
      state.sessions = {}
      state.books = {}
      state.completed = {}
      state.chapters = {}
      state.cache = { ...EMPTY_READING_STATS }
      state.active = null
      lastKeepaliveKey = ''
    }
    if (next) state.account = next
    persist()
    onChange(snapshot())
  }

  // ─── 旧本地统计一次性迁移 ───
  function mergeLegacyKeys(value: unknown, target: Record<string, number>, normalize: (input: string) => string) {
    if (!Array.isArray(value)) return
    for (const item of value.slice(0, MAX_IMPORT_ITEMS)) {
      const key = normalize(typeof item === 'string' ? item : '')
      if (key) target[key] = 1
    }
  }

  function importLegacyStats() {
    if (state.legacyImported) return
    state.legacyImported = true
    const raw = storage?.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return
    try {
      const legacy = JSON.parse(raw) as Record<string, unknown>
      const seconds = positiveInteger(legacy.totalSeconds)
      // 每台设备一个固定的迁移会话 ID：重复上传只会取最大值，不会翻倍。
      if (seconds > 0) syncEntry(`legacy:${state.deviceId}`, seconds)
      mergeLegacyKeys(legacy.openedBooks, state.books, normalizeBookUrl)
      mergeLegacyKeys(legacy.completedBooks, state.completed, normalizeBookUrl)
      mergeLegacyKeys(legacy.readChapters, state.chapters, normalizeChapterKey)
    } catch {
      // 旧数据损坏时跳过迁移。
    }
  }

  // ─── 会话计时 ───
  function foldActive(timestamp: number) {
    const active = state.active
    if (!active) return
    if (active.visibleSince !== null) active.base += Math.max(0, (timestamp - active.visibleSince) / 1000)
    active.visibleSince = null
    active.updatedAt = timestamp
  }

  function resumeStoredSession() {
    const active = state.active
    if (!active) return
    const timestamp = now()
    if (active.visibleSince !== null) {
      active.base += Math.max(0, (active.updatedAt - active.visibleSince) / 1000)
      active.visibleSince = null
    }
    if (timestamp - active.updatedAt > RESUME_WINDOW_MS) {
      syncEntry(active.id, active.base)
      state.active = null
      dropSettledEntry(active.id)
      return
    }
    // 刷新页面后从账本里已记录的会话总时长继续计时，不能从 0 重新开始。
    active.base = Math.max(active.base, state.sessions[active.id]?.seconds ?? 0)
    active.visibleSince = isVisible() ? timestamp : null
    active.updatedAt = timestamp
  }

  function start() {
    const timestamp = now()
    if (!state.active) {
      const id = makeId()
      state.active = { id, base: 0, visibleSince: isVisible() ? timestamp : null, updatedAt: timestamp }
      syncEntry(id, 0)
    } else if (isVisible() && state.active.visibleSince === null) {
      state.active.visibleSince = timestamp
      state.active.updatedAt = timestamp
    }
    persist()
    onChange(snapshot())
  }

  /** 切后台/息屏：结算当前前台时长并停止计时。 */
  function pause() {
    if (!state.active || state.active.visibleSince === null) return
    foldActive(now())
    syncEntry(state.active.id, activeSeconds())
    persist()
    onChange(snapshot())
  }

  function resume() {
    if (!state.active || state.active.visibleSince !== null) return
    const timestamp = now()
    state.active.visibleSince = timestamp
    state.active.updatedAt = timestamp
    persist()
    onChange(snapshot())
  }

  function stop() {
    if (!state.active) return
    foldActive(now())
    syncEntry(state.active.id, activeSeconds())
    const sessionId = state.active.id
    state.active = null
    dropSettledEntry(sessionId)
    persist()
    onChange(snapshot())
  }

  // ─── 书架/章节并集 ───
  function markBookOpened(bookUrl: string) {
    const url = normalizeBookUrl(bookUrl)
    if (!url) return
    state.books[url] = 1
    persist()
    onChange(snapshot())
  }

  function markChapterRead(bookUrl: string, index: number, totalChapters: number) {
    const key = normalizeChapterKey(chapterKey(bookUrl, index))
    if (!key) return
    state.chapters[key] = 1
    if (Number.isFinite(totalChapters) && totalChapters > 0 && index >= totalChapters - 1) {
      const url = normalizeBookUrl(bookUrl)
      if (url) state.completed[url] = 1
    }
    persist()
    onChange(snapshot())
  }

  // ─── 同步 ───
  function buildUpload(limits = { sessions: MAX_SESSIONS_PER_FLUSH, books: MAX_BOOKS_PER_FLUSH, chapters: MAX_CHAPTERS_PER_FLUSH, completed: MAX_BOOKS_PER_FLUSH }): ReadingStatsUpload {
    const sessions: ReadingStatsUpload['sessions'] = []
    for (const [sessionId, entry] of Object.entries(state.sessions)) {
      if (sessions.length >= limits.sessions) break
      const seconds = Math.min(sessionSeconds(sessionId), MAX_SESSION_SECONDS)
      // 已确认过的会话不必重复上报。
      if (seconds > 0 && seconds > entry.synced) sessions.push({ sessionId, seconds })
    }
    return {
      deviceId: state.deviceId,
      sessions,
      openedBooks: Object.keys(state.books).slice(0, limits.books),
      completedBooks: Object.keys(state.completed).slice(0, limits.completed),
      readChapters: Object.keys(state.chapters).slice(0, limits.chapters),
    }
  }

  function uploadKey(upload: ReadingStatsUpload) {
    return [
      upload.sessions.map((session) => `${session.sessionId}:${session.seconds}`).join(','),
      upload.openedBooks.length,
      upload.completedBooks.length,
      upload.readChapters.length,
    ].join('|')
  }

  function hasUploadWork(upload: ReadingStatsUpload) {
    return upload.sessions.length > 0 || upload.openedBooks.length > 0
      || upload.completedBooks.length > 0 || upload.readChapters.length > 0
  }

  function drainUpload(upload: ReadingStatsUpload) {
    for (const session of upload.sessions) {
      const entry = state.sessions[session.sessionId]
      if (!entry) continue
      entry.seconds = Math.max(entry.seconds, session.seconds)
      entry.synced = Math.max(entry.synced, session.seconds)
      dropSettledEntry(session.sessionId)
    }
    for (const bookUrl of upload.openedBooks) delete state.books[bookUrl]
    for (const bookUrl of upload.completedBooks) delete state.completed[bookUrl]
    for (const key of upload.readChapters) delete state.chapters[key]
  }

  async function flush(): Promise<boolean> {
    if (!send) return false
    if (inFlight) return inFlight
    const upload = buildUpload()
    if (!hasUploadWork(upload)) return false
    syncing = true
    onChange(snapshot())
    inFlight = (async () => {
      try {
        state.cache = normalizeCounters(await send(upload))
        drainUpload(upload)
        lastSyncedAt = now()
        syncError = ''
        return true
      } catch (error) {
        // 网络失败时保留账本，下次同步按会话幂等重发。
        syncError = error instanceof Error && error.message ? error.message : '阅读统计同步失败'
        return false
      } finally {
        syncing = false
        inFlight = null
        persist()
        onChange(snapshot())
      }
    })()
    return inFlight
  }

  function flushKeepalive() {
    if (!sendKeepalive) return
    const upload = buildUpload(KEEPALIVE_LIMITS)
    if (!hasUploadWork(upload)) return
    // 内容没变化就不重复发送，避免频繁切后台时刷请求。
    const key = uploadKey(upload)
    if (key === lastKeepaliveKey) return
    lastKeepaliveKey = key
    // keepalive 请求拿不到响应，不清理账本，后续正常同步会重发。
    sendKeepalive(upload)
  }

  async function refresh() {
    if (!load) return
    await flush()
    try {
      state.cache = normalizeCounters(await load())
      lastSyncedAt = now()
      syncError = ''
    } catch (error) {
      syncError = error instanceof Error && error.message ? error.message : '阅读统计同步失败'
    }
    persist()
    onChange(snapshot())
  }

  importLegacyStats()
  resumeStoredSession()
  persist()

  return {
    snapshot,
    start,
    pause,
    resume,
    stop,
    markBookOpened,
    markChapterRead,
    setAccount,
    flush,
    flushKeepalive,
    refresh,
    hasQueued: () => queuedItemCount() > 0,
  }
}

export type ReadingStatsTracker = ReturnType<typeof createReadingStatsTracker>
