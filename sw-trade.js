// ════════════════════════════════════════════════════════════
// SecureWorks Trade — Service Worker
//
// Caches the app shell so the login screen + UI loads instantly.
// API calls always go to network (no stale data for job lists).
// ════════════════════════════════════════════════════════════

const CACHE_NAME = 'sw-trade-v44'

// App shell — these files are cached for instant load
const SHELL_FILES = [
  '/secureworks-ux/trade.html',
  '/secureworks-ux/shared/brand.js',
  '/secureworks-ux/shared/cloud.js',
  '/secureworks-ux/fonts/ibm-plex-mono/ibm-plex-mono-400.woff2',
  '/secureworks-ux/fonts/ibm-plex-mono/ibm-plex-mono-600.woff2',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
]

// Install — cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_FILES)
    })
  )
  // Activate immediately (don't wait for tabs to close)
  self.skipWaiting()
})

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    })
  )
  // Take control of all open tabs immediately
  self.clients.claim()
})

// Fetch — network-first for API, cache-first for shell
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Only handle trade.html and its assets — let other pages (ops, ceo, sale) pass through.
  // '/fonts/' is included so the self-hosted IBM Plex Mono woff2 files are served
  // cache-first (they render the Briefing ops chrome offline).
  if (!url.pathname.includes('trade') && !url.pathname.includes('/shared/') && !url.pathname.includes('/fonts/') && !SHELL_FILES.includes(url.href)) {
    return // Not a trade app resource — don't intercept
  }

  // API calls and auth — always network, never cache
  if (
    url.pathname.includes('/functions/') ||
    url.pathname.includes('/auth/') ||
    url.hostname.includes('supabase.co')
  ) {
    return // Let browser handle normally (network only)
  }

  // HTML files — network-first (always get latest code, fall back to cache offline)
  if (event.request.destination === 'document' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      }).catch(() => caches.match(event.request))
    )
    return
  }

  // Other shell files (JS, CSS) — cache-first with background update
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      }).catch(() => cached)

      return cached || fetchPromise
    })
  )
})
