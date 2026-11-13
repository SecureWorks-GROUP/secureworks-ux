// SecureWorks Crew service worker. Scope: this folder only, so the current
// Trade App's own worker (scope /secureworks-ux/) is left alone.
// App files: network first (updates land straight away), saved copy when
// there is no signal. Fonts and vendored libraries: saved copy first.
// Server calls (Supabase) are never touched.
const CACHE = 'crew-shell-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css', './css/more.css', './css/pay.css', './css/reports.css', './css/manager.css',
  './fonts/archivo-var.woff2', './vendor/supabase.js', './vendor/preact.js', './vendor/preact-hooks.js', './vendor/htm.js',
  './js/main.js', './icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('crew-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function fromNetwork(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then((res) => {
      clearTimeout(timer);
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {}); }
      resolve(res);
    }, (err) => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return;
  const slow = /\/(fonts|vendor|icons)\//.test(url.pathname);
  if (slow) {
    event.respondWith(caches.match(req).then((hit) => hit || fromNetwork(req, 15000)));
    return;
  }
  const key = req.mode === 'navigate' ? new Request(new URL('./index.html', self.location).href) : req;
  event.respondWith(fromNetwork(req, 4000).catch(() => caches.match(key, { ignoreSearch: true }).then((hit) => hit || caches.match(new URL('./index.html', self.location).href))));
});
