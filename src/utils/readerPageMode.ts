export type ReaderPageMode = 'auto' | 'mobile'

export const MOBILE_READER_BREAKPOINT = 768

export function shouldUseMobileReaderLayout(pageMode: ReaderPageMode, isMobileViewport: boolean) {
  return pageMode === 'mobile' || isMobileViewport
}
