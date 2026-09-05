// Service Worker - راديو قرآن
// يُسجَّل من ملف حقيقي (sw.js) حتى يعمل الأوفلاين بشكل موثوق على GitHub Pages.
// ملاحظة: رقم الإصدار (v3) مرفوع لإبطال أي كاش قديم (ومنه تسجيل الـ blob السابق).
const CACHE_NAME = 'radio-quran-v5';

// ملفات أساسية تُخزَّن مسبقًا عند التثبيت (أيقونات + هوية التطبيق)
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './quran-search.html',
  './mushaf.html',
  './Al-Arifi.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// تحديث فوري عندما تطلب الصفحة ذلك
self.addEventListener('message', (e) => {
  const data = (e.data && e.data.type) ? e.data.type : e.data;
  if (data === 'SKIP_WAITING') { self.skipWaiting(); }
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // لا نتدخل في طلبات خارج نطاق الموقع (أصوات/صور خارجية) — تُمرَّر للشبكة مباشرة
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const isPageRequest = req.mode === 'navigate' || req.destination === 'document';

  if (isPageRequest) {
    // Network First لصفحات HTML: أحدث نسخة من الشبكة، والكاش فقط عند انقطاع الإنترنت
    e.respondWith(
      fetch(req)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return response;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Cache First لباقي الملفات المحلية (أيقونات، خطوط، ستايل)
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
