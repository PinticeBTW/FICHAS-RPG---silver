-- Corre este SQL no Supabase SQL Editor para activar a partilha de fichas web
-- entre players (fichas de player e fichas de NPC).

do $$
begin
  create type public.sheet_share_target_kind as enum ('profile', 'npc');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.sheet_share_access (
  id uuid primary key default gen_random_uuid(),
  viewer_profile_id uuid not null references public.profiles (id) on delete cascade,
  target_kind public.sheet_share_target_kind not null,
  target_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (viewer_profile_id, target_kind, target_id)
);

grant select, insert, update, delete on public.sheet_share_access to authenticated;
alter table public.sheet_share_access enable row level security;

create or replace function public.has_sheet_share_access(
  target_kind public.sheet_share_target_kind,
  target_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sheet_share_access access_entry
    where access_entry.viewer_profile_id = auth.uid()
      and access_entry.target_kind = has_sheet_share_access.target_kind
      and access_entry.target_id = has_sheet_share_access.target_id
  );
$$;

drop policy if exists sheet_share_access_select_allowed on public.sheet_share_access;
create policy sheet_share_access_select_allowed
on public.sheet_share_access
for select
to authenticated
using (
  public.is_current_user_gm()
  or viewer_profile_id = auth.uid()
);

drop policy if exists sheet_share_access_insert_gm on public.sheet_share_access;
create policy sheet_share_access_insert_gm
on public.sheet_share_access
for insert
to authenticated
with check (public.is_current_user_gm());

drop policy if exists sheet_share_access_update_gm on public.sheet_share_access;
create policy sheet_share_access_update_gm
on public.sheet_share_access
for update
to authenticated
using (public.is_current_user_gm())
with check (public.is_current_user_gm());

drop policy if exists sheet_share_access_delete_gm on public.sheet_share_access;
create policy sheet_share_access_delete_gm
on public.sheet_share_access
for delete
to authenticated
using (public.is_current_user_gm());

drop policy if exists profiles_select_shared_campaign on public.profiles;
create policy profiles_select_shared_campaign
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.is_current_user_gm()
  or public.has_sheet_share_access('profile', id)
);

drop policy if exists character_sheet_forms_select_allowed on public.character_sheet_forms;
create policy character_sheet_forms_select_allowed
on public.character_sheet_forms
for select
to authenticated
using (
  public.is_current_user_gm()
  or profile_id = auth.uid()
  or public.has_sheet_share_access('profile', profile_id)
);

do $$
begin
  if exists (
    select 1
    from pg_tables
    where schemaname = 'public'
      and tablename = 'npc_cards'
  ) then
    execute 'alter table public.npc_cards add column if not exists owner_profile_id uuid references public.profiles (id) on delete cascade';
    execute 'grant select, insert, update, delete on public.npc_cards to authenticated';
    execute 'drop policy if exists "player_read" on public.npc_cards';
    execute 'drop policy if exists "player_update_owned" on public.npc_cards';
    execute 'drop policy if exists "player_update_shared" on public.npc_cards';
    execute $policy$
      create policy "player_read" on public.npc_cards
        for select
        using (
          exists (
            select 1
            from public.profiles
            where profiles.id = auth.uid()
              and profiles.role = 'gm'
          )
          or owner_profile_id = auth.uid()
          or public.has_sheet_share_access('npc', id)
        )
    $policy$;
    execute $policy$
      create policy "player_update_owned" on public.npc_cards
        for update
        using (owner_profile_id = auth.uid())
        with check (owner_profile_id = auth.uid())
    $policy$;
    execute $policy$
      create policy "player_update_shared" on public.npc_cards
        for update
        using (public.has_sheet_share_access('npc', id))
        with check (public.has_sheet_share_access('npc', id))
    $policy$;
  end if;
exception
  when undefined_table then null;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sheet_share_access'
  ) then
    alter publication supabase_realtime add table public.sheet_share_access;
  end if;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_tables
    where schemaname = 'public'
      and tablename = 'npc_cards'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'npc_cards'
  ) then
    alter publication supabase_realtime add table public.npc_cards;
  end if;
exception
  when duplicate_object then null;
end $$;
