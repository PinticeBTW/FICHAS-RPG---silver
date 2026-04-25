-- Diagnostico nao-destrutivo para encontrar fichas pesadas que puxam egress.
-- Corre no Supabase SQL Editor. Nao apaga nem altera dados.

select
  'npc_cards' as source,
  id::text,
  display_name as name,
  pg_size_pretty(octet_length(field_data::text)::bigint) as payload_size,
  octet_length(coalesce(field_data ->> 'FOTO', '')) as foto_bytes,
  octet_length(coalesce(field_data ->> 'FOTO2', '')) as foto2_bytes,
  updated_at
from public.npc_cards
order by octet_length(field_data::text) desc
limit 20;

select
  'character_sheet_forms' as source,
  form.id::text,
  coalesce(profile.display_name, profile.email, form.profile_id::text) as name,
  pg_size_pretty(octet_length(form.field_data::text)::bigint) as payload_size,
  octet_length(coalesce(form.field_data ->> 'FOTO', '')) as foto_bytes,
  octet_length(coalesce(form.field_data ->> 'FOTO2', '')) as foto2_bytes,
  form.updated_at
from public.character_sheet_forms as form
left join public.profiles as profile on profile.id = form.profile_id
order by octet_length(form.field_data::text) desc
limit 20;
