// Service worker: caché versionada. Al cambiar VERSION se instala una caché
// nueva y la app muestra "Hay una versión nueva".
const VERSION = '1.0.0';
const CACHE = 'finanzas-diario-' + VERSION;
const ARCHIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/api.js',
  'js/cola.js',
  'js/datos.js',
  'js/fechas.js',
  'js/idb.js',
  'js/montos.js',
  'js/version.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('finanzas-diario-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'saltarEspera') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // las llamadas al Web App (POST) van directo a la red
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html', { cacheName: CACHE }).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((r) => r || fetch(req)));
});
