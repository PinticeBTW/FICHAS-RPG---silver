-- Limpa fotos/base64 pesadas guardadas dentro das fichas web.
-- Faz backup antes de apagar FOTO/FOTO2.
--
-- Corre no Supabase SQL Editor.
-- Por defeito limpa qualquer ficha com payload >= 200 KB ou foto >= 150 KB.

create extension if not exists pgcrypto;

alter table public.npc_cards
  add column if not exists owner_profile_id uuid references public.profiles (id) on delete cascade;

create table if not exists public.sheet_image_backups (
  id uuid primary key default gen_random_uuid(),
  source_table text not null,
  source_id uuid not null,
  owner_profile_id uuid,
  display_name text,
  field_data jsonb not null,
  backed_up_at timestamptz not null default timezone('utc', now())
);

with heavy_character_sheets as (
  select
    form.id,
    form.profile_id as owner_profile_id,
    profile.display_name,
    form.field_data
  from public.character_sheet_forms as form
  left join public.profiles as profile on profile.id = form.profile_id
  where octet_length(form.field_data::text) >= 200000
    or octet_length(coalesce(form.field_data ->> 'FOTO', '')) >= 150000
    or octet_length(coalesce(form.field_data ->> 'FOTO2', '')) >= 150000
),
backed_up_character_sheets as (
  insert into public.sheet_image_backups (
    source_table,
    source_id,
    owner_profile_id,
    display_name,
    field_data
  )
  select
    'character_sheet_forms',
    id,
    owner_profile_id,
    display_name,
    jsonb_build_object(
      'FOTO', field_data -> 'FOTO',
      'FOTO2', field_data -> 'FOTO2'
    )
  from heavy_character_sheets
  where coalesce(field_data ->> 'FOTO', '') <> ''
     or coalesce(field_data ->> 'FOTO2', '') <> ''
  returning source_id
)
update public.character_sheet_forms as form
set
  field_data = (form.field_data - 'FOTO' - 'FOTO2'),
  updated_at = timezone('utc', now())
from heavy_character_sheets as heavy
where form.id = heavy.id;

with heavy_npc_sheets as (
  select
    card.id,
    card.owner_profile_id,
    card.display_name,
    card.field_data
  from public.npc_cards as card
  where octet_length(card.field_data::text) >= 200000
    or octet_length(coalesce(card.field_data ->> 'FOTO', '')) >= 150000
    or octet_length(coalesce(card.field_data ->> 'FOTO2', '')) >= 150000
),
backed_up_npc_sheets as (
  insert into public.sheet_image_backups (
    source_table,
    source_id,
    owner_profile_id,
    display_name,
    field_data
  )
  select
    'npc_cards',
    id,
    owner_profile_id,
    display_name,
    jsonb_build_object(
      'FOTO', field_data -> 'FOTO',
      'FOTO2', field_data -> 'FOTO2'
    )
  from heavy_npc_sheets
  where coalesce(field_data ->> 'FOTO', '') <> ''
     or coalesce(field_data ->> 'FOTO2', '') <> ''
  returning source_id
)
update public.npc_cards as card
set
  field_data = (card.field_data - 'FOTO' - 'FOTO2'),
  updated_at = timezone('utc', now())
from heavy_npc_sheets as heavy
where card.id = heavy.id;

-- Confirma o resultado depois da limpeza.
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
