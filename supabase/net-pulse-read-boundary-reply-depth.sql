-- PULSE P0-A: bounded profile reads, closed raw table reads, and one-level replies.
-- Run after net-pulse-notifications.sql and the existing PULSE pagination migrations.
-- This migration is intentionally data-preserving and idempotent.

-- A single-account profile reader replaces direct PostgREST access to
-- net_pulse_profiles. Exact UUID references preserve the existing Limited
-- profile navigation contract, while account-owned preferences are returned
-- only to the actual owner or the exact authoritative compromised target.
create or replace function public.fetch_net_pulse_profile(
  requested_account_id uuid
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
stable
security definer
set search_path = public, pg_temp
as $$
declare
  authenticated_actor_id uuid := auth.uid();
  viewer_can_manage boolean := false;
begin
  if authenticated_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if requested_account_id is null then
    raise exception 'A PULSE account is required.' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.net_app_accounts as owned_account
    where owned_account.id = requested_account_id
      and owned_account.app_id = 'pulse'
      and owned_account.identity_link_id is not null
      and public.current_user_controls_playable_net_identity_link(
        owned_account.identity_link_id
      )
  ) into viewer_can_manage;

  if not viewer_can_manage and public.is_current_user_gm() then
    select exists (
      select 1
      from public.net_gm_persona_sessions as persona_session
      join public.net_identity_links as identity_link
        on identity_link.subject_kind = persona_session.subject_kind
        and identity_link.subject_id = persona_session.subject_id
        and identity_link.identity_kind = 'player'
        and identity_link.playability = 'playable'
      join public.net_app_accounts as compromised_account
        on compromised_account.identity_link_id = identity_link.id
        and compromised_account.app_id = 'pulse'
        and compromised_account.status = 'active'
      where persona_session.gm_profile_id = authenticated_actor_id
        and persona_session.mode = 'compromised-session'
        and compromised_account.id = requested_account_id
    ) into viewer_can_manage;
  end if;

  return query
  select
    pulse_account.id,
    pulse_account.handle,
    coalesce(pulse_profile.bio, ''),
    coalesce(
      pulse_profile.visibility,
      case when viewer_can_manage then 'public' else 'limited' end
    ),
    case
      when viewer_can_manage then coalesce(pulse_profile.show_district, false)
      else false
    end,
    case
      when viewer_can_manage then coalesce(pulse_profile.discoverable, false)
      else false
    end,
    case
      when viewer_can_manage then coalesce(pulse_profile.default_feed, 'city')
      else 'city'
    end,
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

comment on function public.fetch_net_pulse_profile(uuid) is
  'Returns one explicitly referenced PULSE profile. Private profile preferences are visible only to the owner or exact compromised target; discovery remains separately constrained.';

revoke all on function public.fetch_net_pulse_profile(uuid) from public, anon, authenticated;
grant execute on function public.fetch_net_pulse_profile(uuid) to authenticated;

-- Central write invariant for every current and future insertion path. A reply
-- can target only a live root Pulse. This is one indexed primary-key lookup;
-- it never walks an ancestor chain.
create or replace function public.validate_net_pulse_visible_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_parent_parent_id uuid;
  requested_parent_deleted_at timestamptz;
begin
  if new.parent_post_id is null then
    return new;
  end if;

  select parent_post.parent_post_id, parent_post.deleted_at
  into requested_parent_parent_id, requested_parent_deleted_at
  from public.net_pulse_posts as parent_post
  where parent_post.id = new.parent_post_id;

  if not found or requested_parent_deleted_at is not null then
    raise exception 'PULSE_PARENT_UNAVAILABLE' using errcode = '23503';
  end if;

  if requested_parent_parent_id is not null then
    raise exception 'PULSE_REPLY_DEPTH_EXCEEDED' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists net_pulse_posts_validate_visible_parent on public.net_pulse_posts;
create trigger net_pulse_posts_validate_visible_parent
before insert or update of parent_post_id on public.net_pulse_posts
for each row execute procedure public.validate_net_pulse_visible_parent();

revoke all on function public.validate_net_pulse_visible_parent() from public, anon, authenticated;

-- Defensive legacy compatibility: malformed pre-existing deep chains cannot
-- cause an unbounded recursive read. Reaching the cap fails visibility closed.
create or replace function public.net_pulse_post_is_visible(requested_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive ancestors as (
    select post.id, post.parent_post_id, post.deleted_at, 0 as depth
    from public.net_pulse_posts as post
    where post.id = requested_post_id

    union all

    select parent.id, parent.parent_post_id, parent.deleted_at, child.depth + 1
    from public.net_pulse_posts as parent
    join ancestors as child on child.parent_post_id = parent.id
    where child.depth < 16
  )
  select exists (select 1 from ancestors)
    and not exists (select 1 from ancestors where deleted_at is not null)
    and not exists (
      select 1
      from ancestors
      where depth = 16 and parent_post_id is not null
    );
$$;

revoke all on function public.net_pulse_post_is_visible(uuid) from public, anon, authenticated;

-- RPC mediation is now the only client read boundary for these two tables.
-- RLS remains enabled as defense in depth, but no PostgREST role has table
-- SELECT privilege. SECURITY DEFINER readers continue to execute internally.
alter table public.net_pulse_posts enable row level security;
alter table public.net_pulse_profiles enable row level security;

drop policy if exists net_pulse_posts_select_authenticated on public.net_pulse_posts;
create policy net_pulse_posts_select_authenticated
on public.net_pulse_posts
for select
to authenticated
using (false);

drop policy if exists net_pulse_profiles_select_authenticated on public.net_pulse_profiles;
create policy net_pulse_profiles_select_authenticated
on public.net_pulse_profiles
for select
to authenticated
using (false);

revoke select on table public.net_pulse_posts from public, anon, authenticated;
revoke select on table public.net_pulse_profiles from public, anon, authenticated;
