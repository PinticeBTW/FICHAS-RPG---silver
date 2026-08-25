-- VEIL SEARCH V1: canonical New Vega knowledge and bounded source-first search.
-- Run after the base RPGSILVER profiles schema.
--
-- This migration creates no lore. Direct table access remains closed; players
-- and GM System use separate purpose-bound RPCs. No AI-generated answer is
-- stored as canon by this schema.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'NET_SEARCH_PROFILES_REQUIRED: public.profiles does not exist. Run this in the RPGSILVER Supabase project after its base schema.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'id'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'role'
  ) then
    raise exception 'NET_SEARCH_RPGSILVER_PROFILE_SCHEMA_REQUIRED: public.profiles must contain id and role. This database does not have the RPGSILVER base profile schema.'
      using errcode = '55000';
  end if;
end;
$$;

-- Some older RPGSILVER databases predate the app-account registry. Search is a
-- system app and does not require an app account, so this compatibility row is
-- registered only when that optional registry already exists.
do $$
begin
  if to_regclass('public.net_app_account_policies') is not null then
    execute $policy$
      insert into public.net_app_account_policies (
        app_id, account_mode, account_available
      )
      values ('net-search', 'none', false)
      on conflict (app_id) do update set
        account_mode = excluded.account_mode,
        account_available = excluded.account_available,
        updated_at = timezone('utc', now())
    $policy$;
  end if;
end;
$$;

create or replace function public.net_search_text_array_is_bounded(
  requested_values text[],
  requested_max_items integer,
  requested_max_item_length integer
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    requested_values is not null
    and requested_max_items > 0
    and requested_max_item_length > 0
    and cardinality(requested_values) <= requested_max_items
    and not exists (
      select 1
      from unnest(requested_values) as item(value)
      where item.value is null
        or item.value <> btrim(item.value)
        or btrim(item.value) = ''
        or char_length(item.value) > requested_max_item_length
    );
$$;

-- array_to_string(anyarray, ...) is catalogued STABLE because arbitrary array
-- element output may depend on settings. This text[]-only wrapper is genuinely
-- immutable and keeps the generated FTS document legal on PostgreSQL 17.
create or replace function public.net_search_text_array_to_document(
  requested_values text[]
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(array_to_string(requested_values, ' '), '');
$$;

create table if not exists public.net_search_knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null default 'knowledge'
    check (source_kind = 'knowledge'),
  entry_type text not null
    check (entry_type in (
      'person', 'organization', 'location', 'event', 'technology',
      'concept', 'project', 'document', 'other'
    )),
  title text not null,
  summary text not null,
  content text not null,
  aliases text[] not null default '{}'::text[],
  tags text[] not null default '{}'::text[],
  visibility text not null default 'public'
    check (visibility in ('public', 'restricted', 'classified')),
  status text not null default 'active'
    check (status in ('active', 'archived')),
  available_from timestamptz,
  expires_at timestamptz,
  related_references text[] not null default '{}'::text[],
  created_by_profile_id uuid not null
    references public.profiles (id) on delete restrict,
  updated_by_profile_id uuid not null
    references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  search_document tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A')
    || setweight(to_tsvector('simple', public.net_search_text_array_to_document(aliases)), 'A')
    || setweight(to_tsvector('simple', public.net_search_text_array_to_document(tags)), 'B')
    || setweight(to_tsvector('simple', coalesce(summary, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(content, '')), 'C')
  ) stored,
  constraint net_search_knowledge_title_shape check (
    title = btrim(title) and char_length(title) between 1 and 160
  ),
  constraint net_search_knowledge_summary_shape check (
    summary = btrim(summary) and char_length(summary) between 1 and 500
  ),
  constraint net_search_knowledge_content_shape check (
    content = btrim(content) and char_length(content) between 1 and 20000
  ),
  constraint net_search_knowledge_aliases_shape check (
    public.net_search_text_array_is_bounded(aliases, 20, 100)
  ),
  constraint net_search_knowledge_tags_shape check (
    public.net_search_text_array_is_bounded(tags, 20, 60)
  ),
  constraint net_search_knowledge_references_shape check (
    public.net_search_text_array_is_bounded(related_references, 20, 160)
  ),
  constraint net_search_knowledge_time_shape check (
    expires_at is null or available_from is null or expires_at > available_from
  ),
  constraint net_search_knowledge_lifecycle_shape check (
    (status = 'active' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  )
);

comment on table public.net_search_knowledge_entries is
  'GM-authored canonical lore for VEIL Search. V1 player reads expose only active, currently available PUBLIC entries through bounded RPCs.';
comment on column public.net_search_knowledge_entries.visibility is
  'PUBLIC is player-searchable. RESTRICTED and CLASSIFIED remain GM-only in V1 and are never downloaded to player clients.';
comment on column public.net_search_knowledge_entries.search_document is
  'Server-owned deterministic full-text document. It contains no generated AI answer.';

create index if not exists net_search_knowledge_search_document_idx
  on public.net_search_knowledge_entries using gin (search_document);
create index if not exists net_search_knowledge_player_window_idx
  on public.net_search_knowledge_entries (
    status, visibility, available_from, expires_at, updated_at desc, id desc
  );
create index if not exists net_search_knowledge_gm_directory_idx
  on public.net_search_knowledge_entries (status, visibility, updated_at desc, id desc);

create table if not exists public.net_search_knowledge_audit (
  id uuid primary key default gen_random_uuid(),
  authenticated_actor_profile_id uuid not null
    references public.profiles (id) on delete restrict,
  action_type text not null,
  entry_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint net_search_knowledge_audit_action_shape check (
    action_type = btrim(action_type) and char_length(action_type) between 1 and 120
  )
);

comment on table public.net_search_knowledge_audit is
  'Hidden append-only GM audit for VEIL Search. entry_id intentionally has no foreign key so deletion remains traceable.';

create index if not exists net_search_knowledge_audit_entry_idx
  on public.net_search_knowledge_audit (entry_id, created_at desc, id desc);
create index if not exists net_search_knowledge_audit_actor_idx
  on public.net_search_knowledge_audit (
    authenticated_actor_profile_id, created_at desc, id desc
  );

create or replace function public.set_net_search_knowledge_updated_at()
returns trigger
language plpgsql
volatile
set search_path = public, pg_temp
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists net_search_knowledge_set_updated_at
  on public.net_search_knowledge_entries;
create trigger net_search_knowledge_set_updated_at
before update on public.net_search_knowledge_entries
for each row execute procedure public.set_net_search_knowledge_updated_at();

create or replace function public.assert_net_search_gm_editor()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
begin
  if actor_profile_id is null or not exists (
    select 1
    from public.profiles as actor_profile
    where actor_profile.id = actor_profile_id
      and actor_profile.role::text = 'gm'
  ) then
    raise exception 'Only GM System may control the VEIL Search index.'
      using errcode = '42501';
  end if;
  return actor_profile_id;
end;
$$;

create or replace function public.assert_net_search_gm_entry_input(
  requested_title text,
  requested_entry_type text,
  requested_summary text,
  requested_content text,
  requested_aliases text[],
  requested_tags text[],
  requested_visibility text,
  requested_available_from timestamptz,
  requested_expires_at timestamptz,
  requested_related_references text[]
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if octet_length(coalesce(requested_title, '')) > 1024
    or btrim(coalesce(requested_title, '')) = ''
    or char_length(btrim(requested_title)) > 160
  then
    raise exception 'NET_SEARCH_INPUT_TITLE_INVALID' using errcode = '22023';
  end if;

  if lower(btrim(coalesce(requested_entry_type, ''))) not in (
    'person', 'organization', 'location', 'event', 'technology',
    'concept', 'project', 'document', 'other'
  ) then
    raise exception 'NET_SEARCH_INPUT_TYPE_INVALID' using errcode = '22023';
  end if;

  if octet_length(coalesce(requested_summary, '')) > 4096
    or btrim(coalesce(requested_summary, '')) = ''
    or char_length(btrim(requested_summary)) > 500
  then
    raise exception 'NET_SEARCH_INPUT_SUMMARY_INVALID' using errcode = '22023';
  end if;

  if octet_length(coalesce(requested_content, '')) > 100000
    or btrim(coalesce(requested_content, '')) = ''
    or char_length(btrim(requested_content)) > 20000
  then
    raise exception 'NET_SEARCH_INPUT_CONTENT_INVALID' using errcode = '22023';
  end if;

  if not public.net_search_text_array_is_bounded(coalesce(requested_aliases, '{}'::text[]), 20, 100)
    or not public.net_search_text_array_is_bounded(coalesce(requested_tags, '{}'::text[]), 20, 60)
    or not public.net_search_text_array_is_bounded(
      coalesce(requested_related_references, '{}'::text[]), 20, 160
    )
  then
    raise exception 'NET_SEARCH_INPUT_ARRAY_INVALID' using errcode = '22023';
  end if;

  if lower(btrim(coalesce(requested_visibility, ''))) not in (
    'public', 'restricted', 'classified'
  ) then
    raise exception 'NET_SEARCH_INPUT_VISIBILITY_INVALID' using errcode = '22023';
  end if;

  if requested_available_from is not null
    and requested_expires_at is not null
    and requested_expires_at <= requested_available_from
  then
    raise exception 'NET_SEARCH_INPUT_TIME_INVALID' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.audit_net_search_gm_action(
  requested_action_type text,
  requested_entry_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := public.assert_net_search_gm_editor();
begin
  insert into public.net_search_knowledge_audit (
    authenticated_actor_profile_id,
    action_type,
    entry_id
  )
  values (
    actor_profile_id,
    requested_action_type,
    requested_entry_id
  );
end;
$$;

-- Player search is always PUBLIC-only, including when the caller is a GM.
-- GM-only records are available exclusively through the GM RPC family below.
create or replace function public.search_net_knowledge(
  requested_query text,
  requested_limit integer default 20
)
returns table (
  id uuid,
  source_kind text,
  entry_type text,
  title text,
  summary text,
  excerpt text,
  tags text[],
  updated_at timestamptz,
  rank_score double precision
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_query text := lower(btrim(coalesce(requested_query, '')));
  page_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 30);
  search_query tsquery;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if octet_length(coalesce(requested_query, '')) > 1024
    or char_length(normalized_query) not between 2 and 120
  then
    raise exception 'NET_SEARCH_QUERY_INVALID' using errcode = '22023';
  end if;

  search_query := websearch_to_tsquery('simple', normalized_query);

  return query
  select
    entry.id,
    entry.source_kind,
    entry.entry_type,
    entry.title,
    entry.summary,
    left(entry.content, 360) as excerpt,
    entry.tags,
    entry.updated_at,
    (
      case when lower(entry.title) = normalized_query then 1000 else 0 end
      + case when exists (
          select 1 from unnest(entry.aliases) as alias(value)
          where lower(alias.value) = normalized_query
        ) then 800 else 0 end
      + case when position(normalized_query in lower(entry.title)) > 0 then 500 else 0 end
      + case when exists (
          select 1 from unnest(entry.tags) as tag(value)
          where lower(tag.value) = normalized_query
        ) then 350 else 0 end
      + case when position(normalized_query in lower(entry.summary)) > 0 then 140 else 0 end
      + (ts_rank_cd(entry.search_document, search_query, 32) * 100)
    )::double precision as rank_score
  from public.net_search_knowledge_entries as entry
  where entry.status = 'active'
    and entry.visibility = 'public'
    and (entry.available_from is null or entry.available_from <= statement_timestamp())
    and (entry.expires_at is null or entry.expires_at > statement_timestamp())
    and (
      entry.search_document @@ search_query
      or position(normalized_query in lower(concat_ws(
        ' ', entry.title, entry.summary, array_to_string(entry.aliases, ' '),
        array_to_string(entry.tags, ' ')
      ))) > 0
    )
  order by rank_score desc, entry.updated_at desc, entry.id desc
  limit page_limit;
end;
$$;

create or replace function public.fetch_net_search_home(
  requested_limit integer default 8
)
returns table (
  id uuid,
  source_kind text,
  entry_type text,
  title text,
  summary text,
  excerpt text,
  tags text[],
  updated_at timestamptz,
  rank_score double precision
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  page_limit integer := least(greatest(coalesce(requested_limit, 8), 1), 12);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  return query
  select
    entry.id,
    entry.source_kind,
    entry.entry_type,
    entry.title,
    entry.summary,
    left(entry.content, 360) as excerpt,
    entry.tags,
    entry.updated_at,
    0::double precision as rank_score
  from public.net_search_knowledge_entries as entry
  where entry.status = 'active'
    and entry.visibility = 'public'
    and (entry.available_from is null or entry.available_from <= statement_timestamp())
    and (entry.expires_at is null or entry.expires_at > statement_timestamp())
  order by entry.updated_at desc, entry.id desc
  limit page_limit;
end;
$$;

create or replace function public.fetch_net_search_entry(
  requested_entry_id uuid
)
returns table (
  id uuid,
  source_kind text,
  entry_type text,
  title text,
  summary text,
  excerpt text,
  tags text[],
  updated_at timestamptz,
  rank_score double precision,
  content text,
  aliases text[],
  related_references text[],
  available_from timestamptz,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if requested_entry_id is null then
    return;
  end if;

  return query
  select
    entry.id,
    entry.source_kind,
    entry.entry_type,
    entry.title,
    entry.summary,
    left(entry.content, 360) as excerpt,
    entry.tags,
    entry.updated_at,
    0::double precision as rank_score,
    entry.content,
    entry.aliases,
    entry.related_references,
    entry.available_from,
    entry.expires_at
  from public.net_search_knowledge_entries as entry
  where entry.id = requested_entry_id
    and entry.status = 'active'
    and entry.visibility = 'public'
    and (entry.available_from is null or entry.available_from <= statement_timestamp())
    and (entry.expires_at is null or entry.expires_at > statement_timestamp());
end;
$$;

create or replace function public.net_search_gm_entry_payload(
  requested_entry_id uuid
)
returns table (
  id uuid,
  title text,
  entry_type text,
  summary text,
  content text,
  aliases text[],
  tags text[],
  visibility text,
  available_from timestamptz,
  expires_at timestamptz,
  related_references text[],
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    entry.id,
    entry.title,
    entry.entry_type,
    entry.summary,
    entry.content,
    entry.aliases,
    entry.tags,
    entry.visibility,
    entry.available_from,
    entry.expires_at,
    entry.related_references,
    entry.status,
    entry.created_at,
    entry.updated_at,
    entry.archived_at
  from public.net_search_knowledge_entries as entry
  where entry.id = requested_entry_id;
$$;

create or replace function public.fetch_net_search_gm_directory(
  requested_query text default null,
  requested_visibility text default null,
  requested_lifecycle text default 'all',
  requested_limit integer default 200
)
returns table (
  id uuid,
  title text,
  entry_type text,
  visibility text,
  status text,
  available_from timestamptz,
  expires_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_query text := lower(nullif(btrim(requested_query), ''));
  normalized_visibility text := lower(nullif(btrim(requested_visibility), ''));
  normalized_lifecycle text := lower(btrim(coalesce(requested_lifecycle, 'all')));
  page_limit integer := least(greatest(coalesce(requested_limit, 200), 1), 200);
begin
  perform public.assert_net_search_gm_editor();

  if octet_length(coalesce(requested_query, '')) > 1024
    or (normalized_query is not null and char_length(normalized_query) > 120)
    or (normalized_visibility is not null and normalized_visibility not in ('public', 'restricted', 'classified'))
    or normalized_lifecycle not in ('all', 'current', 'future', 'expired', 'archived')
  then
    raise exception 'NET_SEARCH_INPUT_DIRECTORY_INVALID' using errcode = '22023';
  end if;

  return query
  select
    entry.id,
    entry.title,
    entry.entry_type,
    entry.visibility,
    entry.status,
    entry.available_from,
    entry.expires_at,
    entry.updated_at
  from public.net_search_knowledge_entries as entry
  where (normalized_visibility is null or entry.visibility = normalized_visibility)
    and (
      normalized_query is null
      or position(normalized_query in lower(concat_ws(
        ' ', entry.title, entry.entry_type, entry.summary,
        array_to_string(entry.aliases, ' '), array_to_string(entry.tags, ' ')
      ))) > 0
    )
    and (
      normalized_lifecycle = 'all'
      or (normalized_lifecycle = 'archived' and entry.status = 'archived')
      or (
        normalized_lifecycle = 'current'
        and entry.status = 'active'
        and (entry.available_from is null or entry.available_from <= statement_timestamp())
        and (entry.expires_at is null or entry.expires_at > statement_timestamp())
      )
      or (
        normalized_lifecycle = 'future'
        and entry.status = 'active'
        and entry.available_from > statement_timestamp()
      )
      or (
        normalized_lifecycle = 'expired'
        and entry.status = 'active'
        and entry.expires_at <= statement_timestamp()
      )
    )
  order by (entry.status = 'archived'), entry.updated_at desc, entry.id desc
  limit page_limit;
end;
$$;

create or replace function public.fetch_net_search_gm_entry(
  requested_entry_id uuid
)
returns table (
  id uuid,
  title text,
  entry_type text,
  summary text,
  content text,
  aliases text[],
  tags text[],
  visibility text,
  available_from timestamptz,
  expires_at timestamptz,
  related_references text[],
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_search_gm_editor();
  if requested_entry_id is null then return; end if;
  return query select * from public.net_search_gm_entry_payload(requested_entry_id);
end;
$$;

create or replace function public.save_net_search_gm_entry(
  requested_entry_id uuid,
  requested_title text,
  requested_entry_type text,
  requested_summary text,
  requested_content text,
  requested_aliases text[],
  requested_tags text[],
  requested_visibility text,
  requested_available_from timestamptz,
  requested_expires_at timestamptz,
  requested_related_references text[]
)
returns table (
  id uuid,
  title text,
  entry_type text,
  summary text,
  content text,
  aliases text[],
  tags text[],
  visibility text,
  available_from timestamptz,
  expires_at timestamptz,
  related_references text[],
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := public.assert_net_search_gm_editor();
  saved_entry_id uuid;
  normalized_aliases text[] := array(
    select distinct btrim(value)
    from unnest(coalesce(requested_aliases, '{}'::text[])) as alias(value)
    where btrim(value) <> ''
    order by btrim(value)
  );
  normalized_tags text[] := array(
    select distinct lower(btrim(value))
    from unnest(coalesce(requested_tags, '{}'::text[])) as tag(value)
    where btrim(value) <> ''
    order by lower(btrim(value))
  );
  normalized_references text[] := array(
    select distinct btrim(value)
    from unnest(coalesce(requested_related_references, '{}'::text[])) as reference(value)
    where btrim(value) <> ''
    order by btrim(value)
  );
begin
  perform public.assert_net_search_gm_entry_input(
    requested_title,
    requested_entry_type,
    requested_summary,
    requested_content,
    normalized_aliases,
    normalized_tags,
    requested_visibility,
    requested_available_from,
    requested_expires_at,
    normalized_references
  );

  if requested_entry_id is null then
    insert into public.net_search_knowledge_entries (
      entry_type,
      title,
      summary,
      content,
      aliases,
      tags,
      visibility,
      available_from,
      expires_at,
      related_references,
      created_by_profile_id,
      updated_by_profile_id
    )
    values (
      lower(btrim(requested_entry_type)),
      btrim(requested_title),
      btrim(requested_summary),
      btrim(requested_content),
      normalized_aliases,
      normalized_tags,
      lower(btrim(requested_visibility)),
      requested_available_from,
      requested_expires_at,
      normalized_references,
      actor_profile_id,
      actor_profile_id
    )
    returning net_search_knowledge_entries.id into saved_entry_id;

    perform public.audit_net_search_gm_action(
      'net-search.knowledge.create', saved_entry_id
    );
  else
    update public.net_search_knowledge_entries as entry
    set
      entry_type = lower(btrim(requested_entry_type)),
      title = btrim(requested_title),
      summary = btrim(requested_summary),
      content = btrim(requested_content),
      aliases = normalized_aliases,
      tags = normalized_tags,
      visibility = lower(btrim(requested_visibility)),
      available_from = requested_available_from,
      expires_at = requested_expires_at,
      related_references = normalized_references,
      updated_by_profile_id = actor_profile_id
    where entry.id = requested_entry_id
    returning entry.id into saved_entry_id;

    if saved_entry_id is null then
      raise exception 'NET_SEARCH_ENTRY_NOT_FOUND' using errcode = 'P0002';
    end if;

    perform public.audit_net_search_gm_action(
      'net-search.knowledge.update', saved_entry_id
    );
  end if;

  return query select * from public.net_search_gm_entry_payload(saved_entry_id);
end;
$$;

create or replace function public.set_net_search_gm_entry_lifecycle(
  requested_entry_id uuid,
  requested_action text
)
returns table (
  id uuid,
  title text,
  entry_type text,
  summary text,
  content text,
  aliases text[],
  tags text[],
  visibility text,
  available_from timestamptz,
  expires_at timestamptz,
  related_references text[],
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := public.assert_net_search_gm_editor();
  normalized_action text := lower(btrim(coalesce(requested_action, '')));
  current_status text;
begin
  if requested_entry_id is null or normalized_action not in ('archive', 'restore') then
    raise exception 'NET_SEARCH_LIFECYCLE_INVALID' using errcode = 'P0001';
  end if;

  select entry.status into current_status
  from public.net_search_knowledge_entries as entry
  where entry.id = requested_entry_id
  for update;

  if not found then
    raise exception 'NET_SEARCH_ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if (normalized_action = 'archive' and current_status <> 'active')
    or (normalized_action = 'restore' and current_status <> 'archived')
  then
    raise exception 'NET_SEARCH_LIFECYCLE_INVALID' using errcode = 'P0001';
  end if;

  update public.net_search_knowledge_entries as entry
  set
    status = case normalized_action when 'archive' then 'archived' else 'active' end,
    archived_at = case normalized_action when 'archive' then timezone('utc', now()) else null end,
    updated_by_profile_id = actor_profile_id
  where entry.id = requested_entry_id;

  perform public.audit_net_search_gm_action(
    case normalized_action
      when 'archive' then 'net-search.knowledge.archive'
      else 'net-search.knowledge.restore'
    end,
    requested_entry_id
  );

  return query select * from public.net_search_gm_entry_payload(requested_entry_id);
end;
$$;

create or replace function public.delete_net_search_gm_entry(
  requested_entry_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_rows integer := 0;
begin
  perform public.assert_net_search_gm_editor();
  if requested_entry_id is null then
    raise exception 'NET_SEARCH_ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform 1
  from public.net_search_knowledge_entries as entry
  where entry.id = requested_entry_id
  for update;
  if not found then
    raise exception 'NET_SEARCH_ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform public.audit_net_search_gm_action(
    'net-search.knowledge.delete', requested_entry_id
  );
  delete from public.net_search_knowledge_entries as entry
  where entry.id = requested_entry_id;
  get diagnostics deleted_rows = row_count;
  return deleted_rows = 1;
end;
$$;

alter table public.net_search_knowledge_entries enable row level security;
alter table public.net_search_knowledge_audit enable row level security;

-- No policies are intentional. SECURITY DEFINER RPCs are the only browser API.
revoke all on table public.net_search_knowledge_entries
  from public, anon, authenticated;
revoke all on table public.net_search_knowledge_audit
  from public, anon, authenticated;

revoke all on function public.net_search_text_array_is_bounded(text[], integer, integer)
  from public, anon, authenticated;
revoke all on function public.net_search_text_array_to_document(text[])
  from public, anon, authenticated;
revoke all on function public.set_net_search_knowledge_updated_at()
  from public, anon, authenticated;
revoke all on function public.assert_net_search_gm_editor()
  from public, anon, authenticated;
revoke all on function public.assert_net_search_gm_entry_input(
  text, text, text, text, text[], text[], text, timestamptz, timestamptz, text[]
) from public, anon, authenticated;
revoke all on function public.audit_net_search_gm_action(text, uuid)
  from public, anon, authenticated;
revoke all on function public.net_search_gm_entry_payload(uuid)
  from public, anon, authenticated;

revoke all on function public.search_net_knowledge(text, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_search_home(integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_search_entry(uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_search_gm_directory(text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_search_gm_entry(uuid)
  from public, anon, authenticated;
revoke all on function public.save_net_search_gm_entry(
  uuid, text, text, text, text, text[], text[], text, timestamptz, timestamptz, text[]
) from public, anon, authenticated;
revoke all on function public.set_net_search_gm_entry_lifecycle(uuid, text)
  from public, anon, authenticated;
revoke all on function public.delete_net_search_gm_entry(uuid)
  from public, anon, authenticated;

grant execute on function public.search_net_knowledge(text, integer)
  to authenticated;
grant execute on function public.fetch_net_search_home(integer)
  to authenticated;
grant execute on function public.fetch_net_search_entry(uuid)
  to authenticated;
grant execute on function public.fetch_net_search_gm_directory(text, text, text, integer)
  to authenticated;
grant execute on function public.fetch_net_search_gm_entry(uuid)
  to authenticated;
grant execute on function public.save_net_search_gm_entry(
  uuid, text, text, text, text, text[], text[], text, timestamptz, timestamptz, text[]
) to authenticated;
grant execute on function public.set_net_search_gm_entry_lifecycle(uuid, text)
  to authenticated;
grant execute on function public.delete_net_search_gm_entry(uuid)
  to authenticated;

commit;
