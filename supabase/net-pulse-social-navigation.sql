-- PULSE Social Navigation V1: narrow public-account discovery and relationship
-- ledger reads. Run after supabase/net-pulse-engagement.sql.

create or replace function public.net_pulse_account_directory_rows(
  requested_account_ids uuid[] default null,
  requested_discoverable_only boolean default false,
  requested_limit integer default 50
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
  safe_limit integer := least(greatest(coalesce(requested_limit, 50), 1), 200);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  viewer_account_id := public.current_net_pulse_owner_account_id();

  return query
  with follower_counts as (
    select follow.followed_account_id as id, count(*)::bigint as total
    from public.net_pulse_follows as follow
    group by follow.followed_account_id
  ),
  following_counts as (
    select follow.follower_account_id as id, count(*)::bigint as total
    from public.net_pulse_follows as follow
    group by follow.follower_account_id
  ),
  pulse_counts as (
    select post.author_account_id as id, count(*)::bigint as total
    from public.net_pulse_posts as post
    where post.parent_post_id is null and post.deleted_at is null
    group by post.author_account_id
  )
  select
    account.id,
    account.handle,
    coalesce(
      nullif(btrim(account.avatar_url_override), ''),
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
    coalesce(profile.bio, ''),
    profile.visibility,
    profile.discoverable,
    account.status,
    coalesce(follower_count.total, 0),
    coalesce(following_count.total, 0),
    coalesce(pulse_count.total, 0),
    exists (
      select 1
      from public.net_pulse_follows as viewer_follow
      where viewer_follow.follower_account_id = viewer_account_id
        and viewer_follow.followed_account_id = account.id
    )
  from public.net_app_accounts as account
  join public.net_pulse_profiles as profile on profile.account_id = account.id
  left join public.net_identity_links as identity_link on identity_link.id = account.identity_link_id
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
  left join follower_counts as follower_count on follower_count.id = account.id
  left join following_counts as following_count on following_count.id = account.id
  left join pulse_counts as pulse_count on pulse_count.id = account.id
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
        and (
          profile.visibility = 'public'
          or account.id = viewer_account_id
        )
      )
    )
  order by account.created_at desc, account.handle asc
  limit safe_limit;
end;
$$;

create or replace function public.fetch_net_pulse_discover_accounts(
  requested_limit integer default 12
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
  select directory.*
  from public.net_pulse_account_directory_rows(
    null,
    true,
    least(greatest(coalesce(requested_limit, 12), 1), 50)
  ) as directory;
$$;

create or replace function public.fetch_net_pulse_relationship_accounts(
  requested_profile_account_id uuid,
  requested_direction text,
  requested_limit integer default 200
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
  target_account_id uuid;
  target_visibility text;
  related_account_ids uuid[] := array[]::uuid[];
  safe_limit integer := least(greatest(coalesce(requested_limit, 200), 1), 200);
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

  viewer_account_id := public.current_net_pulse_owner_account_id();

  select account.id, profile.visibility
  into target_account_id, target_visibility
  from public.net_app_accounts as account
  join public.net_pulse_profiles as profile on profile.account_id = account.id
  where account.id = requested_profile_account_id
    and account.app_id = 'pulse';

  if not found then
    raise exception 'The requested PULSE profile is unavailable.' using errcode = 'P0002';
  end if;
  if target_visibility <> 'public'
    and target_account_id <> viewer_account_id
  then
    raise exception 'The requested social graph is not publicly available.' using errcode = '42501';
  end if;

  if requested_direction = 'followers' then
    select coalesce(array_agg(follow.follower_account_id order by follow.created_at desc), array[]::uuid[])
    into related_account_ids
    from public.net_pulse_follows as follow
    where follow.followed_account_id = target_account_id;
  else
    select coalesce(array_agg(follow.followed_account_id order by follow.created_at desc), array[]::uuid[])
    into related_account_ids
    from public.net_pulse_follows as follow
    where follow.follower_account_id = target_account_id;
  end if;

  return query
  select directory.*
  from public.net_pulse_account_directory_rows(
    related_account_ids,
    false,
    safe_limit
  ) as directory;
end;
$$;

revoke all on function public.net_pulse_account_directory_rows(uuid[], boolean, integer) from public;
revoke all on function public.fetch_net_pulse_discover_accounts(integer) from public;
revoke all on function public.fetch_net_pulse_relationship_accounts(uuid, text, integer) from public;

revoke all on function public.net_pulse_account_directory_rows(uuid[], boolean, integer) from anon, authenticated;
grant execute on function public.fetch_net_pulse_discover_accounts(integer) to authenticated;
grant execute on function public.fetch_net_pulse_relationship_accounts(uuid, text, integer) to authenticated;
