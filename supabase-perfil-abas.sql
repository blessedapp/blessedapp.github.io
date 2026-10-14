-- Blessed: comentários de Blessings, Fotos comigo e compartilhamentos.
-- Somente estruturas novas. Não altera profiles, Auth, e-mails,
-- políticas existentes, arquivos de mídia ou segredos de API.

create table if not exists public.blessing_comments (
  id uuid primary key default gen_random_uuid(),
  blessing_id uuid not null references public.blessings(id) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists blessing_comments_blessing_created_idx
  on public.blessing_comments (blessing_id, created_at, id);
create index if not exists blessing_comments_author_idx on public.blessing_comments (author);

create table if not exists public.post_tags (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  tagged_user uuid not null references public.community_profiles(id) on delete cascade,
  tagged_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, tagged_user)
);
create index if not exists post_tags_user_created_idx
  on public.post_tags (tagged_user, created_at desc);
create index if not exists post_tags_tagged_by_idx on public.post_tags (tagged_by);

create table if not exists public.profile_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.community_profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  blessing_id uuid references public.blessings(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(post_id, blessing_id) = 1)
);
create unique index if not exists profile_shares_user_post_unique
  on public.profile_shares (user_id, post_id) where post_id is not null;
create unique index if not exists profile_shares_user_blessing_unique
  on public.profile_shares (user_id, blessing_id) where blessing_id is not null;
create index if not exists profile_shares_user_created_idx
  on public.profile_shares (user_id, created_at desc);
create index if not exists profile_shares_post_idx
  on public.profile_shares (post_id) where post_id is not null;
create index if not exists profile_shares_blessing_idx
  on public.profile_shares (blessing_id) where blessing_id is not null;

alter table public.blessing_comments enable row level security;
alter table public.post_tags enable row level security;
alter table public.profile_shares enable row level security;
revoke all on public.blessing_comments, public.post_tags, public.profile_shares from public, anon, authenticated;
grant select, insert, delete on public.blessing_comments, public.post_tags, public.profile_shares to authenticated;
grant all on public.blessing_comments, public.post_tags, public.profile_shares to service_role;

drop policy if exists pf_blessing_comments_read on public.blessing_comments;
create policy pf_blessing_comments_read on public.blessing_comments for select to authenticated
using (
  (select auth.uid()) is not null
  and not (select public.is_blocked((select auth.uid())))
  and (not public.is_blocked(author) or author = (select auth.uid()) or (select public.my_role()) = 'admin')
  and exists (select 1 from public.blessings b where b.id = blessing_id)
);
drop policy if exists pf_blessing_comments_add on public.blessing_comments;
create policy pf_blessing_comments_add on public.blessing_comments for insert to authenticated
with check (
  author = (select auth.uid())
  and not (select public.is_blocked((select auth.uid())))
  and exists (select 1 from public.community_profiles p where p.id = (select auth.uid()))
  and exists (select 1 from public.blessings b where b.id = blessing_id)
);
drop policy if exists pf_blessing_comments_delete on public.blessing_comments;
create policy pf_blessing_comments_delete on public.blessing_comments for delete to authenticated
using (
  author = (select auth.uid()) or (select public.my_role()) = 'admin'
  or exists (select 1 from public.blessings b where b.id = blessing_id and b.author = (select auth.uid()))
);

drop policy if exists pf_post_tags_read on public.post_tags;
create policy pf_post_tags_read on public.post_tags for select to authenticated
using (
  (select auth.uid()) is not null
  and not (select public.is_blocked((select auth.uid())))
  and (not public.is_blocked(tagged_user) or tagged_user = (select auth.uid()) or (select public.my_role()) = 'admin')
  and exists (select 1 from public.posts p where p.id = post_id)
);
drop policy if exists pf_post_tags_add on public.post_tags;
create policy pf_post_tags_add on public.post_tags for insert to authenticated
with check (
  tagged_by = (select auth.uid())
  and not (select public.is_blocked((select auth.uid())))
  and not public.is_blocked(tagged_user)
  and exists (select 1 from public.posts p where p.id = post_id
    and (p.author = (select auth.uid()) or (select public.my_role()) = 'admin'))
);
drop policy if exists pf_post_tags_delete on public.post_tags;
create policy pf_post_tags_delete on public.post_tags for delete to authenticated
using (
  tagged_user = (select auth.uid()) or tagged_by = (select auth.uid())
  or (select public.my_role()) = 'admin'
  or exists (select 1 from public.posts p where p.id = post_id and p.author = (select auth.uid()))
);

drop policy if exists pf_profile_shares_read on public.profile_shares;
create policy pf_profile_shares_read on public.profile_shares for select to authenticated
using (
  (select auth.uid()) is not null
  and not (select public.is_blocked((select auth.uid())))
  and (not public.is_blocked(user_id) or user_id = (select auth.uid()) or (select public.my_role()) = 'admin')
  and (
    (post_id is not null and exists (select 1 from public.posts p where p.id = post_id))
    or (blessing_id is not null and exists (select 1 from public.blessings b where b.id = blessing_id))
  )
);
drop policy if exists pf_profile_shares_add on public.profile_shares;
create policy pf_profile_shares_add on public.profile_shares for insert to authenticated
with check (
  user_id = (select auth.uid())
  and not (select public.is_blocked((select auth.uid())))
  and (
    (post_id is not null and exists (select 1 from public.posts p where p.id = post_id))
    or (blessing_id is not null and exists (select 1 from public.blessings b where b.id = blessing_id))
  )
);
drop policy if exists pf_profile_shares_delete on public.profile_shares;
create policy pf_profile_shares_delete on public.profile_shares for delete to authenticated
using (user_id = (select auth.uid()) or (select public.my_role()) = 'admin');

-- Salva toda a seleção de marcações numa transação. Continua sujeito às RLS.
create or replace function public.pf_set_post_tags(p_post_id uuid, p_users uuid[])
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  chosen uuid[] := coalesce(p_users, '{}'::uuid[]);
begin
  if caller is null or public.is_blocked(caller) then
    raise exception 'Acesso não permitido' using errcode = '42501';
  end if;
  if not exists (select 1 from public.posts p where p.id = p_post_id
    and (p.author = caller or public.my_role() = 'admin')) then
    raise exception 'Somente o dono da foto ou administrador pode marcar pessoas' using errcode = '42501';
  end if;
  if cardinality(chosen) > 30 or array_position(chosen, null) is not null then
    raise exception 'Seleção de pessoas inválida' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(chosen) as x(uid) where not exists
    (select 1 from public.community_profiles p where p.id = x.uid and not public.is_blocked(p.id))) then
    raise exception 'Perfil não disponível para marcação' using errcode = '22023';
  end if;
  delete from public.post_tags where post_id = p_post_id and not (tagged_user = any(chosen));
  insert into public.post_tags(post_id, tagged_user, tagged_by)
    select distinct p_post_id, x.uid, caller from unnest(chosen) as x(uid)
    on conflict (post_id, tagged_user) do nothing;
end;
$$;
revoke all on function public.pf_set_post_tags(uuid, uuid[]) from public, anon;
grant execute on function public.pf_set_post_tags(uuid, uuid[]) to authenticated, service_role;
