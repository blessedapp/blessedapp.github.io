// Guarda o app para abrir sem internet. Página e histórias: internet primeiro (pega atualizações).
const CACHE = "cifra-campo-202610180550";
const BIBLE_CACHE = "blessed-biblia-blivre-2018";
const LUT_CACHE = "blessed-story-luts-v1";
const FILES = ["img/vendor/supabase.js", "img/vendor/jspdf.umd.min.js", "img/vendor/qrcode.min.js", "img/fonts/caveat.ttf", "img/fonts/anton.woff2", "img/fonts/bebas.woff2", "img/fonts/pacifico.woff2", "img/fonts/playfair.woff2", "img/fonts/marker.woff2", "img/fonts/montserrat.woff2", "img/fonts/lobster.woff2", "./", "index.html", "tema-vidro.css?v=20261016-indigo", "manifest.json", "info.json", "img/icon-192.png?v=roxo", "img/icon-512.png?v=roxo", "img/apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  // a Bíblia fica num cache próprio que não é apagado a cada versão (o texto não muda)
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== BIBLE_CACHE && k !== LUT_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/img/apresentacao/")) return;
  if (url.pathname.includes("/img/luts/")) {
    e.respondWith(caches.open(LUT_CACHE).then(c => c.match(e.request).then(h => h || fetch(e.request).then(async r => { if (r.ok) await c.put(e.request, r.clone()).catch(() => {}); return r; }))));
    return;
  }
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


// BLESSED-PUSH-WORKER: dados do aparelho sobrevivem à atualização do cache do app.
function pushOwner(value,write=false){return new Promise((resolve,reject)=>{
 const request=indexedDB.open('blessed-push-device',1);request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onerror=()=>reject(new Error('storage'));
 request.onsuccess=()=>{const db=request.result,tx=db.transaction('state',write?'readwrite':'readonly'),store=tx.objectStore('state'),op=write?store.put(value,'owner'):store.get('owner');let result;op.onsuccess=()=>{result=op.result;};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(new Error('storage'));};};
});}
function pushSafeURL(value){try{const u=new URL(value,self.location.origin);if(u.origin!==self.location.origin||u.pathname!=='/')return '/';const entries=[...u.searchParams];if(entries.length!==1)return '/';const [kind,id]=entries[0];return ['conversation','foto','blessing','story','profile'].includes(kind)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)?u.pathname+u.search:'/';}catch{return '/';}}
self.addEventListener('message',e=>{
 if(e.data?.type==='BLESSED_PUSH_OWNER'||e.data?.type==='BLESSED_PUSH_LOGOUT'){
  const owner=e.data.type==='BLESSED_PUSH_LOGOUT'?null:e.data.owner;
  if(owner!==null&&!/^[a-f0-9-]{36}$/i.test(owner||'')){e.ports?.[0]?.postMessage({ok:false});return;}
  e.waitUntil(pushOwner(owner,true).then(()=>e.ports?.[0]?.postMessage({ok:true})).catch(()=>e.ports?.[0]?.postMessage({ok:false})));
 }
});
self.addEventListener('push',e=>{
 e.waitUntil((async()=>{
  let data;try{data=e.data?.json();}catch{}const owner=await pushOwner().catch(()=>null);
  const known=owner&&owner===data?.account,notification=known?data:{};
  if(known&&data.activity==='attention'&&/^[a-f0-9-]{36}$/i.test(data.actor||'')&&/^[a-f0-9-]{36}$/i.test(data.target||'')){
   const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
   for(const client of windows)if(client.visibilityState==='visible'&&new URL(client.url).origin===self.location.origin)client.postMessage({type:'BLESSED_PUSH_ACTIVITY',account:owner,activity:'attention',actor:data.actor,target:data.target});
  }
  // App aberto na tela: o aviso flutuante dentro do app já cuida disso, então não repete a notificação do celular.
  const seen=known&&(await self.clients.matchAll({type:'window',includeUncontrolled:true})).some(c=>c.visibilityState==='visible'&&new URL(c.url).origin===self.location.origin);
  if(seen)return;
  const tag0=known?String(data.tag||data.id).slice(0,100):'blessed';
  await self.registration.showNotification(String(notification.title||'Blessed').slice(0,140),{
   body:String(notification.body||'Abra o Blessed para ver seus avisos.').slice(0,200),
   icon:'/img/icon-192.png',badge:'/img/icon-192.png',tag:known?String(data.tag||data.id).slice(0,100):'blessed',
   data:{url:known?pushSafeURL(data.url):'/',account:known?owner:null},
   renotify:!!known&&!seen,silent:!known||seen,...(known&&!seen?{vibrate:[180,90,180]}:{})
  });
 })());
});
self.addEventListener('notificationclick',e=>{
 e.notification.close();e.waitUntil((async()=>{
  const data=e.notification.data||{},owner=await pushOwner().catch(()=>null),url=owner&&owner===data.account?pushSafeURL(data.url):'/';
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const client=windows.find(c=>new URL(c.url).origin===self.location.origin);
  if(client){await client.focus();client.postMessage({type:'BLESSED_PUSH_OPEN',url,account:owner});}
  else await self.clients.openWindow(url);
 })());
});
