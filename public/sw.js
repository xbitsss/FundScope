const CACHE_PREFIX = 'fundscope-static-v1';
const SHELL_CACHE = `${CACHE_PREFIX}-shell`;
const DATA_CACHE = `${CACHE_PREFIX}-data`;
const scopeUrl = new URL(self.registration.scope);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.add(new URL('./', scopeUrl).href)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('fundscope-static-') && !name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(async (response) => {
    if (response.ok) {
      await cache.put(request, response.clone());
      await response.clone().json().then((manifest) => pruneOldSnapshots(manifest.snapshot_id)).catch(() => undefined);
    }
    return response;
  });
  if (cached) { event.waitUntil(network.catch(() => undefined)); return cached; }
  return network;
}

async function pruneOldSnapshots(snapshotId) {
  if (typeof snapshotId !== 'string' || !snapshotId) return;
  const cache = await caches.open(DATA_CACHE);
  const requests = await cache.keys();
  await Promise.all(requests.map((request) => {
    const url = new URL(request.url);
    if (!url.pathname.includes('/data/')) return false;
    const relative = url.pathname.slice(scopeUrl.pathname.length);
    if (relative.startsWith('data/') && relative !== 'data/manifest.json' && !relative.startsWith(`data/${snapshotId}/`)) return cache.delete(request);
    return false;
  }));
}

async function cacheFirst(request, event) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) event.waitUntil(cache.put(request, response.clone()));
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname)) return;
  const relativePath = url.pathname.slice(scopeUrl.pathname.length);
  if (relativePath === 'data/manifest.json') {
    if (url.searchParams.has('fresh')) {
      event.respondWith(fetch(request).then(async (response) => {
        if (response.ok) await caches.open(DATA_CACHE).then((cache) => cache.put(new URL('data/manifest.json', scopeUrl).href, response.clone()));
        return response;
      }));
      return;
    }
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }
  if (relativePath.startsWith('data/') || relativePath.startsWith('assets/')) {
    event.respondWith(cacheFirst(request, event));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(new URL('./', scopeUrl).href, response.clone())));
      return response;
    }).catch(async () => (await caches.match(new URL('./', scopeUrl).href)) ?? Response.error()));
  }
});
