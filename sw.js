// Mirror Service Worker v1.0
// Handles background alarms, push notifications, and offline caching

const CACHE = 'mirror-v1';
const ASSETS = ['/', '/index.html', '/icon-192.png', '/icon-512.png'];

// ── INSTALL: cache app shell ──
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      return c.addAll(ASSETS.filter(a => a !== '/icon-192.png' && a !== '/icon-512.png'));
    }).catch(function() {}) // don't fail if icons missing yet
  );
  self.skipWaiting();
});

// ── ACTIVATE: clean old caches ──
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    })
  );
  self.clients.claim();
});

// ── FETCH: serve from cache, fallback to network ──
self.addEventListener('fetch', function(e) {
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(res) {
        if(res && res.status === 200 && e.request.method === 'GET') {
          var clone = res.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return res;
      });
    }).catch(function() {
      return caches.match('/');
    })
  );
});

// ── SCHEDULED ALARMS: store and check ──
var scheduledAlarms = [];

self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'SCHEDULE_ALARM') {
    var task = e.data.task;
    // Remove existing alarm for same task
    scheduledAlarms = scheduledAlarms.filter(function(a) { return a.id !== task.id; });
    scheduledAlarms.push(task);
    
    // Schedule exact-time alarm
    var alarmTime = new Date(task.date + 'T' + task.time).getTime();
    var delay = alarmTime - Date.now();
    
    if (delay > 0) {
      setTimeout(function() {
        triggerAlarm(task);
      }, delay);
    }
  }
  
  if (e.data && e.data.type === 'CANCEL_ALARM') {
    scheduledAlarms = scheduledAlarms.filter(function(a) { return a.id !== e.data.taskId; });
  }
});

function triggerAlarm(task) {
  // Show notification (visible even when app is backgrounded)
  self.registration.showNotification('Mirror — ' + task.title, {
    body: task.note || 'Your reminder is due now',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'mirror-alarm-' + task.id,
    requireInteraction: true,  // stays on screen until dismissed
    vibrate: [500, 200, 500, 200, 500],
    actions: [
      { action: 'done',    title: '✓ Done'      },
      { action: 'snooze',  title: '⏰ Snooze 5m' }
    ],
    data: { taskId: task.id, time: task.time }
  });
  
  // Also message the open app window if visible
  self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(function(clients) {
    clients.forEach(function(client) {
      client.postMessage({ type: 'TRIGGER_ALARM', taskId: task.id });
      client.focus();
    });
  });
}

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var taskId = e.notification.data && e.notification.data.taskId;
  
  if (e.action === 'done') {
    // Tell app to mark done
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      if (clients.length > 0) {
        clients[0].postMessage({ type: 'MARK_DONE', taskId: taskId });
        clients[0].focus();
      }
    });
    return;
  }
  
  if (e.action === 'snooze') {
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      if (clients.length > 0) {
        clients[0].postMessage({ type: 'SNOOZE_ALARM', taskId: taskId });
        clients[0].focus();
      }
    });
    return;
  }
  
  // Default: open/focus app
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      if (clients.length > 0) {
        clients[0].focus();
        clients[0].postMessage({ type: 'TRIGGER_ALARM', taskId: taskId });
        return;
      }
      return self.clients.openWindow('/');
    })
  );
});

// ── PUSH NOTIFICATION (Web Push from Vercel backend) ──
self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data.json(); } catch(err) {}
  
  e.waitUntil(
    self.registration.showNotification(data.title || 'Mirror Reminder', {
      body: data.body || 'You have a task due',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'mirror-push-' + Date.now(),
      requireInteraction: true,
      vibrate: [500, 200, 500],
      data: data
    })
  );
});
