// Offline service worker of the Vakana web build.
// scripts/build-sw.mjs writes CACHE (the cache name of this build) and FILES
// (every file of the build, as URL paths) above this code.
/* global CACHE, FILES */

// The page must stay cross-origin isolated when it comes from the cache:
// SQLite needs SharedArrayBuffer to persist the journal.
const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// A request can spell a path with or without percent-encoding ("@" or "%40").
const key = (path) => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};
const BY_PATH = new Map(FILES.map((file) => [key(file), file]));

function isolated(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(ISOLATION)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll rejects if one file fails: the install fails and the old build stays.
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' }))))
  );
});

// A new build waits while a page of the old build is open: that page keeps the
// old service worker and the old cache, so it never mixes two builds. The page
// sends SKIP_WAITING when it is ready to reload (src/web/pwaUpdate.js).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'BUILD') event.source.postMessage({ type: 'BUILD', cache: CACHE });
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('vakana-') && name !== CACHE)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // The app is a single page: every navigation gets the cached shell.
  const file = request.mode === 'navigate' ? '/index.html' : BY_PATH.get(key(url.pathname));
  if (!file) return;
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(file, { ignoreVary: true }))
      .then((cached) => (cached ? isolated(cached) : fetch(request)))
  );
});
