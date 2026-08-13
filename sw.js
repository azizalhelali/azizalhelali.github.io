// Service Worker for Mawlawti PWA
const CACHE_NAME = 'mawlawti-v1'
const RUNTIME_CACHE = 'mawlawti-runtime'
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
]

// Install event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS)
    })
  )
  self.skipWaiting()
})

// Activate event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
            return caches.delete(cacheName)
          }
        })
      )
    })
  )
  self.clients.claim()
})

// Fetch event - network first, cache fallback
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return
  }

  // Skip API requests (let them go to network)
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful API responses
          if (response.status === 200) {
            const cache = caches.open(RUNTIME_CACHE)
            cache.then((c) => c.put(event.request, response.clone()))
          }
          return response
        })
        .catch(() => {
          // Fallback to cache for API requests
          return caches.match(event.request)
        })
    )
    return
  }

  // For static assets, use cache-first strategy
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response
      }

      return fetch(event.request).then((response) => {
        // Cache successful responses
        if (response && response.status === 200) {
          const cache = caches.open(CACHE_NAME)
          cache.then((c) => c.put(event.request, response.clone()))
        }
        return response
      })
    })
  )
})

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending-actions') {
    event.waitUntil(syncPendingActions())
  }
})

async function syncPendingActions() {
  const db = await openIndexedDB()
  const pendingActions = await getPendingActions(db)

  for (const action of pendingActions) {
    try {
      await fetch(action.url, {
        method: action.method,
        headers: action.headers,
        body: action.body,
      })

      // Remove from pending after successful sync
      await removePendingAction(db, action.id)
    } catch (error) {
      console.error('Failed to sync action:', error)
    }
  }
}

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mawlawti', 1)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains('pendingActions')) {
        db.createObjectStore('pendingActions', { keyPath: 'id' })
      }
    }
  })
}

function getPendingActions(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('pendingActions', 'readonly')
    const store = transaction.objectStore('pendingActions')
    const request = store.getAll()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function removePendingAction(db, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('pendingActions', 'readwrite')
    const store = transaction.objectStore('pendingActions')
    const request = store.delete(id)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

// Push notifications
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json()
    const options = {
      body: data.message,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'mawlawti-notification',
      requireInteraction: data.requireInteraction || false,
    }

    event.waitUntil(self.registration.showNotification(data.title || 'لوحتي', options))
  }
})

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // Check if window is already open
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus()
        }
      }

      // Otherwise, open new window
      if (clients.openWindow) {
        return clients.openWindow('/')
      }
    })
  )
})
