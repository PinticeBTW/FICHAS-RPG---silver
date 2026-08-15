-- ALTARA NEWS platform parity: bounded search/archive and restore lifecycle.
-- Forward-only. Run after net-altara-news-v2-media.sql.

begin;

do $$
begin
  if to_regclass('public.net_altara_news_articles') is null
    or to_regclass('public.net_altara_news_article_media') is null
    or to_regclass('public.net_altara_news_incidents') is null
    or to_regclass('public.net_altara_news_saved_articles') is null
    or to_regprocedure('public.net_altara_news_effective_player_identity(uuid)') is null
    or to_regprocedure('public.net_altara_news_identity_local_label(uuid)') is null
    or to_regprocedure('public.net_altara_news_article_summary(uuid,uuid)') is null
    or to_regprocedure('public.net_altara_news_article_media_payload(uuid)') is null
    or to_regprocedure('public.net_altara_news_article_media_ref_contains_object(text,uuid,text)') is null
    or to_regprocedure('auth.uid()') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.current_user_can_read_net_altara_news_revision()') is null
    or to_regprocedure('public.current_user_can_read_net_altara_news_media_object(text)') is null
    or to_regprocedure('public.net_altara_news_gm_article_payload(uuid)') is null
    or to_regprocedure('public.net_altara_news_gm_incident_payload(uuid)') is null
    or to_regprocedure('public.assert_net_altara_news_gm_editor()') is null
    or to_regprocedure('public.audit_net_altara_news_gm_action(text,text,uuid)') is null
  then
    raise exception 'ALTARA_NEWS_PLATFORM_PARITY_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;
end;
$$;

-- Keep the existing single Storage SELECT policy and exact descriptor parser.
-- Reader media visibility must match the article-record lifecycle contract:
-- published, or archived after a real publication. Drafts and unpublished
-- records remain private because unpublish clears published_at.
create or replace function public.current_user_can_read_net_altara_news_media_object(
  requested_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and requested_object_name is not null
    and char_length(requested_object_name) between 1 and 1024
    and requested_object_name not like '%..%'
    and split_part(requested_object_name, '/', 1) = 'altara-news-article'
    and split_part(requested_object_name, '/', 2)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and split_part(requested_object_name, '/', 3) = 'general'
    and split_part(requested_object_name, '/', 6) <> ''
    and split_part(requested_object_name, '/', 7) = ''
    and (
      public.is_current_user_gm()
      or (
        public.current_user_can_read_net_altara_news_revision()
        and exists (
          select 1
          from public.net_altara_news_articles as article
          join public.net_altara_news_article_media as media_record
            on media_record.article_id = article.id
          where article.id::text = split_part(requested_object_name, '/', 2)
            and (
              article.status = 'published'
              or (
                article.status = 'archived'
                and article.published_at is not null
              )
            )
            and public.net_altara_news_article_media_ref_contains_object(
              media_record.media_ref,
              article.id,
              requested_object_name
            )
        )
      )
    );
$$;

create or replace function public.set_net_altara_news_gm_incident_lifecycle(
  requested_incident_id uuid,
  requested_action text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text := lower(btrim(coalesce(requested_action, '')));
  v_incident public.net_altara_news_incidents%rowtype;
begin
  perform public.assert_net_altara_news_gm_editor();
  if v_action = 'start' then
    update public.net_altara_news_incidents set
      status = 'live', started_at = timezone('utc', now())
    where id = requested_incident_id and status = 'draft'
    returning * into v_incident;
  elsif v_action = 'close' then
    update public.net_altara_news_incidents set
      status = 'closed', closed_at = timezone('utc', now())
    where id = requested_incident_id and status = 'live'
    returning * into v_incident;
  elsif v_action = 'archive' then
    update public.net_altara_news_incidents set
      status = 'archived', archived_at = timezone('utc', now())
    where id = requested_incident_id and status = 'closed'
    returning * into v_incident;
  elsif v_action = 'restore' then
    update public.net_altara_news_incidents set
      status = 'closed', archived_at = null
    where id = requested_incident_id and status = 'archived'
    returning * into v_incident;
  else
    raise exception 'ALTARA_NEWS_INCIDENT_ACTION_INVALID' using errcode = '22023';
  end if;
  if not found then
    raise exception 'ALTARA_NEWS_INCIDENT_LIFECYCLE_INVALID' using errcode = 'P0001';
  end if;
  perform public.audit_net_altara_news_gm_action(
    'altara-news.incident.' || v_action, 'altara-news-incident', v_incident.id
  );
  return public.net_altara_news_gm_incident_payload(v_incident.id);
end;
$$;

create index net_altara_news_articles_archive_cursor_idx
  on public.net_altara_news_articles (archived_at desc, id desc)
  where status = 'archived';

create or replace function public.fetch_net_altara_news_article_page(
  requested_expected_identity_link_id uuid,
  requested_mode text,
  requested_search_query text default null,
  requested_section text default null,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_mode text := lower(btrim(coalesce(requested_mode, '')));
  v_query text := nullif(lower(btrim(requested_search_query)), '');
  v_section text := nullif(lower(btrim(requested_section)), '');
  v_local_label text;
  v_local_available boolean;
  v_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40);
  v_result jsonb;
begin
  v_identity_link_id := public.net_altara_news_effective_player_identity(
    requested_expected_identity_link_id
  );

  if v_mode not in (
    'home', 'local', 'world', 'business', 'technology', 'culture',
    'saved', 'search', 'archive'
  ) then
    raise exception 'ALTARA_NEWS_FEED_MODE_INVALID' using errcode = '22023';
  end if;
  if v_section is not null and v_section not in ('world', 'business', 'technology', 'culture') then
    raise exception 'ALTARA_NEWS_SECTION_INVALID' using errcode = '22023';
  end if;
  if v_query is not null and char_length(v_query) not between 3 and 80 then
    raise exception 'ALTARA_NEWS_SEARCH_QUERY_INVALID' using errcode = '22023';
  end if;
  if v_mode = 'search' and v_query is null then
    raise exception 'ALTARA_NEWS_SEARCH_QUERY_REQUIRED' using errcode = '22023';
  end if;
  if v_mode not in ('search', 'archive') and (v_query is not null or v_section is not null) then
    raise exception 'ALTARA_NEWS_FILTER_INVALID' using errcode = '22023';
  end if;
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'ALTARA_NEWS_CURSOR_INVALID' using errcode = '22023';
  end if;

  -- Presentation only. Location never participates in authorization or feed visibility.
  v_local_label := public.net_altara_news_identity_local_label(v_identity_link_id);
  select exists (
    select 1 from public.net_altara_news_articles as article
    where article.status = 'published' and article.coverage_scope = 'local'
  ) into v_local_available;

  with candidate as materialized (
    select
      article.id,
      case when v_mode = 'archive' then article.archived_at else article.published_at end as page_sort_at
    from public.net_altara_news_articles as article
    where article.status = case when v_mode = 'archive' then 'archived' else 'published' end
      and (v_mode <> 'archive' or article.published_at is not null)
      and (
        v_mode in ('home', 'search', 'archive')
        or (v_mode = 'local' and article.coverage_scope = 'local')
        or (v_mode = 'world' and article.coverage_scope = 'world')
        or (v_mode = 'business' and article.section = 'business')
        or (v_mode = 'technology' and article.section = 'technology')
        or (v_mode = 'culture' and article.section = 'culture')
        or (v_mode = 'saved' and exists (
          select 1 from public.net_altara_news_saved_articles as saved
          where saved.identity_link_id = v_identity_link_id and saved.article_id = article.id
        ))
      )
      and (v_section is null or article.section = v_section)
      and (
        v_query is null
        or position(v_query in lower(concat_ws(
          ' ', article.headline, article.deck, article.body, article.author_label,
          article.source_label, article.location_label
        ))) > 0
      )
      and (
        requested_cursor_at is null
        or (
          case when v_mode = 'archive' then article.archived_at else article.published_at end,
          article.id
        ) < (requested_cursor_at, requested_cursor_id)
      )
    order by page_sort_at desc, article.id desc
    limit v_limit + 1
  ), page as (
    select candidate.* from candidate
    order by candidate.page_sort_at desc, candidate.id desc
    limit v_limit
  )
  select jsonb_build_object(
    'identity_link_id', v_identity_link_id,
    'mode', v_mode,
    'local_label', v_local_label,
    'local_available', v_local_available,
    'articles', coalesce((
      select jsonb_agg(
        public.net_altara_news_article_summary(page.id, v_identity_link_id)
        || jsonb_build_object(
          'status', article.status,
          'archived_at', article.archived_at
        )
        order by page.page_sort_at desc, page.id desc
      )
      from page
      join public.net_altara_news_articles as article on article.id = page.id
    ), '[]'::jsonb),
    'next_cursor', case when (select count(*) from candidate) > v_limit then (
      select jsonb_build_object(
        -- Retain the established frontend cursor key for both timelines.
        'published_at', page.page_sort_at,
        'article_id', page.id
      )
      from page order by page.page_sort_at asc, page.id asc limit 1
    ) else null end
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.fetch_net_altara_news_article_record(
  requested_expected_identity_link_id uuid,
  requested_article_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_result jsonb;
begin
  v_identity_link_id := public.net_altara_news_effective_player_identity(
    requested_expected_identity_link_id
  );
  select jsonb_build_object(
    'article', public.net_altara_news_article_summary(article.id, v_identity_link_id)
      || jsonb_build_object(
        'body', article.body,
        'status', article.status,
        'archived_at', article.archived_at
      ),
    'media', public.net_altara_news_article_media_payload(article.id),
    'related', coalesce((
      select jsonb_agg(
        public.net_altara_news_article_summary(related.id, v_identity_link_id)
        order by related.published_at desc, related.id desc
      )
      from (
        select candidate.id, candidate.published_at
        from public.net_altara_news_articles as candidate
        where candidate.status = 'published'
          and candidate.section = article.section
          and candidate.id <> article.id
        order by candidate.published_at desc, candidate.id desc
        limit 4
      ) as related
    ), '[]'::jsonb)
  ) into v_result
  from public.net_altara_news_articles as article
  where article.id = requested_article_id
    and article.status in ('published', 'archived')
    and (article.status = 'published' or article.published_at is not null);
  if v_result is null then
    raise exception 'ALTARA_NEWS_ARTICLE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

create or replace function public.set_net_altara_news_gm_article_lifecycle(
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
  v_action text := lower(btrim(coalesce(requested_action, '')));
  v_article public.net_altara_news_articles%rowtype;
begin
  perform public.assert_net_altara_news_gm_editor();
  if v_action = 'publish' then
    update public.net_altara_news_articles set
      status = 'published', published_at = timezone('utc', now()), archived_at = null
    where id = requested_article_id and status = 'draft'
    returning * into v_article;
  elsif v_action = 'unpublish' then
    update public.net_altara_news_articles set
      status = 'draft', published_at = null, archived_at = null
    where id = requested_article_id and status = 'published'
    returning * into v_article;
  elsif v_action = 'archive' then
    update public.net_altara_news_articles set
      status = 'archived', archived_at = timezone('utc', now())
    where id = requested_article_id and status in ('draft', 'published')
    returning * into v_article;
  elsif v_action = 'restore' then
    update public.net_altara_news_articles set
      status = case when published_at is null then 'draft' else 'published' end,
      archived_at = null
    where id = requested_article_id and status = 'archived'
    returning * into v_article;
  else
    raise exception 'ALTARA_NEWS_LIFECYCLE_ACTION_INVALID' using errcode = '22023';
  end if;
  if not found then
    raise exception 'ALTARA_NEWS_LIFECYCLE_INVALID' using errcode = 'P0001';
  end if;
  perform public.audit_net_altara_news_gm_action(
    'altara-news.article.' || v_action, 'altara-news-article', v_article.id
  );
  return public.net_altara_news_gm_article_payload(v_article.id);
end;
$$;

revoke all on function public.fetch_net_altara_news_article_page(
  uuid, text, text, text, timestamptz, uuid, integer
) from public, anon, authenticated;
revoke all on function public.current_user_can_read_net_altara_news_media_object(text)
  from public, anon, authenticated;
revoke all on function public.fetch_net_altara_news_article_record(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.set_net_altara_news_gm_article_lifecycle(uuid, text)
  from public, anon, authenticated;
revoke all on function public.set_net_altara_news_gm_incident_lifecycle(uuid, text)
  from public, anon, authenticated;

grant execute on function public.fetch_net_altara_news_article_page(
  uuid, text, text, text, timestamptz, uuid, integer
) to authenticated;
grant execute on function public.current_user_can_read_net_altara_news_media_object(text)
  to authenticated;
grant execute on function public.fetch_net_altara_news_article_record(uuid, uuid)
  to authenticated;
grant execute on function public.set_net_altara_news_gm_article_lifecycle(uuid, text)
  to authenticated;
grant execute on function public.set_net_altara_news_gm_incident_lifecycle(uuid, text)
  to authenticated;

commit;
