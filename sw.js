// MyGrind service worker
// Migrated 2026-06-06 from an inline blob registration in softball.html to this
// real same-origin file, because Web Push requires a stable file-based service
// worker (a blob: SW can't receive push).
// 2026-07-01 (v389): real offline support. Precache the app shell (softball.html
// + manifest + icons + shared CSS) and runtime-cache successful same-origin GET
// responses, so the journal opens with no signal. Strategy stays network-first
// (fresh when online), cache is the fallback. /api/* is never cached.
// Cache prefix renamed ybg-mygrind → mygrind (activate cleans old caches).
// 2026-07-09 (v390): precache checkin.html — the dashboard's top daily-habit
// card 404'd offline while the shell promised "works offline" (audit 7/8).
// 2026-07-09 (v391): audit buckets 3+4 — softball-side fixes (sport-aware
// resources hrefs, Softball Pathway card, per-sport workout videos, boot
// follows family sport) + settings switcher, mood-tag edit, outdoor gate.
// 2026-07-09 (v392): audit bucket 3 tail — dead-code removal (gift/team-
// sponsor flow, voice-input block, retired signup screens 1/4), tokenized
// toasts, stale-comment sweep, em-dash copy fixes.
// 2026-07-09 (v393): ad-funnel fixes — Meta pixel ViewContent +
// InitiateCheckout mid-funnel events, card-expectation line on the
// signup gate screen (runtime cache can hold signup.html).
// 2026-07-09 (v394): HOTFIX — saveEntry crashed in renderMediaPreview on
// every save since 5/11 (photo-upload DOM pulled, renderer unguarded),
// silencing the save confirmation. Entries were never lost.
// 2026-07-11 (v395): sport unlock — both sports open to every account
// (mg_family_sport no longer gates the toggle; signup sport = default
// view only). Settings sport switcher shown for everyone. D1 card gets
// the Northridge grand-opening block (self-expires after 7/20).
// 2026-07-11 (v396): homepage walkthrough video — Coach's real 21s screen
// recording embedded above the screenshot grid (muted autoplay loop).
// Video file itself is NOT precached (586KB, runtime cache handles it).
// 2026-07-11 (v397): media bypass — the fetch handler no longer intercepts
// video files or Range requests. The v396 handler stalled the homepage
// walkthrough <video> for returning visitors with an installed SW.

const CACHE = 'mygrind-v397';
const ASSETS = [
  '/',
  '/softball.html',
  '/checkin.html',
  '/manifest.json',
  '/assets/interactions.css',
  '/assets/mg-stripe-links.js',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/apple-touch-icon.png',
  '/assets/favicon.png'
];

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
  const url = new URL(e.request.url);

  // Only handle same-origin GETs; never cache API calls.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  // Never intercept media (v397): Chrome's video pipeline sends Range
  // requests that stall behind respondWith(fetch), and cache.put() can't
  // store 206 partials anyway. Let the browser talk to the CDN directly.
  if (e.request.headers.has('range') || /\.(mp4|webm|mov|m4v)$/i.test(url.pathname)) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      // ignoreSearch so /softball.html?anything still hits the cached shell offline
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
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
