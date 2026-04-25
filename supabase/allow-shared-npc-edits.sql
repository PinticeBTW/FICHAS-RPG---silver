-- Corre este SQL no Supabase SQL Editor para permitir que players
-- editem fichas extra partilhadas pelo Silver.

grant select, update on public.npc_cards to authenticated;

drop policy if exists "player_update_shared" on public.npc_cards;
create policy "player_update_shared" on public.npc_cards
  for update
  using (public.has_sheet_share_access('npc', id))
  with check (public.has_sheet_share_access('npc', id));
