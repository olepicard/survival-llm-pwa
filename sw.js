const CACHE_NAME = 'survival-llm-v2.2';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/api.js',
  './js/webgpu.js',
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
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // NEVER intercept or cache external LLM API calls (Ollama, OpenAI, Edge Gallery, LocalAI)
  // or WebGPU weight downloads (HuggingFace, jsDelivr, esm.run which have their own CacheStorage)
  if (
    url.port === '11434' ||
    url.port === '8080' ||
    url.port === '5000' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/v1/') ||
    url.hostname.includes('huggingface.co') ||
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('esm.run')
  ) {
    return;
  }

  // Cache-first for all guide data files: ensures immediate offline availability without delays
  if (url.pathname.includes('/data/guides_')) {
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
            return caches.match('./data/guides_index.json');
          });
      })
    );
    return;
  }

  // Cache-first for core assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
