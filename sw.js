const CACHE_NAME = 'prosketch-v2';
const ASSETS = [
  './',
  './index.html',
  './icon-192.png',
'./icon-512.png',
  './app.js',
  './modules.js', // Assuming you have this file based on your imports
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request))
  );
});


