// Carnes & Sons Office Console — service worker. Makes the console installable as a desktop app
// and gives a fast/offline shell. Network-first for same-origin GETs only; API calls to Supabase
// (cross-origin) are NOT touched, so the console always talks live to the backend.
var V = '1.5.0';
var CACHE = 'csoffice-' + V;
var CORE = ['index.html', 'admin.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', function (e) {
  // NOTE: we do NOT skipWaiting() here on purpose. A new version installs and then WAITS, so the page
  // can show an "update available" banner and let the user click Update — that posts SKIP_WAITING below.
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE).catch(function () {}); }));
});
// The page tells us to activate the new version when the user clicks "Update now".
self.addEventListener('message', function (e) { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
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
    // cache:"no-store" => bypass the BROWSER HTTP cache so a stale GitHub-Pages-cached admin.js/index.html
    // can never be served. This was the real cause of "updates not reaching me". Network-first + no-store.
    fetch(req, { cache: "no-store" }).then(function (r) {
      if (r && r.status === 200 && r.type === 'basic') { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); }
      return r;
    }).catch(function () { return caches.match(req).then(function (m) { return m || caches.match('index.html'); }); })
  );
});
