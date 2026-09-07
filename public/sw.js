/* BirdRadar service worker — push notifications only (no offline caching).
 * Kept dependency-free and tiny so it installs instantly.
 *
 * ─── DO NOT ADD A `fetch` HANDLER WITHOUT READING THIS ──────────────────────
 *
 * There is deliberately no `fetch` listener here, and two separate features now
 * depend on its absence:
 *
 *   1. **Maintenance mode.** `proxy.ts` returns the 503 maintenance page for
 *      navigations. If this worker ever served navigations cache-first from a
 *      precached shell, returning visitors would never reach the proxy and would
 *      never see maintenance mode — while new visitors would. That is the worst
 *      possible split, because the person who tests it is usually the one with
 *      the warm cache.
 *
 *   2. **Debuggability.** `PhaseE1_bugfix_ebird404.md` §7.4: the absence of a
 *      fetch handler is what makes "a stale service worker is caching the 404s"
 *      a one-line elimination instead of a debugging session.
 *
 * If offline caching is ever genuinely wanted, the requirements are: navigation
 * requests must be **network-first**, falling back to cache only on a real
 * network failure; and `503` responses must never be written to a cache. Say so
 * explicitly in that change, and update the service-worker audit note in
 * `proxy.ts`. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'BirdRadar', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'BirdRadar';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag,           // repeat alerts for one species collapse
    renotify: true,
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab and hand it the deep link, else open a new one
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(target).catch(() => {});
          return;
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
