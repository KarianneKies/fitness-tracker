// sw.js — Service Worker for Fitness Tracker PWA

/**
 * Service Worker for Fitness Tracker
 * 
 * Provides offline capabilities and background sync.
 */

const CACHE_NAME = 'fitness-tracker-v4';

// Always fetch fresh files in development mode
// Uncomment the cache logic for production
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/app.js',
    '/manifest.json'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches and force clients to reload
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
    
    // Force all open clients to reload with the new version
    self.clients.matchAll().then((clients) => {
        clients.forEach(client => client.postMessage({ type: 'SKIP_WAITING' }));
    });
});

// Fetch event - serve from cache, fall back to network
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Fetch event - serve fresh files from network (better for development)
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            // Fallback to cache if offline
            return caches.match(event.request);
        })
    );
});

// Background sync for offline data
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-data') {
        event.waitUntil(syncData());
    }
});

async function syncData() {
    // TODO: Implement background data synchronization
    console.log('Background sync - TODO');
}