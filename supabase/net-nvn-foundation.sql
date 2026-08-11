-- NVN 1A: article data, security, and bounded player-reader foundation.
-- Run after the base RPGSILVER schema (profiles and set_updated_at).
--
-- This migration intentionally creates no articles, authors, incidents,
-- metrics, trends, market data, or other fixture content.

begin;

create extension if not exists pgcrypto;

-- Immutable value-only helper used by table CHECK constraints. It is not a
-- client API and is EXECUTE-revoked below.
create or replace function public.net_nvn_text_array_is_bounded(
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
        or btrim(item.value) = ''
        or item.value <> btrim(item.value)
        or char_length(item.value) > requested_max_item_length
    );
$$;

create table if not exists public.net_nvn_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  story_kind text not null
    check (story_kind in ('report', 'investigation', 'opinion')),
  priority text not null default 'standard'
    check (priority in ('standard', 'breaking')),
  category text not null
    check (category in (
      'new-vega',
      'world',
      'business',
      'technology',
      'culture',
      'opinion'
    )),
  headline text not null,
  short_headline text,
  summary text,
  body text not null,
  byline_name text not null,
  byline_role text,
  byline_kind text not null default 'reporter'
    check (byline_kind in ('reporter', 'desk', 'editorial', 'protected')),
  source_status text not null
    check (source_status in (
      'verified',
      'multiple-sources',
      'official-statement',
      'developing',
      'protected-source',
      'unconfirmed'
    )),
  tags text[] not null default '{}'::text[],
  source_labels text[] not null default '{}'::text[],
  district_label text,
  location_label text,
  occurred_at timestamptz,
  pull_quote text,
  pull_quote_attribution text,
  primary_reference_app_id text,
  primary_reference_resource_kind text,
  primary_reference_resource_id text,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  published_at timestamptz,
  archived_at timestamptz,
  constraint net_nvn_articles_slug_shape check (
    char_length(slug) between 1 and 100
    and slug = lower(slug)
    and slug = btrim(slug)
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint net_nvn_articles_headline_shape check (
    btrim(headline) <> '' and char_length(headline) <= 180
  ),
  constraint net_nvn_articles_short_headline_shape check (
    short_headline is null
    or (btrim(short_headline) <> '' and char_length(short_headline) <= 100)
  ),
  constraint net_nvn_articles_summary_shape check (
    summary is null
    or (btrim(summary) <> '' and char_length(summary) <= 400)
  ),
  constraint net_nvn_articles_body_shape check (
    btrim(body) <> '' and char_length(body) <= 12000
  ),
  constraint net_nvn_articles_byline_name_shape check (
    btrim(byline_name) <> '' and char_length(byline_name) <= 100
  ),
  constraint net_nvn_articles_byline_role_shape check (
    byline_role is null
    or (btrim(byline_role) <> '' and char_length(byline_role) <= 100)
  ),
  constraint net_nvn_articles_tags_shape check (
    public.net_nvn_text_array_is_bounded(tags, 12, 40)
  ),
  constraint net_nvn_articles_source_labels_shape check (
    public.net_nvn_text_array_is_bounded(source_labels, 12, 120)
  ),
  constraint net_nvn_articles_district_label_shape check (
    district_label is null
    or (btrim(district_label) <> '' and char_length(district_label) <= 120)
  ),
  constraint net_nvn_articles_location_label_shape check (
    location_label is null
    or (btrim(location_label) <> '' and char_length(location_label) <= 120)
  ),
  constraint net_nvn_articles_pull_quote_shape check (
    num_nonnulls(pull_quote, pull_quote_attribution) in (0, 2)
    and (
      pull_quote is null
      or (
        btrim(pull_quote) <> ''
        and char_length(pull_quote) <= 600
        and btrim(pull_quote_attribution) <> ''
        and char_length(pull_quote_attribution) <= 160
      )
    )
  ),
  constraint net_nvn_articles_reference_shape check (
    num_nonnulls(
      primary_reference_app_id,
      primary_reference_resource_kind,
      primary_reference_resource_id
    ) in (0, 3)
    and (
      primary_reference_app_id is null
      or (
        char_length(primary_reference_app_id) between 1 and 32
        and primary_reference_app_id ~ '^[a-z0-9][a-z0-9-]*$'
        and char_length(primary_reference_resource_kind) between 1 and 40
        and primary_reference_resource_kind ~ '^[a-z0-9][a-z0-9-]*$'
        and char_length(primary_reference_resource_id) between 1 and 160
        and primary_reference_resource_id = btrim(primary_reference_resource_id)
      )
    )
  ),
  constraint net_nvn_articles_lifecycle_shape check (
    (
      status = 'draft'
      and published_at is null
      and archived_at is null
    )
    or (
      status = 'published'
      and published_at is not null
      and archived_at is null
    )
    or (
      status = 'archived'
      and published_at is not null
      and archived_at is not null
      and archived_at >= published_at
    )
  )
);

comment on table public.net_nvn_articles is
  'GM-authored NVN public newsroom articles. Players use bounded lifecycle-filtered RPCs; direct table access is not a product API.';
comment on column public.net_nvn_articles.slug is
  'Validated public navigation label. The immutable article UUID remains resource authority.';
comment on column public.net_nvn_articles.byline_name is
  'Historical presentation snapshot only. It is never writer or authorization authority.';
comment on column public.net_nvn_articles.body is
  'Plain bounded newsroom text. Clients render it as text and never as trusted HTML.';
comment on column public.net_nvn_articles.primary_reference_resource_id is
  'Optional descriptive cross-app/world reference. It never grants access to the referenced resource.';

create index if not exists net_nvn_articles_published_cursor_idx
  on public.net_nvn_articles (published_at desc, id desc)
  where status = 'published';

create index if not exists net_nvn_articles_archived_cursor_idx
  on public.net_nvn_articles (archived_at desc, id desc)
  where status = 'archived';

create index if not exists net_nvn_articles_published_category_cursor_idx
  on public.net_nvn_articles (category, published_at desc, id desc)
  where status = 'published';

drop trigger if exists net_nvn_articles_set_updated_at on public.net_nvn_articles;
create trigger net_nvn_articles_set_updated_at
before update on public.net_nvn_articles
for each row execute procedure public.set_updated_at();

-- One bounded summary reader covers Home/latest, category, published search,
-- and Archive. Search is a small case-insensitive literal substring match over
-- summary metadata; POSITION deliberately has no SQL wildcard semantics.
create or replace function public.fetch_net_nvn_article_page(
  requested_mode text,
  requested_category text default null,
  requested_search_query text default null,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns table (
  id uuid,
  slug text,
  status text,
  headline text,
  short_headline text,
  summary text,
  story_kind text,
  priority text,
  category text,
  byline_name text,
  byline_role text,
  byline_kind text,
  source_status text,
  tags text[],
  district_label text,
  location_label text,
  occurred_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  page_sort_at timestamptz,
  page_has_more boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_mode text := lower(btrim(coalesce(requested_mode, '')));
  normalized_category text := nullif(lower(btrim(requested_category)), '');
  normalized_search text;
  page_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if normalized_mode not in ('home', 'category', 'search', 'archive') then
    raise exception 'NVN_PAGE_MODE_INVALID' using errcode = '22023';
  end if;

  if requested_category is not null
    and (
      normalized_category is null
      or normalized_category not in (
        'new-vega',
        'world',
        'business',
        'technology',
        'culture',
        'opinion'
      )
    )
  then
    raise exception 'NVN_CATEGORY_INVALID' using errcode = '22023';
  end if;

  if normalized_mode = 'category' and normalized_category is null then
    raise exception 'NVN_CATEGORY_REQUIRED' using errcode = '22023';
  end if;

  if normalized_mode = 'home' and normalized_category is not null then
    raise exception 'NVN_CATEGORY_INVALID_FOR_MODE' using errcode = '22023';
  end if;

  if requested_search_query is not null then
    if char_length(requested_search_query) > 80 then
      raise exception 'NVN_SEARCH_QUERY_INVALID' using errcode = '22023';
    end if;
    normalized_search := nullif(lower(btrim(requested_search_query)), '');
    if normalized_search is null or char_length(normalized_search) < 3 then
      raise exception 'NVN_SEARCH_QUERY_INVALID' using errcode = '22023';
    end if;
  end if;

  if normalized_mode = 'search' and normalized_search is null then
    raise exception 'NVN_SEARCH_QUERY_REQUIRED' using errcode = '22023';
  end if;

  if normalized_mode not in ('search', 'archive') and normalized_search is not null then
    raise exception 'NVN_SEARCH_QUERY_INVALID_FOR_MODE' using errcode = '22023';
  end if;

  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'NVN_CURSOR_INVALID' using errcode = '22023';
  end if;

  if normalized_mode = 'archive' then
    return query
    with candidate_rows as materialized (
      select
        article.id,
        article.slug,
        article.status,
        article.headline,
        article.short_headline,
        article.summary,
        article.story_kind,
        article.priority,
        article.category,
        article.byline_name,
        article.byline_role,
        article.byline_kind,
        article.source_status,
        article.tags,
        article.district_label,
        article.location_label,
        article.occurred_at,
        article.published_at,
        article.updated_at,
        article.archived_at,
        article.archived_at as page_sort_at
      from public.net_nvn_articles as article
      where article.status = 'archived'
        and (normalized_category is null or article.category = normalized_category)
        and (
          normalized_search is null
          or position(normalized_search in lower(concat_ws(
            ' ',
            article.headline,
            article.short_headline,
            article.summary,
            article.byline_name,
            article.byline_role,
            article.category,
            article.district_label,
            article.location_label,
            array_to_string(article.tags, ' ')
          ))) > 0
        )
        and (
          requested_cursor_at is null
          or (article.archived_at, article.id) < (requested_cursor_at, requested_cursor_id)
        )
      order by article.archived_at desc, article.id desc
      limit page_limit + 1
    ),
    numbered_rows as (
      select
        candidate.*,
        row_number() over (order by candidate.page_sort_at desc, candidate.id desc) as page_row,
        count(*) over () > page_limit as has_more
      from candidate_rows as candidate
    )
    select
      candidate.id,
      candidate.slug,
      candidate.status,
      candidate.headline,
      candidate.short_headline,
      candidate.summary,
      candidate.story_kind,
      candidate.priority,
      candidate.category,
      candidate.byline_name,
      candidate.byline_role,
      candidate.byline_kind,
      candidate.source_status,
      candidate.tags,
      candidate.district_label,
      candidate.location_label,
      candidate.occurred_at,
      candidate.published_at,
      candidate.updated_at,
      candidate.archived_at,
      candidate.page_sort_at,
      candidate.has_more
    from numbered_rows as candidate
    where candidate.page_row <= page_limit
    order by candidate.page_sort_at desc, candidate.id desc;
    return;
  end if;

  return query
  with candidate_rows as materialized (
    select
      article.id,
      article.slug,
      article.status,
      article.headline,
      article.short_headline,
      article.summary,
      article.story_kind,
      article.priority,
      article.category,
      article.byline_name,
      article.byline_role,
      article.byline_kind,
      article.source_status,
      article.tags,
      article.district_label,
      article.location_label,
      article.occurred_at,
      article.published_at,
      article.updated_at,
      article.archived_at,
      article.published_at as page_sort_at
    from public.net_nvn_articles as article
    where article.status = 'published'
      and (
        normalized_mode not in ('category', 'search')
        or normalized_category is null
        or article.category = normalized_category
      )
      and (
        normalized_search is null
        or position(normalized_search in lower(concat_ws(
          ' ',
          article.headline,
          article.short_headline,
          article.summary,
          article.byline_name,
          article.byline_role,
          article.category,
          article.district_label,
          article.location_label,
          array_to_string(article.tags, ' ')
        ))) > 0
      )
      and (
        requested_cursor_at is null
        or (article.published_at, article.id) < (requested_cursor_at, requested_cursor_id)
      )
    order by article.published_at desc, article.id desc
    limit page_limit + 1
  ),
  numbered_rows as (
    select
      candidate.*,
      row_number() over (order by candidate.page_sort_at desc, candidate.id desc) as page_row,
      count(*) over () > page_limit as has_more
    from candidate_rows as candidate
  )
  select
    candidate.id,
    candidate.slug,
    candidate.status,
    candidate.headline,
    candidate.short_headline,
    candidate.summary,
    candidate.story_kind,
    candidate.priority,
    candidate.category,
    candidate.byline_name,
    candidate.byline_role,
    candidate.byline_kind,
    candidate.source_status,
    candidate.tags,
    candidate.district_label,
    candidate.location_label,
    candidate.occurred_at,
    candidate.published_at,
    candidate.updated_at,
    candidate.archived_at,
    candidate.page_sort_at,
    candidate.has_more
  from numbered_rows as candidate
  where candidate.page_row <= page_limit
  order by candidate.page_sort_at desc, candidate.id desc;
end;
$$;

-- Exact lazy body read. Draft and nonexistent UUIDs both return zero rows.
create or replace function public.fetch_net_nvn_article(
  requested_article_id uuid
)
returns table (
  id uuid,
  slug text,
  status text,
  headline text,
  short_headline text,
  summary text,
  body text,
  story_kind text,
  priority text,
  category text,
  byline_name text,
  byline_role text,
  byline_kind text,
  source_status text,
  tags text[],
  source_labels text[],
  district_label text,
  location_label text,
  occurred_at timestamptz,
  pull_quote text,
  pull_quote_attribution text,
  primary_reference_app_id text,
  primary_reference_resource_kind text,
  primary_reference_resource_id text,
  published_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
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

  if requested_article_id is null then
    return;
  end if;

  return query
  select
    article.id,
    article.slug,
    article.status,
    article.headline,
    article.short_headline,
    article.summary,
    article.body,
    article.story_kind,
    article.priority,
    article.category,
    article.byline_name,
    article.byline_role,
    article.byline_kind,
    article.source_status,
    article.tags,
    article.source_labels,
    article.district_label,
    article.location_label,
    article.occurred_at,
    article.pull_quote,
    article.pull_quote_attribution,
    article.primary_reference_app_id,
    article.primary_reference_resource_kind,
    article.primary_reference_resource_id,
    article.published_at,
    article.updated_at,
    article.archived_at
  from public.net_nvn_articles as article
  where article.id = requested_article_id
    and article.status in ('published', 'archived');
end;
$$;

alter table public.net_nvn_articles enable row level security;

-- No policies are intentional. All player reads and future GM mutations use
-- narrow SECURITY DEFINER RPCs rather than PostgREST table access.
revoke all on table public.net_nvn_articles from public, anon, authenticated;

revoke all on function public.net_nvn_text_array_is_bounded(text[], integer, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_article_page(
  text, text, text, timestamptz, uuid, integer
) from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_article(uuid)
  from public, anon, authenticated;

grant execute on function public.fetch_net_nvn_article_page(
  text, text, text, timestamptz, uuid, integer
) to authenticated;
grant execute on function public.fetch_net_nvn_article(uuid)
  to authenticated;

commit;
