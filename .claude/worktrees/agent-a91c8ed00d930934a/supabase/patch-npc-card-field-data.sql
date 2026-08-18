-- Corre este SQL no Supabase SQL Editor para acelerar saves de fichas NPC grandes.
-- A app passa a enviar apenas os campos alterados de field_data em vez do JSON inteiro.

create or replace function public.patch_npc_card_field_data(
  p_npc_id uuid,
  p_field_patch jsonb,
  p_removed_keys text[] default '{}'::text[]
)
returns table (
  id uuid,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_field_data jsonb;
begin
  next_field_data :=
    (coalesce((select card.field_data from public.npc_cards as card where card.id = p_npc_id), '{}'::jsonb)
      - coalesce(p_removed_keys, '{}'::text[]))
    || coalesce(p_field_patch, '{}'::jsonb);

  return query
  update public.npc_cards as card
  set
    field_data = next_field_data,
    updated_at = timezone('utc', now())
  where card.id = p_npc_id
    and card.field_data is distinct from next_field_data
  returning card.id, card.updated_at;
end;
$$;

grant execute on function public.patch_npc_card_field_data(uuid, jsonb, text[]) to authenticated;
