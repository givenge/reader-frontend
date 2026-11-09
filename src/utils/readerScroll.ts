export const CONTINUOUS_PRUNE_IDLE_MS = 400
export const CONTINUOUS_PREFETCH_VIEWPORTS = 1.5

export function createDebouncedTask(task: () => void, delayMs = CONTINUOUS_PRUNE_IDLE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule() {
    cancel()
    timer = setTimeout(() => {
      timer = null
      task()
    }, delayMs)
  }

  return { schedule, cancel }
}

export function getSafePruneBeforeIndex(
  sections: Array<{ index: number; bottom: number }>,
  targetIndex: number,
  viewportTop: number,
) {
  const firstVisibleReadSection = sections.find((section) =>
    section.index < targetIndex && section.bottom > viewportTop,
  )
  return firstVisibleReadSection?.index ?? targetIndex
}

export function shouldPrefetchContinuousChapter(remainingScroll: number, viewportHeight: number) {
  return viewportHeight > 0 && remainingScroll <= viewportHeight * CONTINUOUS_PREFETCH_VIEWPORTS
}
