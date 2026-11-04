// Bless Play: cache apenas do streaming, sem mídias da antiga rede social.
const CACHE="bless-stream-202611040957";
const FILES=["./","index.html","manifest.json","img/vendor/supabase.js","img/icon-192.png?v=bless-play-approved-20261103","img/icon-512.png?v=bless-play-approved-20261103","img/apple-touch-icon.png","img/bless/avatares-20261030.png","img/bless/avatares-extra-20261030.png","img/bless-play/fonts/Inter.woff2","img/bless-play/fonts/Bodoni.woff2","img/bless-play/logo.png?v=approved-20261103"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&/^(cifra-campo-|bless-stream-|blessed-biblia-|blessed-story-luts-|blessed-fotos-)/.test(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
// Downloads do próprio usuário: cache separado das atualizações do aplicativo.
// Suporte a Range é necessário para buscar/avançar no player do Safari offline.
async function bpCachedVideo(request){
 const cache=await caches.open('bless-play-offline-v1'),saved=await cache.match(new URL(request.url).pathname);
 if(!saved)return new Response('Este download não está mais no aparelho.',{status:404});
 const range=request.headers.get('Range');if(!range)return saved;
 const blob=await saved.blob(),size=blob.size,match=/^bytes=(\d*)-(\d*)$/.exec(range);
 const invalid=()=>new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size,'Accept-Ranges':'bytes'}});
 if(!match||!size||!match[1]&&!match[2])return invalid();
 let start,end;if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return invalid();start=Math.max(0,size-suffix);end=size-1;}else{start=Number(match[1]);end=match[2]?Math.min(size-1,Number(match[2])):size-1;}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return invalid();
 return new Response(blob.slice(start,end+1),{status:206,headers:{'Content-Type':saved.headers.get('Content-Type')||'video/mp4','Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes'}});
}

self.addEventListener("fetch",e=>{
 const u=new URL(e.request.url);if(e.request.method!=="GET"||u.origin!==location.origin)return;
 if(u.pathname.startsWith("/bp-offline/")){e.respondWith(bpCachedVideo(e.request));return;}
 if(u.pathname.includes("/img/negocios-")||u.pathname.includes("/img/apresentacao/"))return;
 if(e.request.mode==="navigate"){e.respondWith(fetch(e.request,{cache:"no-cache"}).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match("index.html"))));return;}
 e.respondWith(caches.open(CACHE).then(c=>c.match(e.request)).then(r=>r||fetch(e.request)));
});
