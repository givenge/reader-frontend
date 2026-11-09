import { defineStore } from 'pinia'
import { ref, watch, computed } from 'vue'
import { getUserInfo } from '../api/user'
import { useReadingStatsStore } from './readingStats'
import { dismissVersionUpdate, getVersionUpdate } from '../api/update'
import type { UserInfo, VersionUpdateInfo } from '../types'
import { applySystemTheme } from '../utils/systemUi'
import { computeNeedSecureKey, readStoredSecureKey, SECURE_KEY_STORAGE_KEY } from '../utils/secureAccess'

export const useAppStore = defineStore('app', () => {
  // ─── Theme ───
  const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null
  const legacyReaderNight = localStorage.getItem('reader-isNight') === 'true'
  const theme = ref<'light' | 'dark'>(
    savedTheme || (legacyReaderNight ? 'dark' : 'light')
  )

  function setTheme(value: 'light' | 'dark') {
    theme.value = value
    localStorage.setItem('theme', value)
    applySystemTheme(value)
  }

  function toggleTheme() {
    setTheme(theme.value === 'light' ? 'dark' : 'light')
  }

  watch(theme, (val) => {
    localStorage.setItem('theme', val)
    applySystemTheme(val)
  }, { immediate: true })

  // ─── User ───
  const userInfo = ref<UserInfo | null>(null)
  const isSecureMode = ref(false)
  const needSecureKey = ref(false)
  const secureKeyRequired = ref(false)
  const adminAuthorized = ref(false)
  const isLoggedIn = ref(false)
  const secureKey = ref(readStoredSecureKey())
  const versionUpdate = ref<VersionUpdateInfo | null>(null)
  const versionUpdateLoading = ref(false)
  const versionUpdateChecked = ref(false)
  let versionUpdateToastVersion = ''
  const canCheckVersionUpdate = computed(() => !isSecureMode.value || adminAuthorized.value)
  const hasVersionUpdateReminder = computed(() => !!versionUpdate.value?.shouldRemind)

  async function fetchUserInfo() {
    try {
      const data = await getUserInfo()
      userInfo.value = data.userInfo
      useReadingStatsStore().setAccount(data.userInfo?.username || '')
      isSecureMode.value = data.secure
      secureKeyRequired.value = data.secureKeyRequired
      adminAuthorized.value = data.adminAuthorized
      needSecureKey.value = computeNeedSecureKey({
        secure: data.secure,
        secureKeyRequired: data.secureKeyRequired,
        adminAuthorized: data.adminAuthorized,
      })
      isLoggedIn.value = !!data.userInfo?.username
      if (canCheckVersionUpdate.value) {
        void checkVersionUpdate()
      }
    } catch {
      isLoggedIn.value = false
    }
  }

  function setUser(user: UserInfo) {
    userInfo.value = user
    useReadingStatsStore().setAccount(user.username)
    isLoggedIn.value = true
    adminAuthorized.value = adminAuthorized.value || !!user.isAdmin
    needSecureKey.value = computeNeedSecureKey({
      secure: isSecureMode.value,
      secureKeyRequired: secureKeyRequired.value,
      adminAuthorized: adminAuthorized.value,
    })
    localStorage.setItem('accessToken', user.accessToken)
    if (canCheckVersionUpdate.value) {
      void checkVersionUpdate()
    }
  }

  function clearUser() {
    userInfo.value = null
    isLoggedIn.value = false
    localStorage.removeItem('accessToken')
  }

  function setSecureKey(value: string) {
    const next = value.trim()
    secureKey.value = next
    if (next) {
      localStorage.setItem(SECURE_KEY_STORAGE_KEY, next)
    } else {
      localStorage.removeItem(SECURE_KEY_STORAGE_KEY)
    }
  }

  function updateUserInfo(next: UserInfo | null) {
    userInfo.value = next
    isLoggedIn.value = !!next?.username
    useReadingStatsStore().setAccount(next?.username || '')
  }

  async function checkVersionUpdate(force = false) {
    if (versionUpdateLoading.value) return versionUpdate.value
    versionUpdateLoading.value = true
    try {
      const info = await getVersionUpdate(force)
      versionUpdate.value = info
      versionUpdateChecked.value = true
      if (info.shouldRemind && info.latestVersion && versionUpdateToastVersion !== info.latestVersion) {
        versionUpdateToastVersion = info.latestVersion
        showToast(`发现服务端新版本 ${info.latestVersion}`, 'warning')
      }
      return info
    } catch (error) {
      if (force) {
        showToast((error as Error).message || '检查更新失败', 'error')
      }
      return null
    } finally {
      versionUpdateLoading.value = false
    }
  }

  async function dismissVersionUpdateReminder(version = versionUpdate.value?.latestVersion || '') {
    if (!version) {
      showToast('当前没有可忽略的版本', 'warning')
      return null
    }
    versionUpdateLoading.value = true
    try {
      const info = await dismissVersionUpdate(version)
      versionUpdate.value = info
      versionUpdateToastVersion = version
      showToast('已忽略当前版本更新提醒', 'success')
      return info
    } catch (error) {
      showToast((error as Error).message || '忽略版本失败', 'error')
      return null
    } finally {
      versionUpdateLoading.value = false
    }
  }

  // ─── UI State ───
  const showLoginModal = ref(false)
  const showSettingsDrawer = ref(false)
  const showSourceManager = ref(false)
  const showUserManager = ref(false)
  const showWebdavManager = ref(false)
  const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const pwaReady = ref(false)
  const pwaUpdateAvailable = ref(false)
  const deferredInstallPrompt = ref<any>(null)
  const waitingServiceWorker = ref<ServiceWorker | null>(null)

  // ─── Toast ───
  const toasts = ref<Array<{ id: number; message: string; type: string }>>([])
  let toastId = 0

  function showToast(message: string, type: 'success' | 'error' | 'warning' = 'success') {
    const id = ++toastId
    toasts.value.push({ id, message, type })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 3000)
  }

  function setOnlineStatus(value: boolean) {
    isOnline.value = value
  }

  function setPwaReady(value: boolean) {
    pwaReady.value = value
  }

  function setPwaUpdateAvailable(value: boolean) {
    pwaUpdateAvailable.value = value
  }

  function setWaitingServiceWorker(value: ServiceWorker | null) {
    waitingServiceWorker.value = value
  }

  function setDeferredInstallPrompt(value: any) {
    deferredInstallPrompt.value = value
  }

  async function installPwa() {
    if (!deferredInstallPrompt.value) return false
    deferredInstallPrompt.value.prompt()
    const result = await deferredInstallPrompt.value.userChoice.catch(() => null)
    deferredInstallPrompt.value = null
    return result?.outcome === 'accepted'
  }

  function applyPwaUpdate() {
    if (!waitingServiceWorker.value) return false
    waitingServiceWorker.value.postMessage({ type: 'SKIP_WAITING' })
    return true
  }

  return {
    theme, setTheme, toggleTheme,
    userInfo, isSecureMode, needSecureKey, secureKeyRequired, adminAuthorized, secureKey, isLoggedIn,
    versionUpdate, versionUpdateLoading, versionUpdateChecked, canCheckVersionUpdate, hasVersionUpdateReminder,
    fetchUserInfo, setUser, clearUser, setSecureKey, updateUserInfo, checkVersionUpdate, dismissVersionUpdateReminder,
    showLoginModal, showSettingsDrawer, showSourceManager, showUserManager, showWebdavManager,
    isOnline, pwaReady, pwaUpdateAvailable, deferredInstallPrompt, waitingServiceWorker,
    setOnlineStatus, setPwaReady, setPwaUpdateAvailable, setDeferredInstallPrompt, setWaitingServiceWorker, installPwa, applyPwaUpdate,
    toasts, showToast,
  }
})
