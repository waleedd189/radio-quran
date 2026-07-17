// Service Worker - راديو قرآن
// خزن هذا الملف بجانب صفحة index.html في نفس المجلد على استضافتك (GitHub Pages)
const CACHE_NAME = 'radio-quran-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // نتعامل فقط مع طلبات GET (تسجيل SW لا يجب أن يتدخل في POST مثلاً)
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      const networkFetch = fetch(e.request)
        .then((response) => {
          // لا نخزن استجابات غير ناجحة أو من نوع opaque بشكل مبالغ فيه (اختياري لكنه أكثر أمانًا)
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(e.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => cachedResponse);

      // إستراتيجية: أعرض النسخة المخزنة فورًا إن وجدت، وحدّثها في الخلفية من الشبكة
      return cachedResponse || networkFetch;
    })
  );
});
