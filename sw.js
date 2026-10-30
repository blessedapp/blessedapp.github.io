// Bless: cache apenas do streaming, sem mídias da antiga rede social.
const CACHE="bless-stream-202610300625";
const FILES=["./","index.html","manifest.json","img/vendor/supabase.js","img/icon-192.png?v=bless-azul-20261030","img/icon-512.png?v=bless-azul-20261030","img/apple-touch-icon.png","img/bless/avatares-20261030.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&/^(cifra-campo-|bless-stream-|blessed-biblia-|blessed-story-luts-|blessed-fotos-)/.test(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
 const u=new URL(e.request.url);if(e.request.method!=="GET"||u.origin!==location.origin)return;
 if(u.pathname.includes("/img/negocios-")||u.pathname.includes("/img/apresentacao/"))return;
 if(e.request.mode==="navigate"){e.respondWith(fetch(e.request,{cache:"no-cache"}).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match("index.html"))));return;}
 e.respondWith(caches.open(CACHE).then(c=>c.match(e.request)).then(r=>r||fetch(e.request)));
});
