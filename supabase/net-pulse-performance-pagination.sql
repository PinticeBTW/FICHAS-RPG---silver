-- PULSE Performance, Pagination & Free-Tier Hardening V1.
-- Run after net-pulse-social-navigation.sql.

create extension if not exists pg_trgm;

-- Feed reads should never reopen large character-sheet JSON merely to render
-- an avatar. This is a presentation cache only; ownership remains authoritative
-- in net_app_accounts/net_identity_links.
create table if not exists public.net_pulse_account_presentation (
  account_id uuid primary key references public.net_app_accounts (id) on delete cascade,
  avatar_url text,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_pulse_account_presentation_avatar_limit check (
    avatar_url is null or char_length(avatar_url) <= 2048
  )
);

comment on table public.net_pulse_account_presentation is
  'Derived PULSE avatar projection. It prevents feed/directory reads from repeatedly loading full sheet JSON; it is not ownership authority.';

alter table public.net_pulse_account_presentation enable row level security;
revoke all on public.net_pulse_account_presentation from anon, authenticated;

create or replace function public.refresh_net_pulse_account_presentation(
  requested_account_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.net_pulse_account_presentation (account_id, avatar_url, updated_at)
  select
    pulse_account.id,
    coalesce(
      nullif(btrim(pulse_account.avatar_url_override), ''),
      nullif(btrim(universal_profile.avatar_url_override), ''),
      case identity_link.subject_kind
        when 'profile-sheet' then coalesce(
          nullif(btrim(profile_sheet.field_data ->> 'FOTO2'), ''),
          nullif(btrim(profile_sheet.field_data ->> 'FOTO'), '')
        )
        when 'npc-card' then coalesce(
          nullif(btrim(npc_card.field_data ->> 'FOTO2'), ''),
          nullif(btrim(npc_card.field_data ->> 'FOTO'), '')
        )
        when 'character' then nullif(btrim(campaign_character.portrait_url), '')
      end
    ),
    timezone('utc', now())
  from public.net_app_accounts as pulse_account
  left join public.net_identity_links as identity_link
    on identity_link.id = pulse_account.identity_link_id
  left join public.net_universal_profiles as universal_profile
    on universal_profile.identity_link_id = identity_link.id
  left join public.character_sheet_forms as profile_sheet
    on identity_link.subject_kind = 'profile-sheet'
    and profile_sheet.profile_id = identity_link.subject_id
  left join public.npc_cards as npc_card
    on identity_link.subject_kind = 'npc-card'
    and npc_card.id = identity_link.subject_id
  left join public.characters as campaign_character
    on identity_link.subject_kind = 'character'
    and campaign_character.id = identity_link.subject_id
  where pulse_account.id = requested_account_id
    and pulse_account.app_id = 'pulse'
  on conflict (account_id) do update set
    avatar_url = excluded.avatar_url,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.refresh_net_pulse_identity_presentation(
  requested_identity_link_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pulse_account_id uuid;
begin
  for pulse_account_id in
    select account.id
    from public.net_app_accounts as account
    where account.app_id = 'pulse'
      and account.identity_link_id = requested_identity_link_id
  loop
    perform public.refresh_net_pulse_account_presentation(pulse_account_id);
  end loop;
end;
$$;

create or replace function public.refresh_net_pulse_presentation_from_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.app_id = 'pulse' then
    perform public.refresh_net_pulse_account_presentation(new.id);
  end if;
  return null;
end;
$$;

create or replace function public.refresh_net_pulse_presentation_from_universal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.refresh_net_pulse_identity_presentation(
    case when tg_op = 'DELETE' then old.identity_link_id else new.identity_link_id end
  );
  return null;
end;
$$;

create or replace function public.refresh_net_pulse_presentation_from_sheet()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_profile_id uuid := case when tg_op = 'DELETE' then old.profile_id else new.profile_id end;
  linked_identity_id uuid;
begin
  if tg_op = 'UPDATE'
    and (old.field_data ->> 'FOTO2') is not distinct from (new.field_data ->> 'FOTO2')
    and (old.field_data ->> 'FOTO') is not distinct from (new.field_data ->> 'FOTO')
  then
    return null;
  end if;
  for linked_identity_id in
    select identity_link.id
    from public.net_identity_links as identity_link
    where identity_link.subject_kind = 'profile-sheet'
      and identity_link.subject_id = target_profile_id
  loop
    perform public.refresh_net_pulse_identity_presentation(linked_identity_id);
  end loop;
  return null;
end;
$$;

create or replace function public.refresh_net_pulse_presentation_from_npc()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_npc_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  linked_identity_id uuid;
begin
  if tg_op = 'UPDATE'
    and (old.field_data ->> 'FOTO2') is not distinct from (new.field_data ->> 'FOTO2')
    and (old.field_data ->> 'FOTO') is not distinct from (new.field_data ->> 'FOTO')
  then
    return null;
  end if;
  for linked_identity_id in
    select identity_link.id
    from public.net_identity_links as identity_link
    where identity_link.subject_kind = 'npc-card'
      and identity_link.subject_id = target_npc_id
  loop
    perform public.refresh_net_pulse_identity_presentation(linked_identity_id);
  end loop;
  return null;
end;
$$;

create or replace function public.refresh_net_pulse_presentation_from_character()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_character_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  linked_identity_id uuid;
begin
  for linked_identity_id in
    select identity_link.id
    from public.net_identity_links as identity_link
    where identity_link.subject_kind = 'character'
      and identity_link.subject_id = target_character_id
  loop
    perform public.refresh_net_pulse_identity_presentation(linked_identity_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists net_app_accounts_refresh_pulse_presentation on public.net_app_accounts;
create trigger net_app_accounts_refresh_pulse_presentation
after insert or update of avatar_url_override, identity_link_id on public.net_app_accounts
for each row execute procedure public.refresh_net_pulse_presentation_from_account();

drop trigger if exists net_universal_profiles_refresh_pulse_presentation on public.net_universal_profiles;
create trigger net_universal_profiles_refresh_pulse_presentation
after insert or update of avatar_url_override or delete on public.net_universal_profiles
for each row execute procedure public.refresh_net_pulse_presentation_from_universal();

drop trigger if exists character_sheet_forms_refresh_pulse_presentation on public.character_sheet_forms;
create trigger character_sheet_forms_refresh_pulse_presentation
after insert or update of field_data or delete on public.character_sheet_forms
for each row execute procedure public.refresh_net_pulse_presentation_from_sheet();

drop trigger if exists npc_cards_refresh_pulse_presentation on public.npc_cards;
create trigger npc_cards_refresh_pulse_presentation
after insert or update of field_data or delete on public.npc_cards
for each row execute procedure public.refresh_net_pulse_presentation_from_npc();

drop trigger if exists characters_refresh_pulse_presentation on public.characters;
create trigger characters_refresh_pulse_presentation
after insert or update of portrait_url or delete on public.characters
for each row execute procedure public.refresh_net_pulse_presentation_from_character();

-- One set-based backfill avoids an installation-time query per account.
insert into public.net_pulse_account_presentation (account_id, avatar_url, updated_at)
select
  pulse_account.id,
  coalesce(
    nullif(btrim(pulse_account.avatar_url_override), ''),
    nullif(btrim(universal_profile.avatar_url_override), ''),
    case identity_link.subject_kind
      when 'profile-sheet' then coalesce(
        nullif(btrim(profile_sheet.field_data ->> 'FOTO2'), ''),
        nullif(btrim(profile_sheet.field_data ->> 'FOTO'), '')
      )
      when 'npc-card' then coalesce(
        nullif(btrim(npc_card.field_data ->> 'FOTO2'), ''),
        nullif(btrim(npc_card.field_data ->> 'FOTO'), '')
      )
      when 'character' then nullif(btrim(campaign_character.portrait_url), '')
    end
  ),
  timezone('utc', now())
from public.net_app_accounts as pulse_account
left join public.net_identity_links as identity_link
  on identity_link.id = pulse_account.identity_link_id
left join public.net_universal_profiles as universal_profile
  on universal_profile.identity_link_id = identity_link.id
left join public.character_sheet_forms as profile_sheet
  on identity_link.subject_kind = 'profile-sheet'
  and profile_sheet.profile_id = identity_link.subject_id
left join public.npc_cards as npc_card
  on identity_link.subject_kind = 'npc-card'
  and npc_card.id = identity_link.subject_id
left join public.characters as campaign_character
  on identity_link.subject_kind = 'character'
  and campaign_character.id = identity_link.subject_id
where pulse_account.app_id = 'pulse'
on conflict (account_id) do update set
  avatar_url = excluded.avatar_url,
  updated_at = excluded.updated_at;

-- Cursor-critical indexes. Existing indexes with the same leading column but
-- without the deterministic tie-breaker are replaced rather than duplicated.
drop index if exists public.net_pulse_posts_created_at_idx;
drop index if exists public.net_pulse_posts_author_created_idx;
drop index if exists public.net_pulse_posts_parent_created_idx;
drop index if exists public.net_pulse_posts_visible_created_idx;

create index if not exists net_pulse_posts_root_page_idx
  on public.net_pulse_posts (created_at desc, id desc)
  where parent_post_id is null and deleted_at is null;

create index if not exists net_pulse_posts_author_root_page_idx
  on public.net_pulse_posts (author_account_id, created_at desc, id desc)
  where parent_post_id is null and deleted_at is null;

create index if not exists net_pulse_posts_reply_page_idx
  on public.net_pulse_posts (parent_post_id, created_at asc, id asc)
  where parent_post_id is not null and deleted_at is null;

create index if not exists net_pulse_posts_search_trgm_idx
  on public.net_pulse_posts using gin (lower(body) gin_trgm_ops)
  where parent_post_id is null and deleted_at is null;

drop index if exists public.net_pulse_follows_followed_idx;
create index net_pulse_follows_followed_idx
  on public.net_pulse_follows (followed_account_id, created_at desc, follower_account_id desc);

create index if not exists net_pulse_follows_follower_activity_idx
  on public.net_pulse_follows (follower_account_id, created_at desc, followed_account_id desc);

drop index if exists public.net_pulse_bookmarks_account_created_idx;
create index net_pulse_bookmarks_account_created_idx
  on public.net_pulse_bookmarks (account_id, created_at desc, post_id desc);

drop index if exists public.net_pulse_boosts_account_idx;
create index net_pulse_boosts_account_idx
  on public.net_pulse_boosts (account_id, created_at desc, post_id desc);

create index if not exists net_pulse_profiles_public_discovery_idx
  on public.net_pulse_profiles (created_at desc, account_id desc)
  where visibility = 'public' and discoverable;

create index if not exists net_app_accounts_pulse_handle_search_trgm_idx
  on public.net_app_accounts using gin (lower(handle) gin_trgm_ops)
  where app_id = 'pulse' and status = 'active';

-- Bounded renderer. All aggregates are restricted to the requested post IDs
-- or their small set of authors; it never scans/aggregates the whole network.
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
      and post.deleted_at is null
  ),
  selected_authors as (
    select distinct post.author_account_id as account_id from selected_posts as post
  ),
  follower_stats as (
    select follow.followed_account_id as account_id, count(*)::bigint as total
    from public.net_pulse_follows as follow
    join selected_authors as author on author.account_id = follow.followed_account_id
    group by follow.followed_account_id
  ),
  following_stats as (
    select follow.follower_account_id as account_id, count(*)::bigint as total
    from public.net_pulse_follows as follow
    join selected_authors as author on author.account_id = follow.follower_account_id
    group by follow.follower_account_id
  ),
  pulse_stats as (
    select pulse.author_account_id as account_id, count(*)::bigint as total
    from public.net_pulse_posts as pulse
    join selected_authors as author on author.account_id = pulse.author_account_id
    where pulse.parent_post_id is null and pulse.deleted_at is null
    group by pulse.author_account_id
  ),
  reply_stats as (
    select reply.parent_post_id as post_id, count(*)::bigint as total
    from public.net_pulse_posts as reply
    join selected_posts as selected on selected.id = reply.parent_post_id
    where reply.deleted_at is null
    group by reply.parent_post_id
  ),
  reaction_stats as (
    select reaction.post_id, count(*)::bigint as total
    from public.net_pulse_reactions as reaction
    join selected_posts as selected on selected.id = reaction.post_id
    group by reaction.post_id
  ),
  boost_stats as (
    select boost.post_id, count(*)::bigint as total
    from public.net_pulse_boosts as boost
    join selected_posts as selected on selected.id = boost.post_id
    group by boost.post_id
  ),
  viewer_follows as (
    select follow.followed_account_id
    from public.net_pulse_follows as follow
    join selected_authors as author on author.account_id = follow.followed_account_id
    where follow.follower_account_id = requested_viewer_account_id
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
      and post.deleted_at is null
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
      and post.deleted_at is null
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
      and post.deleted_at is null
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
      and post.deleted_at is null
    where bookmark.account_id = requested_viewer_account_id
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
        and post.deleted_at is null
      where follow.follower_account_id = requested_viewer_account_id

      union all

      select post.id, boost.created_at, booster.id, booster.handle
      from public.net_pulse_follows as follow
      join public.net_pulse_boosts as boost on boost.account_id = follow.followed_account_id
      join public.net_pulse_posts as post
        on post.id = boost.post_id
        and post.parent_post_id is null
        and post.deleted_at is null
      join public.net_app_accounts as booster
        on booster.id = boost.account_id
        and booster.app_id = 'pulse'
        and booster.status = 'active'
      where follow.follower_account_id = requested_viewer_account_id
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

create or replace function public.fetch_net_pulse_page(
  requested_mode text,
  requested_profile_account_id uuid default null,
  requested_search_query text default null,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
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
    raise exception 'PULSE cursor timestamp and id must be supplied together.' using errcode = '22023';
  end if;
  viewer_account_id := public.current_net_pulse_owner_account_id();

  return query
  with candidate_page as (
    select candidate.*
    from public.net_pulse_page_candidates(
      requested_mode,
      requested_profile_account_id,
      requested_search_query,
      requested_cursor_at,
      requested_cursor_id,
      safe_limit,
      viewer_account_id
    ) as candidate
  ),
  candidate_marked as (
    select candidate.*,
      count(*) over () > safe_limit as has_more,
      row_number() over (order by candidate.sort_at desc, candidate.post_id desc) as row_number
    from candidate_page as candidate
  ),
  selected_candidates as (
    select candidate.*
    from candidate_marked as candidate
    where candidate.row_number <= safe_limit
  ),
  rendered as (
    select row.*
    from public.net_pulse_render_post_rows(
      coalesce((select array_agg(candidate.post_id) from selected_candidates as candidate), array[]::uuid[]),
      viewer_account_id
    ) as row
  )
  select
    rendered.id,
    rendered.author_account_id,
    rendered.parent_post_id,
    rendered.body,
    rendered.created_at,
    rendered.updated_at,
    rendered.author_handle,
    rendered.author_display_name,
    rendered.author_avatar_url,
    rendered.author_status,
    rendered.author_bio,
    rendered.author_visibility,
    rendered.author_discoverable,
    rendered.author_followers,
    rendered.author_following,
    rendered.author_pulses,
    rendered.viewer_follows_author,
    rendered.reply_count,
    rendered.reaction_count,
    rendered.boost_count,
    rendered.viewer_reacted,
    rendered.viewer_boosted,
    rendered.viewer_bookmarked,
    candidate.followed_booster_account_id,
    candidate.followed_booster_handle,
    candidate.sort_at,
    candidate.sort_at,
    candidate.has_more
  from selected_candidates as candidate
  join rendered on rendered.id = candidate.post_id
  order by candidate.sort_at desc, candidate.post_id desc;
end;
$$;

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
      and root.deleted_at is null
  ) then
    raise exception 'The requested PULSE thread is unavailable.' using errcode = 'P0002';
  end if;
  viewer_account_id := public.current_net_pulse_owner_account_id();

  return query
  with reply_page as (
    select reply.id, reply.created_at
    from public.net_pulse_posts as reply
    where reply.parent_post_id = requested_root_post_id
      and reply.deleted_at is null
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

-- Bounded account renderer shared by account search, Discover and social-graph
-- ledgers. Counts are grouped only across the selected account IDs.
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
  ),
  follower_stats as (
    select follow.followed_account_id as account_id, count(*)::bigint as total
    from public.net_pulse_follows as follow
    join selected_accounts as account on account.id = follow.followed_account_id
    group by follow.followed_account_id
  ),
  following_stats as (
    select follow.follower_account_id as account_id, count(*)::bigint as total
    from public.net_pulse_follows as follow
    join selected_accounts as account on account.id = follow.follower_account_id
    group by follow.follower_account_id
  ),
  pulse_stats as (
    select post.author_account_id as account_id, count(*)::bigint as total
    from public.net_pulse_posts as post
    join selected_accounts as account on account.id = post.author_account_id
    where post.parent_post_id is null and post.deleted_at is null
    group by post.author_account_id
  ),
  viewer_follows as (
    select follow.followed_account_id
    from public.net_pulse_follows as follow
    join selected_accounts as account on account.id = follow.followed_account_id
    where follow.follower_account_id = requested_viewer_account_id
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
  left join public.net_pulse_account_presentation as presentation on presentation.account_id = account.id
  left join follower_stats as follower_stat on follower_stat.account_id = account.id
  left join following_stats as following_stat on following_stat.account_id = account.id
  left join pulse_stats as pulse_stat on pulse_stat.account_id = account.id
  left join viewer_follows as viewer_follow on viewer_follow.followed_account_id = account.id;
$$;

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
          and account.status = 'active'
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
      and (
        (
          requested_discoverable_only
          and account.status = 'active'
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
  where account.id = requested_profile_account_id and account.app_id = 'pulse';

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

-- Legacy relationship readers are deliberately capped to one small page.
create or replace function public.fetch_net_pulse_relationship_accounts(
  requested_profile_account_id uuid,
  requested_direction text,
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
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    page.account_id,
    page.handle,
    page.avatar_url,
    page.bio,
    page.visibility,
    page.discoverable,
    page.status,
    page.followers_count,
    page.following_count,
    page.pulses_count,
    page.viewer_following
  from public.fetch_net_pulse_relationship_page(
    requested_profile_account_id,
    requested_direction,
    null,
    null,
    least(greatest(coalesce(requested_limit, 30), 1), 30)
  ) as page;
$$;

-- Compatibility read for older clients: one bounded City page, never the old
-- 200/500-row recursive feed.
create or replace function public.fetch_net_pulse_feed(
  requested_limit integer default 20
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
  following_activity_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    page.id,
    page.author_account_id,
    page.parent_post_id,
    page.body,
    page.created_at,
    page.updated_at,
    page.author_handle,
    page.author_display_name,
    page.author_avatar_url,
    page.author_status,
    page.author_bio,
    page.author_visibility,
    page.author_discoverable,
    page.author_followers,
    page.author_following,
    page.author_pulses,
    page.viewer_follows_author,
    page.reply_count,
    page.reaction_count,
    page.boost_count,
    page.viewer_reacted,
    page.viewer_boosted,
    page.viewer_bookmarked,
    page.followed_booster_account_id,
    page.followed_booster_handle,
    page.following_activity_at
  from public.fetch_net_pulse_page(
    'city', null, null, null, null,
    least(greatest(coalesce(requested_limit, 20), 1), 20)
  ) as page;
$$;

-- Product rule: self-boost is valid PULSE activity. Ownership, active-account,
-- visibility and audit checks remain unchanged.
create or replace function public.set_net_pulse_boost(
  requested_post_id uuid,
  requested_boosted boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
  acting_account_id uuid;
  target_post public.net_pulse_posts%rowtype;
  changed_rows integer := 0;
begin
  if actor_profile_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_boosted is null then
    raise exception 'A desired boost state is required.' using errcode = '22023';
  end if;
  acting_account_id := public.current_net_pulse_owner_account_id();
  if acting_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;

  select post.* into target_post
  from public.net_pulse_posts as post
  where post.id = requested_post_id and post.deleted_at is null;
  if not found or not public.net_pulse_post_is_visible(target_post.id) then
    raise exception 'The requested PULSE is not available.' using errcode = 'P0002';
  end if;
  if target_post.parent_post_id is not null then
    raise exception 'Replies cannot be boosted in PULSE V1.' using errcode = '22023';
  end if;

  if requested_boosted then
    insert into public.net_pulse_boosts (post_id, account_id)
    values (target_post.id, acting_account_id)
    on conflict (post_id, account_id) do nothing;
  else
    delete from public.net_pulse_boosts as boost
    where boost.post_id = target_post.id and boost.account_id = acting_account_id;
  end if;
  get diagnostics changed_rows = row_count;

  if changed_rows > 0 then
    insert into public.net_action_audit (
      authenticated_actor_profile_id, presented_account_id, action_mode,
      action_type, authorization_basis, resource_type, resource_id
    ) values (
      actor_profile_id, acting_account_id, 'owner',
      case when requested_boosted then 'pulse.boost.add' else 'pulse.boost.remove' end,
      'controlled-playable-identity', 'pulse-post', target_post.id
    );
  end if;
  return requested_boosted;
end;
$$;

-- One compact revision row remains the only client subscription. Scoped
-- revisions let the client invalidate only the active surface.
alter table public.net_pulse_realtime_state
  add column if not exists content_revision bigint not null default 0,
  add column if not exists profile_revision bigint not null default 0,
  add column if not exists engagement_revision bigint not null default 0,
  add column if not exists last_entity text,
  add column if not exists last_operation text,
  add column if not exists last_resource_id uuid,
  add column if not exists last_parent_post_id uuid,
  add column if not exists last_account_id uuid;

create or replace function public.signal_net_pulse_realtime_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  scope_name text;
  resource_id uuid;
  parent_id uuid;
  account_id uuid;
  operation_name text := lower(tg_op);
begin
  if tg_table_name = 'net_app_accounts' then
    if tg_op = 'DELETE' then
      if old.app_id <> 'pulse' then return null; end if;
      resource_id := old.id;
      account_id := old.id;
    else
      if new.app_id <> 'pulse' then return null; end if;
      resource_id := new.id;
      account_id := new.id;
    end if;
    scope_name := 'profile';
  elsif tg_table_name = 'net_pulse_profiles' then
    resource_id := case when tg_op = 'DELETE' then old.account_id else new.account_id end;
    account_id := resource_id;
    scope_name := 'profile';
  elsif tg_table_name = 'net_pulse_posts' then
    resource_id := case when tg_op = 'DELETE' then old.id else new.id end;
    parent_id := case when tg_op = 'DELETE' then old.parent_post_id else new.parent_post_id end;
    account_id := case when tg_op = 'DELETE' then old.author_account_id else new.author_account_id end;
    if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
      operation_name := 'soft-delete';
    end if;
    scope_name := 'content';
  elsif tg_table_name in ('net_pulse_reactions', 'net_pulse_boosts', 'net_pulse_bookmarks') then
    resource_id := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
    account_id := case when tg_op = 'DELETE' then old.account_id else new.account_id end;
    scope_name := 'engagement';
  elsif tg_table_name = 'net_pulse_follows' then
    resource_id := case when tg_op = 'DELETE' then old.followed_account_id else new.followed_account_id end;
    account_id := case when tg_op = 'DELETE' then old.follower_account_id else new.follower_account_id end;
    scope_name := 'engagement';
  else
    scope_name := 'content';
  end if;

  insert into public.net_pulse_realtime_state (
    channel,
    revision,
    content_revision,
    profile_revision,
    engagement_revision,
    last_entity,
    last_operation,
    last_resource_id,
    last_parent_post_id,
    last_account_id,
    updated_at
  ) values (
    'public',
    1,
    case when scope_name = 'content' then 1 else 0 end,
    case when scope_name = 'profile' then 1 else 0 end,
    case when scope_name = 'engagement' then 1 else 0 end,
    tg_table_name,
    operation_name,
    resource_id,
    parent_id,
    account_id,
    timezone('utc', now())
  )
  on conflict (channel) do update set
    revision = public.net_pulse_realtime_state.revision + 1,
    content_revision = public.net_pulse_realtime_state.content_revision
      + case when scope_name = 'content' then 1 else 0 end,
    profile_revision = public.net_pulse_realtime_state.profile_revision
      + case when scope_name = 'profile' then 1 else 0 end,
    engagement_revision = public.net_pulse_realtime_state.engagement_revision
      + case when scope_name = 'engagement' then 1 else 0 end,
    last_entity = excluded.last_entity,
    last_operation = excluded.last_operation,
    last_resource_id = excluded.last_resource_id,
    last_parent_post_id = excluded.last_parent_post_id,
    last_account_id = excluded.last_account_id,
    updated_at = excluded.updated_at;

  return null;
end;
$$;

-- Clients now subscribe only to the compact revision row. Removing the former
-- direct table publications avoids serializing the same logical PULSE mutation
-- through several Realtime streams. No repository client subscribes to these
-- tables directly after this batch.
do $$
declare
  published_table text;
begin
  foreach published_table in array array[
    'net_pulse_posts',
    'net_pulse_profiles',
    'net_app_accounts'
  ]
  loop
    if exists (
      select 1
      from pg_publication_tables as publication_table
      where publication_table.pubname = 'supabase_realtime'
        and publication_table.schemaname = 'public'
        and publication_table.tablename = published_table
    ) then
      execute format(
        'alter publication supabase_realtime drop table public.%I',
        published_table
      );
    end if;
  end loop;
end $$;

revoke all on function public.refresh_net_pulse_account_presentation(uuid) from public;
revoke all on function public.refresh_net_pulse_identity_presentation(uuid) from public;
revoke all on function public.refresh_net_pulse_presentation_from_account() from public;
revoke all on function public.refresh_net_pulse_presentation_from_universal() from public;
revoke all on function public.refresh_net_pulse_presentation_from_sheet() from public;
revoke all on function public.refresh_net_pulse_presentation_from_npc() from public;
revoke all on function public.refresh_net_pulse_presentation_from_character() from public;
revoke all on function public.net_pulse_render_post_rows(uuid[], uuid) from public;
revoke all on function public.net_pulse_page_candidates(text, uuid, text, timestamptz, uuid, integer, uuid) from public;
revoke all on function public.net_pulse_account_summary_rows(uuid[], uuid) from public;
revoke all on function public.fetch_net_pulse_page(text, uuid, text, timestamptz, uuid, integer) from public;
revoke all on function public.fetch_net_pulse_thread_page(uuid, timestamptz, uuid, integer) from public;
revoke all on function public.fetch_net_pulse_relationship_page(uuid, text, timestamptz, uuid, integer) from public;

revoke all on function public.refresh_net_pulse_account_presentation(uuid) from anon, authenticated;
revoke all on function public.refresh_net_pulse_identity_presentation(uuid) from anon, authenticated;
revoke all on function public.net_pulse_render_post_rows(uuid[], uuid) from anon, authenticated;
revoke all on function public.net_pulse_page_candidates(text, uuid, text, timestamptz, uuid, integer, uuid) from anon, authenticated;
revoke all on function public.net_pulse_account_summary_rows(uuid[], uuid) from anon, authenticated;
revoke all on function public.fetch_net_pulse_feed(integer) from anon;
revoke all on function public.fetch_net_pulse_account_summaries(text, uuid, integer) from anon;
revoke all on function public.fetch_net_pulse_discover_accounts(integer) from anon;
revoke all on function public.fetch_net_pulse_relationship_accounts(uuid, text, integer) from anon;
revoke all on function public.set_net_pulse_boost(uuid, boolean) from anon;

grant execute on function public.fetch_net_pulse_page(text, uuid, text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_thread_page(uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_relationship_page(uuid, text, timestamptz, uuid, integer) to authenticated;

-- Reassert existing grants after CREATE OR REPLACE.
grant execute on function public.fetch_net_pulse_feed(integer) to authenticated;
grant execute on function public.fetch_net_pulse_account_summaries(text, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_discover_accounts(integer) to authenticated;
grant execute on function public.fetch_net_pulse_relationship_accounts(uuid, text, integer) to authenticated;
grant execute on function public.set_net_pulse_boost(uuid, boolean) to authenticated;
