const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'pf-module.js'), 'utf8');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function harness(handler = () => ({data: [], error: null})) {
  const calls = [], notices = [], elements = new Map();
  const modal = {hidden: true, innerHTML: '', className: ''};
  const focus = {focus(){}, isConnected: true};
  elements.set('#modal', modal); elements.set('#pf-close', focus);
  class Query {
    constructor(table){ this.table = table; this.op = 'select'; this.filters = []; }
    select(fields, options){ this.fields = fields; this.options = options; return this; }
    eq(field, value){ this.filters.push([field, value]); return this; }
    in(field, values){ this.filters.push([field, values]); return this; }
    order(){ return this; }
    limit(value){ this.max = value; return this; }
    maybeSingle(){ return this; }
    insert(payload){ this.op = 'insert'; this.payload = payload; return this; }
    delete(){ this.op = 'delete'; return this; }
    then(resolve, reject){ calls.push(this); return Promise.resolve().then(() => handler(this)).then(resolve, reject); }
  }
  const client = {from(table){ return new Query(table); }, rpc(name, payload){ const q = {table:name, op:'rpc', payload}; calls.push(q); return Promise.resolve().then(() => handler(q)); }};
  const TEAM = {user:{id:'me'}, client, role:'member'};
  const COMM = {me:{id:'me'}, profiles:{me:{id:'me', display_name:'Eu'}}, posts:{}, urls:{}, likes:{}, ccount:{}, myLikes:new Set(), mySaves:new Set()};
  const BLS = {items:{}};
  const state = {view:'profile', profileId:'me'};
  const context = vm.createContext({
    console, Set, Map, Date, TEAM, COMM, BLS, state,
    $: selector => elements.get(selector) || null,
    document: {activeElement:focus, querySelectorAll(){return [];}, getElementById(id){return elements.get('#'+id) || null;}},
    commIn: () => !!TEAM.user && TEAM.role !== 'blocked', teamRole: () => TEAM.role,
    commMissing: error => !!error && ['42P01','PGRST205'].includes(error.code),
    commKeep(rows){ rows.forEach(p => { COMM.profiles[p.id] = {...COMM.profiles[p.id], ...p}; }); },
    commSign(){}, commThumb: p => p.replace('.jpg','-p.jpg'), commGridUrl: p => 'signed/'+p.id,
    commGrid: ids => '<div class="cm-grid">'+ids.join(',')+'</div>',
    commAvatar: () => '<span class="avatar"></span>', commBadge: () => '', commAgo: () => 'agora',
    blUrl: key => 'https://media.invalid/'+key, BL_ICONS:{play:'<svg></svg>'},
    esc:escape, norm:s=>s.toLowerCase(), rerenderKeepScroll(){}, flash:s=>notices.push(s),
    commClick(action, button){ if(action==='cm-post'){state.view='post';state.postId=button.dataset.id;} }, commAfterPosts(){}, blOpen(){}, commShare(){}, blShare(){}, confirm:()=>true,
    closePix(){ context.api.pfPanelClosed(); modal.hidden=true; modal.innerHTML=''; }
  });
  vm.runInContext(source + '\nglobalThis.api={PF,pfActor,pfCurrent,pfReset,pfPanelClosed,pfProfileSection,pfVideoTile,pfListHtml,pfShareOpen,pfShareSave,pfTagsOpen,pfTagsSave,pfUntag,pfCommentsOpen,pfLoadComments,pfCommentsPanelHtml,pfSendComment,pfDeleteComment,pfLoadList,pfPhotoTagsHtml,pfOpenPanel,pfOpenPhoto,pfInput,pfClick};', context);
  return {api:context.api, TEAM, COMM, BLS, state, calls, notices, elements, modal};
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('o app incorpora a fonte exata e todos os scripts compilam', () => {
  const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.equal(html.split('/*PROFILE-TABS-START*/\n')[1].split('\n/*PROFILE-TABS-END*/')[0], source);
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  new vm.Script(fs.readFileSync(path.join(root,'sw.js'),'utf8'));
  assert.match(html, /perfil-abas\.css\?v=20261014-1/);
  assert.match(fs.readFileSync(path.join(root,'sw.js'),'utf8'), /perfil-abas\.css\?v=20261014-1/);
});
test('as quatro abas preservam Fotos como padrão e escapam conteúdo', () => {
  const h = harness(); const html = h.api.pfProfileSection({id:'me'}, ['foto-1']);
  for (const label of ['Fotos','Blessings','Fotos comigo','Compartilhamentos']) assert.ok(html.includes(label));
  assert.match(html, /id="pf-tab-photos"[^>]*aria-selected="true"/);
  assert.ok(html.includes('foto-1')); assert.equal(h.calls.length,0);
  const tile = h.api.pfVideoTile({id:'v', thumb_key:'thumb.jpg', video_key:'video.mp4', caption:'<script>alert(1)</script>', duration:20});
  assert.match(tile,/loading="lazy"/); assert.ok(!tile.includes('<video')); assert.ok(!tile.includes('video.mp4'));
  assert.ok(!tile.includes('<script>')); assert.ok(tile.includes('&lt;script&gt;'));
});
test('compartilhamentos conservam autor e mídia originais sem upload', () => {
  const h = harness(); h.api.pfActor();
  h.COMM.posts.p = {id:'p',author:'original',image_path:'original/p.jpg',caption:'<img onerror=x>'};
  h.COMM.profiles.original = {display_name:'Autor original'};
  h.api.PF.videos.v = {id:'v',author:'original',thumb_key:'v.jpg',video_key:'v.mp4'};
  const html = h.api.pfListHtml('me','shares',[{id:'s1',post_id:'p'},{id:'s2',blessing_id:'v'}]);
  assert.ok(html.includes('Autor original')); assert.ok(html.includes('pf-share-remove'));
  assert.ok(html.includes('signed/p')); assert.ok(!html.includes('v.mp4')); assert.ok(!html.includes('<img onerror='));
  assert.equal(h.calls.length,0);
});
test('compartilhar usa o usuário conectado; duplicata já existente é sucesso', async () => {
  const h = harness(q => q.op==='insert' ? {error:{code:'23505'}} : {data:null});
  await h.api.pfShareOpen('post','photo'); await h.api.pfShareSave();
  const q = h.calls.find(q=>q.op==='insert');
  assert.deepEqual({...q.payload},{user_id:'me',post_id:'photo'});
  assert.ok(h.notices.includes('Compartilhado no seu perfil.')); assert.equal(h.modal.hidden,true);
  assert.ok(h.calls.every(q=>q.table==='profile_shares'));
});
test('marcar pessoas salva seleção atomicamente pelo RPC e recusa visitante', async () => {
  const h = harness(q => ({data:q.table==='community_profiles' ? [{id:'friend',display_name:'Amigo'}] : []}));
  h.COMM.posts.p={id:'p',author:'me'};
  await h.api.pfTagsOpen('p'); h.api.PF.panel.selected.add('friend'); await h.api.pfTagsSave();
  const q=h.calls.find(q=>q.op==='rpc'); assert.equal(q.table,'pf_set_post_tags');
  assert.equal(q.payload.p_post_id,'p'); assert.deepEqual([...q.payload.p_users],['friend']);
  h.COMM.posts.other={id:'other',author:'other'};
  const before=h.calls.length; await h.api.pfTagsOpen('other'); assert.equal(h.calls.length,before);
});
test('a pessoa marcada remove apenas a própria marcação', async () => {
  const h=harness(()=>({error:null})); await h.api.pfUntag('tag','post');
  assert.equal(h.calls[0].table,'post_tags'); assert.equal(h.calls[0].op,'delete');
  assert.deepEqual(h.calls[0].filters,[['id','tag'],['tagged_user','me']]);
});
test('comentários rejeitam vazio e excesso; enviam texto com autoria correta', async () => {
  const h=harness(()=>({data:[],count:0,error:null}));
  h.BLS.items.v={id:'v',author:'owner'};
  h.api.pfCommentsOpen('v'); await tick();
  h.elements.set('#pf-comment',{value:'   '}); await h.api.pfSendComment();
  h.elements.get('#pf-comment').value='x'.repeat(501); await h.api.pfSendComment();
  assert.equal(h.calls.filter(q=>q.op==='insert').length,0);
  h.elements.get('#pf-comment').value='  Amém!  '; await h.api.pfSendComment();
  const insert=h.calls.find(q=>q.op==='insert');
  assert.equal(insert.table,'blessing_comments'); assert.deepEqual({...insert.payload},{blessing_id:'v',author:'me',text:'Amém!'});
  assert.equal(h.api.PF.drafts.v,'');
});
test('comentários escapam HTML e apagar é limitado ao autor, dono ou admin', async () => {
  const h=harness(()=>({error:null,data:[],count:0})); const p=h.api.pfOpenPanel('comments','v'); p.loading=false;
  h.BLS.items.v={author:'owner'};
  h.api.PF.comments.v={rows:[{id:'c',author:'other',text:'<script>alert(1)</script>'}],total:1};
  const html=h.api.pfCommentsPanelHtml(p); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('pf-comment-delete'));
  await h.api.pfDeleteComment('c'); assert.equal(h.calls.length,0);
  h.TEAM.role='admin'; assert.ok(h.api.pfCommentsPanelHtml(p).includes('pf-comment-delete'));
  await h.api.pfDeleteComment('c'); assert.equal(h.calls[0].op,'delete');
});
test('duplo envio não duplica comentário', async () => {
  let finish; const pending=new Promise(resolve=>{finish=resolve;});
  const h=harness(q=>q.op==='insert'?pending:{data:[],count:0});
  const p=h.api.pfOpenPanel('comments','v'); p.loading=false; h.elements.set('#pf-comment',{value:'Comentário'});
  const first=h.api.pfSendComment(); await tick(); await h.api.pfSendComment();
  assert.equal(h.calls.filter(q=>q.op==='insert').length,1); finish({error:null}); await first;
});
test('logout descarta resposta atrasada e limpa o modal e os rascunhos', async () => {
  let finish; const pending=new Promise(resolve=>{finish=resolve;}); const h=harness(()=>pending);
  h.api.pfCommentsOpen('v'); await tick(); h.api.PF.drafts.v='privado';
  h.TEAM.user=null; h.api.pfReset(); finish({data:[{id:'late',author:'me',text:'privado'}],count:1}); await tick();
  assert.equal(h.api.PF.panel,null); assert.equal(h.modal.hidden,true); assert.equal(h.modal.innerHTML,'');
  assert.equal(Object.keys(h.api.PF.comments).length,0); assert.equal(Object.keys(h.api.PF.drafts).length,0);
});
test('resposta de aba de outra conta não entra no perfil atual', async () => {
  let finish; const pending=new Promise(resolve=>{finish=resolve;}); const h=harness(()=>pending);
  h.api.pfActor(); const entry={rows:[],limit:24,loading:true}; h.api.PF.lists['me:videos']=entry;
  const job=h.api.pfLoadList('me','videos',entry); await tick(); h.TEAM.user={id:'new'}; h.api.pfActor();
  finish({data:[{id:'old',author:'me',video_key:'old.mp4'}]}); await job;
  assert.equal(Object.keys(h.api.PF.videos).length,0); assert.equal(Object.keys(h.api.PF.lists).length,0);
});
test('novo módulo consulta só perfis públicos e SQL não altera proteção de e-mails', () => {
  assert.ok(!/from\("profiles"\)|\bemail\b/i.test(source));
  const sql=fs.readFileSync(path.join(root,'supabase-perfil-abas.sql'),'utf8');
  assert.ok(!/alter\s+table\s+(?:public\.)?profiles\b/i.test(sql));
  assert.ok(!/grant[^;]*\bon\s+(?:public\.)?profiles\b/i.test(sql));
  assert.match(sql,/security invoker/i); assert.match(sql,/num_nonnulls\(post_id, blessing_id\) = 1/);
});
test('foto compartilhada recupera curtidas, comentários e salvos do original', async () => {
  const h=harness(q=>({data:q.table==='posts'?{id:'p',author:'original'}:q.table==='post_likes'?[{user_id:'me'}]:q.table==='post_saves'?{post_id:'p'}:null,count:7}));
  await h.api.pfOpenPhoto('p');
  assert.equal(h.state.postId,'p'); assert.equal(h.COMM.likes.p,1); assert.equal(h.COMM.ccount.p,7);
  assert.equal(h.COMM.myLikes.has('p'),true); assert.equal(h.COMM.mySaves.has('p'),true);
});
test('falha de rede nas marcações permite tentar novamente sem apagar seleção', async () => {
  let offline=true;
  const h=harness(q=>offline?{error:{code:'NETWORK'}}:{data:q.table==='community_profiles'?[{id:'friend',display_name:'Amigo'}]:[]});
  h.COMM.posts.p={id:'p',author:'me'}; await h.api.pfTagsOpen('p');
  assert.equal(h.api.PF.panel.ready,false); assert.ok(h.modal.innerHTML.includes('pf-panel-retry'));
  await h.api.pfTagsSave(); assert.ok(!h.calls.some(q=>q.op==='rpc'));
  offline=false; await h.api.pfTagsOpen('p'); assert.equal(h.api.PF.panel.ready,true);
});
test('comentários paginam os mais recentes e preservam ordem de leitura', async () => {
  const h=harness(()=>({data:[{id:'new',author:'me',text:'Novo'},{id:'old',author:'me',text:'Anterior'}],count:70}));
  h.api.pfCommentsOpen('v'); await tick();
  assert.deepEqual([...h.api.PF.comments.v.rows].map(x=>x.id),['old','new']);
  assert.equal(h.calls[0].max,50); assert.ok(h.modal.innerHTML.includes('Ver mais comentários'));
});
