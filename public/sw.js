// Service worker do NEXO: casca do app em cache (rápido e funciona offline para abrir); a API nunca é cacheada.
const VERSION = 'nexo-v2';
const SHELL = ['/', '/css/app.css', '/js/app.js', '/js/ui.js', '/js/icons.js', '/js/charts.js', '/manifest.webmanifest', '/icons/icon.svg', '/img/hero.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Rede primeiro (dados do app sempre atualizados); se offline, usa o cache.
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('/') : Response.error()))));
});

// ---- Notificações push ----
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'NEXO', {
    body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: d.tag || 'nexo', renotify: true, data: { link: d.link || '#/notificacoes' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '#/notificacoes';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const w = cs.find((c) => new URL(c.url).origin === location.origin);
    if (w) { w.postMessage({ type: 'nexo-open', link }); return w.focus(); }
    return self.clients.openWindow('/' + link);
  }));
});
