/* Service worker de "Rutas por plantío y formularios de campo".
 * Qué hace: guarda la app en el teléfono para que abra SIN conexión (también al refrescar la página o abrir el APK sin señal).
 *  · La app (index.html): se sirve al instante desde el teléfono y se actualiza en segundo plano cuando hay señal.
 *  · Íconos, manifiesto y página sin conexión: guardados al instalar.
 *  · Teselas del mapa satelital que ya viste: se guardan (hasta MAX_TESELAS) para ver el fondo del mapa sin señal.
 *  · Los datos (GitHub) y el servidor (Google Apps Script) NO pasan por aquí: la app los guarda en el teléfono por su cuenta.
 * Versión de esta compilación: f8f4e17e327f (cambia en cada actualización de la app; así el teléfono sabe que hay algo nuevo). */
const VERSION = 'f8f4e17e327f';
const CACHE = 'rutas-campo-' + VERSION, TESELAS = 'rutas-campo-teselas';
const CACHEAR_TESELAS = true, MAX_TESELAS = 600, HOST_TESELAS = 'server.arcgisonline.com';
const BASE = new URL('./', self.location).pathname;                      // p. ej. /rutas/
const PRECACHE = ['./', './index.html', './lanzador.html', './offline.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/icon-monochrome-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('rutas-campo-') && k !== CACHE && k !== TESELAS) await caches.delete(k);   // versiones anteriores
    await self.clients.claim();
  })());
});

const PAGINAS = [BASE, BASE + 'index.html', BASE + 'lanzador.html'];                 // la app y su lanzador se abren siempre desde el teléfono
const esApp = u => u.origin === self.location.origin && PAGINAS.includes(u.pathname);
const clave = u => u.pathname === BASE ? './index.html' : './' + u.pathname.split('/').pop();
const esPrecache = u => u.origin === self.location.origin && !PAGINAS.includes(u.pathname) && PRECACHE.some(p => new URL(p, self.location).pathname === u.pathname);

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (req.mode === 'navigate' && esApp(u)) return e.respondWith(abrirApp(e));
  if (esPrecache(u)) return e.respondWith(caches.match(req, {ignoreSearch: true}).then(r => r || fetch(req)));
  if (CACHEAR_TESELAS && u.hostname === HOST_TESELAS) return e.respondWith(tesela(req));
  // todo lo demás (datos de GitHub, Google Apps Script, lanzador…) va directo a la red
});

/** La app se abre desde el teléfono al instante; si hay señal se baja la versión nueva para la próxima vez. */
async function abrirApp(e) {
  const u = new URL(e.request.url), k = clave(u), cache = await caches.open(CACHE), guardada = await cache.match(k);
  const red = fetch(u.origin + u.pathname, {cache: 'no-cache'}).then(r => { if (r.ok) cache.put(k, r.clone()); return r; }).catch(() => null);
  if (guardada) { e.waitUntil(red); return guardada; }
  const r = await red;
  return r || (await cache.match('./offline.html')) || Response.error();
}
async function tesela(req) {
  const cache = await caches.open(TESELAS), hay = await cache.match(req.url);
  if (hay) return hay;
  try {
    const r = await fetch(req.url, {mode: 'cors'});                     // con CORS la respuesta se guarda sin el "relleno" de cuota de las respuestas opacas
    if (r.ok) { cache.put(req.url, r.clone()); if (Math.random() < .04) recortar(cache); }
    return r;
  } catch (err) { return fetch(req).catch(() => Response.error()); }
}
async function recortar(cache) { const ks = await cache.keys(); if (ks.length > MAX_TESELAS) await Promise.all(ks.slice(0, ks.length - MAX_TESELAS).map(k => cache.delete(k))); }
