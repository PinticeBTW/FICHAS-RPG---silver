-- VEIL / ALTARA SEARCH: server-authoritative knowledge-scope isolation.
-- Depends on net-multi-os-unified-gm-control.sql,
-- net-system-hacking-runtime-projection.sql, net-search-knowledge-v1.sql,
-- and 20260825182248_net_search_bulk_lore_v1.sql.
--
-- Existing Search rows are original VEIL / New Vega canon and are therefore
-- backfilled to the VEIL scope. ALTARA starts empty. Browser-facing Search
-- RPCs never accept a caller-selected knowledge scope; they derive it from
-- the current runtime identity or the authenticated GM System workspace.

begin;

do $preflight$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.net_os_families') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_search_knowledge_entries') is null
    or to_regclass('public.net_search_knowledge_documents') is null
    or to_regclass('public.net_search_knowledge_chunks') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.search_net_knowledge_v2(text,integer)') is null
    or to_regprocedure('public.fetch_net_search_home_v2(integer)') is null
    or to_regprocedure('public.fetch_net_search_source_v2(uuid,text)') is null
    or to_regprocedure('public.fetch_net_search_gm_directory_v2(text,text,text,text,integer)') is null
    or to_regprocedure('public.retrieve_net_search_context_v1(text,integer)') is null
  then
    raise exception 'NET_SEARCH_SCOPE_FOUNDATION_REQUIRED'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.net_os_families as os_family
    where os_family.id = 'veil'
      and os_family.status = 'active'
  ) or not exists (
    select 1
    from public.net_os_families as os_family
    where os_family.id = 'altara'
      and os_family.status = 'active'
  ) then
    raise exception 'NET_SEARCH_SUPPORTED_OS_SCOPES_REQUIRED'
      using errcode = '55000';
  end if;
end;
$preflight$;

alter table public.net_gm_persona_sessions
  add column workspace_os_id text not null default 'veil';

alter table public.net_gm_persona_sessions
  add constraint net_gm_persona_sessions_workspace_os_shape
  check (workspace_os_id in ('veil', 'altara'));

alter table public.net_gm_persona_sessions
  add constraint net_gm_persona_sessions_workspace_os_fkey
  foreign key (workspace_os_id)
  references public.net_os_families (id)
  on update restrict
  on delete restrict;

comment on column public.net_gm_persona_sessions.workspace_os_id is
  'Server-authoritative GM System workspace. Controlled runtime identities override it; it never changes a character OS assignment.';

alter table public.net_search_knowledge_entries
  add column knowledge_scope text not null default 'veil';

alter table public.net_search_knowledge_entries
  add constraint net_search_knowledge_entries_scope_shape
  check (knowledge_scope in ('veil', 'altara'));

alter table public.net_search_knowledge_entries
  add constraint net_search_knowledge_entries_scope_fkey
  foreign key (knowledge_scope)
  references public.net_os_families (id)
  on update restrict
  on delete restrict;

comment on column public.net_search_knowledge_entries.knowledge_scope is
  'Canonical Search network namespace. Existing V1 rows are VEIL; ALTARA records are created only from the ALTARA GM workspace.';

alter table public.net_search_knowledge_entries
  alter column knowledge_scope drop default;

alter table public.net_search_knowledge_documents
  add column knowledge_scope text not null default 'veil';

alter table public.net_search_knowledge_documents
  add constraint net_search_knowledge_documents_scope_shape
  check (knowledge_scope in ('veil', 'altara'));

alter table public.net_search_knowledge_documents
  add constraint net_search_knowledge_documents_scope_fkey
  foreign key (knowledge_scope)
  references public.net_os_families (id)
  on update restrict
  on delete restrict;

comment on column public.net_search_knowledge_documents.knowledge_scope is
  'Lore-document Search namespace. All private chunks inherit authority through their parent document.';

alter table public.net_search_knowledge_documents
  alter column knowledge_scope drop default;

create index net_search_knowledge_scope_player_window_idx
  on public.net_search_knowledge_entries (
    knowledge_scope, status, visibility, available_from, expires_at,
    updated_at desc, id desc
  );

create index net_search_knowledge_scope_gm_directory_idx
  on public.net_search_knowledge_entries (
    knowledge_scope, status, visibility, updated_at desc, id desc
  );

create index net_search_document_scope_player_window_idx
  on public.net_search_knowledge_documents (
    knowledge_scope, visibility, available_from, expires_at,
    updated_at desc, id desc
  );

create index net_search_document_scope_gm_directory_idx
  on public.net_search_knowledge_documents (
    knowledge_scope, visibility, updated_at desc, id desc
  );

create or replace function public.set_net_gm_system_workspace_v1(
  requested_workspace_os_id text
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_scope text := lower(btrim(coalesce(requested_workspace_os_id, '')));
  v_mode text;
begin
  if v_actor is null or not public.is_current_user_gm() then
    raise exception 'Only an authenticated GM may select the GM System workspace.'
      using errcode = '42501';
  end if;

  if v_scope not in ('veil', 'altara') or not exists (
    select 1
    from public.net_os_families as os_family
    where os_family.id = v_scope
      and os_family.status = 'active'
  ) then
    raise exception 'NET_SEARCH_SCOPE_INVALID' using errcode = '22023';
  end if;

  select gm_session.mode
  into v_mode
  from public.net_gm_persona_sessions as gm_session
  where gm_session.gm_profile_id = v_actor
  for update;

  if found and v_mode = 'take-control' then
    raise exception 'NET_SEARCH_GM_WORKSPACE_CONTROLLED'
      using errcode = '42501';
  end if;

  insert into public.net_gm_persona_sessions (
    gm_profile_id,
    subject_kind,
    subject_id,
    mode,
    workspace_os_id
  )
  values (v_actor, null, null, 'none', v_scope)
  on conflict (gm_profile_id) do update
  set workspace_os_id = excluded.workspace_os_id;

  return v_scope;
end;
$function$;

create or replace function public.current_net_search_scope_v1()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_runtime_identity_link_id uuid;
  v_scope text;
  v_os_status text;
  v_has_assignment boolean := false;
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select profile.role::text
  into v_role
  from public.profiles as profile
  where profile.id = v_actor;

  if not found or v_role not in ('player', 'gm') then
    raise exception 'NET_SEARCH_SCOPE_UNAVAILABLE' using errcode = '42501';
  end if;

  v_runtime_identity_link_id := public.current_net_effective_runtime_identity_link_id();

  if v_runtime_identity_link_id is not null then
    select assignment.primary_os_id, os_family.status
    into v_scope, v_os_status
    from public.net_identity_os_assignments as assignment
    left join public.net_os_families as os_family
      on os_family.id = assignment.primary_os_id
    where assignment.identity_link_id = v_runtime_identity_link_id;

    v_has_assignment := found;

    if v_has_assignment then
      if v_scope is null
        or v_scope not in ('veil', 'altara')
        or v_os_status is distinct from 'active'
      then
        raise exception 'NET_SEARCH_SCOPE_UNAVAILABLE' using errcode = '42501';
      end if;
      return v_scope;
    end if;
  end if;

  if v_role = 'gm' then
    select gm_session.workspace_os_id
    into v_scope
    from public.net_gm_persona_sessions as gm_session
    where gm_session.gm_profile_id = v_actor;

    v_scope := coalesce(v_scope, 'veil');
    if v_scope is null or v_scope not in ('veil', 'altara') or not exists (
      select 1
      from public.net_os_families as os_family
      where os_family.id = v_scope
        and os_family.status = 'active'
    ) then
      raise exception 'NET_SEARCH_SCOPE_UNAVAILABLE' using errcode = '42501';
    end if;
    return v_scope;
  end if;

  raise exception 'NET_SEARCH_SCOPE_UNAVAILABLE' using errcode = '42501';
end;
$function$;

create or replace function public.assert_net_search_gm_scope_v1()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  perform public.assert_net_search_gm_editor();
  return public.current_net_search_scope_v1();
end;
$function$;

-- Lore-document payloads and mutations bind every UUID to the current scope.
create or replace function public.net_search_gm_document_payload_v1(
  requested_document_id uuid
)
returns table (
  id uuid,
  title text,
  source_label text,
  visibility text,
  available_from timestamptz,
  expires_at timestamptz,
  raw_content text,
  searchable_sections integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    document.id,
    document.title,
    document.source_label,
    document.visibility,
    document.available_from,
    document.expires_at,
    document.raw_content,
    document.searchable_section_count,
    document.created_at,
    document.updated_at
  from public.net_search_knowledge_documents as document
  where document.id = requested_document_id
    and document.knowledge_scope = public.current_net_search_scope_v1();
$function$;

create or replace function public.preview_net_search_gm_lore_import_v1(
  requested_title text,
  requested_raw_content text
)
returns table (
  chunk_index integer,
  heading text,
  excerpt text,
  character_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  perform public.assert_net_search_gm_scope_v1();
  perform public.assert_net_search_gm_document_input_v1(
    requested_title,
    null,
    'public',
    null,
    null,
    requested_raw_content
  );

  return query
  select
    generated_chunk.chunk_index,
    generated_chunk.heading,
    left(generated_chunk.content, 360),
    char_length(generated_chunk.content)
  from public.net_search_chunk_lore_document_v1(
    requested_title,
    requested_raw_content
  ) as generated_chunk
  order by generated_chunk.chunk_index;
end;
$function$;

create or replace function public.fetch_net_search_gm_document_v1(
  requested_document_id uuid
)
returns table (
  id uuid,
  title text,
  source_label text,
  visibility text,
  available_from timestamptz,
  expires_at timestamptz,
  raw_content text,
  searchable_sections integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  perform public.assert_net_search_gm_scope_v1();
  if requested_document_id is null then return; end if;
  return query
  select * from public.net_search_gm_document_payload_v1(requested_document_id);
end;
$function$;

create or replace function public.save_net_search_gm_document_v1(
  requested_document_id uuid,
  requested_title text,
  requested_source_label text,
  requested_visibility text,
  requested_available_from timestamptz,
  requested_expires_at timestamptz,
  requested_raw_content text
)
returns table (
  id uuid,
  title text,
  source_label text,
  visibility text,
  available_from timestamptz,
  expires_at timestamptz,
  raw_content text,
  searchable_sections integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  actor_profile_id uuid := public.assert_net_search_gm_editor();
  v_scope text := public.current_net_search_scope_v1();
  saved_document_id uuid;
  normalized_title text := btrim(requested_title);
  normalized_source_label text := nullif(btrim(requested_source_label), '');
  normalized_visibility text := lower(btrim(requested_visibility));
  normalized_content text := btrim(
    replace(replace(requested_raw_content, E'\r\n', E'\n'), E'\r', E'\n')
  );
begin
  perform public.assert_net_search_gm_document_input_v1(
    normalized_title,
    normalized_source_label,
    normalized_visibility,
    requested_available_from,
    requested_expires_at,
    normalized_content
  );

  if requested_document_id is null then
    insert into public.net_search_knowledge_documents (
      knowledge_scope,
      title,
      source_label,
      visibility,
      available_from,
      expires_at,
      raw_content,
      created_by_profile_id,
      updated_by_profile_id
    )
    values (
      v_scope,
      normalized_title,
      normalized_source_label,
      normalized_visibility,
      requested_available_from,
      requested_expires_at,
      normalized_content,
      actor_profile_id,
      actor_profile_id
    )
    returning net_search_knowledge_documents.id into saved_document_id;
  else
    perform 1
    from public.net_search_knowledge_documents as document
    where document.id = requested_document_id
      and document.knowledge_scope = v_scope
    for update;

    if not found then
      raise exception 'NET_SEARCH_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
    end if;

    update public.net_search_knowledge_documents as document
    set
      title = normalized_title,
      source_label = normalized_source_label,
      visibility = normalized_visibility,
      available_from = requested_available_from,
      expires_at = requested_expires_at,
      raw_content = normalized_content,
      updated_by_profile_id = actor_profile_id
    where document.id = requested_document_id
      and document.knowledge_scope = v_scope
    returning document.id into saved_document_id;
  end if;

  perform public.rebuild_net_search_document_chunks_v1(
    saved_document_id,
    normalized_title,
    normalized_source_label,
    normalized_content
  );

  perform public.audit_net_search_gm_document_action_v1(
    case when requested_document_id is null
      then 'net-search.document.create'
      else 'net-search.document.update'
    end,
    saved_document_id
  );

  return query
  select * from public.net_search_gm_document_payload_v1(saved_document_id);
end;
$function$;

create or replace function public.delete_net_search_gm_document_v1(
  requested_document_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_scope text := public.assert_net_search_gm_scope_v1();
  deleted_rows integer := 0;
begin
  if requested_document_id is null then
    raise exception 'NET_SEARCH_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform 1
  from public.net_search_knowledge_documents as document
  where document.id = requested_document_id
    and document.knowledge_scope = v_scope
  for update;
  if not found then
    raise exception 'NET_SEARCH_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform public.audit_net_search_gm_document_action_v1(
    'net-search.document.delete', requested_document_id
  );
  delete from public.net_search_knowledge_documents as document
  where document.id = requested_document_id
    and document.knowledge_scope = v_scope;
  get diagnostics deleted_rows = row_count;
  return deleted_rows = 1;
end;
$function$;

-- Player-facing combined search. A scope is resolved once per request and
-- applied in addition to visibility and availability.
create or replace function public.search_net_knowledge_v2(
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
  rank_score double precision,
  source_label text,
  searchable_sections integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_scope text := public.current_net_search_scope_v1();
  normalized_query text := lower(btrim(coalesce(requested_query, '')));
  page_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 30);
  search_query tsquery;
begin
  if octet_length(coalesce(requested_query, '')) > 1024
    or char_length(normalized_query) not between 2 and 120
  then
    raise exception 'NET_SEARCH_QUERY_INVALID' using errcode = '22023';
  end if;

  search_query := websearch_to_tsquery('simple', normalized_query);

  return query
  with canonical_matches as (
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
      )::double precision as rank_score,
      null::text as source_label,
      null::integer as searchable_sections
    from public.net_search_knowledge_entries as entry
    where entry.knowledge_scope = v_scope
      and entry.status = 'active'
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
  ),
  document_chunk_matches as (
    select
      document.id,
      document.source_kind,
      'document'::text as entry_type,
      document.title,
      concat_ws(
        ' · ',
        document.source_label,
        document.searchable_section_count::text || ' searchable sections'
      ) as summary,
      left(
        regexp_replace(
          ts_headline(
            'simple',
            chunk.content,
            search_query,
            'MaxWords=55, MinWords=20, ShortWord=2, MaxFragments=1'
          ),
          '</?b>',
          '',
          'g'
        ),
        360
      ) as excerpt,
      '{}'::text[] as tags,
      document.updated_at,
      score.rank_score,
      document.source_label,
      document.searchable_section_count as searchable_sections,
      row_number() over (
        partition by document.id
        order by score.rank_score desc, chunk.chunk_index asc
      ) as match_order
    from public.net_search_knowledge_documents as document
    join public.net_search_knowledge_chunks as chunk
      on chunk.document_id = document.id
    cross join lateral (
      select (
        case when lower(document.title) = normalized_query then 1000 else 0 end
        + case when position(normalized_query in lower(document.title)) > 0 then 600 else 0 end
        + case when position(normalized_query in lower(coalesce(document.source_label, ''))) > 0 then 240 else 0 end
        + case when position(normalized_query in lower(coalesce(chunk.heading, ''))) > 0 then 180 else 0 end
        + (ts_rank_cd(chunk.search_document, search_query, 32) * 120)
      )::double precision as rank_score
    ) as score
    where document.knowledge_scope = v_scope
      and document.visibility = 'public'
      and (document.available_from is null or document.available_from <= statement_timestamp())
      and (document.expires_at is null or document.expires_at > statement_timestamp())
      and (
        chunk.search_document @@ search_query
        or position(normalized_query in lower(document.title)) > 0
        or position(normalized_query in lower(coalesce(document.source_label, ''))) > 0
        or position(normalized_query in lower(coalesce(chunk.heading, ''))) > 0
      )
  ),
  grouped_document_matches as (
    select
      matched.id,
      matched.source_kind,
      matched.entry_type,
      matched.title,
      matched.summary,
      matched.excerpt,
      matched.tags,
      matched.updated_at,
      matched.rank_score,
      matched.source_label,
      matched.searchable_sections
    from document_chunk_matches as matched
    where matched.match_order = 1
  ),
  combined_matches as (
    select * from canonical_matches
    union all
    select * from grouped_document_matches
  )
  select
    matched.id,
    matched.source_kind,
    matched.entry_type,
    matched.title,
    matched.summary,
    matched.excerpt,
    matched.tags,
    matched.updated_at,
    matched.rank_score,
    matched.source_label,
    matched.searchable_sections
  from combined_matches as matched
  order by matched.rank_score desc, matched.updated_at desc, matched.id desc
  limit page_limit;
end;
$function$;

create or replace function public.fetch_net_search_home_v2(
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
  rank_score double precision,
  source_label text,
  searchable_sections integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_scope text := public.current_net_search_scope_v1();
  page_limit integer := least(greatest(coalesce(requested_limit, 8), 1), 12);
begin
  return query
  with available_sources as (
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
      null::text as source_label,
      null::integer as searchable_sections
    from public.net_search_knowledge_entries as entry
    where entry.knowledge_scope = v_scope
      and entry.status = 'active'
      and entry.visibility = 'public'
      and (entry.available_from is null or entry.available_from <= statement_timestamp())
      and (entry.expires_at is null or entry.expires_at > statement_timestamp())

    union all

    select
      document.id,
      document.source_kind,
      'document'::text,
      document.title,
      concat_ws(
        ' · ',
        document.source_label,
        document.searchable_section_count::text || ' searchable sections'
      ),
      left(document.raw_content, 360),
      '{}'::text[],
      document.updated_at,
      0::double precision,
      document.source_label,
      document.searchable_section_count
    from public.net_search_knowledge_documents as document
    where document.knowledge_scope = v_scope
      and document.visibility = 'public'
      and document.searchable_section_count > 0
      and (document.available_from is null or document.available_from <= statement_timestamp())
      and (document.expires_at is null or document.expires_at > statement_timestamp())
  )
  select
    source.id,
    source.source_kind,
    source.entry_type,
    source.title,
    source.summary,
    source.excerpt,
    source.tags,
    source.updated_at,
    source.rank_score,
    source.source_label,
    source.searchable_sections
  from available_sources as source
  order by source.updated_at desc, source.id desc
  limit page_limit;
end;
$function$;

-- Canonical-entry payloads are always current-scope UUID lookups.
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
as $function$
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
  where entry.id = requested_entry_id
    and entry.knowledge_scope = public.current_net_search_scope_v1();
$function$;

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
as $function$
begin
  perform public.assert_net_search_gm_scope_v1();
  if requested_entry_id is null then return; end if;
  return query select * from public.net_search_gm_entry_payload(requested_entry_id);
end;
$function$;

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
as $function$
declare
  actor_profile_id uuid := public.assert_net_search_gm_editor();
  v_scope text := public.current_net_search_scope_v1();
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
      knowledge_scope,
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
      v_scope,
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
      and entry.knowledge_scope = v_scope
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
$function$;

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
as $function$
declare
  actor_profile_id uuid := public.assert_net_search_gm_editor();
  v_scope text := public.current_net_search_scope_v1();
  normalized_action text := lower(btrim(coalesce(requested_action, '')));
  current_status text;
begin
  if requested_entry_id is null or normalized_action not in ('archive', 'restore') then
    raise exception 'NET_SEARCH_LIFECYCLE_INVALID' using errcode = 'P0001';
  end if;

  select entry.status into current_status
  from public.net_search_knowledge_entries as entry
  where entry.id = requested_entry_id
    and entry.knowledge_scope = v_scope
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
  where entry.id = requested_entry_id
    and entry.knowledge_scope = v_scope;

  perform public.audit_net_search_gm_action(
    case normalized_action
      when 'archive' then 'net-search.knowledge.archive'
      else 'net-search.knowledge.restore'
    end,
    requested_entry_id
  );

  return query select * from public.net_search_gm_entry_payload(requested_entry_id);
end;
$function$;

create or replace function public.delete_net_search_gm_entry(
  requested_entry_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_scope text := public.assert_net_search_gm_scope_v1();
  deleted_rows integer := 0;
begin
  if requested_entry_id is null then
    raise exception 'NET_SEARCH_ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform 1
  from public.net_search_knowledge_entries as entry
  where entry.id = requested_entry_id
    and entry.knowledge_scope = v_scope
  for update;
  if not found then
    raise exception 'NET_SEARCH_ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform public.audit_net_search_gm_action(
    'net-search.knowledge.delete', requested_entry_id
  );
  delete from public.net_search_knowledge_entries as entry
  where entry.id = requested_entry_id
    and entry.knowledge_scope = v_scope;
  get diagnostics deleted_rows = row_count;
  return deleted_rows = 1;
end;
$function$;

create or replace function public.fetch_net_search_source_v2(
  requested_source_id uuid,
  requested_source_kind text
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
  source_label text,
  searchable_sections integer,
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
as $function$
declare
  v_scope text := public.current_net_search_scope_v1();
  normalized_source_kind text := lower(btrim(coalesce(requested_source_kind, '')));
begin
  if requested_source_id is null
    or normalized_source_kind not in ('knowledge', 'lore_document')
  then
    return;
  end if;

  if normalized_source_kind = 'knowledge' then
    return query
    select
      entry.id,
      entry.source_kind,
      entry.entry_type,
      entry.title,
      entry.summary,
      left(entry.content, 360),
      entry.tags,
      entry.updated_at,
      0::double precision,
      null::text,
      null::integer,
      entry.content,
      entry.aliases,
      entry.related_references,
      entry.available_from,
      entry.expires_at
    from public.net_search_knowledge_entries as entry
    where entry.id = requested_source_id
      and entry.knowledge_scope = v_scope
      and entry.status = 'active'
      and entry.visibility = 'public'
      and (entry.available_from is null or entry.available_from <= statement_timestamp())
      and (entry.expires_at is null or entry.expires_at > statement_timestamp());
  else
    return query
    select
      document.id,
      document.source_kind,
      'document'::text,
      document.title,
      concat_ws(
        ' · ',
        document.source_label,
        document.searchable_section_count::text || ' searchable sections'
      ),
      left(document.raw_content, 360),
      '{}'::text[],
      document.updated_at,
      0::double precision,
      document.source_label,
      document.searchable_section_count,
      document.raw_content,
      '{}'::text[],
      '{}'::text[],
      document.available_from,
      document.expires_at
    from public.net_search_knowledge_documents as document
    where document.id = requested_source_id
      and document.knowledge_scope = v_scope
      and document.visibility = 'public'
      and document.searchable_section_count > 0
      and (document.available_from is null or document.available_from <= statement_timestamp())
      and (document.expires_at is null or document.expires_at > statement_timestamp());
  end if;
end;
$function$;

create or replace function public.fetch_net_search_gm_directory_v2(
  requested_query text default null,
  requested_source_filter text default 'all',
  requested_visibility text default null,
  requested_lifecycle text default 'all',
  requested_limit integer default 200
)
returns table (
  id uuid,
  source_kind text,
  title text,
  entry_type text,
  source_label text,
  visibility text,
  status text,
  available_from timestamptz,
  expires_at timestamptz,
  updated_at timestamptz,
  searchable_sections integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_scope text := public.assert_net_search_gm_scope_v1();
  normalized_query text := lower(nullif(btrim(requested_query), ''));
  normalized_source_filter text := lower(btrim(coalesce(requested_source_filter, 'all')));
  normalized_visibility text := lower(nullif(btrim(requested_visibility), ''));
  normalized_lifecycle text := lower(btrim(coalesce(requested_lifecycle, 'all')));
  page_limit integer := least(greatest(coalesce(requested_limit, 200), 1), 200);
  search_query tsquery;
begin
  if octet_length(coalesce(requested_query, '')) > 1024
    or (normalized_query is not null and char_length(normalized_query) > 120)
    or normalized_source_filter not in ('all', 'entries', 'documents')
    or (normalized_visibility is not null and normalized_visibility not in ('public', 'restricted', 'classified'))
    or normalized_lifecycle not in ('all', 'current', 'future', 'expired', 'archived')
  then
    raise exception 'NET_SEARCH_INPUT_DIRECTORY_INVALID' using errcode = '22023';
  end if;

  if normalized_query is not null then
    search_query := websearch_to_tsquery('simple', normalized_query);
  end if;

  return query
  with directory_sources as (
    select
      entry.id,
      entry.source_kind,
      entry.title,
      entry.entry_type,
      null::text as source_label,
      entry.visibility,
      entry.status,
      entry.available_from,
      entry.expires_at,
      entry.updated_at,
      null::integer as searchable_sections
    from public.net_search_knowledge_entries as entry
    where entry.knowledge_scope = v_scope
      and normalized_source_filter in ('all', 'entries')
      and (normalized_visibility is null or entry.visibility = normalized_visibility)
      and (
        normalized_query is null
        or entry.search_document @@ search_query
        or position(normalized_query in lower(concat_ws(
          ' ', entry.title, entry.entry_type, entry.summary, entry.content,
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

    union all

    select
      document.id,
      document.source_kind,
      document.title,
      'document'::text,
      document.source_label,
      document.visibility,
      'active'::text,
      document.available_from,
      document.expires_at,
      document.updated_at,
      document.searchable_section_count
    from public.net_search_knowledge_documents as document
    where document.knowledge_scope = v_scope
      and normalized_source_filter in ('all', 'documents')
      and normalized_lifecycle <> 'archived'
      and (normalized_visibility is null or document.visibility = normalized_visibility)
      and (
        normalized_query is null
        or position(normalized_query in lower(concat_ws(
          ' ', document.title, document.source_label
        ))) > 0
        or exists (
          select 1
          from public.net_search_knowledge_chunks as chunk
          where chunk.document_id = document.id
            and (
              chunk.search_document @@ search_query
              or position(normalized_query in lower(chunk.content)) > 0
            )
        )
      )
      and (
        normalized_lifecycle = 'all'
        or (
          normalized_lifecycle = 'current'
          and (document.available_from is null or document.available_from <= statement_timestamp())
          and (document.expires_at is null or document.expires_at > statement_timestamp())
        )
        or (
          normalized_lifecycle = 'future'
          and document.available_from > statement_timestamp()
        )
        or (
          normalized_lifecycle = 'expired'
          and document.expires_at <= statement_timestamp()
        )
      )
  )
  select
    source.id,
    source.source_kind,
    source.title,
    source.entry_type,
    source.source_label,
    source.visibility,
    source.status,
    source.available_from,
    source.expires_at,
    source.updated_at,
    source.searchable_sections
  from directory_sources as source
  order by (source.status = 'archived'), source.updated_at desc, source.id desc
  limit page_limit;
end;
$function$;

-- Local AI receives only the top current-scope PUBLIC contexts. The WebLLM
-- model cache remains shared; no cross-scope lore enters its prompt.
create or replace function public.retrieve_net_search_context_v1(
  requested_query text,
  requested_limit integer default 8
)
returns table (
  source_id uuid,
  source_type text,
  title text,
  heading text,
  excerpt text,
  content text,
  rank_score double precision
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_scope text := public.current_net_search_scope_v1();
  normalized_query text := lower(btrim(coalesce(requested_query, '')));
  page_limit integer := least(greatest(coalesce(requested_limit, 8), 1), 12);
  search_query tsquery;
begin
  if octet_length(coalesce(requested_query, '')) > 1024
    or char_length(normalized_query) not between 2 and 120
  then
    raise exception 'NET_SEARCH_QUERY_INVALID' using errcode = '22023';
  end if;

  search_query := websearch_to_tsquery('simple', normalized_query);

  return query
  with canonical_context as (
    select
      entry.id as source_id,
      'canonical_entry'::text as source_type,
      entry.title,
      null::text as heading,
      left(entry.content, 360) as excerpt,
      entry.content,
      (
        case when lower(entry.title) = normalized_query then 1000 else 0 end
        + case when position(normalized_query in lower(entry.title)) > 0 then 500 else 0 end
        + (ts_rank_cd(entry.search_document, search_query, 32) * 100)
      )::double precision as rank_score
    from public.net_search_knowledge_entries as entry
    where entry.knowledge_scope = v_scope
      and entry.status = 'active'
      and entry.visibility = 'public'
      and (entry.available_from is null or entry.available_from <= statement_timestamp())
      and (entry.expires_at is null or entry.expires_at > statement_timestamp())
      and entry.search_document @@ search_query
  ),
  document_context_candidates as (
    select
      document.id as source_id,
      'lore_document'::text as source_type,
      document.title,
      chunk.heading,
      left(
        regexp_replace(
          ts_headline(
            'simple',
            chunk.content,
            search_query,
            'MaxWords=55, MinWords=20, ShortWord=2, MaxFragments=1'
          ),
          '</?b>',
          '',
          'g'
        ),
        360
      ) as excerpt,
      chunk.content,
      score.rank_score,
      row_number() over (
        partition by document.id
        order by score.rank_score desc, chunk.chunk_index asc
      ) as match_order
    from public.net_search_knowledge_documents as document
    join public.net_search_knowledge_chunks as chunk
      on chunk.document_id = document.id
    cross join lateral (
      select (
        case when lower(document.title) = normalized_query then 1000 else 0 end
        + case when position(normalized_query in lower(document.title)) > 0 then 600 else 0 end
        + case when position(normalized_query in lower(coalesce(chunk.heading, ''))) > 0 then 180 else 0 end
        + (ts_rank_cd(chunk.search_document, search_query, 32) * 120)
      )::double precision as rank_score
    ) as score
    where document.knowledge_scope = v_scope
      and document.visibility = 'public'
      and (document.available_from is null or document.available_from <= statement_timestamp())
      and (document.expires_at is null or document.expires_at > statement_timestamp())
      and chunk.search_document @@ search_query
  ),
  combined_context as (
    select * from canonical_context
    union all
    select
      candidate.source_id,
      candidate.source_type,
      candidate.title,
      candidate.heading,
      candidate.excerpt,
      candidate.content,
      candidate.rank_score
    from document_context_candidates as candidate
    where candidate.match_order = 1
  )
  select
    context.source_id,
    context.source_type,
    context.title,
    context.heading,
    context.excerpt,
    context.content,
    context.rank_score
  from combined_context as context
  order by context.rank_score desc, context.source_id desc
  limit page_limit;
end;
$function$;

-- Direct tables remain closed. Scope is an additional server-side boundary,
-- never a replacement for the existing visibility/time rules.
alter table public.net_search_knowledge_entries enable row level security;
alter table public.net_search_knowledge_documents enable row level security;
alter table public.net_search_knowledge_chunks enable row level security;

revoke all on table public.net_search_knowledge_entries
  from public, anon, authenticated;
revoke all on table public.net_search_knowledge_documents
  from public, anon, authenticated;
revoke all on table public.net_search_knowledge_chunks
  from public, anon, authenticated;

revoke all on function public.current_net_search_scope_v1()
  from public, anon, authenticated;
revoke all on function public.assert_net_search_gm_scope_v1()
  from public, anon, authenticated;
revoke all on function public.net_search_gm_entry_payload(uuid)
  from public, anon, authenticated;
revoke all on function public.net_search_gm_document_payload_v1(uuid)
  from public, anon, authenticated;

revoke all on function public.set_net_gm_system_workspace_v1(text)
  from public, anon, authenticated;
grant execute on function public.set_net_gm_system_workspace_v1(text)
  to authenticated;

-- Obsolete ungrouped player/directory endpoints are closed so they cannot be
-- used as a pre-scope compatibility bypass.
revoke all on function public.search_net_knowledge(text, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_search_home(integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_search_entry(uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_search_gm_directory(text, text, text, integer)
  from public, anon, authenticated;

revoke all on function public.search_net_knowledge_v2(text, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_search_home_v2(integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_search_source_v2(uuid, text)
  from public, anon, authenticated;
revoke all on function public.fetch_net_search_gm_directory_v2(
  text, text, text, text, integer
) from public, anon, authenticated;
revoke all on function public.retrieve_net_search_context_v1(text, integer)
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
revoke all on function public.preview_net_search_gm_lore_import_v1(text, text)
  from public, anon, authenticated;
revoke all on function public.fetch_net_search_gm_document_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.save_net_search_gm_document_v1(
  uuid, text, text, text, timestamptz, timestamptz, text
) from public, anon, authenticated;
revoke all on function public.delete_net_search_gm_document_v1(uuid)
  from public, anon, authenticated;

grant execute on function public.search_net_knowledge_v2(text, integer)
  to authenticated;
grant execute on function public.fetch_net_search_home_v2(integer)
  to authenticated;
grant execute on function public.fetch_net_search_source_v2(uuid, text)
  to authenticated;
grant execute on function public.fetch_net_search_gm_directory_v2(
  text, text, text, text, integer
) to authenticated;
grant execute on function public.retrieve_net_search_context_v1(text, integer)
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
grant execute on function public.preview_net_search_gm_lore_import_v1(text, text)
  to authenticated;
grant execute on function public.fetch_net_search_gm_document_v1(uuid)
  to authenticated;
grant execute on function public.save_net_search_gm_document_v1(
  uuid, text, text, text, timestamptz, timestamptz, text
) to authenticated;
grant execute on function public.delete_net_search_gm_document_v1(uuid)
  to authenticated;

commit;
