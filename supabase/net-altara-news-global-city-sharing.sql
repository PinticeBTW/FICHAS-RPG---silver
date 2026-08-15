begin;

do $$
begin
  if to_regprocedure('public.fetch_net_altara_news_feed(uuid,text,timestamptz,uuid,integer)') is null
    or to_regprocedure('public.net_altara_news_effective_player_identity(uuid)') is null
    or to_regprocedure('public.net_altara_news_identity_local_label(uuid)') is null
    or to_regprocedure('public.net_altara_news_article_summary(uuid,uuid)') is null
    or to_regclass('public.net_altara_news_articles') is null
    or to_regclass('public.net_altara_news_saved_articles') is null
  then
    raise exception 'ALTARA_NEWS_GLOBAL_CITY_DEPENDENCY_REQUIRED';
  end if;
end;
$$;

create or replace function public.fetch_net_altara_news_feed(
  requested_expected_identity_link_id uuid,
  requested_mode text,
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
  v_local_label text;
  v_local_available boolean;
  v_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40);
  v_result jsonb;
begin
  v_identity_link_id := public.net_altara_news_effective_player_identity(
    requested_expected_identity_link_id
  );

  if v_mode not in ('home', 'local', 'world', 'business', 'technology', 'culture', 'saved') then
    raise exception 'ALTARA_NEWS_FEED_MODE_INVALID' using errcode = '22023';
  end if;

  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'ALTARA_NEWS_CURSOR_INVALID' using errcode = '22023';
  end if;

  -- Presentation metadata only. This value never participates in authorization
  -- or in the HOME / LOCAL feed predicates.
  v_local_label := public.net_altara_news_identity_local_label(v_identity_link_id);

  select exists (
    select 1
    from public.net_altara_news_articles as article
    where article.status = 'published'
      and article.coverage_scope = 'local'
  ) into v_local_available;

  with candidate as materialized (
    select article.id, article.published_at
    from public.net_altara_news_articles as article
    where article.status = 'published'
      and (
        v_mode = 'home'
        or (v_mode = 'local' and article.coverage_scope = 'local')
        or (v_mode = 'world' and article.coverage_scope = 'world')
        or (v_mode = 'business' and article.section = 'business')
        or (v_mode = 'technology' and article.section = 'technology')
        or (v_mode = 'culture' and article.section = 'culture')
        or (v_mode = 'saved' and exists (
          select 1
          from public.net_altara_news_saved_articles as saved
          where saved.identity_link_id = v_identity_link_id
            and saved.article_id = article.id
        ))
      )
      and (
        requested_cursor_at is null
        or (article.published_at, article.id) < (requested_cursor_at, requested_cursor_id)
      )
    order by article.published_at desc, article.id desc
    limit v_limit + 1
  ), page as (
    select candidate.*
    from candidate
    order by candidate.published_at desc, candidate.id desc
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
        order by page.published_at desc, page.id desc
      )
      from page
    ), '[]'::jsonb),
    'next_cursor', case when (select count(*) from candidate) > v_limit then (
      select jsonb_build_object(
        'published_at', page.published_at,
        'article_id', page.id
      )
      from page
      order by page.published_at asc, page.id asc
      limit 1
    ) else null end
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.fetch_net_altara_news_feed(uuid, text, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.fetch_net_altara_news_feed(uuid, text, timestamptz, uuid, integer)
  to authenticated;

commit;
