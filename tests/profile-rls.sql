-- Executar em conexão administrativa de teste. Todas as fixtures são revertidas.
-- Não envia e-mails, não faz uploads e não usa contas reais.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  tagged_id uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  blocked_id uuid := gen_random_uuid();
  photo_id uuid := gen_random_uuid();
  video_id uuid := gen_random_uuid();
  comment_id uuid := gen_random_uuid();
  share_id uuid := gen_random_uuid();
  uid uuid;
  affected integer;
begin
  foreach uid in array array[owner_id, other_id, tagged_id, admin_id, blocked_id] loop
    insert into auth.users(id, email, raw_user_meta_data, aud, role)
      values(uid, uid::text || '@example.invalid', '{"name":"PF fixture"}', 'authenticated', 'authenticated');
    insert into public.community_profiles(id, handle, display_name, accepted_rules)
      values(uid, 'pf_test_' || substr(replace(uid::text, '-', ''), 1, 10), 'PF fixture', true);
  end loop;
  update public.profiles set role = 'member' where id = any(array[owner_id, other_id, tagged_id]);
  update public.profiles set role = 'admin' where id = admin_id;
  update public.profiles set role = 'blocked' where id = blocked_id;
  insert into public.posts(id, author, image_path) values(photo_id, owner_id, owner_id::text || '/pf-test.jpg');
  insert into public.blessings(id, author, video_key, thumb_key)
    values(video_id, owner_id, owner_id::text || '/pf-test.webm', owner_id::text || '/pf-test-thumb.jpg');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('role', 'authenticated', true);
  if auth.uid() <> owner_id then raise exception 'FAIL: identidade da fixture'; end if;
  if (select count(*) from public.profiles where id = any(array[owner_id, other_id, tagged_id, admin_id, blocked_id])) <> 1 then
    raise exception 'FAIL: privacidade do perfil e e-mail';
  end if;
  insert into public.blessing_comments(id, blessing_id, author, text) values(comment_id, video_id, owner_id, 'Comentário de teste');
  begin
    insert into public.blessing_comments(blessing_id, author, text) values(video_id, other_id, 'Forjado');
    raise exception 'FAIL: autoria forjada aceita';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.blessing_comments(blessing_id, author, text) values(video_id, owner_id, repeat('x', 501));
    raise exception 'FAIL: comentário excedente aceito';
  exception when check_violation then null; end;
  perform public.pf_set_post_tags(photo_id, array[tagged_id, tagged_id]);
  if (select count(*) from public.post_tags where post_id = photo_id) <> 1 then raise exception 'FAIL: marcação duplicada'; end if;
  begin
    perform public.pf_set_post_tags(photo_id, array[blocked_id]);
    raise exception 'FAIL: marcação de bloqueado aceita';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from public.post_tags where post_id = photo_id) <> 1 then raise exception 'FAIL: RPC sem atomicidade'; end if;
  insert into public.profile_shares(id, user_id, post_id) values(share_id, owner_id, photo_id);
  begin
    insert into public.profile_shares(user_id, post_id) values(owner_id, photo_id);
    raise exception 'FAIL: compartilhamento duplicado aceito';
  exception when unique_violation then null; end;
  begin
    insert into public.profile_shares(user_id, post_id, blessing_id) values(owner_id, photo_id, video_id);
    raise exception 'FAIL: dois originais no compartilhamento';
  exception when check_violation then null; end;
  begin
    insert into public.profile_shares(user_id, blessing_id) values(other_id, video_id);
    raise exception 'FAIL: compartilhamento em perfil alheio';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', other_id::text, true);
  if (select count(*) from public.blessing_comments where id = comment_id) <> 1 then raise exception 'FAIL: leitura de comentários'; end if;
  delete from public.blessing_comments where id = comment_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: terceiro apagou comentário'; end if;
  begin
    perform public.pf_set_post_tags(photo_id, array[other_id]);
    raise exception 'FAIL: terceiro marcou foto alheia';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.post_tags(post_id, tagged_user, tagged_by) values(photo_id, other_id, other_id);
    raise exception 'FAIL: terceiro inseriu marcação direta';
  exception when insufficient_privilege then null; end;
  delete from public.post_tags where post_id = photo_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: terceiro removeu marcação'; end if;
  delete from public.profile_shares where id = share_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: terceiro removeu compartilhamento'; end if;
  insert into public.profile_shares(user_id, blessing_id) values(other_id, video_id);
  insert into public.blessing_comments(blessing_id, author, text) values(video_id, other_id, 'Comentário de outro usuário');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', tagged_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', tagged_id::text, true);
  delete from public.post_tags where post_id = photo_id and tagged_user = tagged_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: pessoa marcada não pode remover marcação'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.pf_set_post_tags(photo_id, array[tagged_id]);
  delete from public.blessing_comments where blessing_id = video_id;
  get diagnostics affected = row_count;
  if affected <> 2 then raise exception 'FAIL: dono não modera comentários do seu vídeo'; end if;
  insert into public.blessing_comments(id, blessing_id, author, text) values(comment_id, video_id, owner_id, 'Teste admin');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', blocked_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', blocked_id::text, true);
  if exists(select 1 from public.blessing_comments where blessing_id = video_id) then raise exception 'FAIL: bloqueado lê comentários'; end if;
  if exists(select 1 from public.post_tags where post_id = photo_id) then raise exception 'FAIL: bloqueado lê marcações'; end if;
  if exists(select 1 from public.profile_shares where id = share_id) then raise exception 'FAIL: bloqueado lê compartilhamentos'; end if;
  begin
    insert into public.blessing_comments(blessing_id, author, text) values(video_id, blocked_id, 'Bloqueado');
    raise exception 'FAIL: bloqueado comenta';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.profile_shares(user_id, post_id) values(blocked_id, photo_id);
    raise exception 'FAIL: bloqueado compartilha';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  delete from public.blessing_comments where id = comment_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: admin não modera comentários'; end if;
  delete from public.profile_shares where id = share_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: admin não remove compartilhamento'; end if;
  perform public.pf_set_post_tags(photo_id, array[other_id]);
  if not exists(select 1 from public.post_tags where post_id = photo_id and tagged_user = other_id) then raise exception 'FAIL: admin não modera marcações'; end if;

  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
  begin
    perform count(*) from public.blessing_comments;
    raise exception 'FAIL: anônimo leu comentários';
  exception when insufficient_privilege then null; end;
  begin
    perform public.pf_set_post_tags(photo_id, '{}');
    raise exception 'FAIL: anônimo chamou RPC';
  exception when insufficient_privilege then null; end;
  perform set_config('role', 'none', true);
  if has_table_privilege('anon','public.post_tags','SELECT') or has_table_privilege('anon','public.profile_shares','SELECT') then
    raise exception 'FAIL: privilégios anônimos';
  end if;
  if has_table_privilege('authenticated','public.post_tags','UPDATE') or has_table_privilege('authenticated','public.profile_shares','UPDATE')
    or has_table_privilege('authenticated','public.blessing_comments','UPDATE') then raise exception 'FAIL: UPDATE indevido'; end if;
end;
$$;
rollback;
select 'PASS: comentários, marcações, compartilhamentos, autoria, moderação, bloqueio, acesso anônimo e privacidade; fixtures revertidas' as result;
