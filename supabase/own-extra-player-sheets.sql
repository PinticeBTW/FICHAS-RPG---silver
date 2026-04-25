-- Corre este SQL no Supabase SQL Editor para transformar fichas extra
-- em fichas do proprio player, mantendo-as tambem acessiveis ao Silver.
-- Caso atual: Adrian ALTARA passa a ser ficha default do pintice38@gmail.com.

alter table public.npc_cards
  add column if not exists owner_profile_id uuid references public.profiles (id) on delete cascade;

grant select, update on public.npc_cards to authenticated;

drop policy if exists "player_read" on public.npc_cards;
create policy "player_read" on public.npc_cards
  for select
  using (
    public.is_current_user_gm()
    or owner_profile_id = auth.uid()
    or public.has_sheet_share_access('npc', id)
  );

drop policy if exists "player_update_owned" on public.npc_cards;
create policy "player_update_owned" on public.npc_cards
  for update
  using (owner_profile_id = auth.uid())
  with check (owner_profile_id = auth.uid());

drop policy if exists "player_update_shared" on public.npc_cards;
create policy "player_update_shared" on public.npc_cards
  for update
  using (public.has_sheet_share_access('npc', id))
  with check (public.has_sheet_share_access('npc', id));

with target_player as (
  select id
  from public.profiles
  where email = 'pintice38@gmail.com'
)
update public.npc_cards as card
set
  owner_profile_id = target_player.id,
  updated_at = timezone('utc', now())
from target_player
where lower(card.display_name) = lower('Adrian ALTARA')
  and (
    card.owner_profile_id = target_player.id
    or exists (
      select 1
      from public.sheet_share_access as access_entry
      where access_entry.target_kind = 'npc'
        and access_entry.target_id = card.id
        and access_entry.viewer_profile_id = target_player.id
    )
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
