const CACHE_NAME = 'prosketch-v3'; 
const ASSETS = [
  './',
  './index.html',
  './icon-192.png',
  './icon-512.png',
  './app.js',
  './engine.js',
  './manifest.json',
  'https://esm.sh/perfect-freehand@1.2.0'
];

// 1. Install: Cache core assets immediately
self.addEventListener('install', (e) => {
  self.skipWaiting(); 
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Caching assets...');
      return cache.addAll(ASSETS);
    })
  );
});

// 2. Activate: Clean up old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch: "Stale-While-Revalidate" Strategy
// This is the magic part for smooth updates
self.addEventListener('fetch', (e) => {
  // Only cache GET requests (ignore POST/PUT etc)
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(e.request);
      
      // 3a. Create a promise to fetch the latest version from network
      const networkFetch = fetch(e.request).then((networkResponse) => {
        // Only update cache if we got a valid response (Status 200)
        if (networkResponse && networkResponse.status === 200) {
          cache.put(e.request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(() => {
        // If offline, do nothing (we will fallback to cache below)
      });

      // 3b. Logic: Return Cached version first (speed), but update in background
      if (cachedResponse) {
        // Important: Use waitUntil to keep SW alive while networkFetch finishes
        e.waitUntil(networkFetch); 
        return cachedResponse;
      }

      // 3c. If nothing in cache (first load), wait for network
      return networkFetch;
    })
  );
});
