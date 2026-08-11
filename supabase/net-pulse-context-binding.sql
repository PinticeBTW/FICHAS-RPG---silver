-- PULSE Security P0-B: request-bound active account and compromised persona.
-- Run after net-pulse-read-boundary-reply-depth.sql.
-- Data-preserving and idempotent; no rate limiting is introduced here.

begin;

alter table public.net_gm_persona_sessions
  add column if not exists session_generation uuid;

update public.net_gm_persona_sessions
set session_generation = gen_random_uuid()
where session_generation is null;

alter table public.net_gm_persona_sessions
  alter column session_generation set default gen_random_uuid(),
  alter column session_generation set not null;

comment on column public.net_gm_persona_sessions.session_generation is
  'Non-secret stale-request assertion. Rotates whenever the authoritative persona context is explicitly replaced, including re-entering the same target.';

create or replace function public.rotate_net_gm_persona_session_generation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The trigger only fires for an insert or an explicit persona-context write.
  -- Re-entering the same target is still a new request context and therefore
  -- invalidates requests captured before that authoritative replacement.
  new.session_generation := gen_random_uuid();
  return new;
end;
$$;

drop trigger if exists net_gm_persona_sessions_rotate_generation
  on public.net_gm_persona_sessions;
create trigger net_gm_persona_sessions_rotate_generation
before insert or update of mode, subject_kind, subject_id
on public.net_gm_persona_sessions
for each row execute procedure public.rotate_net_gm_persona_session_generation();

revoke all on function public.rotate_net_gm_persona_session_generation()
  from public, anon, authenticated;

-- Comparison-only assertion. The active-identity row is locked for the outer
-- transaction so a cross-tab switch either commits first (mismatch) or waits
-- until this request finishes under the previously authoritative character.
create or replace function public.assert_net_pulse_account_context(
  requested_expected_account_id uuid,
  requested_require_account boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  authenticated_actor_id uuid := auth.uid();
  actual_account_id uuid;
begin
  if authenticated_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select pulse_account.id
  into actual_account_id
  from public.net_active_identities as active_identity
  join public.net_identity_links as identity_link
    on identity_link.id = active_identity.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  join public.net_app_accounts as pulse_account
    on pulse_account.identity_link_id = identity_link.id
    and pulse_account.app_id = 'pulse'
    and pulse_account.status = 'active'
  where active_identity.profile_id = authenticated_actor_id
    and public.current_user_controls_playable_net_identity_link(identity_link.id)
  for share of active_identity;

  if requested_expected_account_id is distinct from actual_account_id then
    raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  if coalesce(requested_require_account, true) and actual_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;

  return actual_account_id;
end;
$$;

create or replace function public.assert_net_active_identity_context(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  authenticated_actor_id uuid := auth.uid();
  actual_identity_link_id uuid;
begin
  if authenticated_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select identity_link.id
  into actual_identity_link_id
  from public.net_active_identities as active_identity
  join public.net_identity_links as identity_link
    on identity_link.id = active_identity.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  where active_identity.profile_id = authenticated_actor_id
    and public.current_user_controls_playable_net_identity_link(identity_link.id)
  for share of active_identity;

  if requested_expected_identity_link_id is null
    or requested_expected_identity_link_id is distinct from actual_identity_link_id
  then
    raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  return actual_identity_link_id;
end;
$$;

create or replace function public.assert_net_pulse_compromised_context(
  requested_expected_session_generation uuid,
  requested_expected_account_id uuid
)
returns table (
  actor_profile_id uuid,
  persona_subject_kind text,
  persona_subject_id uuid,
  identity_link_id uuid,
  pulse_account_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  authenticated_actor_id uuid := auth.uid();
  persona_session public.net_gm_persona_sessions%rowtype;
  resolved_context record;
begin
  if authenticated_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.is_current_user_gm() then
    raise exception 'Only an authoritative GM may use a compromised session.' using errcode = '42501';
  end if;

  select session_row.*
  into persona_session
  from public.net_gm_persona_sessions as session_row
  where session_row.gm_profile_id = authenticated_actor_id
  for share;

  if not found
    or persona_session.mode <> 'compromised-session'
    or requested_expected_session_generation is null
    or requested_expected_session_generation <> persona_session.session_generation
  then
    raise exception 'PULSE_COMPROMISED_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  select current_context.*
  into resolved_context
  from public.resolve_current_compromised_pulse_context() as current_context;

  if not found
    or requested_expected_account_id is null
    or requested_expected_account_id is distinct from resolved_context.pulse_account_id
  then
    raise exception 'PULSE_COMPROMISED_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  return query select
    resolved_context.actor_profile_id,
    resolved_context.persona_subject_kind,
    resolved_context.persona_subject_id,
    resolved_context.identity_link_id,
    resolved_context.pulse_account_id;
end;
$$;

revoke all on function public.assert_net_pulse_account_context(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.assert_net_active_identity_context(uuid)
  from public, anon, authenticated;
revoke all on function public.assert_net_pulse_compromised_context(uuid, uuid)
  from public, anon, authenticated;

-- The generic explicit-account RPC also supports ECHO, so it remains
-- available. This table invariant binds only PULSE account provisioning to
-- the request's server-authoritative active identity. The inserted link is an
-- assertion/resource selector; it never becomes authority by itself.
create or replace function public.validate_net_pulse_account_active_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.app_id = 'pulse' and auth.uid() is not null then
    if new.identity_link_id is null then
      raise exception 'PULSE accounts require an active playable identity.'
        using errcode = '42501';
    end if;
    perform public.assert_net_active_identity_context(new.identity_link_id);
  end if;
  return new;
end;
$$;

drop trigger if exists net_app_accounts_validate_pulse_active_identity
  on public.net_app_accounts;
create trigger net_app_accounts_validate_pulse_active_identity
before insert on public.net_app_accounts
for each row execute procedure public.validate_net_pulse_account_active_identity();

revoke all on function public.validate_net_pulse_account_active_identity()
  from public, anon, authenticated;

-- Owner content creation: expected account is comparison-only; the legacy
-- worker receives only the server-derived active account.
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
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );
  return public.create_net_pulse_post(
    actual_account_id,
    requested_body,
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
begin
  perform public.assert_net_pulse_compromised_context(
    requested_expected_session_generation,
    requested_expected_account_id
  );
  return public.create_net_pulse_post_as_compromised_persona(
    requested_body,
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
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, true);
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
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, true);
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
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, true);
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
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, true);
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

-- Bounded public readers still bind viewer-derived flags and private modes to
-- the active account that initiated the request.
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
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, false);
  return query select legacy_page.* from public.fetch_net_pulse_page(
    requested_mode, requested_profile_account_id, requested_search_query,
    requested_cursor_at, requested_cursor_id, requested_limit
  ) as legacy_page;
end;
$$;

create or replace function public.fetch_net_pulse_thread_page(
  requested_root_post_id uuid,
  requested_expected_account_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 30
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
  page_sort_at timestamptz, page_has_more boolean, is_thread_root boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, false);
  return query select legacy_page.* from public.fetch_net_pulse_thread_page(
    requested_root_post_id, requested_cursor_at, requested_cursor_id, requested_limit
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
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, false);
  return query select legacy_summary.*
  from public.fetch_net_pulse_account_summaries(
    requested_query, requested_account_id, requested_limit
  ) as legacy_summary;
end;
$$;

create or replace function public.fetch_net_pulse_discover_accounts(
  requested_expected_account_id uuid,
  requested_limit integer default 12
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
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, false);
  return query select legacy_directory.*
  from public.fetch_net_pulse_discover_accounts(requested_limit) as legacy_directory;
end;
$$;

create or replace function public.fetch_net_pulse_relationship_page(
  requested_profile_account_id uuid,
  requested_direction text,
  requested_expected_account_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_account_id uuid default null,
  requested_limit integer default 30
)
returns table (
  account_id uuid, handle text, avatar_url text, bio text, visibility text,
  discoverable boolean, status text, followers_count bigint,
  following_count bigint, pulses_count bigint, viewer_following boolean,
  relationship_created_at timestamptz, page_has_more boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, false);
  return query select legacy_relationship.*
  from public.fetch_net_pulse_relationship_page(
    requested_profile_account_id, requested_direction, requested_cursor_at,
    requested_cursor_account_id, requested_limit
  ) as legacy_relationship;
end;
$$;

-- Compatibility relationship read remains bounded by its existing worker but
-- cannot derive viewer state from a different active character mid-request.
create or replace function public.fetch_net_pulse_relationship_accounts(
  requested_profile_account_id uuid,
  requested_direction text,
  requested_expected_account_id uuid,
  requested_limit integer default 30
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
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, false);
  return query select legacy_relationship.*
  from public.fetch_net_pulse_relationship_accounts(
    requested_profile_account_id,
    requested_direction,
    requested_limit
  ) as legacy_relationship;
end;
$$;

-- Mention hydration is viewer-sensitive because its worker applies Pulse and
-- ancestor visibility. The UUID list remains capped at 80 by that worker.
create or replace function public.fetch_net_pulse_mentions_for_posts(
  requested_post_ids uuid[],
  requested_expected_account_id uuid
)
returns table (
  post_id uuid,
  mentioned_account_id uuid,
  source_handle text,
  current_handle text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, false);
  return query select legacy_mention.*
  from public.fetch_net_pulse_mentions_for_posts(requested_post_ids) as legacy_mention;
end;
$$;

-- Exact profile reads expose private preferences only when the asserted active
-- owner or asserted compromised generation matches the target account.
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
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    false
  );
  can_manage := actual_account_id = requested_account_id;

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
    elsif requested_expected_session_generation is not null
      or requested_expected_compromised_account_id is not null
    then
      raise exception 'PULSE_COMPROMISED_CONTEXT_CHANGED' using errcode = 'P0001';
    end if;
  elsif requested_expected_session_generation is not null
    or requested_expected_compromised_account_id is not null
  then
    raise exception 'PULSE_COMPROMISED_CONTEXT_CHANGED' using errcode = 'P0001';
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
  limit 1;
end;
$$;

create or replace function public.fetch_net_pulse_notification_page(
  requested_expected_account_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns table (
  id uuid, notification_type text, actor_account_id uuid, actor_handle text,
  actor_avatar_url text, post_id uuid, root_post_id uuid, post_excerpt text,
  post_available boolean, created_at timestamptz, read_at timestamptz,
  page_has_more boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, true);
  return query select legacy_notification.*
  from public.fetch_net_pulse_notification_page(
    requested_cursor_at, requested_cursor_id, requested_limit
  ) as legacy_notification;
end;
$$;

create or replace function public.fetch_net_pulse_notification_state(
  requested_expected_account_id uuid
)
returns table (unread_count bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, true);
  return query select legacy_state.*
  from public.fetch_net_pulse_notification_state() as legacy_state;
end;
$$;

create or replace function public.mark_net_pulse_notification_read(
  requested_notification_id uuid,
  requested_expected_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, true);
  return public.mark_net_pulse_notification_read(requested_notification_id);
end;
$$;

create or replace function public.mark_all_net_pulse_notifications_read(
  requested_expected_account_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_pulse_account_context(requested_expected_account_id, true);
  return public.mark_all_net_pulse_notifications_read();
end;
$$;

-- Remove client access to every legacy unbound overload. They remain internal
-- workers only where the bound wrapper calls them in the same transaction.
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
revoke all on function public.fetch_net_pulse_thread_page(uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_account_summaries(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_discover_accounts(integer) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_relationship_page(uuid, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_mentions_for_posts(uuid[]) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_profile(uuid) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_notification_page(timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_notification_state() from public, anon, authenticated;
revoke all on function public.mark_net_pulse_notification_read(uuid) from public, anon, authenticated;
revoke all on function public.mark_all_net_pulse_notifications_read() from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_feed(integer) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_relationship_accounts(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.upsert_net_pulse_profile(uuid, text, text, boolean, boolean, text) from public, anon, authenticated;

-- New bound entry points. PUBLIC/anon receive no execute authority.
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
revoke all on function public.fetch_net_pulse_thread_page(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_account_summaries(uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_discover_accounts(uuid, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_relationship_page(uuid, text, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_relationship_accounts(uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_mentions_for_posts(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_profile(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_notification_page(uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_notification_state(uuid) from public, anon, authenticated;
revoke all on function public.mark_net_pulse_notification_read(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mark_all_net_pulse_notifications_read(uuid) from public, anon, authenticated;

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
grant execute on function public.fetch_net_pulse_thread_page(uuid, uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_account_summaries(uuid, text, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_discover_accounts(uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_relationship_page(uuid, text, uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_relationship_accounts(uuid, text, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_mentions_for_posts(uuid[], uuid) to authenticated;
grant execute on function public.fetch_net_pulse_profile(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.fetch_net_pulse_notification_page(uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_notification_state(uuid) to authenticated;
grant execute on function public.mark_net_pulse_notification_read(uuid, uuid) to authenticated;
grant execute on function public.mark_all_net_pulse_notifications_read(uuid) to authenticated;

-- Preserve the P0-A raw-read boundary and all mutation mediation.
revoke select on table public.net_pulse_posts from public, anon, authenticated;
revoke select on table public.net_pulse_profiles from public, anon, authenticated;

-- Reassert internal-helper boundaries used by the bound entry points. Revoked
-- EXECUTE does not prevent SECURITY DEFINER wrappers/triggers from using them.
revoke all on function public.current_net_pulse_owner_account_id() from public, anon, authenticated;
revoke all on function public.resolve_current_compromised_pulse_context() from public, anon, authenticated;
revoke all on function public.net_pulse_post_is_visible(uuid) from public, anon, authenticated;
revoke all on function public.net_pulse_root_post_id(uuid) from public, anon, authenticated;
revoke all on function public.net_pulse_account_directory_rows(uuid[], boolean, integer) from public, anon, authenticated;
revoke all on function public.net_pulse_render_post_rows(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.net_pulse_page_candidates(text, uuid, text, timestamptz, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.net_pulse_account_summary_rows(uuid[], uuid) from public, anon, authenticated;

commit;
