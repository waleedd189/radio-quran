// Service Worker - راديو قرآن
// خزن هذا الملف بجانب صفحة index.html في نفس المجلد على استضافتك (GitHub Pages)
// ملاحظة: رقم الإصدار هنا (v2) تم رفعه عمدًا لإبطال أي كاش قديم مخزن عند المستخدمين
const CACHE_NAME = 'radio-quran-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      // حذف أي كاش قديم من إصدارات سابقة (يمنع تكرار مشكلة "الصفحة القديمة عالقة")
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const isPageRequest = e.request.mode === 'navigate' || e.request.destination === 'document';

  if (isPageRequest) {
    // إستراتيجية Network First لصفحة الـ HTML نفسها:
    // نحاول نجيب أحدث نسخة من الشبكة أولًا دايمًا، ونستخدم الكاش فقط لو مفيش إنترنت
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseClone));
          return response;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // إستراتيجية Cache First لباقي الملفات (صور، أصوات، خطوط...) عشان تشتغل أوفلاين وبسرعة
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      const networkFetch = fetch(e.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseClone));
          }
          return response;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkFetch;
    })
  );
});
