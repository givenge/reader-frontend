export interface SavedReadingPosition {
  chapterIndex: number
  progress: number
  paragraphIndex?: number
  paragraphProgress?: number
  updatedAt: number
}

export function normalizePositionTimestamp(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return 0
  return value < 1_000_000_000_000 ? value * 1000 : value
}

export function selectSavedReadingPosition(
  localSaved: SavedReadingPosition | null,
  serverSaved: SavedReadingPosition | null,
  chapterIndex: number,
) {
  const local = localSaved?.chapterIndex === chapterIndex ? localSaved : null
  const server = serverSaved?.chapterIndex === chapterIndex ? serverSaved : null

  if (local && typeof local.paragraphIndex === 'number' && Number.isFinite(local.paragraphIndex)) {
    return { position: local, source: 'local' as const }
  }
  if (server && (!local || normalizePositionTimestamp(server.updatedAt) > normalizePositionTimestamp(local.updatedAt))) {
    return { position: server, source: 'server' as const }
  }
  if (local) return { position: local, source: 'local' as const }
  if (server) return { position: server, source: 'server' as const }
  return { position: null, source: 'none' as const }
}
