/* Fonte das novidades do perfil, incorporada no IIFE de index.html. */
const PF_FIELDS = "id,handle,display_name,avatar_path,cover_path,theme,verified,official,kind";
const PF_POST_FIELDS = "id,author,image_path,caption,song,created_at";
const PF_VIDEO_FIELDS = "id,author,video_key,thumb_key,caption,duration,created_at";
const PF_TABS = [["photos", "Fotos"], ["videos", "Blessings"], ["tagged", "Fotos comigo"], ["shares", "Compartilhamentos"]];
const PF = {viewer: null, generation: 0, tabs: {}, lists: {}, tags: {}, comments: {}, drafts: {}, videos: {}, panel: null, mutations: new Set()};
function pfReset(){
  const hadPanel = !!PF.panel;
  pfPanelClosed(false);
  if (hadPanel) { const modal = $("#modal"); if (modal) { modal.hidden = true; modal.innerHTML = ""; } }
  PF.viewer = TEAM.user ? TEAM.user.id : null;
  PF.generation++;
  PF.tabs = {}; PF.lists = {}; PF.tags = {}; PF.comments = {}; PF.drafts = {}; PF.videos = {}; PF.mutations = new Set();
}
function pfActor(){
  const id = TEAM.user ? TEAM.user.id : null;
  if (PF.viewer !== id) pfReset();
  return {id, generation: PF.generation, client: TEAM.client};
}
function pfCurrent(actor){ return !!actor.id && actor.id === (TEAM.user && TEAM.user.id) && actor.generation === PF.generation && commIn(); }
function pfError(error){
  if (commMissing(error)) return "Este recurso está sendo ativado. Tente novamente em instantes.";
  if (error && error.code === "42501") return "Você não tem permissão para esta ação.";
  return "Não consegui concluir agora. Confira a internet e tente novamente.";
}
function pfInvalidate(){ PF.lists = {}; }
async function pfProfiles(ids, actor){
  const missing = [...new Set(ids)].filter(id => id && !COMM.profiles[id]);
  if (!missing.length) return;
  const {data, error} = await actor.client.from("community_profiles").select(PF_FIELDS).in("id", missing);
  if (error) throw error;
  if (pfCurrent(actor)) commKeep(data || []);
}
async function pfOriginals(rows, actor){
  const posts = [...new Set(rows.map(r => r.post_id).filter(Boolean))];
  const videos = [...new Set(rows.map(r => r.blessing_id).filter(Boolean))];
  const [p, v] = await Promise.all([
    posts.length ? actor.client.from("posts").select(PF_POST_FIELDS).in("id", posts) : {data: []},
    videos.length ? actor.client.from("blessings").select(PF_VIDEO_FIELDS).in("id", videos) : {data: []}
  ]);
  if (p.error || v.error) throw p.error || v.error;
  if (!pfCurrent(actor)) return [];
  const photos = p.data || [], clips = v.data || [];
  await pfProfiles(photos.concat(clips).map(x => x.author), actor);
  if (!pfCurrent(actor)) return [];
  photos.forEach(x => { COMM.posts[x.id] = x; });
  clips.forEach(x => { PF.videos[x.id] = x; });
  commSign(photos.map(x => commThumb(x.image_path)));
  const available = new Set(photos.concat(clips).map(x => x.id));
  return rows.filter(r => available.has(r.post_id || r.blessing_id));
}
function pfProfileSection(profile, photos){
  pfActor();
  const tab = PF.tabs[profile.id] || "photos", key = profile.id + ":" + tab;
  const tabs = PF_TABS.map(([value, label]) => `<button class="pf-tab" role="tab" id="pf-tab-${value}" aria-controls="pf-profile-content" aria-selected="${tab === value}" data-a="pf-tab" data-id="${esc(profile.id)}" data-v="${value}">${esc(label)}</button>`).join("");
  let content;
  if (tab === "photos") content = photos === undefined ? '<p class="muted">Carregando fotos…</p>' : photos.length ? commGrid(photos) : '<p class="muted">Ainda não há fotos publicadas.</p>';
  else {
    let entry = PF.lists[key];
    if (!entry || (!entry.loading && !entry.error && Date.now() - entry.updated > 60000)) {
      entry = PF.lists[key] = {rows: entry ? entry.rows : [], loading: true, limit: entry ? entry.limit : 24};
      pfLoadList(profile.id, tab, entry);
    }
    content = entry.error ? `<p class="pf-status" role="status">${esc(entry.error)}</p><button class="btn" data-a="pf-retry" data-id="${esc(profile.id)}" data-v="${tab}">Tentar novamente</button>`
      : entry.rows.length ? pfListHtml(profile.id, tab, entry.rows) : `<p class="muted">${entry.loading ? "Carregando…" : tab === "videos" ? "Ainda não há Blessings publicados." : tab === "tagged" ? "As fotos em que este perfil foi marcado aparecem aqui." : "As publicações compartilhadas por este perfil aparecem aqui."}</p>`;
    if (entry.rows.length && entry.loading) content += '<p class="muted" role="status">Carregando…</p>';
    else if (entry.more && !entry.error) content += `<button class="btn pf-load-more" data-a="pf-load-more" data-id="${esc(profile.id)}" data-v="${tab}">Ver mais</button>`;
  }
  return `<section class="pf-publications" aria-label="Publicações do perfil"><div class="pf-tabs" role="tablist" aria-label="Tipos de publicação">${tabs}</div><div id="pf-profile-content" role="tabpanel" aria-labelledby="pf-tab-${tab}" aria-live="polite">${content}</div></section>`;
}
async function pfLoadList(id, tab, entry){
  const actor = pfActor(), key = id + ":" + tab;
  if (!pfCurrent(actor)) return;
  try {
    const table = tab === "videos" ? "blessings" : tab === "tagged" ? "post_tags" : "profile_shares";
    const fields = tab === "videos" ? PF_VIDEO_FIELDS : tab === "tagged" ? "id,post_id,tagged_user,tagged_by,created_at" : "id,user_id,post_id,blessing_id,created_at";
    const field = tab === "videos" ? "author" : tab === "tagged" ? "tagged_user" : "user_id";
    const {data, error} = await actor.client.from(table).select(fields).eq(field, id).order("created_at", {ascending: false}).order("id", {ascending: false}).limit(entry.limit + 1);
    if (error) throw error;
    if (!pfCurrent(actor) || PF.lists[key] !== entry) return;
    const rows = (data || []).slice(0, entry.limit);
    if (tab === "videos") {
      await pfProfiles(rows.map(x => x.author), actor);
      if (!pfCurrent(actor) || PF.lists[key] !== entry) return;
      rows.forEach(x => { PF.videos[x.id] = x; });
      entry.rows = rows;
    } else entry.rows = await pfOriginals(rows, actor);
    if (!pfCurrent(actor) || PF.lists[key] !== entry) return;
    entry.more = (data || []).length > entry.limit; entry.updated = Date.now(); entry.error = "";
  } catch (error) { if (pfCurrent(actor) && PF.lists[key] === entry) entry.error = pfError(error); }
  finally { if (pfCurrent(actor) && PF.lists[key] === entry) { entry.loading = false; if (state.view === "profile" && state.profileId === id) rerenderKeepScroll(); } }
}
function pfVideoTile(x){
  return `<button class="pf-video-tile" data-a="pf-video" data-id="${esc(x.id)}" aria-label="Abrir Blessing${x.caption ? ": " + esc(x.caption) : ""}">${x.thumb_key ? `<img src="${esc(blUrl(x.thumb_key))}" alt="Miniatura do Blessing" loading="lazy" decoding="async">` : '<span class="pf-no-thumb">Blessing</span>'}<span class="pf-play">${BL_ICONS.play}</span>${x.duration ? `<small class="pf-duration">${Math.round(x.duration)}s</small>` : ""}</button>`;
}
function pfListHtml(profileId, tab, rows){
  if (tab === "videos") return `<div class="cm-grid pf-video-grid">${rows.map(pfVideoTile).join("")}</div>`;
  if (tab === "tagged") return commGrid(rows.map(r => r.post_id)).replaceAll('data-a="cm-post"', 'data-a="pf-photo"');
  const own = profileId === (TEAM.user && TEAM.user.id);
  return `<div class="pf-shares">${rows.map(r => {
    const x = r.post_id ? COMM.posts[r.post_id] : PF.videos[r.blessing_id]; if (!x) return "";
    const a = COMM.profiles[x.author] || {}, u = r.post_id ? commGridUrl(x) : "";
    return `<article class="pf-shared"><div class="pf-shared-media">${r.post_id ? `<button data-a="pf-photo" data-id="${esc(x.id)}" aria-label="Abrir foto compartilhada">${u ? `<img src="${esc(u)}" alt="Foto compartilhada" loading="lazy" decoding="async">` : '<span class="muted">Carregando foto…</span>'}</button>` : pfVideoTile(x)}</div><div class="pf-shared-info"><small class="muted">${r.post_id ? "Foto compartilhada" : "Blessing compartilhado"}</small><button class="lnk2" data-a="cm-profile" data-id="${esc(x.author)}">${esc(a.display_name || "Perfil original")}${commBadge(a)}</button>${x.caption ? `<p>${esc(x.caption)}</p>` : ""}${own || teamRole() === "admin" ? `<button class="lnk2" data-a="pf-share-remove" data-id="${esc(r.id)}" data-profile="${esc(profileId)}">Remover compartilhamento</button>` : ""}</div></article>`;
  }).join("")}</div>`;
}
function pfCanTag(post){ return !!TEAM.user && (post.author === TEAM.user.id || teamRole() === "admin"); }
function pfPhotoTagsHtml(post){
  pfActor();
  let entry = PF.tags[post.id];
  if (!entry || (!entry.loading && !entry.error && Date.now() - entry.updated > 60000)) { entry = PF.tags[post.id] = {rows: entry ? entry.rows : [], loading: true}; pfLoadTags(post.id, entry); }
  const mine = entry.rows.find(r => r.tagged_user === (TEAM.user && TEAM.user.id));
  const people = entry.rows.map(r => { const p = COMM.profiles[r.tagged_user] || {}; return `<button class="pf-tag-person" data-a="cm-profile" data-id="${esc(r.tagged_user)}">${commAvatar(p, 26)}${esc(p.display_name || "Perfil")}</button>`; }).join("");
  return `<section class="pf-photo-tags" aria-label="Pessoas marcadas">${people ? `<span class="muted">Nesta foto</span><div class="pf-tagged-people">${people}</div>` : ""}${entry.error ? `<p class="muted" role="status">${esc(entry.error)}</p>` : ""}<div class="actions">${pfCanTag(post) ? `<button class="btn ghost" data-a="pf-tags" data-id="${esc(post.id)}">Marcar pessoas</button>` : ""}${mine ? `<button class="btn ghost" data-a="pf-untag" data-id="${esc(mine.id)}" data-post="${esc(post.id)}">Remover minha marcação</button>` : ""}</div></section>`;
}
async function pfLoadTags(id, entry){
  const actor = pfActor();
  try {
    const {data, error} = await actor.client.from("post_tags").select("id,post_id,tagged_user,tagged_by,created_at").eq("post_id", id).order("created_at", {ascending: true});
    if (error) throw error;
    await pfProfiles((data || []).map(r => r.tagged_user), actor);
    if (!pfCurrent(actor) || PF.tags[id] !== entry) return;
    entry.rows = data || []; entry.error = ""; entry.updated = Date.now();
  } catch (error) { if (pfCurrent(actor) && PF.tags[id] === entry) entry.error = pfError(error); }
  finally { if (pfCurrent(actor) && PF.tags[id] === entry) { entry.loading = false; if (state.view === "post" && state.postId === id) rerenderKeepScroll(); } }
}
function pfPanelClosed(resume = true){
  const panel = PF.panel; if (!panel) return;
  PF.panel = null;
  if (panel.kind === "comments") { const input = $("#pf-comment"); if (input) PF.drafts[panel.id] = input.value; }
  if (resume && panel.video && panel.wasPlaying && panel.video.isConnected && state.view === "blessings" && pfCurrent(panel.actor)) panel.video.play().catch(() => {});
  if (resume && panel.focus && panel.focus.isConnected) panel.focus.focus();
}
function pfOpenPanel(kind, id){
  const actor = pfActor(); if (!pfCurrent(actor)) return null;
  closePix();
  const video = [...document.querySelectorAll(".bl-v")].find(v => !v.paused);
  const panel = {kind, id, actor, loading: true, busy: false, error: "", focus: document.activeElement, video, wasPlaying: !!video};
  if (video) video.pause();
  PF.panel = panel; pfRenderPanel(true); return panel;
}
function pfPanelCurrent(panel){ return PF.panel === panel && pfCurrent(panel.actor); }
function pfRenderPanel(first = false){
  const panel = PF.panel; if (!panel || !pfPanelCurrent(panel)) return;
  const m = $("#modal"), active = document.activeElement, focusId = active && active.id;
  const pos = active && active.selectionStart;
  const title = panel.kind === "comments" ? "Comentários do Blessing" : panel.kind === "tags" ? "Marcar pessoas" : "Compartilhar";
  m.className = "modal";
  m.innerHTML = `<div class="modal-box pf-dialog" role="dialog" aria-modal="true" aria-labelledby="pf-dialog-title"><div class="pf-dialog-head"><h2 id="pf-dialog-title">${title}</h2><button class="btn ghost" id="pf-close" data-a="pf-close" aria-label="Fechar">✕</button></div>${panel.error ? `<p class="pf-status" role="status">${esc(panel.error)}</p>` : ""}${panel.kind === "comments" ? pfCommentsPanelHtml(panel) : panel.kind === "tags" ? pfTagsPanelHtml(panel) : pfSharePanelHtml(panel)}</div>`;
  m.hidden = false;
  const focus = !first && focusId ? document.getElementById(focusId) : null;
  if (focus) { focus.focus(); if (typeof pos === "number" && focus.setSelectionRange) try { focus.setSelectionRange(pos, pos); } catch (_) {} }
  else if (first) $("#pf-close").focus();
}
async function pfShareOpen(kind, id){
  const panel = pfOpenPanel("share", id); if (!panel) return;
  panel.mediaKind = kind;
  try {
    const field = kind === "post" ? "post_id" : "blessing_id";
    const {data, error} = await panel.actor.client.from("profile_shares").select("id").eq("user_id", panel.actor.id).eq(field, id).maybeSingle();
    if (error) throw error;
    if (pfPanelCurrent(panel)) panel.share = data || null;
  } catch (error) { if (pfPanelCurrent(panel)) panel.error = pfError(error); }
  finally { if (pfPanelCurrent(panel)) { panel.loading = false; pfRenderPanel(); } }
}
function pfSharePanelHtml(panel){
  return `<p>Compartilhe esta publicação no seu perfil ou envie o link.</p><div class="pf-share-actions">${COMM.me ? `<button class="btn primary" data-a="pf-share-save" ${panel.loading || panel.busy || panel.share === undefined ? "disabled" : ""}>${panel.loading ? "Carregando…" : panel.busy ? "Salvando…" : panel.share ? "Remover do meu perfil" : "Compartilhar no meu perfil"}</button>` : '<button class="btn primary" data-a="pf-create-profile">Criar meu perfil para compartilhar</button>'}${panel.error && panel.share === undefined ? '<button class="btn" data-a="pf-panel-retry">Tentar novamente</button>' : ""}<button class="btn" data-a="pf-share-link" ${panel.busy ? "disabled" : ""}>Enviar link</button></div>`;
}
async function pfShareSave(){
  const panel = PF.panel;
  if (!panel || panel.kind !== "share" || panel.loading || panel.busy || panel.share === undefined || !COMM.me || !pfPanelCurrent(panel)) return;
  panel.busy = true; panel.error = ""; pfRenderPanel();
  const field = panel.mediaKind === "post" ? "post_id" : "blessing_id";
  const removing = !!panel.share;
  try {
    const result = removing ? await panel.actor.client.from("profile_shares").delete().eq("id", panel.share.id).eq("user_id", panel.actor.id)
      : await panel.actor.client.from("profile_shares").insert({user_id: panel.actor.id, [field]: panel.id});
    if (result.error && !(result.error.code === "23505" && !removing)) throw result.error;
    if (!pfCurrent(panel.actor)) return;
    pfInvalidate();
    if (pfPanelCurrent(panel)) { closePix(); flash(removing ? "Compartilhamento removido do seu perfil." : "Compartilhado no seu perfil."); }
    if (state.view === "profile") rerenderKeepScroll();
  } catch (error) { if (pfPanelCurrent(panel)) { panel.error = pfError(error); panel.busy = false; pfRenderPanel(); } }
}
async function pfShareRemove(id, profileId){
  const actor = pfActor(), key = "share:" + id;
  if (!pfCurrent(actor) || PF.mutations.has(key) || (actor.id !== profileId && teamRole() !== "admin")) return;
  PF.mutations.add(key);
  try {
    const {error} = await actor.client.from("profile_shares").delete().eq("id", id).eq("user_id", profileId);
    if (error) throw error;
    if (pfCurrent(actor)) { pfInvalidate(); rerenderKeepScroll(); flash("Compartilhamento removido."); }
  } catch (error) { if (pfCurrent(actor)) flash(pfError(error)); }
  finally { if (pfCurrent(actor)) PF.mutations.delete(key); }
}
async function pfTagsOpen(id){
  const post = COMM.posts[id]; if (!post || !pfCanTag(post)) return;
  const panel = pfOpenPanel("tags", id); if (!panel) return;
  panel.selected = new Set(); panel.people = []; panel.query = ""; panel.ready = false;
  try {
    const [tags, people] = await Promise.all([
      panel.actor.client.from("post_tags").select("id,post_id,tagged_user,tagged_by,created_at").eq("post_id", id),
      panel.actor.client.from("community_profiles").select(PF_FIELDS).order("display_name", {ascending: true}).limit(500)
    ]);
    if (tags.error || people.error) throw tags.error || people.error;
    if (!pfPanelCurrent(panel)) return;
    panel.people = people.data || []; panel.selected = new Set((tags.data || []).map(x => x.tagged_user));
    await pfProfiles((tags.data || []).map(x => x.tagged_user), panel.actor);
    if (!pfPanelCurrent(panel)) return;
    commKeep(panel.people);
    const known = new Set(panel.people.map(p => p.id));
    panel.selected.forEach(uid => { if (!known.has(uid) && COMM.profiles[uid]) panel.people.push(COMM.profiles[uid]); });
    panel.ready = true;
  } catch (error) { if (pfPanelCurrent(panel)) panel.error = pfError(error); }
  finally { if (pfPanelCurrent(panel)) { panel.loading = false; pfRenderPanel(); } }
}
function pfTagsPanelHtml(panel){
  if (panel.loading) return '<p class="muted">Carregando pessoas…</p>';
  return `<p>Escolha quem aparece nesta foto. Cada pessoa pode remover a própria marcação.</p><label class="pf-search-label" for="pf-tag-search">Buscar pessoa</label><input id="pf-tag-search" type="search" placeholder="Nome ou @perfil" value="${esc(panel.query || "")}" autocomplete="off"><p class="muted pf-selection" role="status">${panel.selected.size} de 30 pessoas</p><div class="pf-tag-options">${(panel.people || []).map(p => `<button type="button" class="pf-tag-option" id="pf-person-${esc(p.id)}" data-a="pf-tag-toggle" data-id="${esc(p.id)}" data-search="${esc(norm((p.display_name || "") + " " + (p.handle || "")))}" aria-pressed="${panel.selected.has(p.id)}" ${panel.busy ? "disabled" : ""} ${panel.query && !norm((p.display_name || "") + " " + (p.handle || "")).includes(norm(panel.query)) ? "hidden" : ""}>${commAvatar(p, 36)}<span><b>${esc(p.display_name || "Perfil")}</b><small class="muted">@${esc(p.handle || "")}</small></span><span class="pf-check" aria-hidden="true">${panel.selected.has(p.id) ? "✓" : "＋"}</span></button>`).join("") || '<p class="muted">Nenhum perfil disponível.</p>'}</div>${panel.error && !panel.ready ? '<button class="btn" data-a="pf-panel-retry">Tentar novamente</button>' : ""}<button class="btn primary" data-a="pf-tags-save" ${panel.busy || !panel.ready ? "disabled" : ""}>${panel.busy ? "Salvando…" : "Salvar marcações"}</button>`;
}
async function pfTagsSave(){
  const panel = PF.panel;
  if (!panel || panel.kind !== "tags" || panel.loading || panel.busy || !panel.ready || !pfPanelCurrent(panel)) return;
  panel.busy = true; panel.error = ""; pfRenderPanel();
  try {
    const {error} = await panel.actor.client.rpc("pf_set_post_tags", {p_post_id: panel.id, p_users: [...panel.selected]});
    if (error) throw error;
    if (!pfCurrent(panel.actor)) return;
    delete PF.tags[panel.id]; pfInvalidate();
    if (pfPanelCurrent(panel)) { closePix(); flash("Marcações salvas."); }
    if (state.view === "post" || state.view === "profile") rerenderKeepScroll();
  } catch (error) { if (pfPanelCurrent(panel)) { panel.error = pfError(error); panel.busy = false; pfRenderPanel(); } }
}
async function pfUntag(id, postId){
  const actor = pfActor(), key = "tag:" + id;
  if (!pfCurrent(actor) || PF.mutations.has(key)) return;
  PF.mutations.add(key);
  try {
    const {error} = await actor.client.from("post_tags").delete().eq("id", id).eq("tagged_user", actor.id);
    if (error) throw error;
    if (pfCurrent(actor)) { delete PF.tags[postId]; pfInvalidate(); rerenderKeepScroll(); flash("Sua marcação foi removida."); }
  } catch (error) { if (pfCurrent(actor)) flash(pfError(error)); }
  finally { if (pfCurrent(actor)) PF.mutations.delete(key); }
}
function pfCommentsOpen(id){
  const panel = pfOpenPanel("comments", id); if (!panel) return;
  panel.limit = 50; pfLoadComments(panel);
}
async function pfLoadComments(panel){
  panel.loading = true;
  try {
    const {data, count, error} = await panel.actor.client.from("blessing_comments").select("id,blessing_id,author,text,created_at", {count: "exact"}).eq("blessing_id", panel.id).order("created_at", {ascending: false}).order("id", {ascending: false}).limit(panel.limit);
    if (error) throw error;
    await pfProfiles((data || []).map(c => c.author), panel.actor);
    if (!pfCurrent(panel.actor)) return;
    PF.comments[panel.id] = {rows: (data || []).slice().reverse(), total: count ?? (data || []).length};
    if (pfPanelCurrent(panel)) panel.error = "";
  } catch (error) { if (pfPanelCurrent(panel)) panel.error = pfError(error); }
  finally { if (pfPanelCurrent(panel)) { panel.loading = false; pfRenderPanel(); } }
}
function pfCommentsPanelHtml(panel){
  const entry = PF.comments[panel.id], video = BLS.items[panel.id] || PF.videos[panel.id] || {};
  const rows = entry ? entry.rows : [], uid = panel.actor.id;
  const comments = rows.map(c => { const a = COMM.profiles[c.author] || {}, canDelete = c.author === uid || video.author === uid || teamRole() === "admin";
    return `<div class="cm-cmt"><button class="cm-cmt-av" data-a="cm-profile" data-id="${esc(c.author)}" aria-label="Perfil de ${esc(a.display_name || "alguém")}">${commAvatar(a, 34)}</button><div class="cm-cmt-b"><p><button class="lnk2 cm-cmt-n" data-a="cm-profile" data-id="${esc(c.author)}">${esc(a.display_name || "Perfil")}</button>${commBadge(a)} <span class="muted">· ${commAgo(c.created_at)}</span></p><p class="cm-cmt-t">${esc(c.text)}</p>${canDelete ? `<button class="lnk2" data-a="pf-comment-delete" data-id="${esc(c.id)}" ${panel.busy ? "disabled" : ""}>Apagar</button>` : ""}</div></div>`;
  }).join("");
  return `<p class="muted">${entry ? entry.total + " comentário" + (entry.total === 1 ? "" : "s") : ""}</p><div class="pf-comment-list">${comments || `<p class="muted">${panel.loading ? "Carregando comentários…" : panel.error ? "" : "Seja o primeiro a comentar."}</p>`}</div>${entry && entry.total > rows.length ? `<button class="btn" data-a="pf-comments-more" ${panel.loading || panel.busy ? "disabled" : ""}>${panel.loading ? "Carregando…" : "Ver mais comentários"}</button>` : ""}${panel.error ? '<button class="btn" data-a="pf-comments-retry">Tentar novamente</button>' : ""}${COMM.me ? `<form class="cm-cmt-form pf-comment-form" id="pf-comment-form"><textarea id="pf-comment" maxlength="500" rows="2" aria-label="Seu comentário" placeholder="Escreva um comentário…">${esc(PF.drafts[panel.id] || "")}</textarea><button class="btn primary" type="submit" ${panel.busy || panel.loading ? "disabled" : ""}>${panel.busy ? "Enviando…" : "Enviar"}</button></form>` : '<button class="btn" data-a="pf-create-profile">Criar meu perfil para comentar</button>'}`;
}
async function pfSendComment(){
  const panel = PF.panel;
  if (!panel || panel.kind !== "comments" || panel.busy || panel.loading || !COMM.me || !pfPanelCurrent(panel)) return;
  const input = $("#pf-comment"), text = ((input && input.value) || PF.drafts[panel.id] || "").trim();
  if (!text) { flash("Escreva um comentário antes de enviar."); return; }
  if ([...text].length > 500) { flash("Use até 500 caracteres no comentário."); return; }
  PF.drafts[panel.id] = text; panel.busy = true; panel.error = ""; pfRenderPanel();
  try {
    const {error} = await panel.actor.client.from("blessing_comments").insert({blessing_id: panel.id, author: panel.actor.id, text});
    if (error) throw error;
    if (!pfCurrent(panel.actor)) return;
    PF.drafts[panel.id] = ""; delete PF.comments[panel.id];
    if (pfPanelCurrent(panel)) {
      panel.busy = false;
      await pfLoadComments(panel);
      if (pfPanelCurrent(panel)) { const el = $("#pf-comment"); if (el) el.focus(); }
    }
  } catch (error) { if (pfPanelCurrent(panel)) { panel.busy = false; panel.error = pfError(error); pfRenderPanel(); } }
}
async function pfDeleteComment(id){
  const panel = PF.panel; if (!panel || panel.kind !== "comments" || panel.busy || !pfPanelCurrent(panel)) return;
  const entry = PF.comments[panel.id], row = entry && entry.rows.find(c => c.id === id);
  const video = BLS.items[panel.id] || PF.videos[panel.id] || {};
  if (!row || (row.author !== panel.actor.id && video.author !== panel.actor.id && teamRole() !== "admin")) return;
  panel.busy = true; panel.error = ""; pfRenderPanel();
  try {
    const {error} = await panel.actor.client.from("blessing_comments").delete().eq("id", id).eq("blessing_id", panel.id);
    if (error) throw error;
    if (!pfCurrent(panel.actor)) return;
    delete PF.comments[panel.id];
    if (pfPanelCurrent(panel)) { panel.busy = false; await pfLoadComments(panel); }
  } catch (error) { if (pfPanelCurrent(panel)) { panel.busy = false; panel.error = pfError(error); pfRenderPanel(); } }
}
async function pfOpenPhoto(id){
  const actor = pfActor(); if (!pfCurrent(actor)) return;
  const {data, error} = await actor.client.from("posts").select(PF_POST_FIELDS).eq("id", id).maybeSingle();
  if (!pfCurrent(actor)) return;
  if (error || !data) { flash(error ? pfError(error) : "Esta foto não está mais disponível."); pfInvalidate(); return; }
  COMM.posts[id] = data;
  commClick("cm-post", {dataset: {id}});
  try {
    const [likes, comments, saved] = await Promise.all([
      actor.client.from("post_likes").select("user_id").eq("post_id", id),
      actor.client.from("post_comments").select("id", {count: "exact", head: true}).eq("post_id", id),
      actor.client.from("post_saves").select("post_id").eq("user_id", actor.id).eq("post_id", id).maybeSingle()
    ]);
    if (!pfCurrent(actor)) return;
    if (!likes.error) {
      COMM.likes[id] = (likes.data || []).length;
      COMM.myLikes.delete(id); if ((likes.data || []).some(r => r.user_id === actor.id)) COMM.myLikes.add(id);
    }
    if (!comments.error) COMM.ccount[id] = comments.count || 0;
    if (!saved.error) { COMM.mySaves.delete(id); if (saved.data) COMM.mySaves.add(id); }
    if (state.view === "post" && state.postId === id) rerenderKeepScroll();
  } catch (_) { /* A foto continua disponível; uma nova abertura tenta atualizar as interações. */ }
}
function pfClick(action, button){
  const id = button.dataset.id;
  if (action === "pf-tab") {
    pfActor(); if (!PF_TABS.some(([v]) => v === button.dataset.v)) return true;
    PF.tabs[id] = button.dataset.v; rerenderKeepScroll();
    const tab = document.getElementById("pf-tab-" + button.dataset.v); if (tab) tab.focus();
  } else if (action === "pf-load-more" || action === "pf-retry") {
    const key = id + ":" + button.dataset.v, entry = PF.lists[key];
    if (entry && !entry.loading) { if (action === "pf-load-more") entry.limit += 24; entry.error = ""; entry.loading = true; pfLoadList(id, button.dataset.v, entry); rerenderKeepScroll(); }
  } else if (action === "pf-video") { closePix(); blOpen(id); }
  else if (action === "pf-photo") pfOpenPhoto(id);
  else if (action === "pf-comments") pfCommentsOpen(id);
  else if (action === "pf-comments-more" || action === "pf-comments-retry") { const p = PF.panel; if (p && p.kind === "comments" && !p.loading && !p.busy) { if (action === "pf-comments-more") p.limit += 50; pfLoadComments(p); pfRenderPanel(); } }
  else if (action === "pf-comment-delete") { if (confirm("Apagar este comentário?")) pfDeleteComment(id); }
  else if (action === "pf-tags") pfTagsOpen(id);
  else if (action === "pf-tag-toggle") {
    const p = PF.panel; if (p && p.kind === "tags" && !p.busy && p.people.some(x => x.id === id)) {
      if (p.selected.has(id)) p.selected.delete(id);
      else if (p.selected.size < 30) p.selected.add(id);
      else { flash("Escolha no máximo 30 pessoas."); return true; }
      pfRenderPanel();
    }
  } else if (action === "pf-tags-save") pfTagsSave();
  else if (action === "pf-untag") pfUntag(id, button.dataset.post);
  else if (action === "pf-share-save") pfShareSave();
  else if (action === "pf-panel-retry") { const p = PF.panel; if (p && !p.busy) { if (p.kind === "share") pfShareOpen(p.mediaKind, p.id); else if (p.kind === "tags") pfTagsOpen(p.id); } }
  else if (action === "pf-share-remove") pfShareRemove(id, button.dataset.profile);
  else if (action === "pf-share-link") { const p = PF.panel; if (p && p.kind === "share") { const kind = p.mediaKind, mediaId = p.id; closePix(); if (kind === "post") commShare(mediaId); else blShare(mediaId); } }
  else if (action === "pf-create-profile") { closePix(); commClick("cm-edit", {dataset: {}}); }
  else if (action === "pf-close") closePix();
  else return false;
  return true;
}
function pfInput(target){
  const p = PF.panel; if (!p) return false;
  if (target.id === "pf-comment" && p.kind === "comments") { PF.drafts[p.id] = target.value; return true; }
  if (target.id === "pf-tag-search" && p.kind === "tags") {
    p.query = target.value;
    document.querySelectorAll(".pf-tag-option").forEach(el => { el.hidden = !el.dataset.search.includes(norm(p.query)); });
    return true;
  }
  return false;
}
function pfKeydown(event){
  if (event.target && event.target.classList && event.target.classList.contains("pf-tab") && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const index = PF_TABS.findIndex(([v]) => v === event.target.dataset.v);
    const next = event.key === "Home" ? 0 : event.key === "End" ? 3 : (index + (event.key === "ArrowRight" ? 1 : 3)) % 4;
    pfClick("pf-tab", {dataset: {id: event.target.dataset.id, v: PF_TABS[next][0]}}); return;
  }
  if (event.key !== "Tab" || !PF.panel) return;
  const box = $(".pf-dialog"); if (!box) return;
  const elements = [...box.querySelectorAll('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),a[href]')].filter(el => !el.hidden && el.getClientRects().length);
  const first = elements[0], last = elements[elements.length - 1]; if (!first) return;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
