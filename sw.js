// オフラインでも遊べるようにするための Service Worker
// - HTML / JS / CSS は「ネット優先」：更新をすぐ反映（2台のPCで編集→push したらすぐ見える）
// - 画像は「キャッシュ優先」：一度読んだら次からは一瞬で表示
const CACHE = 'power-tower-v1';
const CORE = ['./', 'index.html', 'style.css', 'manifest.json',
  'js/config.js', 'js/level.js', 'js/audio.js', 'js/game.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isImage = /\.(webp|png|jpg)$/.test(new URL(req.url).pathname);
  const put = res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  };
  e.respondWith(isImage
    ? caches.match(req).then(hit => hit || fetch(req).then(put))
    : fetch(req).then(put).catch(() => caches.match(req)));
});
