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
