import http from './http'
import { buildAuthHeaderValues } from '../utils/secureAccess'

export interface ReadingStatsCounters {
  totalSeconds: number
  openedBooks: number
  readChapters: number
  completedBooks: number
  deviceCount: number
  updatedAt: number
}

export interface ReadingStatsUpload {
  deviceId: string
  sessions: Array<{ sessionId: string; seconds: number }>
  openedBooks: string[]
  readChapters: string[]
  completedBooks: string[]
}

export function getReadingStats() {
  return http.get<ReadingStatsCounters>('/getReadingStats').then((r) => r.data)
}

export function saveReadingStats(payload: ReadingStatsUpload) {
  return http.post<ReadingStatsCounters>('/saveReadingStats', payload).then((r) => r.data)
}

/**
 * 页面隐藏/离开时的兜底上报：keepalive 请求不等待响应，也不清理本地待同步数据，
 * 下次正常同步时按会话幂等重发即可。
 */
export function saveReadingStatsKeepalive(payload: ReadingStatsUpload) {
  if (typeof fetch === 'undefined') return
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const { accessToken, secureKey } = buildAuthHeaderValues(localStorage)
  if (accessToken) headers.Authorization = accessToken
  if (secureKey) headers['X-Secure-Key'] = secureKey
  void fetch('/reader3/saveReadingStats', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined)
}
