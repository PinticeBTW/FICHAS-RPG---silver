-- Corre este SQL no Supabase SQL Editor para activar "Nova Ficha"
-- (fichas de NPC sem conta de utilizador)

create table if not exists public.npc_cards (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  field_data jsonb not null default '{}',
  updated_at timestamptz not null default timezone('utc', now())
);

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

-- Players so podem ler os NPCs que o Silver lhes partilhar
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
    or public.has_sheet_share_access('npc', id)
  );

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
