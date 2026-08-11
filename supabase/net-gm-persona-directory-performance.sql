-- THE NET GM Persona Control Performance / Free-Tier Hardening.
-- Run after net-compromised-session.sql and net-identity-selection.sql.
--
-- This is a presentation projection only. net_identity_links and the existing
-- persona RPCs remain the authority for classification and control.

create table if not exists public.net_gm_identity_directory_summaries (
  subject_kind text not null,
  subject_id uuid not null,
  owner_profile_id uuid,
  display_name text not null,
  avatar_url text,
  occupation text,
  city text,
  source_updated_at timestamptz,
  refreshed_at timestamptz not null default timezone('utc', now()),
  primary key (subject_kind, subject_id),
  constraint net_gm_identity_directory_subject_kind_check
    check (subject_kind in ('profile-sheet', 'npc-card')),
  constraint net_gm_identity_directory_display_name_limit
    check (char_length(display_name) between 1 and 160),
  constraint net_gm_identity_directory_avatar_limit
    check (avatar_url is null or char_length(avatar_url) <= 2048),
  constraint net_gm_identity_directory_occupation_limit
    check (occupation is null or char_length(occupation) <= 240),
  constraint net_gm_identity_directory_city_limit
    check (city is null or char_length(city) <= 160)
);

comment on table public.net_gm_identity_directory_summaries is
  'Private derived presentation projection for the GM identity directory. It is never identity, ownership, persona, or authoring authority.';

alter table public.net_gm_identity_directory_summaries enable row level security;
revoke all on public.net_gm_identity_directory_summaries from anon, authenticated;

create index if not exists net_gm_identity_directory_sort_idx
  on public.net_gm_identity_directory_summaries (
    lower(display_name),
    subject_kind,
    subject_id
  );

create or replace function public.refresh_net_gm_profile_sheet_summary(
  requested_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if requested_profile_id is null then
    return;
  end if;

  insert into public.net_gm_identity_directory_summaries (
    subject_kind,
    subject_id,
    owner_profile_id,
    display_name,
    avatar_url,
    occupation,
    city,
    source_updated_at,
    refreshed_at
  )
  select
    'profile-sheet',
    profile.id,
    profile.id,
    left(coalesce(nullif(btrim(sheet.field_data ->> 'NOME'), ''), profile.display_name), 160),
    case
      when coalesce(
        nullif(btrim(sheet.field_data ->> 'FOTO2'), ''),
        nullif(btrim(sheet.field_data ->> 'FOTO'), '')
      ) is not null
      and char_length(coalesce(
        nullif(btrim(sheet.field_data ->> 'FOTO2'), ''),
        nullif(btrim(sheet.field_data ->> 'FOTO'), '')
      )) <= 2048
      and lower(coalesce(
        nullif(btrim(sheet.field_data ->> 'FOTO2'), ''),
        nullif(btrim(sheet.field_data ->> 'FOTO'), '')
      )) not like 'data:%'
      then coalesce(
        nullif(btrim(sheet.field_data ->> 'FOTO2'), ''),
        nullif(btrim(sheet.field_data ->> 'FOTO'), '')
      )
      else null
    end,
    left(nullif(btrim(coalesce(
      nullif(sheet.field_data ->> 'OCUPAÇÃO', ''),
      sheet.field_data ->> 'OCUPACAO'
    )), ''), 240),
    left(nullif(btrim(sheet.field_data ->> 'CIDADE'), ''), 160),
    greatest(profile.updated_at, sheet.updated_at),
    timezone('utc', now())
  from public.profiles as profile
  left join public.character_sheet_forms as sheet
    on sheet.profile_id = profile.id
  where profile.id = requested_profile_id
    and profile.role = 'player'
  on conflict (subject_kind, subject_id) do update set
    owner_profile_id = excluded.owner_profile_id,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    occupation = excluded.occupation,
    city = excluded.city,
    source_updated_at = excluded.source_updated_at,
    refreshed_at = excluded.refreshed_at;

  if not found then
    delete from public.net_gm_identity_directory_summaries as summary
    where summary.subject_kind = 'profile-sheet'
      and summary.subject_id = requested_profile_id;
  end if;
end;
$$;

create or replace function public.refresh_net_gm_npc_card_summary(
  requested_npc_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if requested_npc_id is null then
    return;
  end if;

  insert into public.net_gm_identity_directory_summaries (
    subject_kind,
    subject_id,
    owner_profile_id,
    display_name,
    avatar_url,
    occupation,
    city,
    source_updated_at,
    refreshed_at
  )
  select
    'npc-card',
    card.id,
    card.owner_profile_id,
    left(coalesce(nullif(btrim(card.field_data ->> 'NOME'), ''), card.display_name), 160),
    case
      when coalesce(
        nullif(btrim(card.field_data ->> 'FOTO2'), ''),
        nullif(btrim(card.field_data ->> 'FOTO'), '')
      ) is not null
      and char_length(coalesce(
        nullif(btrim(card.field_data ->> 'FOTO2'), ''),
        nullif(btrim(card.field_data ->> 'FOTO'), '')
      )) <= 2048
      and lower(coalesce(
        nullif(btrim(card.field_data ->> 'FOTO2'), ''),
        nullif(btrim(card.field_data ->> 'FOTO'), '')
      )) not like 'data:%'
      then coalesce(
        nullif(btrim(card.field_data ->> 'FOTO2'), ''),
        nullif(btrim(card.field_data ->> 'FOTO'), '')
      )
      else null
    end,
    left(nullif(btrim(coalesce(
      nullif(card.field_data ->> 'OCUPAÇÃO', ''),
      card.field_data ->> 'OCUPACAO'
    )), ''), 240),
    left(nullif(btrim(card.field_data ->> 'CIDADE'), ''), 160),
    card.updated_at,
    timezone('utc', now())
  from public.npc_cards as card
  where card.id = requested_npc_id
  on conflict (subject_kind, subject_id) do update set
    owner_profile_id = excluded.owner_profile_id,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    occupation = excluded.occupation,
    city = excluded.city,
    source_updated_at = excluded.source_updated_at,
    refreshed_at = excluded.refreshed_at;

  if not found then
    delete from public.net_gm_identity_directory_summaries as summary
    where summary.subject_kind = 'npc-card'
      and summary.subject_id = requested_npc_id;
  end if;
end;
$$;

create or replace function public.refresh_net_gm_directory_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.refresh_net_gm_profile_sheet_summary(
    case when tg_op = 'DELETE' then old.id else new.id end
  );
  return null;
end;
$$;

create or replace function public.refresh_net_gm_directory_from_sheet()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
    and (old.field_data ->> 'NOME') is not distinct from (new.field_data ->> 'NOME')
    and (old.field_data ->> 'FOTO2') is not distinct from (new.field_data ->> 'FOTO2')
    and (old.field_data ->> 'FOTO') is not distinct from (new.field_data ->> 'FOTO')
    and (old.field_data ->> 'OCUPAÇÃO') is not distinct from (new.field_data ->> 'OCUPAÇÃO')
    and (old.field_data ->> 'OCUPACAO') is not distinct from (new.field_data ->> 'OCUPACAO')
    and (old.field_data ->> 'CIDADE') is not distinct from (new.field_data ->> 'CIDADE')
  then
    return null;
  end if;

  perform public.refresh_net_gm_profile_sheet_summary(
    case when tg_op = 'DELETE' then old.profile_id else new.profile_id end
  );
  return null;
end;
$$;

create or replace function public.refresh_net_gm_directory_from_npc()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
    and old.display_name is not distinct from new.display_name
    and old.owner_profile_id is not distinct from new.owner_profile_id
    and (old.field_data ->> 'NOME') is not distinct from (new.field_data ->> 'NOME')
    and (old.field_data ->> 'FOTO2') is not distinct from (new.field_data ->> 'FOTO2')
    and (old.field_data ->> 'FOTO') is not distinct from (new.field_data ->> 'FOTO')
    and (old.field_data ->> 'OCUPAÇÃO') is not distinct from (new.field_data ->> 'OCUPAÇÃO')
    and (old.field_data ->> 'OCUPACAO') is not distinct from (new.field_data ->> 'OCUPACAO')
    and (old.field_data ->> 'CIDADE') is not distinct from (new.field_data ->> 'CIDADE')
  then
    return null;
  end if;

  perform public.refresh_net_gm_npc_card_summary(
    case when tg_op = 'DELETE' then old.id else new.id end
  );
  return null;
end;
$$;

drop trigger if exists profiles_refresh_net_gm_directory on public.profiles;
create trigger profiles_refresh_net_gm_directory
after insert or update of display_name, role or delete on public.profiles
for each row execute procedure public.refresh_net_gm_directory_from_profile();

drop trigger if exists character_sheet_forms_refresh_net_gm_directory on public.character_sheet_forms;
create trigger character_sheet_forms_refresh_net_gm_directory
after insert or update of field_data or delete on public.character_sheet_forms
for each row execute procedure public.refresh_net_gm_directory_from_sheet();

drop trigger if exists npc_cards_refresh_net_gm_directory on public.npc_cards;
create trigger npc_cards_refresh_net_gm_directory
after insert or update of display_name, owner_profile_id, field_data or delete on public.npc_cards
for each row execute procedure public.refresh_net_gm_directory_from_npc();

-- One set-based installation backfill. It reads each source JSON once during
-- deployment; normal Persona Control opens never read the JSON columns.
insert into public.net_gm_identity_directory_summaries (
  subject_kind,
  subject_id,
  owner_profile_id,
  display_name,
  avatar_url,
  occupation,
  city,
  source_updated_at,
  refreshed_at
)
select
  'profile-sheet',
  profile.id,
  profile.id,
  left(coalesce(nullif(btrim(sheet.field_data ->> 'NOME'), ''), profile.display_name), 160),
  case
    when coalesce(nullif(btrim(sheet.field_data ->> 'FOTO2'), ''), nullif(btrim(sheet.field_data ->> 'FOTO'), '')) is not null
      and char_length(coalesce(nullif(btrim(sheet.field_data ->> 'FOTO2'), ''), nullif(btrim(sheet.field_data ->> 'FOTO'), ''))) <= 2048
      and lower(coalesce(nullif(btrim(sheet.field_data ->> 'FOTO2'), ''), nullif(btrim(sheet.field_data ->> 'FOTO'), ''))) not like 'data:%'
    then coalesce(nullif(btrim(sheet.field_data ->> 'FOTO2'), ''), nullif(btrim(sheet.field_data ->> 'FOTO'), ''))
    else null
  end,
  left(nullif(btrim(coalesce(nullif(sheet.field_data ->> 'OCUPAÇÃO', ''), sheet.field_data ->> 'OCUPACAO')), ''), 240),
  left(nullif(btrim(sheet.field_data ->> 'CIDADE'), ''), 160),
  greatest(profile.updated_at, sheet.updated_at),
  timezone('utc', now())
from public.profiles as profile
left join public.character_sheet_forms as sheet on sheet.profile_id = profile.id
where profile.role = 'player'
on conflict (subject_kind, subject_id) do update set
  owner_profile_id = excluded.owner_profile_id,
  display_name = excluded.display_name,
  avatar_url = excluded.avatar_url,
  occupation = excluded.occupation,
  city = excluded.city,
  source_updated_at = excluded.source_updated_at,
  refreshed_at = excluded.refreshed_at;

insert into public.net_gm_identity_directory_summaries (
  subject_kind,
  subject_id,
  owner_profile_id,
  display_name,
  avatar_url,
  occupation,
  city,
  source_updated_at,
  refreshed_at
)
select
  'npc-card',
  card.id,
  card.owner_profile_id,
  left(coalesce(nullif(btrim(card.field_data ->> 'NOME'), ''), card.display_name), 160),
  case
    when coalesce(nullif(btrim(card.field_data ->> 'FOTO2'), ''), nullif(btrim(card.field_data ->> 'FOTO'), '')) is not null
      and char_length(coalesce(nullif(btrim(card.field_data ->> 'FOTO2'), ''), nullif(btrim(card.field_data ->> 'FOTO'), ''))) <= 2048
      and lower(coalesce(nullif(btrim(card.field_data ->> 'FOTO2'), ''), nullif(btrim(card.field_data ->> 'FOTO'), ''))) not like 'data:%'
    then coalesce(nullif(btrim(card.field_data ->> 'FOTO2'), ''), nullif(btrim(card.field_data ->> 'FOTO'), ''))
    else null
  end,
  left(nullif(btrim(coalesce(nullif(card.field_data ->> 'OCUPAÇÃO', ''), card.field_data ->> 'OCUPACAO')), ''), 240),
  left(nullif(btrim(card.field_data ->> 'CIDADE'), ''), 160),
  card.updated_at,
  timezone('utc', now())
from public.npc_cards as card
on conflict (subject_kind, subject_id) do update set
  owner_profile_id = excluded.owner_profile_id,
  display_name = excluded.display_name,
  avatar_url = excluded.avatar_url,
  occupation = excluded.occupation,
  city = excluded.city,
  source_updated_at = excluded.source_updated_at,
  refreshed_at = excluded.refreshed_at;

create or replace function public.fetch_net_gm_identity_directory(
  requested_limit integer default 1000
)
returns table (
  subject_kind text,
  subject_id uuid,
  identity_link_id uuid,
  entity_id text,
  link_owner_profile_id uuid,
  campaign_id uuid,
  identity_kind text,
  playability text,
  link_created_at timestamptz,
  link_updated_at timestamptz,
  owner_profile_id uuid,
  owner_display_name text,
  owner_handle text,
  display_name text,
  avatar_url text,
  occupation text,
  city text,
  source_updated_at timestamptz,
  can_inspect boolean,
  can_take_control boolean,
  can_act_as boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  bounded_limit integer := least(greatest(coalesce(requested_limit, 1000), 1), 1000);
begin
  if auth.uid() is null or not public.is_current_user_gm() then
    raise exception 'Only an authenticated GM may read the identity directory.'
      using errcode = '42501';
  end if;

  return query
  select
    summary.subject_kind,
    summary.subject_id,
    identity_link.id,
    identity_link.entity_id,
    identity_link.owner_profile_id,
    identity_link.campaign_id,
    identity_link.identity_kind,
    identity_link.playability,
    identity_link.created_at,
    identity_link.updated_at,
    summary.owner_profile_id,
    owner_profile.display_name,
    owner_profile.handle,
    summary.display_name,
    summary.avatar_url,
    summary.occupation,
    summary.city,
    summary.source_updated_at,
    true,
    identity_link.identity_kind = 'player' and identity_link.playability = 'playable',
    summary.subject_kind = 'npc-card'
      and coalesce(identity_link.identity_kind, 'npc') <> 'player'
  from public.net_gm_identity_directory_summaries as summary
  left join public.net_identity_links as identity_link
    on identity_link.subject_kind = summary.subject_kind
    and identity_link.subject_id = summary.subject_id
  left join public.profiles as owner_profile
    on owner_profile.id = summary.owner_profile_id
  order by lower(summary.display_name), summary.subject_kind, summary.subject_id
  limit bounded_limit;
end;
$$;

create or replace function public.fetch_net_gm_identity_detail(
  requested_subject_kind text,
  requested_subject_id uuid
)
returns table (
  subject_kind text,
  subject_id uuid,
  age text,
  gender text,
  occupation text,
  city text,
  source_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_current_user_gm() then
    raise exception 'Only an authenticated GM may read identity details.'
      using errcode = '42501';
  end if;

  if requested_subject_kind not in ('profile-sheet', 'npc-card')
    or requested_subject_id is null
  then
    raise exception 'Unsupported identity detail request.' using errcode = '22023';
  end if;

  return query
  select
    summary.subject_kind,
    summary.subject_id,
    left(nullif(btrim(case summary.subject_kind
      when 'profile-sheet' then profile_sheet.field_data ->> 'IDADE'
      when 'npc-card' then npc_card.field_data ->> 'IDADE'
    end), ''), 80),
    left(nullif(btrim(case summary.subject_kind
      when 'profile-sheet' then profile_sheet.field_data ->> 'SEXO'
      when 'npc-card' then npc_card.field_data ->> 'SEXO'
    end), ''), 80),
    summary.occupation,
    summary.city,
    summary.source_updated_at
  from public.net_gm_identity_directory_summaries as summary
  left join public.character_sheet_forms as profile_sheet
    on summary.subject_kind = 'profile-sheet'
    and profile_sheet.profile_id = summary.subject_id
  left join public.npc_cards as npc_card
    on summary.subject_kind = 'npc-card'
    and npc_card.id = summary.subject_id
  where summary.subject_kind = requested_subject_kind
    and summary.subject_id = requested_subject_id
  limit 1;
end;
$$;

revoke all on function public.refresh_net_gm_profile_sheet_summary(uuid) from public;
revoke all on function public.refresh_net_gm_npc_card_summary(uuid) from public;
revoke all on function public.refresh_net_gm_directory_from_profile() from public;
revoke all on function public.refresh_net_gm_directory_from_sheet() from public;
revoke all on function public.refresh_net_gm_directory_from_npc() from public;
revoke all on function public.fetch_net_gm_identity_directory(integer) from public;
revoke all on function public.fetch_net_gm_identity_detail(text, uuid) from public;

grant execute on function public.fetch_net_gm_identity_directory(integer) to authenticated;
grant execute on function public.fetch_net_gm_identity_detail(text, uuid) to authenticated;
