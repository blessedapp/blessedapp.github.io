// Guarda o app para abrir sem internet. Página e histórias: internet primeiro (pega atualizações).
const CACHE = "cifra-campo-202610142246";
const BIBLE_CACHE = "blessed-biblia-blivre-2018";
const FILES = ["./", "index.html", "tema-vidro.css?v=20261014-lilas", "manifest.json", "info.json", "img/icon-192.png", "img/icon-512.png", "img/apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  // a Bíblia fica num cache próprio que não é apagado a cada versão (o texto não muda)
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== BIBLE_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/biblia/")) {
    e.respondWith(caches.open(BIBLE_CACHE).then(c => c.match(e.request).then(h => h || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }))));
    return;
  }
  if (e.request.mode === "navigate" || url.pathname.endsWith("info.json")) {
    e.respondWith(fetch(e.request, {cache:"no-cache"}).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request).then(h => h || caches.match("index.html"))));
    return;
  }
  e.respondWith(caches.match(e.request).then(h => h || fetch(e.request)));
});
