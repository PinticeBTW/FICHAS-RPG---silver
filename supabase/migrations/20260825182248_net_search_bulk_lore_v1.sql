-- VEIL SEARCH V2: deterministic bulk lore documents and grouped retrieval.
-- Depends on supabase/net-search-knowledge-v1.sql.
--
-- This is a forward-only migration. Lore chunks are private search
-- infrastructure: browser clients can only reach them through bounded RPCs.

begin;

do $$
begin
  if to_regclass('public.net_search_knowledge_entries') is null
    or to_regclass('public.profiles') is null
    or to_regprocedure('public.assert_net_search_gm_editor()') is null
  then
    raise exception 'NET_SEARCH_BULK_LORE_BASE_REQUIRED: apply net-search-knowledge-v1.sql first.'
      using errcode = '55000';
  end if;
end;
$$;

create table public.net_search_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null default 'lore_document'
    check (source_kind = 'lore_document'),
  title text not null,
  source_label text,
  visibility text not null default 'public'
    check (visibility in ('public', 'restricted', 'classified')),
  available_from timestamptz,
  expires_at timestamptz,
  raw_content text not null,
  searchable_section_count integer not null default 0
    check (searchable_section_count >= 0),
  created_by_profile_id uuid not null
    references public.profiles (id) on delete restrict,
  updated_by_profile_id uuid not null
    references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_search_document_title_shape check (
    title = btrim(title) and char_length(title) between 1 and 160
  ),
  constraint net_search_document_source_shape check (
    source_label is null
    or (source_label = btrim(source_label) and char_length(source_label) between 1 and 240)
  ),
  constraint net_search_document_content_shape check (
    raw_content = btrim(raw_content)
    and char_length(raw_content) between 1 and 500000
    and octet_length(raw_content) <= 2000000
  ),
  constraint net_search_document_time_shape check (
    expires_at is null or available_from is null or expires_at > available_from
  )
);

comment on table public.net_search_knowledge_documents is
  'GM-authored long-form lore. Player clients can read only current PUBLIC documents through purpose-bound RPCs.';
comment on column public.net_search_knowledge_documents.raw_content is
  'Authoritative full source text. It is never exposed to players unless the document is PUBLIC and currently available.';
comment on column public.net_search_knowledge_documents.searchable_section_count is
  'Server-maintained count of private deterministic chunks. Chunks are not canonical sidebar records.';

create table public.net_search_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null
    references public.net_search_knowledge_documents (id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  heading text,
  content text not null,
  title_context text not null,
  source_label_context text,
  created_at timestamptz not null default timezone('utc', now()),
  search_document tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title_context, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(heading, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(source_label_context, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(content, '')), 'C')
  ) stored,
  constraint net_search_chunk_document_order unique (document_id, chunk_index),
  constraint net_search_chunk_heading_shape check (
    heading is null or (heading = btrim(heading) and char_length(heading) between 1 and 200)
  ),
  constraint net_search_chunk_content_shape check (
    content = btrim(content) and char_length(content) between 1 and 3000
  ),
  constraint net_search_chunk_title_context_shape check (
    title_context = btrim(title_context) and char_length(title_context) between 1 and 160
  ),
  constraint net_search_chunk_source_context_shape check (
    source_label_context is null
    or (
      source_label_context = btrim(source_label_context)
      and char_length(source_label_context) between 1 and 240
    )
  )
);

comment on table public.net_search_knowledge_chunks is
  'Private deterministic search infrastructure for lore documents. Rows are never exposed as independent canon records.';
comment on column public.net_search_knowledge_chunks.search_document is
  'Weighted document title, heading, source label, and chunk text. No embeddings or generated AI content.';

create table public.net_search_knowledge_document_audit (
  id uuid primary key default gen_random_uuid(),
  authenticated_actor_profile_id uuid not null
    references public.profiles (id) on delete restrict,
  action_type text not null,
  document_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint net_search_document_audit_action_shape check (
    action_type = btrim(action_type) and char_length(action_type) between 1 and 120
  )
);

comment on table public.net_search_knowledge_document_audit is
  'Hidden append-only GM audit. document_id intentionally has no foreign key so deletion remains traceable.';

create index net_search_document_player_window_idx
  on public.net_search_knowledge_documents (
    visibility, available_from, expires_at, updated_at desc, id desc
  );
create index net_search_document_gm_directory_idx
  on public.net_search_knowledge_documents (visibility, updated_at desc, id desc);
create index net_search_document_created_by_idx
  on public.net_search_knowledge_documents (created_by_profile_id);
create index net_search_document_updated_by_idx
  on public.net_search_knowledge_documents (updated_by_profile_id);
create index net_search_chunk_search_document_idx
  on public.net_search_knowledge_chunks using gin (search_document);
create index net_search_document_audit_document_idx
  on public.net_search_knowledge_document_audit (document_id, created_at desc, id desc);
create index net_search_document_audit_actor_idx
  on public.net_search_knowledge_document_audit (
    authenticated_actor_profile_id, created_at desc, id desc
  );

create function public.set_net_search_document_updated_at()
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

create trigger net_search_document_set_updated_at
before update on public.net_search_knowledge_documents
for each row execute procedure public.set_net_search_document_updated_at();

-- The same deterministic routine powers preview and persistence. It groups
-- paragraphs, keeps Markdown heading context, prefers sentence boundaries for
-- oversized blocks, and uses a 3,000-character hard ceiling.
create function public.net_search_chunk_lore_document_v1(
  requested_title text,
  requested_content text
)
returns table (
  chunk_index integer,
  heading text,
  content text
)
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  normalized_content text := btrim(
    replace(replace(coalesce(requested_content, ''), E'\r\n', E'\n'), E'\r', E'\n')
  );
  raw_blocks text[];
  raw_block text;
  block_text text;
  first_line text;
  current_heading text := left(nullif(btrim(requested_title), ''), 200);
  buffered_heading text := current_heading;
  chunk_buffer text := '';
  remaining_text text;
  boundary_window text;
  segment_text text;
  combined_length integer;
  sentence_boundary integer;
  split_at integer;
  next_chunk_index integer := 0;
begin
  if normalized_content = '' then
    return;
  end if;

  raw_blocks := regexp_split_to_array(normalized_content, E'\n[ \t]*\n+');

  foreach raw_block in array raw_blocks loop
    block_text := btrim(raw_block);
    if block_text = '' then
      continue;
    end if;

    first_line := split_part(block_text, E'\n', 1);
    if first_line ~ '^[#]{1,6}[[:blank:]]+' then
      if chunk_buffer <> '' then
        chunk_index := next_chunk_index;
        heading := nullif(left(coalesce(buffered_heading, ''), 200), '');
        content := chunk_buffer;
        return next;
        next_chunk_index := next_chunk_index + 1;
        chunk_buffer := '';
      end if;

      current_heading := left(
        btrim(regexp_replace(first_line, '^[#]{1,6}[[:blank:]]+', '')),
        200
      );
      buffered_heading := current_heading;

      if strpos(block_text, E'\n') = 0 then
        continue;
      end if;
      block_text := btrim(substring(block_text from char_length(first_line) + 2));
      if block_text = '' then
        continue;
      end if;
    end if;

    remaining_text := block_text;

    while char_length(remaining_text) > 3000 loop
      if chunk_buffer <> '' then
        chunk_index := next_chunk_index;
        heading := nullif(left(coalesce(buffered_heading, ''), 200), '');
        content := chunk_buffer;
        return next;
        next_chunk_index := next_chunk_index + 1;
        chunk_buffer := '';
      end if;

      boundary_window := substring(remaining_text from 2201 for 800);
      select min(candidate.position_value)
      into sentence_boundary
      from (
        values
          (nullif(strpos(boundary_window, '. '), 0)),
          (nullif(strpos(boundary_window, '! '), 0)),
          (nullif(strpos(boundary_window, '? '), 0)),
          (nullif(strpos(boundary_window, E'.\n'), 0)),
          (nullif(strpos(boundary_window, E'!\n'), 0)),
          (nullif(strpos(boundary_window, E'?\n'), 0))
      ) as candidate(position_value)
      where candidate.position_value is not null;

      split_at := case
        when sentence_boundary is null then 3000
        else 2200 + sentence_boundary
      end;
      segment_text := btrim(left(remaining_text, split_at));

      chunk_index := next_chunk_index;
      heading := nullif(left(coalesce(current_heading, ''), 200), '');
      content := segment_text;
      return next;
      next_chunk_index := next_chunk_index + 1;

      remaining_text := btrim(substring(remaining_text from split_at + 1));
    end loop;

    if remaining_text = '' then
      continue;
    end if;

    combined_length := char_length(chunk_buffer)
      + case when chunk_buffer = '' then 0 else 2 end
      + char_length(remaining_text);

    if chunk_buffer = '' then
      chunk_buffer := remaining_text;
      buffered_heading := current_heading;
    elsif combined_length <= 2400
      or (char_length(chunk_buffer) < 1500 and combined_length <= 3000)
    then
      chunk_buffer := chunk_buffer || E'\n\n' || remaining_text;
    else
      chunk_index := next_chunk_index;
      heading := nullif(left(coalesce(buffered_heading, ''), 200), '');
      content := chunk_buffer;
      return next;
      next_chunk_index := next_chunk_index + 1;
      chunk_buffer := remaining_text;
      buffered_heading := current_heading;
    end if;
  end loop;

  if chunk_buffer <> '' then
    chunk_index := next_chunk_index;
    heading := nullif(left(coalesce(buffered_heading, ''), 200), '');
    content := chunk_buffer;
    return next;
  end if;
end;
$$;

create function public.assert_net_search_gm_document_input_v1(
  requested_title text,
  requested_source_label text,
  requested_visibility text,
  requested_available_from timestamptz,
  requested_expires_at timestamptz,
  requested_raw_content text
)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if octet_length(coalesce(requested_title, '')) > 1024
    or btrim(coalesce(requested_title, '')) = ''
    or char_length(btrim(requested_title)) > 160
  then
    raise exception 'NET_SEARCH_INPUT_TITLE_INVALID' using errcode = '22023';
  end if;

  if octet_length(coalesce(requested_source_label, '')) > 2048
    or char_length(btrim(coalesce(requested_source_label, ''))) > 240
  then
    raise exception 'NET_SEARCH_INPUT_SOURCE_INVALID' using errcode = '22023';
  end if;

  if lower(btrim(coalesce(requested_visibility, ''))) not in (
    'public', 'restricted', 'classified'
  ) then
    raise exception 'NET_SEARCH_INPUT_VISIBILITY_INVALID' using errcode = '22023';
  end if;

  if btrim(coalesce(requested_raw_content, '')) = ''
    or char_length(btrim(requested_raw_content)) > 500000
    or octet_length(btrim(requested_raw_content)) > 2000000
  then
    raise exception 'NET_SEARCH_INPUT_LORE_CONTENT_INVALID' using errcode = '22023';
  end if;

  if requested_available_from is not null
    and requested_expires_at is not null
    and requested_expires_at <= requested_available_from
  then
    raise exception 'NET_SEARCH_INPUT_TIME_INVALID' using errcode = '22023';
  end if;
end;
$$;

create function public.audit_net_search_gm_document_action_v1(
  requested_action_type text,
  requested_document_id uuid
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
  insert into public.net_search_knowledge_document_audit (
    authenticated_actor_profile_id,
    action_type,
    document_id
  )
  values (
    actor_profile_id,
    requested_action_type,
    requested_document_id
  );
end;
$$;

create function public.rebuild_net_search_document_chunks_v1(
  requested_document_id uuid,
  requested_title text,
  requested_source_label text,
  requested_raw_content text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  rebuilt_count integer := 0;
begin
  delete from public.net_search_knowledge_chunks as chunk
  where chunk.document_id = requested_document_id;

  insert into public.net_search_knowledge_chunks (
    document_id,
    chunk_index,
    heading,
    content,
    title_context,
    source_label_context
  )
  select
    requested_document_id,
    generated_chunk.chunk_index,
    generated_chunk.heading,
    generated_chunk.content,
    btrim(requested_title),
    nullif(btrim(requested_source_label), '')
  from public.net_search_chunk_lore_document_v1(
    requested_title,
    requested_raw_content
  ) as generated_chunk;

  get diagnostics rebuilt_count = row_count;
  if rebuilt_count < 1 then
    raise exception 'NET_SEARCH_INPUT_LORE_CONTENT_INVALID' using errcode = '22023';
  end if;

  update public.net_search_knowledge_documents as document
  set searchable_section_count = rebuilt_count
  where document.id = requested_document_id;

  return rebuilt_count;
end;
$$;

create function public.net_search_gm_document_payload_v1(
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
as $$
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
  where document.id = requested_document_id;
$$;

create function public.preview_net_search_gm_lore_import_v1(
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
as $$
begin
  perform public.assert_net_search_gm_editor();
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
$$;

create function public.fetch_net_search_gm_document_v1(
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
as $$
begin
  perform public.assert_net_search_gm_editor();
  if requested_document_id is null then return; end if;
  return query
  select * from public.net_search_gm_document_payload_v1(requested_document_id);
end;
$$;

create function public.save_net_search_gm_document_v1(
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
as $$
declare
  actor_profile_id uuid := public.assert_net_search_gm_editor();
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
$$;

create function public.delete_net_search_gm_document_v1(
  requested_document_id uuid
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
  if requested_document_id is null then
    raise exception 'NET_SEARCH_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform 1
  from public.net_search_knowledge_documents as document
  where document.id = requested_document_id
  for update;
  if not found then
    raise exception 'NET_SEARCH_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform public.audit_net_search_gm_document_action_v1(
    'net-search.document.delete', requested_document_id
  );
  delete from public.net_search_knowledge_documents as document
  where document.id = requested_document_id;
  get diagnostics deleted_rows = row_count;
  return deleted_rows = 1;
end;
$$;

-- Combined player search. Each lore document contributes only its highest
-- scoring chunk, so one large source cannot flood the result list.
create function public.search_net_knowledge_v2(
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
    where document.visibility = 'public'
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
$$;

create function public.fetch_net_search_home_v2(
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
as $$
declare
  page_limit integer := least(greatest(coalesce(requested_limit, 8), 1), 12);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

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
    where entry.status = 'active'
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
    where document.visibility = 'public'
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
$$;

create function public.fetch_net_search_source_v2(
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
as $$
declare
  normalized_source_kind text := lower(btrim(coalesce(requested_source_kind, '')));
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

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
      and document.visibility = 'public'
      and document.searchable_section_count > 0
      and (document.available_from is null or document.available_from <= statement_timestamp())
      and (document.expires_at is null or document.expires_at > statement_timestamp());
  end if;
end;
$$;

create function public.fetch_net_search_gm_directory_v2(
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
as $$
declare
  normalized_query text := lower(nullif(btrim(requested_query), ''));
  normalized_source_filter text := lower(btrim(coalesce(requested_source_filter, 'all')));
  normalized_visibility text := lower(nullif(btrim(requested_visibility), ''));
  normalized_lifecycle text := lower(btrim(coalesce(requested_lifecycle, 'all')));
  page_limit integer := least(greatest(coalesce(requested_limit, 200), 1), 200);
  search_query tsquery;
begin
  perform public.assert_net_search_gm_editor();

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
    where normalized_source_filter in ('all', 'entries')
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
    where normalized_source_filter in ('all', 'documents')
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
$$;

-- Future local-AI retrieval contract. It returns only allowed excerpts and
-- never generates text. Lore documents remain grouped by source.
create function public.retrieve_net_search_context_v1(
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
as $$
declare
  normalized_query text := lower(btrim(coalesce(requested_query, '')));
  page_limit integer := least(greatest(coalesce(requested_limit, 8), 1), 12);
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
    where entry.status = 'active'
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
    where document.visibility = 'public'
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
$$;

alter table public.net_search_knowledge_documents enable row level security;
alter table public.net_search_knowledge_chunks enable row level security;
alter table public.net_search_knowledge_document_audit enable row level security;

-- No policies are intentional. SECURITY DEFINER RPCs are the only browser API.
revoke all on table public.net_search_knowledge_documents
  from public, anon, authenticated;
revoke all on table public.net_search_knowledge_chunks
  from public, anon, authenticated;
revoke all on table public.net_search_knowledge_document_audit
  from public, anon, authenticated;

revoke all on function public.set_net_search_document_updated_at()
  from public, anon, authenticated;
revoke all on function public.net_search_chunk_lore_document_v1(text, text)
  from public, anon, authenticated;
revoke all on function public.assert_net_search_gm_document_input_v1(
  text, text, text, timestamptz, timestamptz, text
) from public, anon, authenticated;
revoke all on function public.audit_net_search_gm_document_action_v1(text, uuid)
  from public, anon, authenticated;
revoke all on function public.rebuild_net_search_document_chunks_v1(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.net_search_gm_document_payload_v1(uuid)
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

grant execute on function public.preview_net_search_gm_lore_import_v1(text, text)
  to authenticated;
grant execute on function public.fetch_net_search_gm_document_v1(uuid)
  to authenticated;
grant execute on function public.save_net_search_gm_document_v1(
  uuid, text, text, text, timestamptz, timestamptz, text
) to authenticated;
grant execute on function public.delete_net_search_gm_document_v1(uuid)
  to authenticated;
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

commit;
