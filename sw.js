const CACHE_NAME = 'survival-llm-v2.9';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/api.js',
  './js/webgpu.js',
  './js/webgpu-worker.js',
  './js/vendor/web-llm.js',
  './js/arch.js',
  './js/rag.js',
  './js/db.js',
  './js/emergency.js',
  './js/markdown.js',
  './data/emergency_protocols.json',
  './data/guides_index.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          // CRITICAL: Only delete old 'survival-llm-*' caches!
          // NEVER delete WebLLM model caches ('webllm/model', 'webllm/config', 'webllm/wasm', 'tvmjs')!
          if (key.startsWith('survival-llm-') && key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ONLY intercept same-origin requests!
  // Cross-origin requests (HuggingFace CDN, CloudFront, Ollama on loopback)
  // bypass the Service Worker completely so they are handled directly by the browser & WebLLM cache.
  if (url.origin !== self.location.origin) {
    return;
  }

  // 1. Cache-First for heavy immutable assets (local WebLLM SDK bundle, guide bundles, icons)
  if (
    url.pathname.includes('/data/guides_') ||
    url.pathname.includes('/js/vendor/web-llm.js') ||
    url.pathname.includes('/icons/')
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const respClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, respClone));
            }
            return networkResponse;
          })
          .catch(() => {
            if (url.pathname.includes('/data/guides_')) {
              return caches.match('./data/guides_index.json');
            }
          });
      })
    );
    return;
  }

  // 2. Network-First with Offline Cache Fallback for lightweight app shell (HTML, app JS, CSS)
  // Guarantees instant updates when online and 100% offline availability in Airplane Mode.
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
