-- THE NET GM identity directory canonical portrait correction.
--
-- The deployed directory summary is a private denormalized presentation cache.
-- Some pre-existing rows retained NULL avatar_url values after their canonical
-- sheet portraits were converted to rpg-media:v1 descriptors. This migration
-- repairs the cache generically and makes the bounded GM RPC derive portraits
-- from the canonical source on every read, so control mode cannot affect them.

begin;

do $$
declare
  v_rpc_oid oid := to_regprocedure('public.fetch_net_gm_identity_directory(integer)');
  v_rpc_definition text;
  v_summary_relkind "char";
begin
  if to_regclass('public.net_gm_identity_directory_summaries') is null
    or to_regclass('public.character_sheet_forms') is null
    or to_regclass('public.npc_cards') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.profiles') is null
    or v_rpc_oid is null
    or to_regprocedure('public.refresh_net_gm_profile_sheet_summary(uuid)') is null
    or to_regprocedure('public.refresh_net_gm_npc_card_summary(uuid)') is null
    or to_regprocedure('public.refresh_net_gm_directory_from_sheet()') is null
    or to_regprocedure('public.refresh_net_gm_directory_from_npc()') is null
    or to_regprocedure('public.is_current_user_gm()') is null
  then
    raise exception 'NET_GM_IDENTITY_DIRECTORY_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_get_functiondef(v_rpc_oid)
  into v_rpc_definition;

  select relation.relkind
  into v_summary_relkind
  from pg_class as relation
  where relation.oid = 'public.net_gm_identity_directory_summaries'::regclass;

  if v_summary_relkind <> 'r'
    or position('security definer' in lower(v_rpc_definition)) = 0
    or position('set search_path to ''public'', ''pg_temp''' in lower(v_rpc_definition)) = 0
    or position('net_gm_identity_directory_summaries' in v_rpc_definition) = 0
  then
    raise exception 'NET_GM_IDENTITY_DIRECTORY_DEPLOYED_CONTRACT_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_trigger as trigger_record
    where trigger_record.tgrelid = 'public.character_sheet_forms'::regclass
      and trigger_record.tgname = 'character_sheet_forms_refresh_net_gm_directory'
      and not trigger_record.tgisinternal
  ) or not exists (
    select 1
    from pg_trigger as trigger_record
    where trigger_record.tgrelid = 'public.npc_cards'::regclass
      and trigger_record.tgname = 'npc_cards_refresh_net_gm_directory'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'NET_GM_IDENTITY_DIRECTORY_TRIGGER_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function public.net_gm_canonical_portrait_value(
  requested_field_data jsonb
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select candidate.value
  from (
    values
      (1, nullif(btrim(requested_field_data ->> 'FOTO2'), '')),
      (2, nullif(btrim(requested_field_data ->> 'FOTO'), ''))
  ) as candidate(priority, value)
  where candidate.value is not null
    and char_length(candidate.value) <= 2048
    and lower(candidate.value) not like 'data:%'
  order by candidate.priority
  limit 1;
$$;

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
    public.net_gm_canonical_portrait_value(sheet.field_data),
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
    public.net_gm_canonical_portrait_value(card.field_data),
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

-- Generic, set-based repair for every existing profile-sheet summary. Only
-- derived portrait metadata changes; identity, OS and source-sheet rows do not.
update public.net_gm_identity_directory_summaries as summary
set avatar_url = public.net_gm_canonical_portrait_value(sheet.field_data),
    refreshed_at = timezone('utc', now())
from public.profiles as profile
left join public.character_sheet_forms as sheet
  on sheet.profile_id = profile.id
where summary.subject_kind = 'profile-sheet'
  and summary.subject_id = profile.id
  and profile.role = 'player'
  and summary.avatar_url is distinct from
    public.net_gm_canonical_portrait_value(sheet.field_data);

-- The NPC list uses exactly the same canonical portrait contract.
update public.net_gm_identity_directory_summaries as summary
set avatar_url = public.net_gm_canonical_portrait_value(card.field_data),
    refreshed_at = timezone('utc', now())
from public.npc_cards as card
where summary.subject_kind = 'npc-card'
  and summary.subject_id = card.id
  and summary.avatar_url is distinct from
    public.net_gm_canonical_portrait_value(card.field_data);

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
    case summary.subject_kind
      when 'profile-sheet' then public.net_gm_canonical_portrait_value(profile_sheet.field_data)
      when 'npc-card' then public.net_gm_canonical_portrait_value(npc_card.field_data)
      else null
    end,
    summary.occupation,
    summary.city,
    summary.source_updated_at,
    true,
    identity_link.identity_kind = 'player' and identity_link.playability = 'playable',
    summary.subject_kind = 'npc-card'
      and coalesce(identity_link.identity_kind, 'npc') <> 'player'
  from public.net_gm_identity_directory_summaries as summary
  left join public.character_sheet_forms as profile_sheet
    on summary.subject_kind = 'profile-sheet'
    and profile_sheet.profile_id = summary.subject_id
  left join public.npc_cards as npc_card
    on summary.subject_kind = 'npc-card'
    and npc_card.id = summary.subject_id
  left join public.net_identity_links as identity_link
    on identity_link.subject_kind = summary.subject_kind
    and identity_link.subject_id = summary.subject_id
  left join public.profiles as owner_profile
    on owner_profile.id = summary.owner_profile_id
  order by lower(summary.display_name), summary.subject_kind, summary.subject_id
  limit bounded_limit;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.net_gm_identity_directory_summaries as summary
    join public.profiles as profile
      on summary.subject_kind = 'profile-sheet'
      and summary.subject_id = profile.id
      and profile.role = 'player'
    left join public.character_sheet_forms as sheet
      on sheet.profile_id = profile.id
    where summary.avatar_url is distinct from
      public.net_gm_canonical_portrait_value(sheet.field_data)
  ) then
    raise exception 'NET_GM_PROFILE_PORTRAIT_BACKFILL_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.net_gm_identity_directory_summaries as summary
    join public.npc_cards as card
      on summary.subject_kind = 'npc-card'
      and summary.subject_id = card.id
    where summary.avatar_url is distinct from
      public.net_gm_canonical_portrait_value(card.field_data)
  ) then
    raise exception 'NET_GM_NPC_PORTRAIT_BACKFILL_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.net_gm_canonical_portrait_value(jsonb)
  from public, anon, authenticated;
revoke all on function public.refresh_net_gm_profile_sheet_summary(uuid)
  from public, anon, authenticated;
revoke all on function public.refresh_net_gm_npc_card_summary(uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_gm_identity_directory(integer)
  from public, anon, authenticated;
grant execute on function public.fetch_net_gm_identity_directory(integer)
  to authenticated;

commit;
