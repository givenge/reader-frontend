import type { SavedReadingPosition } from './readerPosition'

interface ScrollContainer {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
  scrollTo: (options: { top: number; behavior: ScrollBehavior }) => void
}

interface ParagraphAnchor {
  offsetHeight: number
  getBoundingClientRect: () => { top: number }
}

export function restoreChapterReadingPosition(
  container: ScrollContainer,
  saved: SavedReadingPosition,
  anchorOffset: number,
  paragraph?: ParagraphAnchor,
  containerTop = 0,
) {
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
  const progress = Math.max(0, Math.min(1, saved.progress || 0))
  let targetTop = maxScroll * progress

  if (paragraph && typeof saved.paragraphIndex === 'number') {
    const paragraphTop = paragraph.getBoundingClientRect().top - containerTop + container.scrollTop
    const paragraphProgress = Math.max(0, Math.min(1, saved.paragraphProgress || 0))
    targetTop = paragraphTop + paragraph.offsetHeight * paragraphProgress - anchorOffset
  }

  const boundedTop = Math.max(0, Math.min(maxScroll, targetTop))
  container.scrollTo({ top: boundedTop, behavior: 'auto' })
  return boundedTop
}
