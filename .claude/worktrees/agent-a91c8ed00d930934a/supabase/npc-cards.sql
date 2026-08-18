-- Corre este SQL no Supabase SQL Editor para activar "Nova Ficha"
-- (fichas de NPC sem conta de utilizador)

create table if not exists public.npc_cards (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  owner_profile_id uuid references public.profiles (id) on delete cascade,
  field_data jsonb not null default '{}',
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.npc_cards
  add column if not exists owner_profile_id uuid references public.profiles (id) on delete cascade;

grant select, insert, update, delete on public.npc_cards to authenticated;

-- So o GM (role = 'gm') pode criar/editar/apagar NPCs
alter table public.npc_cards enable row level security;

drop policy if exists "gm_all" on public.npc_cards;
create policy "gm_all" on public.npc_cards
  for all
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'gm'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'gm'
    )
  );

-- Players so podem ler NPCs proprios ou partilhados pelo Silver
drop policy if exists "player_read" on public.npc_cards;
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
  );

-- Players podem editar fichas extra que lhes pertencem
drop policy if exists "player_update_owned" on public.npc_cards;
create policy "player_update_owned" on public.npc_cards
  for update
  using (owner_profile_id = auth.uid())
  with check (owner_profile_id = auth.uid());

-- Players podem editar fichas extra que lhes foram partilhadas
drop policy if exists "player_update_shared" on public.npc_cards;
create policy "player_update_shared" on public.npc_cards
  for update
  using (public.has_sheet_share_access('npc', id))
  with check (public.has_sheet_share_access('npc', id));

do $$
begin
  if not exists (
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
