import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getReadingStats, saveReadingStats, saveReadingStatsKeepalive } from '../api/readingStats'
import {
  createReadingStatsTracker,
  formatReadingStatsSummary,
  type ReadingStatsSnapshot,
} from '../utils/readingStats'

// 阅读统计：服务端为唯一数据源，本地只做展示缓存与待同步队列。
export const useReadingStatsStore = defineStore('readingStats', () => {
  const snapshot = ref<ReadingStatsSnapshot>({
    totalSeconds: 0,
    openedBooks: 0,
    readChapters: 0,
    completedBooks: 0,
    deviceCount: 0,
    updatedAt: 0,
    pendingSeconds: 0,
    pendingItems: 0,
    syncing: false,
    lastSyncedAt: 0,
    syncError: '',
    sessionActive: false,
  })

  const tracker = createReadingStatsTracker({
    send: saveReadingStats,
    load: getReadingStats,
    sendKeepalive: saveReadingStatsKeepalive,
    onChange: (next) => {
      snapshot.value = next
    },
  })
  snapshot.value = tracker.snapshot()

  const summary = computed(() => formatReadingStatsSummary(snapshot.value))

  // 历史本地统计可能一次导入很多条，上线后连续补传几轮把队列清空。
  async function drainBacklog(maxRounds = 8) {
    for (let round = 0; round < maxRounds; round += 1) {
      if (!tracker.hasQueued()) return
      if (!(await tracker.flush())) return
    }
  }

  function startReadingSession() {
    tracker.start()
    void drainBacklog()
  }

  function pauseReadingSession() {
    tracker.pause()
    tracker.flushKeepalive()
  }

  function resumeReadingSession() {
    tracker.resume()
  }

  async function stopReadingSession() {
    tracker.stop()
    await tracker.flush()
  }

  /** 账号变化时由 app store 通知，避免跨账号串数据。 */
  function setAccount(account: string) {
    tracker.setAccount(account)
  }

  function markBookOpened(bookUrl: string) {
    tracker.markBookOpened(bookUrl)
  }

  function markChapterRead(bookUrl: string, index: number, totalChapters: number) {
    tracker.markChapterRead(bookUrl, index, totalChapters)
  }

  async function flushReadingStats() {
    await tracker.flush()
  }

  function flushReadingStatsKeepalive() {
    tracker.flushKeepalive()
  }

  async function refreshReadingStats() {
    await drainBacklog()
    await tracker.refresh()
  }

  return {
    snapshot, summary,
    startReadingSession, pauseReadingSession, resumeReadingSession, stopReadingSession, setAccount,
    markBookOpened, markChapterRead,
    flushReadingStats, flushReadingStatsKeepalive, refreshReadingStats,
  }
})
