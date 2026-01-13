const CACHE_NAME = 'prosketch-v3'; // Change this string (v4, v5) to force an update next time
const ASSETS = [
  './',
  './index.html',
  './icon-192.png',
  './icon-512.png', // Ensure this file exists in your folder
  './app.js',
  './engine.js',    // Changed from 'modules.js' to match your app.js import
  './manifest.json',
  'https://esm.sh/perfect-freehand@1.2.0' // Added external lib for offline support
];

// 1. Install: Cache all assets
self.addEventListener('install', (e) => {
  // Force this SW to become active immediately (updates easier)
  self.skipWaiting(); 
  
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Caching assets...');
      return cache.addAll(ASSETS);
    })
  );
});

// 2. Activate: CLEAR OLD CACHES (This is the auto-clear part)
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
    }).then(() => self.clients.claim()) // Take control of all open pages immediately
  );
});

// 3. Fetch: Cache First, fallback to Network
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      // Return cached file if found, otherwise fetch from network
      return response || fetch(e.request);
    })
  );
});
