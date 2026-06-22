// MyGrind service worker
// Migrated 2026-06-06 from an inline blob registration in softball.html to this
// real same-origin file, because Web Push requires a stable file-based service
// worker (a blob: SW can't receive push). Caching behavior is unchanged from the
// old inline version; cache bumped v326 -> v327. The push/notificationclick
// handlers below are inert until subscriptions + the send cron ship (Phases B/C).

const CACHE = 'ybg-mygrind-v371';
const ASSETS = ['/'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ── Web Push (inert until Phase B/C: client subscription + send cron) ──
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}
  const title = data.title || 'MyGrind';
  const options = {
    body:  data.body  || "Log today's grind. Keep your streak alive.",
    icon:  data.icon  || 'https://www.mygrindapp.com/assets/icon-192.png',
    badge: data.badge || 'https://www.mygrindapp.com/assets/icon-192.png',
    tag:   data.tag   || 'mygrind-daily',
    data:  { url: data.url || '/softball.html#journal' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/softball.html#journal';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) { try { c.navigate(target); } catch (err) {} return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
