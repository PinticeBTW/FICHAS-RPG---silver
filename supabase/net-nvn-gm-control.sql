-- NVN 1C: authoritative GM newsroom control for articles.
-- Run after net-nvn-foundation.sql and net-pulse-content.sql (audit ledger).
-- This migration creates no articles and does not change player reader visibility.

begin;

create index if not exists net_nvn_articles_gm_directory_idx
  on public.net_nvn_articles (status, updated_at desc, id desc);

create or replace function public.assert_net_nvn_gm_editor()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
begin
  if actor_profile_id is null or not public.is_current_user_gm() then
    raise exception 'Only the authoritative GM may control the NVN newsroom.'
      using errcode = '42501';
  end if;
  return actor_profile_id;
end;
$$;

create or replace function public.assert_net_nvn_gm_article_input(
  requested_slug text,
  requested_story_kind text,
  requested_priority text,
  requested_category text,
  requested_headline text,
  requested_short_headline text,
  requested_summary text,
  requested_body text,
  requested_byline_name text,
  requested_byline_role text,
  requested_byline_kind text,
  requested_source_status text,
  requested_tags text[],
  requested_source_labels text[],
  requested_district_label text,
  requested_location_label text,
  requested_pull_quote text,
  requested_pull_quote_attribution text,
  requested_reference_app_id text,
  requested_reference_resource_kind text,
  requested_reference_resource_id text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_slug text := lower(btrim(coalesce(requested_slug, '')));
  normalized_short_headline text := nullif(btrim(requested_short_headline), '');
  normalized_summary text := nullif(btrim(requested_summary), '');
  normalized_byline_role text := nullif(btrim(requested_byline_role), '');
  normalized_district_label text := nullif(btrim(requested_district_label), '');
  normalized_location_label text := nullif(btrim(requested_location_label), '');
  normalized_pull_quote text := nullif(btrim(requested_pull_quote), '');
  normalized_pull_quote_attribution text := nullif(btrim(requested_pull_quote_attribution), '');
  normalized_reference_app_id text := lower(nullif(btrim(requested_reference_app_id), ''));
  normalized_reference_resource_kind text := lower(nullif(btrim(requested_reference_resource_kind), ''));
  normalized_reference_resource_id text := nullif(btrim(requested_reference_resource_id), '');
begin
  if octet_length(coalesce(requested_slug, '')) > 512
    or char_length(normalized_slug) not between 1 and 100
    or normalized_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  then
    raise exception 'NVN_SLUG_INVALID' using errcode = '22023';
  end if;

  if lower(btrim(coalesce(requested_story_kind, ''))) not in (
    'report', 'investigation', 'opinion'
  ) then
    raise exception 'NVN_STORY_KIND_INVALID' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(requested_priority, ''))) not in ('standard', 'breaking') then
    raise exception 'NVN_PRIORITY_INVALID' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(requested_category, ''))) not in (
    'new-vega', 'world', 'business', 'technology', 'culture', 'opinion'
  ) then
    raise exception 'NVN_CATEGORY_INVALID' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(requested_byline_kind, ''))) not in (
    'reporter', 'desk', 'editorial', 'protected'
  ) then
    raise exception 'NVN_BYLINE_KIND_INVALID' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(requested_source_status, ''))) not in (
    'verified', 'multiple-sources', 'official-statement', 'developing',
    'protected-source', 'unconfirmed'
  ) then
    raise exception 'NVN_SOURCE_STATUS_INVALID' using errcode = '22023';
  end if;

  if octet_length(coalesce(requested_headline, '')) > 720
    or char_length(btrim(coalesce(requested_headline, ''))) not between 1 and 180
  then
    raise exception 'NVN_HEADLINE_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_short_headline, '')) > 400
    or (normalized_short_headline is not null and char_length(normalized_short_headline) > 100)
  then
    raise exception 'NVN_SHORT_HEADLINE_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_summary, '')) > 1600
    or (normalized_summary is not null and char_length(normalized_summary) > 400)
  then
    raise exception 'NVN_SUMMARY_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_body, '')) > 48000
    or char_length(btrim(coalesce(requested_body, ''))) not between 1 and 12000
  then
    raise exception 'NVN_BODY_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_byline_name, '')) > 400
    or char_length(btrim(coalesce(requested_byline_name, ''))) not between 1 and 100
  then
    raise exception 'NVN_BYLINE_NAME_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_byline_role, '')) > 400
    or (normalized_byline_role is not null and char_length(normalized_byline_role) > 100)
  then
    raise exception 'NVN_BYLINE_ROLE_INVALID' using errcode = '22023';
  end if;

  if cardinality(coalesce(requested_tags, '{}'::text[])) > 12 then
    raise exception 'NVN_TAGS_INVALID' using errcode = '22023';
  end if;
  if exists (
      select 1
      from unnest(coalesce(requested_tags, '{}'::text[])) as tag(value)
      where tag.value is null
        or octet_length(tag.value) > 160
        or char_length(btrim(tag.value)) not between 1 and 40
    ) then
    raise exception 'NVN_TAGS_INVALID' using errcode = '22023';
  end if;
  if cardinality(coalesce(requested_source_labels, '{}'::text[])) > 12 then
    raise exception 'NVN_SOURCE_LABELS_INVALID' using errcode = '22023';
  end if;
  if exists (
      select 1
      from unnest(coalesce(requested_source_labels, '{}'::text[])) as source_label(value)
      where source_label.value is null
        or octet_length(source_label.value) > 480
        or char_length(btrim(source_label.value)) not between 1 and 120
    ) then
    raise exception 'NVN_SOURCE_LABELS_INVALID' using errcode = '22023';
  end if;

  if octet_length(coalesce(requested_district_label, '')) > 480
    or (normalized_district_label is not null and char_length(normalized_district_label) > 120)
  then
    raise exception 'NVN_DISTRICT_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_location_label, '')) > 480
    or (normalized_location_label is not null and char_length(normalized_location_label) > 120)
  then
    raise exception 'NVN_LOCATION_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_pull_quote, '')) > 2400
    or (normalized_pull_quote is not null and char_length(normalized_pull_quote) > 600)
    or octet_length(coalesce(requested_pull_quote_attribution, '')) > 640
    or (
      normalized_pull_quote_attribution is not null
      and char_length(normalized_pull_quote_attribution) > 160
    )
    or num_nonnulls(normalized_pull_quote, normalized_pull_quote_attribution) not in (0, 2)
  then
    raise exception 'NVN_PULL_QUOTE_INVALID' using errcode = '22023';
  end if;

  if octet_length(coalesce(requested_reference_app_id, '')) > 128
    or octet_length(coalesce(requested_reference_resource_kind, '')) > 160
    or octet_length(coalesce(requested_reference_resource_id, '')) > 640
    or num_nonnulls(
      normalized_reference_app_id,
      normalized_reference_resource_kind,
      normalized_reference_resource_id
    ) not in (0, 3)
    or (
      normalized_reference_app_id is not null
      and (
        char_length(normalized_reference_app_id) not between 1 and 32
        or normalized_reference_app_id !~ '^[a-z0-9][a-z0-9-]*$'
        or char_length(normalized_reference_resource_kind) not between 1 and 40
        or normalized_reference_resource_kind !~ '^[a-z0-9][a-z0-9-]*$'
        or char_length(normalized_reference_resource_id) not between 1 and 160
      )
    )
  then
    raise exception 'NVN_REFERENCE_INVALID' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.net_nvn_gm_article_payload(
  requested_article_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', article.id,
    'slug', article.slug,
    'status', article.status,
    'story_kind', article.story_kind,
    'priority', article.priority,
    'category', article.category,
    'headline', article.headline,
    'short_headline', article.short_headline,
    'summary', article.summary,
    'body', article.body,
    'byline_name', article.byline_name,
    'byline_role', article.byline_role,
    'byline_kind', article.byline_kind,
    'source_status', article.source_status,
    'tags', to_jsonb(article.tags),
    'source_labels', to_jsonb(article.source_labels),
    'district_label', article.district_label,
    'location_label', article.location_label,
    'occurred_at', article.occurred_at,
    'pull_quote', article.pull_quote,
    'pull_quote_attribution', article.pull_quote_attribution,
    'primary_reference_app_id', article.primary_reference_app_id,
    'primary_reference_resource_kind', article.primary_reference_resource_kind,
    'primary_reference_resource_id', article.primary_reference_resource_id,
    'created_at', article.created_at,
    'updated_at', article.updated_at,
    'published_at', article.published_at,
    'archived_at', article.archived_at
  )
  from public.net_nvn_articles as article
  where article.id = requested_article_id;
$$;

create or replace function public.audit_net_nvn_gm_action(
  requested_action_type text,
  requested_article_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid;
begin
  actor_profile_id := public.assert_net_nvn_gm_editor();
  if requested_action_type is null or btrim(requested_action_type) = ''
    or requested_article_id is null
  then
    raise exception 'NVN audit context is invalid.' using errcode = '22023';
  end if;

  insert into public.net_action_audit (
    authenticated_actor_profile_id,
    presented_account_id,
    persona_subject_kind,
    persona_subject_id,
    action_mode,
    action_type,
    authorization_basis,
    resource_type,
    resource_id
  ) values (
    actor_profile_id,
    null,
    null,
    null,
    'system',
    requested_action_type,
    'authoritative-gm-editor',
    'nvn-article',
    requested_article_id
  );
end;
$$;

create or replace function public.fetch_net_nvn_gm_article_directory(
  requested_status text default null,
  requested_limit integer default 200
)
returns table (
  id uuid,
  slug text,
  status text,
  story_kind text,
  priority text,
  category text,
  headline text,
  short_headline text,
  byline_name text,
  source_status text,
  updated_at timestamptz,
  published_at timestamptz,
  archived_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_status text := lower(btrim(coalesce(requested_status, 'all')));
  bounded_limit integer := least(greatest(coalesce(requested_limit, 200), 1), 200);
begin
  perform public.assert_net_nvn_gm_editor();
  if normalized_status not in ('all', 'draft', 'published', 'archived') then
    raise exception 'NVN_DIRECTORY_STATUS_INVALID' using errcode = '22023';
  end if;

  return query
  select
    article.id,
    article.slug,
    article.status,
    article.story_kind,
    article.priority,
    article.category,
    article.headline,
    article.short_headline,
    article.byline_name,
    article.source_status,
    article.updated_at,
    article.published_at,
    article.archived_at
  from public.net_nvn_articles as article
  where normalized_status = 'all' or article.status = normalized_status
  order by article.updated_at desc, article.id desc
  limit bounded_limit;
end;
$$;

create or replace function public.fetch_net_nvn_gm_article(
  requested_article_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  payload jsonb;
begin
  perform public.assert_net_nvn_gm_editor();
  if requested_article_id is null then
    raise exception 'NVN_ARTICLE_NOT_FOUND' using errcode = 'P0002';
  end if;
  payload := public.net_nvn_gm_article_payload(requested_article_id);
  if payload is null then
    raise exception 'NVN_ARTICLE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return payload;
end;
$$;

create or replace function public.create_net_nvn_gm_article(
  requested_slug text,
  requested_story_kind text,
  requested_priority text,
  requested_category text,
  requested_headline text,
  requested_short_headline text,
  requested_summary text,
  requested_body text,
  requested_byline_name text,
  requested_byline_role text,
  requested_byline_kind text,
  requested_source_status text,
  requested_tags text[],
  requested_source_labels text[],
  requested_district_label text,
  requested_location_label text,
  requested_occurred_at timestamptz,
  requested_pull_quote text,
  requested_pull_quote_attribution text,
  requested_reference_app_id text,
  requested_reference_resource_kind text,
  requested_reference_resource_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid;
  saved_article_id uuid;
  normalized_tags text[];
  normalized_source_labels text[];
begin
  actor_profile_id := public.assert_net_nvn_gm_editor();
  perform public.assert_net_nvn_gm_article_input(
    requested_slug, requested_story_kind, requested_priority,
    requested_category, requested_headline, requested_short_headline,
    requested_summary, requested_body, requested_byline_name,
    requested_byline_role, requested_byline_kind, requested_source_status,
    requested_tags, requested_source_labels, requested_district_label,
    requested_location_label, requested_pull_quote,
    requested_pull_quote_attribution, requested_reference_app_id,
    requested_reference_resource_kind, requested_reference_resource_id
  );

  select coalesce(array_agg(value order by first_position), '{}'::text[])
  into normalized_tags
  from (
    select lower(btrim(tag.value)) as value, min(tag.position) as first_position
    from unnest(coalesce(requested_tags, '{}'::text[])) with ordinality as tag(value, position)
    group by lower(btrim(tag.value))
  ) as normalized;

  select coalesce(array_agg(value order by first_position), '{}'::text[])
  into normalized_source_labels
  from (
    select btrim(source_label.value) as value, min(source_label.position) as first_position
    from unnest(coalesce(requested_source_labels, '{}'::text[]))
      with ordinality as source_label(value, position)
    group by btrim(source_label.value)
  ) as normalized;

  begin
    insert into public.net_nvn_articles (
      slug, status, story_kind, priority, category, headline,
      short_headline, summary, body, byline_name, byline_role,
      byline_kind, source_status, tags, source_labels, district_label,
      location_label, occurred_at, pull_quote, pull_quote_attribution,
      primary_reference_app_id, primary_reference_resource_kind,
      primary_reference_resource_id, created_by_profile_id,
      published_at, archived_at
    ) values (
      lower(btrim(requested_slug)), 'draft',
      lower(btrim(requested_story_kind)), lower(btrim(requested_priority)),
      lower(btrim(requested_category)), btrim(requested_headline),
      nullif(btrim(requested_short_headline), ''),
      nullif(btrim(requested_summary), ''), btrim(requested_body),
      btrim(requested_byline_name), nullif(btrim(requested_byline_role), ''),
      lower(btrim(requested_byline_kind)), lower(btrim(requested_source_status)),
      normalized_tags, normalized_source_labels,
      nullif(btrim(requested_district_label), ''),
      nullif(btrim(requested_location_label), ''), requested_occurred_at,
      nullif(btrim(requested_pull_quote), ''),
      nullif(btrim(requested_pull_quote_attribution), ''),
      lower(nullif(btrim(requested_reference_app_id), '')),
      lower(nullif(btrim(requested_reference_resource_kind), '')),
      nullif(btrim(requested_reference_resource_id), ''),
      actor_profile_id, null, null
    )
    returning id into saved_article_id;
  exception
    when unique_violation then
      raise exception 'NVN_SLUG_TAKEN' using errcode = 'P0001';
  end;

  perform public.audit_net_nvn_gm_action('nvn.article.create', saved_article_id);
  return public.net_nvn_gm_article_payload(saved_article_id);
end;
$$;

create or replace function public.update_net_nvn_gm_article(
  requested_article_id uuid,
  requested_slug text,
  requested_story_kind text,
  requested_priority text,
  requested_category text,
  requested_headline text,
  requested_short_headline text,
  requested_summary text,
  requested_body text,
  requested_byline_name text,
  requested_byline_role text,
  requested_byline_kind text,
  requested_source_status text,
  requested_tags text[],
  requested_source_labels text[],
  requested_district_label text,
  requested_location_label text,
  requested_occurred_at timestamptz,
  requested_pull_quote text,
  requested_pull_quote_attribution text,
  requested_reference_app_id text,
  requested_reference_resource_kind text,
  requested_reference_resource_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  current_article public.net_nvn_articles%rowtype;
  saved_article_id uuid := requested_article_id;
  normalized_tags text[];
  normalized_source_labels text[];
  changed_rows integer := 0;
begin
  perform public.assert_net_nvn_gm_editor();
  if requested_article_id is null then
    raise exception 'NVN_ARTICLE_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_net_nvn_gm_article_input(
    requested_slug, requested_story_kind, requested_priority,
    requested_category, requested_headline, requested_short_headline,
    requested_summary, requested_body, requested_byline_name,
    requested_byline_role, requested_byline_kind, requested_source_status,
    requested_tags, requested_source_labels, requested_district_label,
    requested_location_label, requested_pull_quote,
    requested_pull_quote_attribution, requested_reference_app_id,
    requested_reference_resource_kind, requested_reference_resource_id
  );

  select article.* into current_article
  from public.net_nvn_articles as article
  where article.id = requested_article_id
  for update;
  if not found then
    raise exception 'NVN_ARTICLE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(value order by first_position), '{}'::text[])
  into normalized_tags
  from (
    select lower(btrim(tag.value)) as value, min(tag.position) as first_position
    from unnest(coalesce(requested_tags, '{}'::text[])) with ordinality as tag(value, position)
    group by lower(btrim(tag.value))
  ) as normalized;

  select coalesce(array_agg(value order by first_position), '{}'::text[])
  into normalized_source_labels
  from (
    select btrim(source_label.value) as value, min(source_label.position) as first_position
    from unnest(coalesce(requested_source_labels, '{}'::text[]))
      with ordinality as source_label(value, position)
    group by btrim(source_label.value)
  ) as normalized;

  begin
    update public.net_nvn_articles as article
    set
      slug = lower(btrim(requested_slug)),
      story_kind = lower(btrim(requested_story_kind)),
      priority = lower(btrim(requested_priority)),
      category = lower(btrim(requested_category)),
      headline = btrim(requested_headline),
      short_headline = nullif(btrim(requested_short_headline), ''),
      summary = nullif(btrim(requested_summary), ''),
      body = btrim(requested_body),
      byline_name = btrim(requested_byline_name),
      byline_role = nullif(btrim(requested_byline_role), ''),
      byline_kind = lower(btrim(requested_byline_kind)),
      source_status = lower(btrim(requested_source_status)),
      tags = normalized_tags,
      source_labels = normalized_source_labels,
      district_label = nullif(btrim(requested_district_label), ''),
      location_label = nullif(btrim(requested_location_label), ''),
      occurred_at = requested_occurred_at,
      pull_quote = nullif(btrim(requested_pull_quote), ''),
      pull_quote_attribution = nullif(btrim(requested_pull_quote_attribution), ''),
      primary_reference_app_id = lower(nullif(btrim(requested_reference_app_id), '')),
      primary_reference_resource_kind = lower(nullif(btrim(requested_reference_resource_kind), '')),
      primary_reference_resource_id = nullif(btrim(requested_reference_resource_id), '')
    where article.id = requested_article_id
      and row(
        article.slug, article.story_kind, article.priority, article.category,
        article.headline, article.short_headline, article.summary, article.body,
        article.byline_name, article.byline_role, article.byline_kind,
        article.source_status, article.tags, article.source_labels,
        article.district_label, article.location_label, article.occurred_at,
        article.pull_quote, article.pull_quote_attribution,
        article.primary_reference_app_id,
        article.primary_reference_resource_kind,
        article.primary_reference_resource_id
      ) is distinct from row(
        lower(btrim(requested_slug)), lower(btrim(requested_story_kind)),
        lower(btrim(requested_priority)), lower(btrim(requested_category)),
        btrim(requested_headline), nullif(btrim(requested_short_headline), ''),
        nullif(btrim(requested_summary), ''), btrim(requested_body),
        btrim(requested_byline_name), nullif(btrim(requested_byline_role), ''),
        lower(btrim(requested_byline_kind)), lower(btrim(requested_source_status)),
        normalized_tags, normalized_source_labels,
        nullif(btrim(requested_district_label), ''),
        nullif(btrim(requested_location_label), ''), requested_occurred_at,
        nullif(btrim(requested_pull_quote), ''),
        nullif(btrim(requested_pull_quote_attribution), ''),
        lower(nullif(btrim(requested_reference_app_id), '')),
        lower(nullif(btrim(requested_reference_resource_kind), '')),
        nullif(btrim(requested_reference_resource_id), '')
      )
    returning article.id into saved_article_id;
    get diagnostics changed_rows = row_count;
  exception
    when unique_violation then
      raise exception 'NVN_SLUG_TAKEN' using errcode = 'P0001';
  end;

  if changed_rows > 0 then
    perform public.audit_net_nvn_gm_action('nvn.article.update', saved_article_id);
  end if;
  return public.net_nvn_gm_article_payload(saved_article_id);
end;
$$;

create or replace function public.set_net_nvn_gm_article_lifecycle(
  requested_article_id uuid,
  requested_action text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  current_article public.net_nvn_articles%rowtype;
  normalized_action text := lower(btrim(coalesce(requested_action, '')));
begin
  perform public.assert_net_nvn_gm_editor();
  if requested_article_id is null then
    raise exception 'NVN_ARTICLE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if normalized_action not in ('publish', 'hide', 'archive', 'restore') then
    raise exception 'NVN_LIFECYCLE_INVALID' using errcode = 'P0001';
  end if;

  select article.* into current_article
  from public.net_nvn_articles as article
  where article.id = requested_article_id
  for update;
  if not found then
    raise exception 'NVN_ARTICLE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if (normalized_action = 'publish' and current_article.status <> 'draft')
    or (normalized_action = 'hide' and current_article.status <> 'published')
    or (normalized_action = 'archive' and current_article.status <> 'published')
    or (normalized_action = 'restore' and current_article.status <> 'archived')
  then
    raise exception 'NVN_LIFECYCLE_INVALID' using errcode = 'P0001';
  end if;

  update public.net_nvn_articles as article
  set
    status = case normalized_action
      when 'publish' then 'published'
      when 'hide' then 'draft'
      when 'archive' then 'archived'
      when 'restore' then 'published'
    end,
    published_at = case normalized_action
      when 'publish' then timezone('utc', now())
      when 'hide' then null
      else article.published_at
    end,
    archived_at = case normalized_action
      when 'archive' then timezone('utc', now())
      else null
    end
  where article.id = requested_article_id;

  perform public.audit_net_nvn_gm_action(
    case normalized_action
      when 'publish' then 'nvn.article.publish'
      when 'hide' then 'nvn.article.hide'
      when 'archive' then 'nvn.article.archive'
      when 'restore' then 'nvn.article.restore'
    end,
    requested_article_id
  );
  return public.net_nvn_gm_article_payload(requested_article_id);
end;
$$;

alter table public.net_nvn_articles enable row level security;
revoke all on table public.net_nvn_articles from public, anon, authenticated;

revoke all on function public.assert_net_nvn_gm_editor()
  from public, anon, authenticated;
revoke all on function public.assert_net_nvn_gm_article_input(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text[], text[], text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.net_nvn_gm_article_payload(uuid)
  from public, anon, authenticated;
revoke all on function public.audit_net_nvn_gm_action(text, uuid)
  from public, anon, authenticated;

revoke all on function public.fetch_net_nvn_gm_article_directory(text, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_gm_article(uuid)
  from public, anon, authenticated;
revoke all on function public.create_net_nvn_gm_article(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text[], text[], text, text, timestamptz, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.update_net_nvn_gm_article(
  uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, text[], text[], text, text, timestamptz, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.set_net_nvn_gm_article_lifecycle(uuid, text)
  from public, anon, authenticated;

grant execute on function public.fetch_net_nvn_gm_article_directory(text, integer)
  to authenticated;
grant execute on function public.fetch_net_nvn_gm_article(uuid)
  to authenticated;
grant execute on function public.create_net_nvn_gm_article(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text[], text[], text, text, timestamptz, text, text, text, text, text
) to authenticated;
grant execute on function public.update_net_nvn_gm_article(
  uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, text[], text[], text, text, timestamptz, text, text, text, text, text
) to authenticated;
grant execute on function public.set_net_nvn_gm_article_lifecycle(uuid, text)
  to authenticated;

commit;
