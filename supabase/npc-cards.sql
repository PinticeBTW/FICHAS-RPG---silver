-- Corre este SQL no Supabase SQL Editor para activar "Nova Ficha"
-- (fichas de NPC sem conta de utilizador)

create table if not exists public.npc_cards (
  id          uuid primary key default gen_random_uuid(),
  display_name text not null,
  field_data  jsonb not null default '{}',
  updated_at  timestamptz not null default timezone('utc', now())
);

-- Só o GM (role = 'gm') pode criar/editar/apagar NPCs
alter table public.npc_cards enable row level security;

create policy "gm_all" on public.npc_cards
  for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'gm'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'gm'
    )
  );

-- Players podem ler (para ver a ficha do NPC no ecrã)
create policy "player_read" on public.npc_cards
  for select
  using (true);
