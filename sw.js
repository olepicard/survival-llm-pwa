const CACHE_NAME = 'survival-llm-v3.3';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/api.js',
  './js/webgpu.js',
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
    caches.open(CACHE_NAME).then(async (cache) => {
      // Bypass browser HTTP disk cache during Service Worker installation
      const requests = CORE_ASSETS.map((url) => new Request(url, { cache: 'reload' }));
      await cache.addAll(requests);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((key) => {
        // CRITICAL: Only delete old 'survival-llm-*' caches!
        // NEVER delete WebLLM model caches ('webllm/model', 'webllm/config', 'webllm/wasm', 'tvmjs')!
        if (key.startsWith('survival-llm-') && key !== CACHE_NAME) {
          return caches.delete(key);
        }
      })
    );
    await self.clients.claim();

    // Force any open client tab to reload onto the new Service Worker immediately
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      try {
        await client.navigate(client.url);
      } catch (e) {
        // ignore if navigation is restricted
      }
    }
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // 1. Cross-Origin WebLLM / HuggingFace / GitHub WASM requests:
  // Always serve from local CacheStorage ('webllm/model', 'webllm/config', 'webllm/wasm') with ignoreVary:true
  // if already downloaded once! Never re-download from the Internet once cached.
  if (url.origin !== self.location.origin) {
    if (
      url.hostname.includes('huggingface.co') ||
      url.hostname.includes('hf.co') ||
      url.hostname.includes('raw.githubusercontent.com')
    ) {
      event.respondWith((async () => {
        const cached = await caches.match(event.request, { ignoreVary: true, ignoreSearch: true });
        if (cached) {
          return cached;
        }
        return fetch(event.request);
      })());
    }
    return;
  }

  // 2. 100% Cache-First for ALL Same-Origin PWA assets (HTML, JS, CSS, WebLLM bundle, guides, icons)
  // Once installed, the PWA boots in 0ms from local CacheStorage with ZERO network requests!
  event.respondWith((async () => {
    const cachedResponse = await caches.match(event.request, { ignoreSearch: true, ignoreVary: true });
    if (cachedResponse) {
      return cachedResponse;
    }

    try {
      const networkResponse = await fetch(event.request);
      if (networkResponse && networkResponse.status === 200) {
        const respClone = networkResponse.clone();
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, respClone);
      }
      return networkResponse;
    } catch (err) {
      if (url.pathname.includes('/data/guides_')) {
        const fallbackGuides = await caches.match('./data/guides_index.json', { ignoreSearch: true });
        if (fallbackGuides) return fallbackGuides;
      }
      if (event.request.mode === 'navigate') {
        const fallbackIndex = await caches.match('./index.html', { ignoreSearch: true });
        if (fallbackIndex) return fallbackIndex;
      }
      throw err;
    }
  })());
});
