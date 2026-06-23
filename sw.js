// Carnes & Sons Office Console — service worker. Makes the console installable as a desktop app
// and gives a fast/offline shell. Network-first for same-origin GETs only; API calls to Supabase
// (cross-origin) are NOT touched, so the console always talks live to the backend.
var V = '1.0.0';
var CACHE = 'csoffice-' + V;
var CORE = ['index.html', 'admin.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE).catch(function () {}); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                 // never cache POSTs (API writes)
  var u = new URL(req.url);
  if (u.origin !== location.origin) return;         // leave cross-origin (Supabase API) alone
  e.respondWith(
    fetch(req).then(function (r) {
      if (r && r.status === 200 && r.type === 'basic') { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); }
      return r;
    }).catch(function () { return caches.match(req).then(function (m) { return m || caches.match('index.html'); }); })
  );
});
