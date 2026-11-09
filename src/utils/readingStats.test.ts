import { describe, expect, it } from 'vitest'
import {
  createReadingStatsTracker,
  formatReadingDuration,
  formatReadingStatsSummary,
  MAX_CHAPTERS_PER_FLUSH,
} from './readingStats'
import type { ReadingStatsCounters, ReadingStatsUpload } from '../api/readingStats'

const EMPTY: ReadingStatsCounters = {
  totalSeconds: 0, openedBooks: 0, readChapters: 0, completedBooks: 0, deviceCount: 0, updatedAt: 0,
}

function createStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed))
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

type Storage = ReturnType<typeof createStorage>

/** 与服务端语义一致的假服务端：会话取最大值，书籍/章节取并集。 */
function createFakeServer() {
  const sessions = new Map<string, number>()
  const books = new Set<string>()
  const chapters = new Set<string>()
  const completed = new Set<string>()
  const devices = new Set<string>()
  const counters = { ...EMPTY }
  return {
    counters,
    uploads: [] as ReadingStatsUpload[],
    failNext: false,
    apply(upload: ReadingStatsUpload) {
      if (this.failNext) { this.failNext = false; throw new Error('offline') }
      for (const session of upload.sessions) {
        const previous = sessions.get(session.sessionId) ?? 0
        counters.totalSeconds += Math.max(0, session.seconds - previous)
        sessions.set(session.sessionId, Math.max(previous, session.seconds))
      }
      for (const bookUrl of upload.openedBooks) books.add(bookUrl)
      for (const key of upload.readChapters) chapters.add(key)
      for (const bookUrl of upload.completedBooks) completed.add(bookUrl)
      devices.add(upload.deviceId)
      counters.openedBooks = books.size
      counters.readChapters = chapters.size
      counters.completedBooks = completed.size
      counters.deviceCount = devices.size
      counters.updatedAt += 1
      return { ...counters }
    },
  }
}

function createHarness(options: {
  storage?: Storage
  clock?: { value: number }
  createId?: () => string
  visible?: boolean
  server?: ReturnType<typeof createFakeServer>
} = {}) {
  const storage = options.storage ?? createStorage()
  const clock = options.clock ?? { value: 1_700_000_000_000 }
  const server = options.server ?? createFakeServer()
  const keepaliveUploads: ReadingStatsUpload[] = []
  let visible = options.visible ?? true
  let idCounter = 0

  const tracker = createReadingStatsTracker({
    storage,
    now: () => clock.value,
    createId: options.createId ?? (() => `id-${++idCounter}`),
    isVisible: () => visible,
    send: async (upload) => {
      server.uploads.push(upload)
      return server.apply(upload)
    },
    load: async () => ({ ...server.counters }),
    sendKeepalive: (upload) => { keepaliveUploads.push(upload) },
  })
  return {
    tracker, storage, clock, server, keepaliveUploads,
    advance: (seconds: number) => { clock.value += seconds * 1000 },
    setVisible: (value: boolean) => { visible = value },
  }
}

describe('reading stats tracker', () => {
  it('counts only foreground time and pauses while hidden', async () => {
    const harness = createHarness()
    harness.tracker.start()
    harness.advance(120)
    harness.setVisible(false)
    harness.tracker.pause()
    harness.advance(600)
    harness.setVisible(true)
    harness.tracker.resume()
    harness.advance(60)

    expect(harness.tracker.snapshot().totalSeconds).toBe(180)
    await harness.tracker.flush()
    expect(harness.server.uploads[0]?.sessions).toEqual([{ sessionId: 'id-1', seconds: 180 }])
    expect(harness.server.counters.totalSeconds).toBe(180)
    // 同步成功后不会重复计入展示数值。
    expect(harness.tracker.snapshot().totalSeconds).toBe(180)
    expect(harness.tracker.hasQueued()).toBe(false)
  })

  it('does not count time when the reader is not visible', () => {
    const harness = createHarness({ visible: false })
    harness.tracker.start()
    harness.advance(300)
    expect(harness.tracker.snapshot().totalSeconds).toBe(0)
    expect(harness.tracker.snapshot().sessionActive).toBe(true)
  })

  it('keeps a session idempotent across repeated uploads', async () => {
    const harness = createHarness()
    harness.tracker.start()
    harness.advance(60)
    await harness.tracker.flush()
    expect(harness.server.uploads).toHaveLength(1)
    // 没有新的时长时不会重复上报。
    await harness.tracker.flush()
    expect(harness.server.uploads).toHaveLength(1)

    harness.advance(60)
    await harness.tracker.flush()
    expect(harness.server.uploads[1]?.sessions[0]?.seconds).toBe(120)
    expect(harness.server.counters.totalSeconds).toBe(120)
    expect(harness.tracker.snapshot().totalSeconds).toBe(120)
  })

  it('keeps pending data when an upload fails and retries later', async () => {
    const harness = createHarness()
    harness.server.failNext = true
    harness.tracker.start()
    harness.advance(90)
    harness.tracker.stop()
    await harness.tracker.flush()

    const failed = harness.tracker.snapshot()
    expect(failed.syncError).toBe('offline')
    expect(failed.totalSeconds).toBe(90)
    expect(failed.pendingSeconds).toBe(90)
    expect(harness.tracker.hasQueued()).toBe(true)

    await harness.tracker.flush()
    const synced = harness.tracker.snapshot()
    expect(synced.syncError).toBe('')
    expect(synced.totalSeconds).toBe(90)
    expect(synced.pendingSeconds).toBe(0)
    expect(harness.server.counters.totalSeconds).toBe(90)
    expect(harness.tracker.hasQueued()).toBe(false)
  })

  it('merges opened books, read chapters and completed books into the queue', async () => {
    const harness = createHarness()
    harness.tracker.markBookOpened('https://book.test/1')
    harness.tracker.markChapterRead('https://book.test/1', 0, 3)
    harness.tracker.markChapterRead('https://book.test/1', 2, 3)
    harness.tracker.markChapterRead('https://book.test/1', 2, 3)

    const snapshot = harness.tracker.snapshot()
    expect(snapshot.openedBooks).toBe(1)
    expect(snapshot.readChapters).toBe(2)
    expect(snapshot.completedBooks).toBe(1)

    await harness.tracker.flush()
    expect(harness.server.uploads[0]?.readChapters).toEqual([
      'https://book.test/1#0', 'https://book.test/1#2',
    ])
    expect(harness.tracker.snapshot().totalSeconds).toBe(0)
  })

  it('ignores malformed book data', () => {
    const harness = createHarness()
    harness.tracker.markBookOpened('')
    harness.tracker.markBookOpened(`https://book.test/${'x'.repeat(5000)}`)
    harness.tracker.markChapterRead('https://book.test/1', Number.NaN, 3)
    expect(harness.tracker.snapshot().pendingItems).toBe(0)
  })

  it('sends a keepalive snapshot without clearing pending data', async () => {
    const harness = createHarness()
    harness.tracker.start()
    harness.advance(45)
    harness.tracker.flushKeepalive()
    expect(harness.keepaliveUploads).toHaveLength(1)
    expect(harness.keepaliveUploads[0]?.sessions[0]?.seconds).toBe(45)
    // 内容没变时不重复上报；频繁切后台不会刷请求。
    harness.tracker.flushKeepalive()
    expect(harness.keepaliveUploads).toHaveLength(1)

    expect(harness.tracker.snapshot().totalSeconds).toBe(45)
    expect(harness.tracker.snapshot().pendingSeconds).toBe(45)
    // 随后正常同步会带上同样的会话总时长，服务端幂等合并。
    harness.advance(15)
    await harness.tracker.flush()
    expect(harness.server.uploads[0]?.sessions[0]?.seconds).toBe(60)
    expect(harness.server.counters.totalSeconds).toBe(60)
    expect(harness.tracker.snapshot().totalSeconds).toBe(60)
    expect(harness.tracker.snapshot().pendingSeconds).toBe(0)
  })

  it('imports legacy local stats once and chunks oversized queues', async () => {
    const legacyChapters = Array.from(
      { length: MAX_CHAPTERS_PER_FLUSH + 5 },
      (_, index) => `https://book.test/legacy#${index}`,
    )
    const storage = createStorage({
      'reader-stats': JSON.stringify({
        totalSeconds: 3600,
        openedBooks: ['https://book.test/legacy'],
        readChapters: legacyChapters,
        completedBooks: [],
      }),
      'reader-device-id': 'device-legacy',
    })
    const server = createFakeServer()
    const harness = createHarness({ storage, server })

    const migrated = harness.tracker.snapshot()
    expect(migrated.totalSeconds).toBe(3600)
    expect(migrated.openedBooks).toBe(1)
    expect(migrated.readChapters).toBe(MAX_CHAPTERS_PER_FLUSH + 5)
    expect(harness.tracker.hasQueued()).toBe(true)

    expect(await harness.tracker.flush()).toBe(true)
    expect(server.uploads[0]?.sessions).toEqual([{ sessionId: 'legacy:device-legacy', seconds: 3600 }])
    expect(server.uploads[0]?.readChapters).toHaveLength(MAX_CHAPTERS_PER_FLUSH)
    expect(harness.tracker.hasQueued()).toBe(true)

    expect(await harness.tracker.flush()).toBe(true)
    expect(server.uploads[1]?.readChapters).toHaveLength(5)
    expect(harness.tracker.hasQueued()).toBe(false)
    expect(server.counters.totalSeconds).toBe(3600)
    expect(server.counters.readChapters).toBe(MAX_CHAPTERS_PER_FLUSH + 5)

    // 重新加载页面：迁移过的不再入队，展示保留服务端缓存。
    const rehydrated = createHarness({ storage, server })
    expect(rehydrated.tracker.hasQueued()).toBe(false)
    expect(rehydrated.tracker.snapshot().totalSeconds).toBe(3600)
    expect(rehydrated.tracker.snapshot().readChapters).toBe(MAX_CHAPTERS_PER_FLUSH + 5)
  })

  it('resumes the same session after a quick reload but starts a new one later', async () => {
    const storage = createStorage()
    const clock = { value: 1_700_000_000_000 }
    const server = createFakeServer()
    const first = createHarness({ storage, clock, server })
    first.tracker.start()
    first.advance(100)
    await first.tracker.flush()

    // 快速刷新：继续同一个会话，不产生第二段会话。
    const quickReload = createHarness({ storage, clock, server, createId: () => 'restarted' })
    expect(quickReload.tracker.snapshot().totalSeconds).toBe(100)
    quickReload.tracker.start()
    quickReload.advance(50)
    quickReload.setVisible(false)
    quickReload.tracker.pause()
    await quickReload.tracker.flush()
    expect(quickReload.server.uploads.map((upload) => upload.sessions[0]?.sessionId)).toEqual(['id-1', 'id-1'])
    expect(quickReload.server.counters.totalSeconds).toBe(150)

    // 间隔超过一小时后重开：新的会话，之前累计的时长保留。
    clock.value += 2 * 60 * 60 * 1000
    const lateReload = createHarness({ storage, clock, server, createId: () => 'late-session' })
    expect(lateReload.tracker.snapshot().totalSeconds).toBe(150)
    lateReload.tracker.start()
    lateReload.advance(30)
    expect(lateReload.tracker.snapshot().totalSeconds).toBe(180)
    await lateReload.tracker.flush()
    expect(lateReload.server.counters.totalSeconds).toBe(180)
    expect(lateReload.tracker.snapshot().pendingSeconds).toBe(0)
  })

  it('keeps data for an unknown account but drops it when another account signs in', async () => {
    const harness = createHarness()
    harness.tracker.start()
    harness.advance(120)
    harness.tracker.pause()
    // 未登录 → 登录：本地已统计的时长保留并归属该账号。
    harness.tracker.setAccount('alice')
    expect(harness.tracker.snapshot().totalSeconds).toBe(120)
    harness.tracker.setAccount('alice')
    expect(harness.tracker.snapshot().totalSeconds).toBe(120)

    // 同一台设备换账号：上一个账号未同步的数据不再上传。
    harness.tracker.setAccount('bob')
    expect(harness.tracker.snapshot().totalSeconds).toBe(0)
    harness.tracker.start()
    harness.advance(30)
    harness.tracker.pause()
    await harness.tracker.flush()
    expect(harness.server.uploads).toHaveLength(1)
    expect(harness.server.uploads[0]?.sessions).toEqual([{ sessionId: 'id-2', seconds: 30 }])
    expect(harness.server.counters.totalSeconds).toBe(30)
  })

  it('refreshes server counters and formats the summary text', async () => {
    const harness = createHarness()
    Object.assign(harness.server.counters, {
      totalSeconds: 3720, openedBooks: 3, readChapters: 12, completedBooks: 1, deviceCount: 2,
    })
    await harness.tracker.refresh()
    const snapshot = harness.tracker.snapshot()
    expect(snapshot.totalSeconds).toBe(3720)
    expect(snapshot.deviceCount).toBe(2)
    expect(snapshot.syncing).toBe(false)

    const summary = formatReadingStatsSummary(snapshot)
    expect(summary.totalTimeText).toBe('1小时2分钟')
    expect(summary.hasPending).toBe(false)
    expect(formatReadingDuration(0)).toBe('0分钟')
    expect(formatReadingDuration(59)).toBe('0分钟')
    expect(formatReadingDuration(60)).toBe('1分钟')
    expect(formatReadingDuration(90)).toBe('1分钟')
  })
})
