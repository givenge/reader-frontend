import type { useAppStore } from '../stores/app'
import { canRequestFullscreenDisplay, isIosWebkit } from './pwaDisplay'

type AppStore = ReturnType<typeof useAppStore>

function isLocalhostEnv() {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

async function clearServiceWorkerCaches() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(registrations.map((registration) => registration.unregister()))
  if (typeof window !== 'undefined' && 'caches' in window) {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
  }
}

/**
 * Asks the browser for fullscreen and reports whether it was actually granted.
 * Only Chromium (Android Chrome / installed PWA) honours this for the document;
 * iOS Safari has no element Fullscreen API on iPhone, so this returns false there
 * and the UI must fall back to home-screen instructions.
 *
 * The return value is the observed state after the request, never the mere fact
 * that a call was made — browsers may ignore a request without throwing.
 */
export async function enterFullscreenDisplay(): Promise<boolean> {
  if (typeof document === 'undefined') return false
  const doc = document as Document & { webkitFullscreenElement?: Element | null }
  if (isIosWebkit()) return false
  if (doc.fullscreenElement || doc.webkitFullscreenElement) return true

  if (!canRequestFullscreenDisplay()) return false
  const element = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }
  try {
    if (element.requestFullscreen) await element.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions)
    else if (element.webkitRequestFullscreen) await element.webkitRequestFullscreen()
    else return false
  } catch {
    return false
  }
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement)
}

/** Exits only a Fullscreen API session, not the installed PWA display mode. */
export async function exitFullscreenDisplay(): Promise<boolean> {
  if (typeof document === 'undefined') return false
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null
    webkitExitFullscreen?: () => Promise<void> | void
  }
  if (isIosWebkit()) return false
  if (!doc.fullscreenElement && !doc.webkitFullscreenElement) return false

  try {
    if (doc.exitFullscreen) await doc.exitFullscreen()
    else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen()
    else return false
  } catch {
    return false
  }
  return !doc.fullscreenElement && !doc.webkitFullscreenElement
}

export function registerPwa(appStore: AppStore) {
  if (typeof window === 'undefined') return

  appStore.setOnlineStatus(navigator.onLine)

  window.addEventListener('online', () => {
    appStore.setOnlineStatus(true)
    appStore.showToast('网络已恢复', 'success')
  })

  window.addEventListener('offline', () => {
    appStore.setOnlineStatus(false)
    appStore.showToast('已进入离线模式', 'warning')
  })

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    appStore.setDeferredInstallPrompt(event)
  })

  window.addEventListener('appinstalled', () => {
    appStore.setDeferredInstallPrompt(null)
    appStore.showToast('已安装到主屏幕', 'success')
  })

  if (!('serviceWorker' in navigator)) return

  if (isLocalhostEnv()) {
    window.addEventListener('load', () => {
      void clearServiceWorkerCaches().finally(() => {
        appStore.setPwaReady(false)
      })
    })
    return
  }

  function bindWaitingWorker(worker: ServiceWorker | null | undefined) {
    if (!worker) return
    const wasAvailable = appStore.pwaUpdateAvailable
    appStore.setWaitingServiceWorker(worker)
    appStore.setPwaUpdateAvailable(true)
    worker.postMessage({ type: 'SKIP_WAITING' })
    if (!wasAvailable) {
      appStore.showToast('发现新版本，正在切换', 'success')
    }
  }

  async function checkForUpdates(registration: ServiceWorkerRegistration) {
    try {
      await registration.update()
      if (registration.waiting) {
        bindWaitingWorker(registration.waiting)
      }
    } catch {
      // Ignore update check errors and keep the current app available.
    }
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      appStore.setPwaReady(true)

      if (registration.waiting) {
        bindWaitingWorker(registration.waiting)
      }

      void checkForUpdates(registration)

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            bindWaitingWorker(registration.waiting || installing)
          }
        })
      })

      let refreshing = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return
        refreshing = true
        appStore.setPwaUpdateAvailable(false)
        appStore.setWaitingServiceWorker(null)
        window.location.reload()
      })

      window.setInterval(() => {
        if (!navigator.onLine) return
        void checkForUpdates(registration)
      }, 5 * 60 * 1000)
    }).catch(() => {
      appStore.setPwaReady(false)
    })
  })
}
