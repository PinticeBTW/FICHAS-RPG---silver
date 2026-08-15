-- PULSE dormant-account visibility
--
-- Historical PULSE rows remain immutable/preserved.  This migration changes
-- only bounded server projections so an account whose identity cannot
-- currently use the PULSE service does not participate in current social UI.

begin;

do $$
begin
  if to_regclass('public.net_app_accounts') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_pulse_profiles') is null
    or to_regclass('public.net_pulse_posts') is null
    or to_regclass('public.net_pulse_follows') is null
    or to_regclass('public.net_pulse_reactions') is null
    or to_regclass('public.net_pulse_boosts') is null
    or to_regclass('public.net_pulse_bookmarks') is null
    or to_regclass('public.net_pulse_notifications') is null
    or to_regclass('public.net_pulse_post_mentions') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
    or to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.assert_net_effective_runtime_identity(uuid,text,boolean)') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.assert_net_pulse_account_context(uuid,boolean)') is null
    or to_regprocedure('public.assert_net_pulse_compromised_context(uuid,uuid)') is null
    or to_regclass('public.net_pulse_account_presentation') is null
    or to_regprocedure('public.net_pulse_post_is_visible(uuid)') is null
    or to_regprocedure('public.net_pulse_account_summary_rows(uuid[],uuid)') is null
    or to_regprocedure('public.fetch_net_pulse_account_summaries(text,uuid,integer)') is null
    or to_regprocedure('public.net_pulse_account_directory_rows(uuid[],boolean,integer)') is null
    or to_regprocedure('public.fetch_net_pulse_relationship_page(uuid,text,timestamptz,uuid,integer)') is null
    or to_regprocedure('public.net_pulse_page_candidates(text,uuid,text,timestamptz,uuid,integer,uuid)') is null
    or to_regprocedure('public.net_pulse_render_post_rows(uuid[],uuid)') is null
    or to_regprocedure('public.fetch_net_pulse_thread_page(uuid,timestamptz,uuid,integer)') is null
    or to_regprocedure('public.fetch_net_pulse_profile(uuid,uuid,uuid,uuid)') is null
    or to_regprocedure('public.fetch_net_pulse_mentions_for_posts(uuid[])') is null
    or to_regprocedure('public.fetch_net_pulse_notification_page(timestamptz,uuid,integer)') is null
    or to_regprocedure('public.fetch_net_pulse_notification_state()') is null
    or to_regprocedure('public.mark_net_pulse_notification_read(uuid)') is null
    or to_regprocedure('public.mark_all_net_pulse_notifications_read()') is null
  then
    raise exception 'PULSE_DORMANT_VISIBILITY_DEPENDENCY_REQUIRED';
  end if;
end;
$$;

-- Target-account capability only.  This is deliberately independent of the
-- caller and is not an actor-authority predicate. Installation is launcher /
-- actor-use state, not public-account lifecycle state, so it is intentionally
-- absent from this target visibility predicate.
create or replace function public.net_pulse_account_is_currently_visible(
  requested_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.net_app_accounts as account
    join public.net_identity_links as identity_link
      on identity_link.id = account.identity_link_id
    where account.id = requested_account_id
      and account.app_id = 'pulse'
      and account.status = 'active'
      and account.identity_link_id is not null
      and public.net_identity_link_can_access_service(identity_link.id, 'pulse')
  );
$$;

comment on function public.net_pulse_account_is_currently_visible(uuid) is
  'Private target-account projection predicate: active PULSE account with a valid identity link and current PULSE service eligibility. Install state remains an actor-use/launcher concern. This function neither derives nor grants actor authority.';

revoke all on function public.net_pulse_account_is_currently_visible(uuid)
  from public, anon, authenticated;

-- The effective-runtime foundation intentionally keeps inspect/compromised
-- sessions outside the mutable runtime-identity model. Preserve the older
-- PULSE public-reader contract for those two GM modes without manufacturing a
-- viewer account: a locked current session may read only wrappers that pass
-- requested_require_account = false and comparison-bind a null account. Every
-- mutation/notification-private path still requires the exact runtime account.
create or replace function public.assert_net_pulse_account_context(
  requested_expected_account_id uuid,
  requested_require_account boolean default true
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_profile_id uuid := auth.uid();
  v_identity_link_id uuid;
  v_account_id uuid;
  v_gm_session public.net_gm_persona_sessions%rowtype;
begin
  if v_actor_profile_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  v_identity_link_id := public.current_net_effective_runtime_identity_link_id();
  if v_identity_link_id is null then
    if not coalesce(requested_require_account, true)
      and requested_expected_account_id is null
      and public.is_current_user_gm()
    then
      select gm_session.* into v_gm_session
      from public.net_gm_persona_sessions as gm_session
      where gm_session.gm_profile_id = v_actor_profile_id
        and gm_session.mode in ('inspect', 'compromised-session')
      for share;

      if found then
        return null;
      end if;
    end if;

    raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  perform public.assert_net_effective_runtime_identity(
    v_identity_link_id,
    'pulse',
    true
  );

  select account.id
  into v_account_id
  from public.net_app_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.app_id = 'pulse'
    and account.status = 'active'
  for share;

  if requested_expected_account_id is distinct from v_account_id then
    raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  if coalesce(requested_require_account, true) and v_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;
  return v_account_id;
end;
$$;

revoke all on function public.assert_net_pulse_account_context(uuid, boolean)
  from public, anon, authenticated;

-- A post is current only while every post in its bounded ancestor chain has a
-- current PULSE-visible author.  Soft-delete and depth protections are kept.
create or replace function public.net_pulse_post_is_visible(
  requested_post_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive ancestors as (
    select post.id, post.parent_post_id, post.author_account_id,
      post.deleted_at, 0 as depth
    from public.net_pulse_posts as post
    where post.id = requested_post_id

    union all

    select parent.id, parent.parent_post_id, parent.author_account_id,
      parent.deleted_at, child.depth + 1
    from public.net_pulse_posts as parent
    join ancestors as child on child.parent_post_id = parent.id
    where child.depth < 16
  )
  select exists (select 1 from ancestors)
    and not exists (select 1 from ancestors where deleted_at is not null)
    and not exists (
      select 1 from ancestors
      where depth = 16 and parent_post_id is not null
    )
    and not exists (
      select 1 from ancestors
      where not public.net_pulse_account_is_currently_visible(author_account_id)
    );
$$;

revoke all on function public.net_pulse_post_is_visible(uuid)
  from public, anon, authenticated;

-- Shared account renderer.  A dormant requested account produces no row.
-- Counts include only counterpart accounts that are currently PULSE-visible;
-- the underlying follow rows are not changed.
create or replace function public.net_pulse_account_summary_rows(
  requested_account_ids uuid[],
  requested_viewer_account_id uuid
)
returns table (
  account_id uuid,
  handle text,
  avatar_url text,
  bio text,
  visibility text,
  discoverable boolean,
  status text,
  followers_count bigint,
  following_count bigint,
  pulses_count bigint,
  viewer_following boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with selected_accounts as (
    select account.*
    from public.net_app_accounts as account
    where account.app_id = 'pulse'
      and account.id = any(coalesce(requested_account_ids, array[]::uuid[]))
      and public.net_pulse_account_is_currently_visible(account.id)
  ),
  follower_stats as (
    select follow.followed_account_id as account_id, count(*)::bigint as total
    from public.net_pulse_follows as follow
    join selected_accounts as account on account.id = follow.followed_account_id
    where public.net_pulse_account_is_currently_visible(follow.follower_account_id)
    group by follow.followed_account_id
  ),
  following_stats as (
    select follow.follower_account_id as account_id, count(*)::bigint as total
    from public.net_pulse_follows as follow
    join selected_accounts as account on account.id = follow.follower_account_id
    where public.net_pulse_account_is_currently_visible(follow.followed_account_id)
    group by follow.follower_account_id
  ),
  pulse_stats as (
    select post.author_account_id as account_id, count(*)::bigint as total
    from public.net_pulse_posts as post
    join selected_accounts as account on account.id = post.author_account_id
    where post.parent_post_id is null
      and public.net_pulse_post_is_visible(post.id)
    group by post.author_account_id
  ),
  viewer_follows as (
    select follow.followed_account_id
    from public.net_pulse_follows as follow
    join selected_accounts as account on account.id = follow.followed_account_id
    where follow.follower_account_id = requested_viewer_account_id
      and public.net_pulse_account_is_currently_visible(follow.follower_account_id)
  )
  select
    account.id,
    account.handle,
    presentation.avatar_url,
    coalesce(profile.bio, ''),
    profile.visibility,
    profile.discoverable,
    account.status,
    coalesce(follower_stat.total, 0),
    coalesce(following_stat.total, 0),
    coalesce(pulse_stat.total, 0),
    viewer_follow.followed_account_id is not null
  from selected_accounts as account
  join public.net_pulse_profiles as profile on profile.account_id = account.id
  left join public.net_pulse_account_presentation as presentation
    on presentation.account_id = account.id
  left join follower_stats as follower_stat on follower_stat.account_id = account.id
  left join following_stats as following_stat on following_stat.account_id = account.id
  left join pulse_stats as pulse_stat on pulse_stat.account_id = account.id
  left join viewer_follows as viewer_follow on viewer_follow.followed_account_id = account.id;
$$;

revoke all on function public.net_pulse_account_summary_rows(uuid[], uuid)
  from public, anon, authenticated;

create or replace function public.fetch_net_pulse_account_summaries(
  requested_query text default null,
  requested_account_id uuid default null,
  requested_limit integer default 20
)
returns table (
  account_id uuid,
  handle text,
  avatar_url text,
  bio text,
  visibility text,
  discoverable boolean,
  status text,
  followers_count bigint,
  following_count bigint,
  pulses_count bigint,
  viewer_following boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  normalized_query text := lower(regexp_replace(btrim(coalesce(requested_query, '')), '^@', ''));
  safe_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 30);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  viewer_account_id := public.current_net_pulse_owner_account_id();

  return query
  with candidates as (
    select account.id, account.handle
    from public.net_app_accounts as account
    join public.net_pulse_profiles as profile on profile.account_id = account.id
    where account.app_id = 'pulse'
      and public.net_pulse_account_is_currently_visible(account.id)
      and (
        (
          requested_account_id is not null
          and account.id = requested_account_id
          and (
            profile.visibility = 'public'
            or account.id = viewer_account_id
            or public.is_current_user_gm()
          )
        )
        or (
          requested_account_id is null
          and normalized_query <> ''
          and profile.visibility = 'public'
          and profile.discoverable
          and lower(account.handle) like '%' || normalized_query || '%'
        )
      )
    order by account.handle asc, account.id asc
    limit safe_limit
  )
  select summary.*
  from candidates as candidate
  join public.net_pulse_account_summary_rows(
    coalesce((select array_agg(selected.id) from candidates as selected), array[]::uuid[]),
    viewer_account_id
  ) as summary on summary.account_id = candidate.id
  order by candidate.handle asc, candidate.id asc;
end;
$$;

revoke all on function public.fetch_net_pulse_account_summaries(text, uuid, integer)
  from public, anon, authenticated;

create or replace function public.net_pulse_account_directory_rows(
  requested_account_ids uuid[] default null,
  requested_discoverable_only boolean default false,
  requested_limit integer default 30
)
returns table (
  account_id uuid,
  handle text,
  avatar_url text,
  bio text,
  visibility text,
  discoverable boolean,
  status text,
  followers_count bigint,
  following_count bigint,
  pulses_count bigint,
  viewer_following boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  safe_limit integer := least(greatest(coalesce(requested_limit, 30), 1), 30);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  viewer_account_id := public.current_net_pulse_owner_account_id();

  return query
  with candidates as (
    select account.id, profile.created_at
    from public.net_app_accounts as account
    join public.net_pulse_profiles as profile on profile.account_id = account.id
    where account.app_id = 'pulse'
      and public.net_pulse_account_is_currently_visible(account.id)
      and (
        (
          requested_discoverable_only
          and profile.visibility = 'public'
          and profile.discoverable
        )
        or (
          not requested_discoverable_only
          and requested_account_ids is not null
          and account.id = any(requested_account_ids)
          and (profile.visibility = 'public' or account.id = viewer_account_id)
        )
      )
    order by profile.created_at desc, account.id desc
    limit safe_limit
  )
  select summary.*
  from candidates as candidate
  join public.net_pulse_account_summary_rows(
    coalesce((select array_agg(selected.id) from candidates as selected), array[]::uuid[]),
    viewer_account_id
  ) as summary on summary.account_id = candidate.id
  order by candidate.created_at desc, candidate.id desc;
end;
$$;

revoke all on function public.net_pulse_account_directory_rows(uuid[], boolean, integer)
  from public, anon, authenticated;

create or replace function public.fetch_net_pulse_relationship_page(
  requested_profile_account_id uuid,
  requested_direction text,
  requested_cursor_at timestamptz default null,
  requested_cursor_account_id uuid default null,
  requested_limit integer default 30
)
returns table (
  account_id uuid,
  handle text,
  avatar_url text,
  bio text,
  visibility text,
  discoverable boolean,
  status text,
  followers_count bigint,
  following_count bigint,
  pulses_count bigint,
  viewer_following boolean,
  relationship_created_at timestamptz,
  page_has_more boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  target_visibility text;
  safe_limit integer := least(greatest(coalesce(requested_limit, 30), 1), 40);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_profile_account_id is null then
    raise exception 'A PULSE profile account is required.' using errcode = '22023';
  end if;
  if requested_direction is null or requested_direction not in ('followers', 'following') then
    raise exception 'A valid PULSE relationship direction is required.' using errcode = '22023';
  end if;
  if (requested_cursor_at is null) <> (requested_cursor_account_id is null) then
    raise exception 'PULSE relationship cursor values must be supplied together.' using errcode = '22023';
  end if;

  viewer_account_id := public.current_net_pulse_owner_account_id();
  select profile.visibility into target_visibility
  from public.net_app_accounts as account
  join public.net_pulse_profiles as profile on profile.account_id = account.id
  where account.id = requested_profile_account_id
    and account.app_id = 'pulse'
    and public.net_pulse_account_is_currently_visible(account.id);

  if not found then
    raise exception 'The requested PULSE profile is unavailable.' using errcode = 'P0002';
  end if;
  if target_visibility <> 'public' and requested_profile_account_id <> viewer_account_id then
    raise exception 'The requested social graph is not publicly available.' using errcode = '42501';
  end if;

  return query
  with relationship_candidates as (
    select
      case when requested_direction = 'followers'
        then follow.follower_account_id else follow.followed_account_id end as related_account_id,
      follow.created_at
    from public.net_pulse_follows as follow
    join public.net_app_accounts as related_account
      on related_account.id = case when requested_direction = 'followers'
        then follow.follower_account_id else follow.followed_account_id end
      and related_account.app_id = 'pulse'
    join public.net_pulse_profiles as related_profile on related_profile.account_id = related_account.id
    where (
      (requested_direction = 'followers' and follow.followed_account_id = requested_profile_account_id)
      or (requested_direction = 'following' and follow.follower_account_id = requested_profile_account_id)
    )
      and public.net_pulse_account_is_currently_visible(related_account.id)
      and (related_profile.visibility = 'public' or related_account.id = viewer_account_id)
      and (
        requested_cursor_at is null
        or (follow.created_at, related_account.id) < (requested_cursor_at, requested_cursor_account_id)
      )
    order by follow.created_at desc, related_account.id desc
    limit safe_limit + 1
  ),
  candidate_marked as (
    select candidate.*,
      count(*) over () > safe_limit as has_more,
      row_number() over (order by candidate.created_at desc, candidate.related_account_id desc) as row_number
    from relationship_candidates as candidate
  ),
  selected_candidates as (
    select candidate.* from candidate_marked as candidate where candidate.row_number <= safe_limit
  )
  select
    summary.account_id,
    summary.handle,
    summary.avatar_url,
    summary.bio,
    summary.visibility,
    summary.discoverable,
    summary.status,
    summary.followers_count,
    summary.following_count,
    summary.pulses_count,
    summary.viewer_following,
    candidate.created_at,
    candidate.has_more
  from selected_candidates as candidate
  join public.net_pulse_account_summary_rows(
    coalesce((select array_agg(selected.related_account_id) from selected_candidates as selected), array[]::uuid[]),
    viewer_account_id
  ) as summary on summary.account_id = candidate.related_account_id
  order by candidate.created_at desc, candidate.related_account_id desc;
end;
$$;

revoke all on function public.fetch_net_pulse_relationship_page(uuid, text, timestamptz, uuid, integer)
  from public, anon, authenticated;

-- Apply current author visibility before cursor limits so dormant posts never
-- consume a bounded page slot or produce a misleading page_has_more value.
create or replace function public.net_pulse_page_candidates(
  requested_mode text,
  requested_profile_account_id uuid,
  requested_search_query text,
  requested_cursor_at timestamptz,
  requested_cursor_id uuid,
  requested_limit integer,
  requested_viewer_account_id uuid
)
returns table (
  post_id uuid,
  sort_at timestamptz,
  followed_booster_account_id uuid,
  followed_booster_handle text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  safe_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40) + 1;
  normalized_query text := lower(btrim(coalesce(requested_search_query, '')));
  escaped_query text;
begin
  if requested_mode in ('city', 'raw', 'discover') then
    return query
    select post.id, post.created_at, null::uuid, null::text
    from public.net_pulse_posts as post
    where post.parent_post_id is null
      and public.net_pulse_post_is_visible(post.id)
      and (requested_cursor_at is null or (post.created_at, post.id) < (requested_cursor_at, requested_cursor_id))
    order by post.created_at desc, post.id desc
    limit safe_limit;
  elsif requested_mode = 'profile' then
    if requested_profile_account_id is null then
      raise exception 'A PULSE profile account is required.' using errcode = '22023';
    end if;
    return query
    select post.id, post.created_at, null::uuid, null::text
    from public.net_pulse_posts as post
    where post.author_account_id = requested_profile_account_id
      and post.parent_post_id is null
      and public.net_pulse_post_is_visible(post.id)
      and (requested_cursor_at is null or (post.created_at, post.id) < (requested_cursor_at, requested_cursor_id))
    order by post.created_at desc, post.id desc
    limit safe_limit;
  elsif requested_mode = 'search' then
    if normalized_query = '' then return; end if;
    if char_length(normalized_query) > 80 then
      raise exception 'PULSE search is limited to 80 characters.' using errcode = '22001';
    end if;
    escaped_query := replace(replace(replace(normalized_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
    return query
    select post.id, post.created_at, null::uuid, null::text
    from public.net_pulse_posts as post
    where post.parent_post_id is null
      and public.net_pulse_post_is_visible(post.id)
      and lower(post.body) like '%' || escaped_query || '%' escape E'\\'
      and (requested_cursor_at is null or (post.created_at, post.id) < (requested_cursor_at, requested_cursor_id))
    order by post.created_at desc, post.id desc
    limit safe_limit;
  elsif requested_mode = 'bookmarks' then
    if requested_viewer_account_id is null then return; end if;
    return query
    select post.id, bookmark.created_at, null::uuid, null::text
    from public.net_pulse_bookmarks as bookmark
    join public.net_pulse_posts as post
      on post.id = bookmark.post_id
      and post.parent_post_id is null
    where bookmark.account_id = requested_viewer_account_id
      and public.net_pulse_post_is_visible(post.id)
      and (requested_cursor_at is null or (bookmark.created_at, post.id) < (requested_cursor_at, requested_cursor_id))
    order by bookmark.created_at desc, post.id desc
    limit safe_limit;
  elsif requested_mode = 'following' then
    if requested_viewer_account_id is null then return; end if;
    return query
    with activities as (
      select post.id as candidate_post_id, post.created_at as activity_at,
        null::uuid as booster_id, null::text as booster_handle
      from public.net_pulse_follows as follow
      join public.net_pulse_posts as post
        on post.author_account_id = follow.followed_account_id
        and post.parent_post_id is null
      where follow.follower_account_id = requested_viewer_account_id
        and public.net_pulse_account_is_currently_visible(follow.followed_account_id)
        and public.net_pulse_post_is_visible(post.id)

      union all

      select post.id, boost.created_at, booster.id, booster.handle
      from public.net_pulse_follows as follow
      join public.net_pulse_boosts as boost on boost.account_id = follow.followed_account_id
      join public.net_pulse_posts as post
        on post.id = boost.post_id
        and post.parent_post_id is null
      join public.net_app_accounts as booster
        on booster.id = boost.account_id
        and booster.app_id = 'pulse'
      where follow.follower_account_id = requested_viewer_account_id
        and public.net_pulse_account_is_currently_visible(booster.id)
        and public.net_pulse_post_is_visible(post.id)
    ),
    latest_activity as (
      select distinct on (activity.candidate_post_id)
        activity.candidate_post_id,
        activity.activity_at,
        activity.booster_id,
        activity.booster_handle
      from activities as activity
      order by activity.candidate_post_id, activity.activity_at desc, activity.booster_id nulls last
    )
    select activity.candidate_post_id, activity.activity_at,
      activity.booster_id, activity.booster_handle
    from latest_activity as activity
    where requested_cursor_at is null
      or (activity.activity_at, activity.candidate_post_id) < (requested_cursor_at, requested_cursor_id)
    order by activity.activity_at desc, activity.candidate_post_id desc
    limit safe_limit;
  else
    raise exception 'Unsupported PULSE page mode.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.net_pulse_page_candidates(text, uuid, text, timestamptz, uuid, integer, uuid)
  from public, anon, authenticated;

-- Shared post renderer.  Current account capability also scopes all public
-- engagement counts; dormant reactions/boosts/follows remain stored.
create or replace function public.net_pulse_render_post_rows(
  requested_post_ids uuid[],
  requested_viewer_account_id uuid
)
returns table (
  id uuid,
  author_account_id uuid,
  parent_post_id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  author_handle text,
  author_display_name text,
  author_avatar_url text,
  author_status text,
  author_bio text,
  author_visibility text,
  author_discoverable boolean,
  author_followers bigint,
  author_following bigint,
  author_pulses bigint,
  viewer_follows_author boolean,
  reply_count bigint,
  reaction_count bigint,
  boost_count bigint,
  viewer_reacted boolean,
  viewer_boosted boolean,
  viewer_bookmarked boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with selected_posts as (
    select post.*
    from public.net_pulse_posts as post
    where post.id = any(coalesce(requested_post_ids, array[]::uuid[]))
      and public.net_pulse_post_is_visible(post.id)
  ),
  selected_authors as (
    select distinct post.author_account_id as account_id from selected_posts as post
  ),
  follower_stats as (
    select follow.followed_account_id as account_id, count(*)::bigint as total
    from public.net_pulse_follows as follow
    join selected_authors as author on author.account_id = follow.followed_account_id
    where public.net_pulse_account_is_currently_visible(follow.follower_account_id)
    group by follow.followed_account_id
  ),
  following_stats as (
    select follow.follower_account_id as account_id, count(*)::bigint as total
    from public.net_pulse_follows as follow
    join selected_authors as author on author.account_id = follow.follower_account_id
    where public.net_pulse_account_is_currently_visible(follow.followed_account_id)
    group by follow.follower_account_id
  ),
  pulse_stats as (
    select pulse.author_account_id as account_id, count(*)::bigint as total
    from public.net_pulse_posts as pulse
    join selected_authors as author on author.account_id = pulse.author_account_id
    where pulse.parent_post_id is null
      and public.net_pulse_post_is_visible(pulse.id)
    group by pulse.author_account_id
  ),
  reply_stats as (
    select reply.parent_post_id as post_id, count(*)::bigint as total
    from public.net_pulse_posts as reply
    join selected_posts as selected on selected.id = reply.parent_post_id
    where public.net_pulse_post_is_visible(reply.id)
    group by reply.parent_post_id
  ),
  reaction_stats as (
    select reaction.post_id, count(*)::bigint as total
    from public.net_pulse_reactions as reaction
    join selected_posts as selected on selected.id = reaction.post_id
    where public.net_pulse_account_is_currently_visible(reaction.account_id)
    group by reaction.post_id
  ),
  boost_stats as (
    select boost.post_id, count(*)::bigint as total
    from public.net_pulse_boosts as boost
    join selected_posts as selected on selected.id = boost.post_id
    where public.net_pulse_account_is_currently_visible(boost.account_id)
    group by boost.post_id
  ),
  viewer_follows as (
    select follow.followed_account_id
    from public.net_pulse_follows as follow
    join selected_authors as author on author.account_id = follow.followed_account_id
    where follow.follower_account_id = requested_viewer_account_id
      and public.net_pulse_account_is_currently_visible(follow.follower_account_id)
  ),
  viewer_reactions as (
    select reaction.post_id
    from public.net_pulse_reactions as reaction
    join selected_posts as selected on selected.id = reaction.post_id
    where reaction.account_id = requested_viewer_account_id
  ),
  viewer_boosts as (
    select boost.post_id
    from public.net_pulse_boosts as boost
    join selected_posts as selected on selected.id = boost.post_id
    where boost.account_id = requested_viewer_account_id
  ),
  viewer_bookmarks as (
    select bookmark.post_id
    from public.net_pulse_bookmarks as bookmark
    join selected_posts as selected on selected.id = bookmark.post_id
    where bookmark.account_id = requested_viewer_account_id
  )
  select
    post.id,
    post.author_account_id,
    post.parent_post_id,
    post.body,
    post.created_at,
    post.updated_at,
    account.handle,
    account.handle,
    presentation.avatar_url,
    account.status,
    coalesce(profile.bio, ''),
    coalesce(profile.visibility, 'limited'),
    coalesce(profile.discoverable, false),
    coalesce(follower_stat.total, 0),
    coalesce(following_stat.total, 0),
    coalesce(pulse_stat.total, 0),
    viewer_follow.followed_account_id is not null,
    coalesce(reply_stat.total, 0),
    coalesce(reaction_stat.total, 0),
    coalesce(boost_stat.total, 0),
    viewer_reaction.post_id is not null,
    viewer_boost.post_id is not null,
    viewer_bookmark.post_id is not null
  from selected_posts as post
  join public.net_app_accounts as account
    on account.id = post.author_account_id and account.app_id = 'pulse'
  left join public.net_pulse_profiles as profile on profile.account_id = account.id
  left join public.net_pulse_account_presentation as presentation on presentation.account_id = account.id
  left join follower_stats as follower_stat on follower_stat.account_id = account.id
  left join following_stats as following_stat on following_stat.account_id = account.id
  left join pulse_stats as pulse_stat on pulse_stat.account_id = account.id
  left join viewer_follows as viewer_follow on viewer_follow.followed_account_id = account.id
  left join reply_stats as reply_stat on reply_stat.post_id = post.id
  left join reaction_stats as reaction_stat on reaction_stat.post_id = post.id
  left join boost_stats as boost_stat on boost_stat.post_id = post.id
  left join viewer_reactions as viewer_reaction on viewer_reaction.post_id = post.id
  left join viewer_boosts as viewer_boost on viewer_boost.post_id = post.id
  left join viewer_bookmarks as viewer_bookmark on viewer_bookmark.post_id = post.id;
$$;

revoke all on function public.net_pulse_render_post_rows(uuid[], uuid)
  from public, anon, authenticated;

create or replace function public.fetch_net_pulse_thread_page(
  requested_root_post_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 30
)
returns table (
  id uuid,
  author_account_id uuid,
  parent_post_id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  author_handle text,
  author_display_name text,
  author_avatar_url text,
  author_status text,
  author_bio text,
  author_visibility text,
  author_discoverable boolean,
  author_followers bigint,
  author_following bigint,
  author_pulses bigint,
  viewer_follows_author boolean,
  reply_count bigint,
  reaction_count bigint,
  boost_count bigint,
  viewer_reacted boolean,
  viewer_boosted boolean,
  viewer_bookmarked boolean,
  followed_booster_account_id uuid,
  followed_booster_handle text,
  following_activity_at timestamptz,
  page_sort_at timestamptz,
  page_has_more boolean,
  is_thread_root boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  safe_limit integer := least(greatest(coalesce(requested_limit, 30), 1), 50);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_root_post_id is null then
    raise exception 'A root PULSE is required.' using errcode = '22023';
  end if;
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'PULSE reply cursor timestamp and id must be supplied together.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.net_pulse_posts as root
    where root.id = requested_root_post_id
      and root.parent_post_id is null
      and public.net_pulse_post_is_visible(root.id)
  ) then
    raise exception 'The requested PULSE thread is unavailable.' using errcode = 'P0002';
  end if;
  viewer_account_id := public.current_net_pulse_owner_account_id();

  return query
  with reply_page as (
    select reply.id, reply.created_at
    from public.net_pulse_posts as reply
    where reply.parent_post_id = requested_root_post_id
      and public.net_pulse_post_is_visible(reply.id)
      and (requested_cursor_at is null or (reply.created_at, reply.id) < (requested_cursor_at, requested_cursor_id))
    order by reply.created_at desc, reply.id desc
    limit safe_limit + 1
  ),
  reply_marked as (
    select reply.*,
      count(*) over () > safe_limit as has_more,
      row_number() over (order by reply.created_at desc, reply.id desc) as row_number
    from reply_page as reply
  ),
  selected_replies as (
    select reply.* from reply_marked as reply where reply.row_number <= safe_limit
  ),
  selected_ids as (
    select requested_root_post_id as id
    union all
    select reply.id from selected_replies as reply
  ),
  rendered as (
    select row.*
    from public.net_pulse_render_post_rows(
      coalesce((select array_agg(selected.id) from selected_ids as selected), array[]::uuid[]),
      viewer_account_id
    ) as row
  ),
  output_rows as (
    select rendered.*, rendered.created_at as sort_at,
      coalesce((select bool_or(reply.has_more) from selected_replies as reply), false) as has_more,
      true as thread_root
    from rendered
    where rendered.id = requested_root_post_id
      and requested_cursor_at is null

    union all

    select rendered.*, reply.created_at,
      reply.has_more,
      false
    from selected_replies as reply
    join rendered on rendered.id = reply.id
  )
  select
    output.id,
    output.author_account_id,
    output.parent_post_id,
    output.body,
    output.created_at,
    output.updated_at,
    output.author_handle,
    output.author_display_name,
    output.author_avatar_url,
    output.author_status,
    output.author_bio,
    output.author_visibility,
    output.author_discoverable,
    output.author_followers,
    output.author_following,
    output.author_pulses,
    output.viewer_follows_author,
    output.reply_count,
    output.reaction_count,
    output.boost_count,
    output.viewer_reacted,
    output.viewer_boosted,
    output.viewer_bookmarked,
    null::uuid,
    null::text,
    output.created_at,
    output.sort_at,
    output.has_more,
    output.thread_root
  from output_rows as output
  order by output.thread_root desc, output.sort_at desc, output.id desc;
end;
$$;

revoke all on function public.fetch_net_pulse_thread_page(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;

-- Public exact-profile reads share the same target eligibility as discovery.
-- Existing owner/compromised preference masking is retained unchanged.
create or replace function public.fetch_net_pulse_profile(
  requested_account_id uuid,
  requested_expected_account_id uuid,
  requested_expected_session_generation uuid default null,
  requested_expected_compromised_account_id uuid default null
)
returns table (
  account_id uuid, handle text, bio text, visibility text,
  show_district boolean, discoverable boolean, default_feed text,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  authenticated_actor_id uuid := auth.uid();
  actual_account_id uuid;
  can_manage boolean := false;
  current_gm_session public.net_gm_persona_sessions%rowtype;
  compromised_context record;
begin
  if requested_account_id is null then
    raise exception 'A PULSE account is required.' using errcode = '22023';
  end if;

  if public.is_current_user_gm() then
    select session_row.* into current_gm_session
    from public.net_gm_persona_sessions as session_row
    where session_row.gm_profile_id = authenticated_actor_id
    for share;

    if found and current_gm_session.mode = 'compromised-session' then
      select asserted_context.* into compromised_context
      from public.assert_net_pulse_compromised_context(
        requested_expected_session_generation,
        requested_expected_compromised_account_id
      ) as asserted_context;
      can_manage := compromised_context.pulse_account_id = requested_account_id;
    else
      if requested_expected_session_generation is not null
        or requested_expected_compromised_account_id is not null
      then
        raise exception 'PULSE_COMPROMISED_CONTEXT_CHANGED' using errcode = 'P0001';
      end if;

      actual_account_id := public.assert_net_pulse_account_context(
        requested_expected_account_id,
        false
      );
      can_manage := actual_account_id = requested_account_id;
    end if;
  else
    if requested_expected_session_generation is not null
      or requested_expected_compromised_account_id is not null
    then
      raise exception 'PULSE_COMPROMISED_CONTEXT_CHANGED' using errcode = 'P0001';
    end if;

    actual_account_id := public.assert_net_pulse_account_context(
      requested_expected_account_id,
      false
    );
    can_manage := actual_account_id = requested_account_id;
  end if;

  return query
  select
    pulse_account.id,
    pulse_account.handle,
    coalesce(pulse_profile.bio, ''),
    coalesce(pulse_profile.visibility, case when can_manage then 'public' else 'limited' end),
    case when can_manage then coalesce(pulse_profile.show_district, false) else false end,
    case when can_manage then coalesce(pulse_profile.discoverable, false) else false end,
    case when can_manage then coalesce(pulse_profile.default_feed, 'city') else 'city' end,
    coalesce(pulse_profile.created_at, pulse_account.created_at),
    coalesce(pulse_profile.updated_at, pulse_account.updated_at)
  from public.net_app_accounts as pulse_account
  left join public.net_pulse_profiles as pulse_profile
    on pulse_profile.account_id = pulse_account.id
  where pulse_account.id = requested_account_id
    and pulse_account.app_id = 'pulse'
    and public.net_pulse_account_is_currently_visible(pulse_account.id)
  limit 1;
end;
$$;

revoke all on function public.fetch_net_pulse_profile(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fetch_net_pulse_profile(uuid, uuid, uuid, uuid)
  to authenticated;

create or replace function public.fetch_net_pulse_mentions_for_posts(
  requested_post_ids uuid[]
)
returns table (
  post_id uuid,
  mentioned_account_id uuid,
  source_handle text,
  current_handle text
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
  if cardinality(coalesce(requested_post_ids, array[]::uuid[])) > 80 then
    raise exception 'At most 80 PULSE records may be resolved at once.' using errcode = '22023';
  end if;

  return query
  with requested as (
    select distinct requested_id as post_id
    from unnest(coalesce(requested_post_ids, array[]::uuid[])) as request(requested_id)
    where requested_id is not null
  ),
  visible_requested as (
    select requested.post_id
    from requested
    where public.net_pulse_post_is_visible(requested.post_id)
  )
  select
    mention.post_id,
    mention.mentioned_account_id,
    mention.source_handle,
    account.handle
  from visible_requested as visible
  join public.net_pulse_post_mentions as mention on mention.post_id = visible.post_id
  join public.net_app_accounts as account
    on account.id = mention.mentioned_account_id and account.app_id = 'pulse'
  where public.net_pulse_account_is_currently_visible(account.id)
  order by mention.post_id, mention.source_handle;
end;
$$;

revoke all on function public.fetch_net_pulse_mentions_for_posts(uuid[])
  from public, anon, authenticated;

-- Notification rows stay stored.  Current inbox pages and unread counts hide
-- events whose actor is not currently PULSE-visible.  Post-backed events also
-- retain the existing bounded ancestry/deletion check through the strengthened
-- post predicate.
create or replace function public.fetch_net_pulse_notification_page(
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns table (
  id uuid,
  notification_type text,
  actor_account_id uuid,
  actor_handle text,
  actor_avatar_url text,
  post_id uuid,
  root_post_id uuid,
  post_excerpt text,
  post_available boolean,
  created_at timestamptz,
  read_at timestamptz,
  page_has_more boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  safe_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'Notification cursor timestamp and id must be supplied together.' using errcode = '22023';
  end if;

  viewer_account_id := public.current_net_pulse_owner_account_id();
  if viewer_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;

  return query
  with recursive candidates as (
    select notification.*
    from public.net_pulse_notifications as notification
    join public.net_app_accounts as actor
      on actor.id = notification.actor_account_id
      and actor.app_id = 'pulse'
    where notification.recipient_account_id = viewer_account_id
      and public.net_pulse_account_is_currently_visible(actor.id)
      and (
        notification.notification_type = 'follow'
        or (
          notification.post_id is not null
          and public.net_pulse_post_is_visible(notification.post_id)
        )
      )
      and (
        requested_cursor_at is null
        or (notification.created_at, notification.id) < (requested_cursor_at, requested_cursor_id)
      )
    order by notification.created_at desc, notification.id desc
    limit safe_limit + 1
  ),
  marked as (
    select candidate.*,
      count(*) over () > safe_limit as has_more,
      row_number() over (order by candidate.created_at desc, candidate.id desc) as row_number
    from candidates as candidate
  ),
  selected as (
    select candidate.* from marked as candidate where candidate.row_number <= safe_limit
  ),
  ancestry as (
    select
      selected.id as notification_id,
      post.id,
      post.parent_post_id,
      post.deleted_at,
      post.body,
      0 as depth
    from selected
    join public.net_pulse_posts as post on post.id = selected.post_id

    union all

    select
      child.notification_id,
      parent.id,
      parent.parent_post_id,
      parent.deleted_at,
      parent.body,
      child.depth + 1
    from ancestry as child
    join public.net_pulse_posts as parent on parent.id = child.parent_post_id
    where child.depth < 16
  ),
  availability as (
    select
      selected.id,
      selected.post_id is not null
        and count(ancestor.id) > 0
        and bool_and(ancestor.deleted_at is null) as available,
      max(ancestor.body) filter (where ancestor.depth = 0) as body
    from selected
    left join ancestry as ancestor on ancestor.notification_id = selected.id
    group by selected.id, selected.post_id
  )
  select
    selected.id,
    selected.notification_type,
    selected.actor_account_id,
    actor.handle,
    presentation.avatar_url,
    selected.post_id,
    selected.root_post_id,
    case when availability.available then left(availability.body, 120) else null end,
    case when selected.notification_type = 'follow' then true else availability.available end,
    selected.created_at,
    selected.read_at,
    selected.has_more
  from selected
  join public.net_app_accounts as actor
    on actor.id = selected.actor_account_id and actor.app_id = 'pulse'
  left join public.net_pulse_account_presentation as presentation
    on presentation.account_id = actor.id
  left join availability on availability.id = selected.id
  order by selected.created_at desc, selected.id desc;
end;
$$;

revoke all on function public.fetch_net_pulse_notification_page(timestamptz, uuid, integer)
  from public, anon, authenticated;

create or replace function public.fetch_net_pulse_notification_state()
returns table (
  unread_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  resolved_unread_count bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  viewer_account_id := public.current_net_pulse_owner_account_id();
  if viewer_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;

  select count(*)::bigint into resolved_unread_count
  from public.net_pulse_notifications as notification
  where notification.recipient_account_id = viewer_account_id
    and notification.read_at is null
    and public.net_pulse_account_is_currently_visible(notification.actor_account_id)
    and (
      notification.notification_type = 'follow'
      or (
        notification.post_id is not null
        and public.net_pulse_post_is_visible(notification.post_id)
      )
    );

  return query select resolved_unread_count;
end;
$$;

revoke all on function public.fetch_net_pulse_notification_state()
  from public, anon, authenticated;

create or replace function public.mark_net_pulse_notification_read(
  requested_notification_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  marked_notification_id uuid;
  changed_read_state boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_notification_id is null then
    raise exception 'A PULSE notification is required.' using errcode = '22023';
  end if;
  viewer_account_id := public.current_net_pulse_owner_account_id();
  if viewer_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;

  update public.net_pulse_notifications as notification
  set read_at = timezone('utc', now())
  where notification.id = requested_notification_id
    and notification.recipient_account_id = viewer_account_id
    and notification.read_at is null
    and public.net_pulse_account_is_currently_visible(notification.actor_account_id)
    and (
      notification.notification_type = 'follow'
      or (
        notification.post_id is not null
        and public.net_pulse_post_is_visible(notification.post_id)
      )
    )
  returning notification.id into marked_notification_id;

  changed_read_state := marked_notification_id is not null;

  if marked_notification_id is null then
    select notification.id into marked_notification_id
    from public.net_pulse_notifications as notification
    where notification.id = requested_notification_id
      and notification.recipient_account_id = viewer_account_id
      and public.net_pulse_account_is_currently_visible(notification.actor_account_id)
      and (
        notification.notification_type = 'follow'
        or (
          notification.post_id is not null
          and public.net_pulse_post_is_visible(notification.post_id)
        )
      );
  end if;
  if marked_notification_id is null then
    raise exception 'The requested PULSE notification is unavailable.' using errcode = 'P0002';
  end if;

  if changed_read_state then
    perform public.signal_net_pulse_notification_read_change();
  end if;
  return marked_notification_id;
end;
$$;

revoke all on function public.mark_net_pulse_notification_read(uuid)
  from public, anon, authenticated;

create or replace function public.mark_all_net_pulse_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  changed_rows integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  viewer_account_id := public.current_net_pulse_owner_account_id();
  if viewer_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;

  update public.net_pulse_notifications as notification
  set read_at = timezone('utc', now())
  where notification.recipient_account_id = viewer_account_id
    and notification.read_at is null
    and public.net_pulse_account_is_currently_visible(notification.actor_account_id)
    and (
      notification.notification_type = 'follow'
      or (
        notification.post_id is not null
        and public.net_pulse_post_is_visible(notification.post_id)
      )
    );
  get diagnostics changed_rows = row_count;

  if changed_rows > 0 then
    perform public.signal_net_pulse_notification_read_change();
  end if;
  return changed_rows;
end;
$$;

revoke all on function public.mark_all_net_pulse_notifications_read()
  from public, anon, authenticated;

-- Reassert the intended authenticated wrappers.  Legacy workers and every
-- visibility helper remain private.
revoke all on function public.fetch_net_pulse_account_summaries(uuid, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_discover_accounts(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_relationship_page(uuid, text, uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_relationship_accounts(uuid, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_mentions_for_posts(uuid[], uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_notification_page(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_notification_state(uuid)
  from public, anon, authenticated;
revoke all on function public.mark_net_pulse_notification_read(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.mark_all_net_pulse_notifications_read(uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_page(text, uuid, uuid, text, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_thread_page(uuid, uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;

grant execute on function public.fetch_net_pulse_account_summaries(uuid, text, uuid, integer)
  to authenticated;
grant execute on function public.fetch_net_pulse_discover_accounts(uuid, integer)
  to authenticated;
grant execute on function public.fetch_net_pulse_relationship_page(uuid, text, uuid, timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.fetch_net_pulse_relationship_accounts(uuid, text, uuid, integer)
  to authenticated;
grant execute on function public.fetch_net_pulse_mentions_for_posts(uuid[], uuid)
  to authenticated;
grant execute on function public.fetch_net_pulse_notification_page(uuid, timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.fetch_net_pulse_notification_state(uuid)
  to authenticated;
grant execute on function public.mark_net_pulse_notification_read(uuid, uuid)
  to authenticated;
grant execute on function public.mark_all_net_pulse_notifications_read(uuid)
  to authenticated;
grant execute on function public.fetch_net_pulse_page(text, uuid, uuid, text, timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.fetch_net_pulse_thread_page(uuid, uuid, timestamptz, uuid, integer)
  to authenticated;

commit;
