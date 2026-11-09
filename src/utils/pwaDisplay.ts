/**
 * Platform capability helpers behind the reader's 全屏阅读 button.
 *
 * iOS WebKit cannot hide the operating-system status bar from a web page: iPhone
 * has no element Fullscreen API, and a Home Screen launch (`navigator.standalone`)
 * only lets content flow under the status bar instead of removing it. Keep that
 * capability check separate from "is the site installed" so the button never
 * reports a state the browser cannot actually enter.
 */

export function isIosWebkit() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1)
}

function fullscreenElement() {
  if (typeof document === 'undefined') return null
  const doc = document as Document & { webkitFullscreenElement?: Element | null }
  return doc.fullscreenElement || doc.webkitFullscreenElement || null
}

/** True while a real Fullscreen API session is active — the only state that hides the OS status bar. */
export function isFullscreenApiActive() {
  return Boolean(fullscreenElement())
}

/** Whether the document can actually be sent fullscreen. Always false on iOS WebKit. */
export function canRequestFullscreenDisplay() {
  if (typeof document === 'undefined' || isIosWebkit()) return false
  const element = document.documentElement as (HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }) | undefined
  return Boolean(element?.requestFullscreen || element?.webkitRequestFullscreen)
}
