-- Corre este SQL no Supabase SQL Editor para ativar o catalogo global
-- de cyberware. O Silver gere uma lista unica; players so leem essa lista.

create table if not exists public.cyberware_catalog_settings (
  id text primary key default 'global',
  catalog jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint cyberware_catalog_settings_singleton check (id = 'global')
);

grant select, insert, update, delete on public.cyberware_catalog_settings to authenticated;
alter table public.cyberware_catalog_settings enable row level security;

drop policy if exists cyberware_catalog_settings_select_authenticated on public.cyberware_catalog_settings;
create policy cyberware_catalog_settings_select_authenticated
on public.cyberware_catalog_settings
for select
to authenticated
using (true);

drop policy if exists cyberware_catalog_settings_insert_gm on public.cyberware_catalog_settings;
create policy cyberware_catalog_settings_insert_gm
on public.cyberware_catalog_settings
for insert
to authenticated
with check (public.is_current_user_gm());

drop policy if exists cyberware_catalog_settings_update_gm on public.cyberware_catalog_settings;
create policy cyberware_catalog_settings_update_gm
on public.cyberware_catalog_settings
for update
to authenticated
using (public.is_current_user_gm())
with check (public.is_current_user_gm());

drop policy if exists cyberware_catalog_settings_delete_gm on public.cyberware_catalog_settings;
create policy cyberware_catalog_settings_delete_gm
on public.cyberware_catalog_settings
for delete
to authenticated
using (public.is_current_user_gm());

insert into public.cyberware_catalog_settings (id, catalog)
values ('global', '[]'::jsonb)
on conflict (id) do nothing;

with existing_catalogs as (
  select
    form.field_data ->> 'P4_CYBERWARE_CATALOG' as catalog_text,
    form.updated_at
  from public.character_sheet_forms as form
  where coalesce(form.field_data ->> 'P4_CYBERWARE_CATALOG', '') not in ('', '[]')
    and left(trim(form.field_data ->> 'P4_CYBERWARE_CATALOG'), 1) = '['

  union all

  select
    card.field_data ->> 'P4_CYBERWARE_CATALOG' as catalog_text,
    card.updated_at
  from public.npc_cards as card
  where coalesce(card.field_data ->> 'P4_CYBERWARE_CATALOG', '') not in ('', '[]')
    and left(trim(card.field_data ->> 'P4_CYBERWARE_CATALOG'), 1) = '['
),
latest_catalog as (
  select catalog_text
  from existing_catalogs
  order by updated_at desc nulls last
  limit 1
)
update public.cyberware_catalog_settings as settings
set
  catalog = latest_catalog.catalog_text::jsonb,
  updated_at = timezone('utc', now())
from latest_catalog
where settings.id = 'global'
  and settings.catalog = '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cyberware_catalog_settings'
  ) then
    alter publication supabase_realtime add table public.cyberware_catalog_settings;
  end if;
exception
  when duplicate_object then null;
end $$;
