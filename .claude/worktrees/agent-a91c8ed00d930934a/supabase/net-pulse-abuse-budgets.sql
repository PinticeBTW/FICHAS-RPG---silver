-- PULSE V1 final hardening: compact transactional abuse budgets.
-- Run after net-pulse-context-binding.sql.
-- Data-preserving and idempotent; no existing PULSE content is rewritten.

begin;

create table if not exists public.net_pulse_rate_limits (
  actor_profile_id uuid not null references public.profiles(id) on delete cascade,
  action_class text not null,
  short_window_started_at timestamptz not null,
  short_count integer not null default 0 check (short_count >= 0),
  long_window_started_at timestamptz not null,
  long_count integer not null default 0 check (long_count >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (actor_profile_id, action_class),
  constraint net_pulse_rate_limits_action_class_check check (
    action_class in (
      'root_pulse',
      'reply',
      'follow',
      'engagement',
      'profile',
      'delete',
      'mention_recipients'
    )
  )
);

comment on table public.net_pulse_rate_limits is
  'Constant-size PULSE mutation budgets keyed by authenticated real actor and a small action class. Not an event log or identity authority.';

alter table public.net_pulse_rate_limits enable row level security;
revoke all on table public.net_pulse_rate_limits from public, anon, authenticated;

-- Internal only. The caller chooses a fixed action class and a cost; window
-- configuration cannot be supplied by a client or by a public RPC argument.
-- The row lock serializes concurrent requests for the same actor/class. Since
-- this runs inside the mutation transaction, any downstream failure rolls the
-- counter update back with the rejected mutation.
create or replace function public.consume_net_pulse_rate_limit(
  requested_action_class text,
  requested_cost integer default 1
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  authenticated_actor_id uuid := auth.uid();
  bucket_now timestamptz := transaction_timestamp();
  short_window interval;
  short_limit integer;
  long_window interval;
  long_limit integer;
  inserted_rows integer := 0;
  bucket public.net_pulse_rate_limits%rowtype;
  effective_short_count integer;
  effective_long_count integer;
  next_short_started_at timestamptz;
  next_long_started_at timestamptz;
begin
  if authenticated_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_cost is null or requested_cost < 0 then
    raise exception 'A valid PULSE rate-limit cost is required.' using errcode = '22023';
  end if;
  if requested_cost = 0 then
    return;
  end if;

  case requested_action_class
    when 'root_pulse' then
      short_window := interval '1 minute'; short_limit := 5;
      long_window := interval '1 hour'; long_limit := 30;
    when 'reply' then
      short_window := interval '1 minute'; short_limit := 10;
      long_window := interval '1 hour'; long_limit := 60;
    when 'follow' then
      short_window := interval '1 minute'; short_limit := 20;
      long_window := interval '1 hour'; long_limit := 100;
    when 'engagement' then
      short_window := interval '1 minute'; short_limit := 30;
      long_window := interval '1 hour'; long_limit := 300;
    when 'profile' then
      short_window := interval '10 minutes'; short_limit := 10;
      long_window := interval '1 hour'; long_limit := 30;
    when 'delete' then
      short_window := interval '1 minute'; short_limit := 20;
      long_window := interval '1 hour'; long_limit := 100;
    when 'mention_recipients' then
      short_window := interval '10 minutes'; short_limit := 30;
      long_window := interval '1 hour'; long_limit := 100;
    else
      raise exception 'Unsupported PULSE rate-limit action class.' using errcode = '22023';
  end case;

  if requested_cost > short_limit or requested_cost > long_limit then
    raise exception 'PULSE_RATE_LIMITED' using errcode = 'P0001';
  end if;

  insert into public.net_pulse_rate_limits (
    actor_profile_id,
    action_class,
    short_window_started_at,
    short_count,
    long_window_started_at,
    long_count,
    updated_at
  ) values (
    authenticated_actor_id,
    requested_action_class,
    bucket_now,
    requested_cost,
    bucket_now,
    requested_cost,
    bucket_now
  )
  on conflict (actor_profile_id, action_class) do nothing;
  get diagnostics inserted_rows = row_count;

  if inserted_rows > 0 then
    return;
  end if;

  select rate_bucket.*
  into bucket
  from public.net_pulse_rate_limits as rate_bucket
  where rate_bucket.actor_profile_id = authenticated_actor_id
    and rate_bucket.action_class = requested_action_class
  for update;

  if not found then
    raise exception 'PULSE rate-limit state could not be synchronized.' using errcode = 'P0001';
  end if;

  if bucket_now >= bucket.short_window_started_at + short_window then
    effective_short_count := 0;
    next_short_started_at := bucket_now;
  else
    effective_short_count := bucket.short_count;
    next_short_started_at := bucket.short_window_started_at;
  end if;

  if bucket_now >= bucket.long_window_started_at + long_window then
    effective_long_count := 0;
    next_long_started_at := bucket_now;
  else
    effective_long_count := bucket.long_count;
    next_long_started_at := bucket.long_window_started_at;
  end if;

  if effective_short_count + requested_cost > short_limit
    or effective_long_count + requested_cost > long_limit
  then
    raise exception 'PULSE_RATE_LIMITED' using errcode = 'P0001';
  end if;

  update public.net_pulse_rate_limits as rate_bucket
  set short_window_started_at = next_short_started_at,
      short_count = effective_short_count + requested_cost,
      long_window_started_at = next_long_started_at,
      long_count = effective_long_count + requested_cost,
      updated_at = bucket_now
  where rate_bucket.actor_profile_id = authenticated_actor_id
    and rate_bucket.action_class = requested_action_class;
end;
$$;

revoke all on function public.consume_net_pulse_rate_limit(text, integer)
  from public, anon, authenticated;

-- Cheap raw-size checks run before trimming, normalization, mention parsing,
-- mutation, audit, notification and realtime work. The 4 KiB transport cap
-- safely accommodates 360 valid four-byte UTF-8 characters.
create or replace function public.validate_net_pulse_content_request(
  requested_body text
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  normalized_body text;
begin
  if octet_length(coalesce(requested_body, '')) > 4096 then
    raise exception 'PULSE content request is too large.' using errcode = '22001';
  end if;
  normalized_body := btrim(coalesce(requested_body, ''));
  if normalized_body = '' then
    raise exception 'PULSE content cannot be empty.' using errcode = '22023';
  end if;
  if char_length(normalized_body) > 360 then
    raise exception 'PULSE content is limited to 360 characters.' using errcode = '22001';
  end if;
  return normalized_body;
end;
$$;

create or replace function public.validate_net_pulse_profile_request(
  requested_handle text,
  requested_bio text,
  requested_visibility text,
  requested_default_feed text
)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if octet_length(coalesce(requested_handle, '')) > 256
    or octet_length(coalesce(requested_bio, '')) > 2048
    or octet_length(coalesce(requested_visibility, '')) > 64
    or octet_length(coalesce(requested_default_feed, '')) > 64
  then
    raise exception 'PULSE profile request is too large.' using errcode = '22001';
  end if;
end;
$$;

revoke all on function public.validate_net_pulse_content_request(text)
  from public, anon, authenticated;
revoke all on function public.validate_net_pulse_profile_request(text, text, text, text)
  from public, anon, authenticated;

-- P0-B context comparison remains first. Expected IDs are assertions only;
-- the legacy workers still derive and verify all mutation authority.
create or replace function public.create_net_pulse_post(
  requested_body text,
  requested_expected_account_id uuid,
  requested_parent_post_id uuid default null
)
returns public.net_pulse_posts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_account_id uuid;
  normalized_body text;
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );
  normalized_body := public.validate_net_pulse_content_request(requested_body);
  perform public.consume_net_pulse_rate_limit(
    case when requested_parent_post_id is null then 'root_pulse' else 'reply' end,
    1
  );
  return public.create_net_pulse_post(
    actual_account_id,
    normalized_body,
    requested_parent_post_id
  );
end;
$$;

create or replace function public.create_net_pulse_post_as_compromised_persona(
  requested_body text,
  requested_expected_session_generation uuid,
  requested_expected_account_id uuid,
  requested_parent_post_id uuid default null
)
returns public.net_pulse_posts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_body text;
begin
  perform public.assert_net_pulse_compromised_context(
    requested_expected_session_generation,
    requested_expected_account_id
  );
  normalized_body := public.validate_net_pulse_content_request(requested_body);
  perform public.consume_net_pulse_rate_limit(
    case when requested_parent_post_id is null then 'root_pulse' else 'reply' end,
    1
  );
  return public.create_net_pulse_post_as_compromised_persona(
    normalized_body,
    requested_parent_post_id
  );
end;
$$;

create or replace function public.set_net_pulse_follow(
  requested_target_account_id uuid,
  requested_following boolean,
  requested_expected_account_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_account_id uuid;
  current_state boolean;
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );
  if requested_following is null then
    raise exception 'A desired follow state is required.' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.net_pulse_follows as follow
    where follow.follower_account_id = actual_account_id
      and follow.followed_account_id = requested_target_account_id
  ) into current_state;

  if current_state is distinct from requested_following then
    perform public.consume_net_pulse_rate_limit('follow', 1);
  end if;
  return public.set_net_pulse_follow(requested_target_account_id, requested_following);
end;
$$;

create or replace function public.set_net_pulse_reaction(
  requested_post_id uuid,
  requested_reacted boolean,
  requested_expected_account_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_account_id uuid;
  current_state boolean;
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );
  if requested_reacted is null then
    raise exception 'A desired reaction state is required.' using errcode = '22023';
  end if;
  select exists (
    select 1 from public.net_pulse_reactions as reaction
    where reaction.post_id = requested_post_id
      and reaction.account_id = actual_account_id
  ) into current_state;
  if current_state is distinct from requested_reacted then
    perform public.consume_net_pulse_rate_limit('engagement', 1);
  end if;
  return public.set_net_pulse_reaction(requested_post_id, requested_reacted);
end;
$$;

create or replace function public.set_net_pulse_boost(
  requested_post_id uuid,
  requested_boosted boolean,
  requested_expected_account_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_account_id uuid;
  current_state boolean;
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );
  if requested_boosted is null then
    raise exception 'A desired boost state is required.' using errcode = '22023';
  end if;
  select exists (
    select 1 from public.net_pulse_boosts as boost
    where boost.post_id = requested_post_id
      and boost.account_id = actual_account_id
  ) into current_state;
  if current_state is distinct from requested_boosted then
    perform public.consume_net_pulse_rate_limit('engagement', 1);
  end if;
  return public.set_net_pulse_boost(requested_post_id, requested_boosted);
end;
$$;

create or replace function public.set_net_pulse_bookmark(
  requested_post_id uuid,
  requested_bookmarked boolean,
  requested_expected_account_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_account_id uuid;
  current_state boolean;
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );
  if requested_bookmarked is null then
    raise exception 'A desired bookmark state is required.' using errcode = '22023';
  end if;
  select exists (
    select 1 from public.net_pulse_bookmarks as bookmark
    where bookmark.post_id = requested_post_id
      and bookmark.account_id = actual_account_id
  ) into current_state;
  if current_state is distinct from requested_bookmarked then
    perform public.consume_net_pulse_rate_limit('engagement', 1);
  end if;
  return public.set_net_pulse_bookmark(requested_post_id, requested_bookmarked);
end;
$$;

create or replace function public.delete_net_pulse_post(
  requested_post_id uuid,
  requested_expected_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_account_id uuid;
  target_author_account_id uuid;
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );
  select post.author_account_id into target_author_account_id
  from public.net_pulse_posts as post
  where post.id = requested_post_id and post.deleted_at is null;
  if target_author_account_id is null or target_author_account_id <> actual_account_id then
    raise exception 'Only the active PULSE owner may delete this content.' using errcode = '42501';
  end if;
  perform public.consume_net_pulse_rate_limit('delete', 1);
  return public.delete_net_pulse_post(requested_post_id);
end;
$$;

create or replace function public.delete_net_pulse_post_as_compromised_persona(
  requested_post_id uuid,
  requested_expected_session_generation uuid,
  requested_expected_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_pulse_compromised_context(
    requested_expected_session_generation,
    requested_expected_account_id
  );
  perform public.consume_net_pulse_rate_limit('delete', 1);
  return public.delete_net_pulse_post_as_compromised_persona(requested_post_id);
end;
$$;

create or replace function public.update_net_pulse_public_profile(
  requested_account_id uuid,
  requested_handle text,
  requested_bio text,
  requested_visibility text,
  requested_show_district boolean,
  requested_discoverable boolean,
  requested_default_feed text,
  requested_expected_account_id uuid
)
returns table (
  account_id uuid,
  handle text,
  bio text,
  visibility text,
  show_district boolean,
  discoverable boolean,
  default_feed text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_account_id uuid;
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );
  if requested_account_id <> actual_account_id then
    raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  perform public.validate_net_pulse_profile_request(
    requested_handle, requested_bio, requested_visibility, requested_default_feed
  );
  perform public.consume_net_pulse_rate_limit('profile', 1);
  return query select legacy_profile.*
  from public.update_net_pulse_public_profile(
    actual_account_id,
    requested_handle,
    requested_bio,
    requested_visibility,
    requested_show_district,
    requested_discoverable,
    requested_default_feed
  ) as legacy_profile;
end;
$$;

create or replace function public.update_net_pulse_profile_as_compromised_persona(
  requested_handle text,
  requested_bio text,
  requested_visibility text,
  requested_show_district boolean,
  requested_discoverable boolean,
  requested_default_feed text,
  requested_expected_session_generation uuid,
  requested_expected_account_id uuid
)
returns table (
  account_id uuid,
  handle text,
  bio text,
  visibility text,
  show_district boolean,
  discoverable boolean,
  default_feed text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_pulse_compromised_context(
    requested_expected_session_generation,
    requested_expected_account_id
  );
  perform public.validate_net_pulse_profile_request(
    requested_handle, requested_bio, requested_visibility, requested_default_feed
  );
  perform public.consume_net_pulse_rate_limit('profile', 1);
  return query select legacy_profile.*
  from public.update_net_pulse_profile_as_compromised_persona(
    requested_handle,
    requested_bio,
    requested_visibility,
    requested_show_district,
    requested_discoverable,
    requested_default_feed
  ) as legacy_profile;
end;
$$;

-- Initial provisioning is naturally one-per-identity, but it still accepts
-- profile text and writes the same public profile surface. Bind it to the
-- active identity, apply the same raw guards, and charge the profile class.
create or replace function public.create_net_pulse_account_with_profile(
  requested_identity_link_id uuid,
  requested_handle text,
  requested_bio text,
  requested_visibility text,
  requested_show_district boolean,
  requested_discoverable boolean,
  requested_default_feed text,
  requested_expected_identity_link_id uuid
)
returns public.net_app_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_identity_link_id uuid;
begin
  actual_identity_link_id := public.assert_net_active_identity_context(
    requested_expected_identity_link_id
  );
  if requested_identity_link_id <> actual_identity_link_id then
    raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  perform public.validate_net_pulse_profile_request(
    requested_handle, requested_bio, requested_visibility, requested_default_feed
  );
  perform public.consume_net_pulse_rate_limit('profile', 1);
  return public.create_net_pulse_account_with_profile(
    actual_identity_link_id,
    requested_handle,
    requested_bio,
    requested_visibility,
    requested_show_district,
    requested_discoverable,
    requested_default_feed
  );
end;
$$;

-- Search remains read-only and does not write a rate bucket. Raw caps precede
-- normalization; minimum lengths stop cheap wildcard/empty scans. Exact UUID
-- account lookup remains unchanged for profile navigation.
create or replace function public.fetch_net_pulse_page(
  requested_mode text,
  requested_expected_account_id uuid,
  requested_profile_account_id uuid default null,
  requested_search_query text default null,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns table (
  id uuid, author_account_id uuid, parent_post_id uuid, body text,
  created_at timestamptz, updated_at timestamptz, author_handle text,
  author_display_name text, author_avatar_url text, author_status text,
  author_bio text, author_visibility text, author_discoverable boolean,
  author_followers bigint, author_following bigint, author_pulses bigint,
  viewer_follows_author boolean, reply_count bigint, reaction_count bigint,
  boost_count bigint, viewer_reacted boolean, viewer_boosted boolean,
  viewer_bookmarked boolean, followed_booster_account_id uuid,
  followed_booster_handle text, following_activity_at timestamptz,
  page_sort_at timestamptz, page_has_more boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_search_query text;
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, false);
  if requested_search_query is not null
    and (
      octet_length(requested_search_query) > 320
      or char_length(requested_search_query) > 80
    )
  then
    raise exception 'PULSE search is limited to 80 characters.' using errcode = '22001';
  end if;
  normalized_search_query := btrim(coalesce(requested_search_query, ''));
  if requested_mode = 'search' and char_length(normalized_search_query) < 3 then
    raise exception 'PULSE content search requires at least 3 characters.' using errcode = '22023';
  end if;
  return query select legacy_page.* from public.fetch_net_pulse_page(
    requested_mode, requested_profile_account_id,
    case when requested_mode = 'search' then normalized_search_query else requested_search_query end,
    requested_cursor_at, requested_cursor_id, requested_limit
  ) as legacy_page;
end;
$$;

create or replace function public.fetch_net_pulse_account_summaries(
  requested_expected_account_id uuid,
  requested_query text default null,
  requested_account_id uuid default null,
  requested_limit integer default 20
)
returns table (
  account_id uuid, handle text, avatar_url text, bio text, visibility text,
  discoverable boolean, status text, followers_count bigint,
  following_count bigint, pulses_count bigint, viewer_following boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_query text;
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, false);
  if requested_query is not null
    and (
      octet_length(requested_query) > 320
      or char_length(requested_query) > 80
    )
  then
    raise exception 'PULSE account search is limited to 80 characters.' using errcode = '22001';
  end if;

  normalized_query := lower(btrim(coalesce(requested_query, '')));
  if left(normalized_query, 1) = '@' then
    normalized_query := substr(normalized_query, 2);
  end if;
  if requested_account_id is null and (
    char_length(normalized_query) < 2
    or normalized_query !~ '^[a-z0-9_.-]+$'
  ) then
    raise exception 'PULSE account search requires at least 2 valid handle characters.' using errcode = '22023';
  end if;

  return query select legacy_summary.*
  from public.fetch_net_pulse_account_summaries(
    case when requested_account_id is null then normalized_query else requested_query end,
    requested_account_id,
    requested_limit
  ) as legacy_summary;
end;
$$;

-- Reuse the notification trigger's already-resolved distinct account set for
-- mention-recipient cost. No second regex/normalization pass is introduced.
create or replace function public.create_net_pulse_post_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_author_account_id uuid;
  root_id uuid := new.id;
  resolved_mention_account_ids uuid[] := array[]::uuid[];
  valid_mention_count integer := 0;
  notifying_mention_count integer := 0;
begin
  if new.parent_post_id is not null then
    select parent.author_account_id
    into parent_author_account_id
    from public.net_pulse_posts as parent
    where parent.id = new.parent_post_id
      and parent.deleted_at is null;
    if not found or not public.net_pulse_post_is_visible(new.parent_post_id) then
      return null;
    end if;
    root_id := public.net_pulse_root_post_id(new.parent_post_id);
  end if;

  with mention_tokens as (
    select public.normalize_net_app_handle((token_match.capture)[2]) as source_handle
    from regexp_matches(
      new.body,
      '(^|[^A-Za-z0-9_.@-])@([A-Za-z0-9_.-]+)',
      'g'
    ) as token_match(capture)
  ),
  resolved_mentions as (
    select distinct account.id
    from mention_tokens as token
    join public.net_app_accounts as account
      on account.app_id = 'pulse'
      and account.status = 'active'
      and account.handle = token.source_handle
    join public.net_pulse_profiles as profile
      on profile.account_id = account.id
    where token.source_handle is not null
  )
  select coalesce(array_agg(mention.id order by mention.id), array[]::uuid[])
  into resolved_mention_account_ids
  from resolved_mentions as mention;

  valid_mention_count := cardinality(resolved_mention_account_ids);
  if valid_mention_count > 10 then
    raise exception 'PULSE supports up to 10 distinct account mentions per Pulse.'
      using errcode = '22023';
  end if;

  select count(*)::integer
  into notifying_mention_count
  from unnest(resolved_mention_account_ids) as mentioned(account_id)
  where mentioned.account_id <> new.author_account_id
    and mentioned.account_id is distinct from parent_author_account_id;

  perform public.consume_net_pulse_rate_limit(
    'mention_recipients',
    notifying_mention_count
  );

  insert into public.net_pulse_post_mentions (
    post_id,
    mentioned_account_id,
    source_handle
  )
  select new.id, account.id, account.handle
  from public.net_app_accounts as account
  where account.id = any(resolved_mention_account_ids)
  on conflict (post_id, mentioned_account_id) do nothing;

  with notification_candidates as (
    select
      parent_author_account_id as recipient_account_id,
      'reply'::text as notification_type
    where parent_author_account_id is not null
      and parent_author_account_id <> new.author_account_id

    union all

    select
      mention.mentioned_account_id,
      'mention'::text
    from public.net_pulse_post_mentions as mention
    where mention.post_id = new.id
      and mention.mentioned_account_id <> new.author_account_id
      and mention.mentioned_account_id is distinct from parent_author_account_id
  )
  insert into public.net_pulse_notifications (
    recipient_account_id,
    actor_account_id,
    notification_type,
    post_id,
    root_post_id
  )
  select
    candidate.recipient_account_id,
    new.author_account_id,
    candidate.notification_type,
    new.id,
    coalesce(root_id, new.id)
  from notification_candidates as candidate
  on conflict do nothing;

  return null;
end;
$$;

-- Reassert all public boundaries after replacing the deployed entry points.
revoke all on function public.create_net_pulse_post(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_net_pulse_post_as_compromised_persona(text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_net_pulse_follow(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.set_net_pulse_reaction(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.set_net_pulse_boost(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.set_net_pulse_bookmark(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.delete_net_pulse_post(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_net_pulse_post_as_compromised_persona(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_net_pulse_public_profile(uuid, text, text, text, boolean, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.update_net_pulse_profile_as_compromised_persona(text, text, text, boolean, boolean, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_net_pulse_account_with_profile(uuid, text, text, text, boolean, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_page(text, uuid, uuid, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_account_summaries(uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.create_net_pulse_post_notifications() from public, anon, authenticated;

grant execute on function public.create_net_pulse_post(text, uuid, uuid) to authenticated;
grant execute on function public.create_net_pulse_post_as_compromised_persona(text, uuid, uuid, uuid) to authenticated;
grant execute on function public.set_net_pulse_follow(uuid, boolean, uuid) to authenticated;
grant execute on function public.set_net_pulse_reaction(uuid, boolean, uuid) to authenticated;
grant execute on function public.set_net_pulse_boost(uuid, boolean, uuid) to authenticated;
grant execute on function public.set_net_pulse_bookmark(uuid, boolean, uuid) to authenticated;
grant execute on function public.delete_net_pulse_post(uuid, uuid) to authenticated;
grant execute on function public.delete_net_pulse_post_as_compromised_persona(uuid, uuid, uuid) to authenticated;
grant execute on function public.update_net_pulse_public_profile(uuid, text, text, text, boolean, boolean, text, uuid) to authenticated;
grant execute on function public.update_net_pulse_profile_as_compromised_persona(text, text, text, boolean, boolean, text, uuid, uuid) to authenticated;
grant execute on function public.create_net_pulse_account_with_profile(uuid, text, text, text, boolean, boolean, text, uuid) to authenticated;
grant execute on function public.fetch_net_pulse_page(text, uuid, uuid, text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_account_summaries(uuid, text, uuid, integer) to authenticated;

-- Legacy workers and the new rate/validation helpers remain non-callable.
revoke all on function public.create_net_pulse_post(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.create_net_pulse_post_as_compromised_persona(text, uuid) from public, anon, authenticated;
revoke all on function public.set_net_pulse_follow(uuid, boolean) from public, anon, authenticated;
revoke all on function public.set_net_pulse_reaction(uuid, boolean) from public, anon, authenticated;
revoke all on function public.set_net_pulse_boost(uuid, boolean) from public, anon, authenticated;
revoke all on function public.set_net_pulse_bookmark(uuid, boolean) from public, anon, authenticated;
revoke all on function public.delete_net_pulse_post(uuid) from public, anon, authenticated;
revoke all on function public.delete_net_pulse_post_as_compromised_persona(uuid) from public, anon, authenticated;
revoke all on function public.update_net_pulse_public_profile(uuid, text, text, text, boolean, boolean, text) from public, anon, authenticated;
revoke all on function public.update_net_pulse_profile_as_compromised_persona(text, text, text, boolean, boolean, text) from public, anon, authenticated;
revoke all on function public.create_net_pulse_account_with_profile(uuid, text, text, text, boolean, boolean, text) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_page(text, uuid, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_account_summaries(text, uuid, integer) from public, anon, authenticated;

-- Preserve P0-A raw-read and existing helper boundaries.
revoke select on table public.net_pulse_posts from public, anon, authenticated;
revoke select on table public.net_pulse_profiles from public, anon, authenticated;
revoke all on function public.assert_net_pulse_account_context(uuid, boolean) from public, anon, authenticated;
revoke all on function public.assert_net_pulse_compromised_context(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assert_net_active_identity_context(uuid) from public, anon, authenticated;

commit;
