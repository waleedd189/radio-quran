/*
 * Service Worker — تطبيق «المصحف الشريف» المستقل.
 *
 * نطاق هذا العامل هو /mushaf/ فقط، وهو أضيق من نطاق الراديو (/)، ولأن المتصفح
 * يُغلّب التسجيل الأضيق فإن صفحات المصحف يتحكم فيها هذا الملف لا عامل الراديو.
 * النتيجة: كاش منفصل، وتحديث منفصل، وتثبيت منفصل على الشاشة الرئيسية.
 *
 * محتوى المصحف (الخطوط وصفحات JSON) يأتي من jsDelivr مثبَّتًا على commit محدد،
 * ولأن الرابط لا يتغير أبدًا فالتخزين دائم بلا إبطال: ما يُحمَّل مرة يبقى للأبد.
 */

const VERSION = 'v1';
const SHELL_CACHE = `mushaf-shell-${VERSION}`;
const QURAN_CACHE = 'mushaf-quran';   // مثبَّت على SHA فلا يحتاج ترقيم إصدار
const VENDOR_CACHE = 'mushaf-vendor'; // خطوط الواجهة وأيقوناتها

// لا بد أن يطابق القيمة في index.html — أي تغيير هنا يعني تحميل المصحف من جديد
const QURAN_CDN = 'https://cdn.jsdelivr.net/gh/MohamadHajjRabee/quran-qcf4@5130511027e769f0a8f4eeb7f00f46bde3788d60';

const VENDOR_HOSTS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://cdnjs.cloudflare.com'
];

const SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './mushaf-reading.js',
  './mushaf-reading.css',
  './data/mushaf-layout.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  // عنصرًا عنصرًا: فشل ملف واحد يجب ألا يُفرغ الكاش كله كما يحدث مع addAll
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // كاش المصحف والموردين يبقيان بين الإصدارات: محتواهما ثابت ومكلف التحميل
      caches.keys().then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('mushaf-shell-') && key !== SHELL_CACHE)
            .map((key) => caches.delete(key))
      )),
      self.clients.claim()
    ])
  );
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type ? event.data.type : event.data;
  if (type === 'SKIP_WAITING') self.skipWaiting();
});

// تخزين دائم: الرابط مثبَّت على SHA فما يُحمَّل مرة لا يحتاج تحديثًا أبدًا
async function cacheFirstImmutable(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // الاستجابة المعتمة (opaque) لا يمكن قراءة حالتها، لكنها صالحة للتخزين
  if (response && (response.ok || response.type === 'opaque')) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1) محتوى المصحف: خطوط QCF وصفحات JSON — أهم ما يجعل التطبيق يعمل أوفلاين
  if (request.url.startsWith(QURAN_CDN)) {
    event.respondWith(
      cacheFirstImmutable(request, QURAN_CACHE)
        .catch(() => caches.match(request).then((r) => r || Response.error()))
    );
    return;
  }

  // 2) خطوط الواجهة وأيقوناتها من مزوّدين خارجيين
  if (VENDOR_HOSTS.some((host) => request.url.startsWith(host))) {
    event.respondWith(
      cacheFirstImmutable(request, VENDOR_CACHE)
        .catch(() => caches.match(request).then((r) => r || Response.error()))
    );
    return;
  }

  // 3) أي أصل خارجي آخر يمرّ للشبكة دون تدخل
  if (url.origin !== self.location.origin) return;

  // 4) صفحات التطبيق: الشبكة أولًا ليصل التحديث، والكاش عند الانقطاع
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 5) أصول التطبيق المحلية: الكاش أولًا مع تحديث صامت في الخلفية
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached || new Response('', { status: 504, statusText: 'Offline' }));
      return cached || network;
    })
  );
});
