-- ROLL attempt lifecycle: a persistent ROLL grant (net_system_hacking_grants,
-- method = 'roll') is permission only -- it is NOT itself a pending attempt.
-- This migration adds the missing server-authoritative primitive for "the
-- actor has signalled they are attempting a roll right now", so Silver sees
-- a real pending state (not merely "a roll grant exists") before confirming.
--
-- Mirrors the existing one-session-per-actor shape
-- (net_system_hacking_sessions) with one-pending-attempt-per-actor
-- (net_system_hacking_roll_attempts), keyed the same way and reachable only
-- through bounded SECURITY DEFINER RPCs (RLS enabled, zero policies, same
-- pattern as every other hacking table).
--
-- Actor resolution reuses current_net_runtime_source_identity_link_id() --
-- the exact same canonical, non-projected SOURCE resolver
-- fetch_net_system_hacking_session() / end_net_system_hacking_session() /
-- attempt_net_system_credential_access() / fetch_net_system_hacking_targets()
-- already use (net-system-hacking-runtime-projection.sql). No new identity
-- resolution logic, no client-supplied actor id.
--
-- Untouched by this migration: net_system_hacking_establish_compromised_access
-- (the shared session-establishment helper -- credential flow calls it
-- exactly as before), attempt_net_system_credential_access, every runtime
-- projection function, and net_system_hacking_sessions itself. The CREDENTIAL
-- method's behavior is byte-for-byte unchanged.
--
-- confirm_net_system_hacking_roll_success and the GM grant-mutation RPCs
-- (set_net_system_hacking_grant, revoke_net_system_hacking_grant) are
-- redefined here (create or replace, same signatures) rather than editing
-- the already-applied foundation/runtime-projection migrations, matching
-- this codebase's established layering convention.

begin;

do $preflight$
begin
  if to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_system_hacking_grants') is null
    or to_regclass('public.net_system_hacking_sessions') is null
    or to_regclass('public.net_action_audit') is null
    or to_regprocedure('public.set_updated_at()') is null
    or to_regprocedure('public.assert_net_system_admin()') is null
    or to_regprocedure('public.assert_net_system_admin_read()') is null
    or to_regprocedure('public.current_net_runtime_source_identity_link_id()') is null
    or to_regprocedure('public.net_runtime_action_context(uuid)') is null
    or to_regprocedure('public.net_system_hacking_establish_compromised_access(uuid,uuid,uuid,text)') is null
    or to_regprocedure('public.confirm_net_system_hacking_roll_success(uuid,uuid)') is null
    or to_regprocedure('public.fetch_net_system_hacking_grants(uuid)') is null
    or to_regprocedure('public.set_net_system_hacking_grant(uuid,uuid,text)') is null
    or to_regprocedure('public.revoke_net_system_hacking_grant(uuid,uuid)') is null
  then
    raise exception 'NET_SYSTEM_HACKING_ROLL_ATTEMPTS_DEPENDENCY_REQUIRED. This migration requires supabase/net-system-hacking-foundation.sql and supabase/net-system-hacking-runtime-projection.sql to be deployed first.'
      using errcode = '55000';
  end if;
end;
$preflight$;

-- ==================================================================
-- TABLE
-- ==================================================================

-- One pending ROLL attempt per ACTOR identity -- the same one-row-per-key
-- shape net_system_hacking_sessions already uses. A grant permits attempts;
-- a row here means the actor has actually signalled one is in progress right
-- now, for Silver to see and resolve. RLS enabled with zero policies:
-- reachable only through the bounded RPCs below.
create table if not exists public.net_system_hacking_roll_attempts (
  actor_identity_link_id uuid primary key
    references public.net_identity_links (id) on delete cascade,
  target_identity_link_id uuid not null
    references public.net_identity_links (id) on delete cascade,
  requested_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_system_hacking_roll_attempts_actor_target_distinct
    check (actor_identity_link_id <> target_identity_link_id)
);

comment on table public.net_system_hacking_roll_attempts is
  'One pending ROLL attempt per actor identity, created when the actor requests a roll and consumed (deleted) when Silver confirms success or marks it failed. Independent of net_system_hacking_grants (permission) and net_system_hacking_sessions (established access).';

alter table public.net_system_hacking_roll_attempts enable row level security;
revoke all on public.net_system_hacking_roll_attempts from public, anon, authenticated;

drop trigger if exists net_system_hacking_roll_attempts_set_updated_at on public.net_system_hacking_roll_attempts;
create trigger net_system_hacking_roll_attempts_set_updated_at
before update on public.net_system_hacking_roll_attempts
for each row
execute procedure public.set_updated_at();

-- ==================================================================
-- PLAYER: REQUEST / FETCH OWN PENDING ATTEMPT
-- ==================================================================

-- Current effective hacking SOURCE identity only (never a client-supplied
-- actor). Requires an enabled method='roll' grant for the exact actor ->
-- target pair, and refuses while that actor already has an active hacking
-- session. Re-requesting the same target it is already pending against is a
-- harmless no-op (refreshes requested_at); requesting a different target
-- while one is already pending fails safely rather than silently switching.
create or replace function public.request_net_system_hacking_roll_attempt(
  requested_target_identity_link_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.current_net_runtime_source_identity_link_id();
  v_grant public.net_system_hacking_grants%rowtype;
  v_existing public.net_system_hacking_roll_attempts%rowtype;
  v_context record;
  v_saved public.net_system_hacking_roll_attempts%rowtype;
begin
  if v_actor_id is null
    or requested_target_identity_link_id is null
    or v_actor_id = requested_target_identity_link_id
  then
    raise exception 'NET_SYSTEM_HACKING_ROLL_REQUEST_INVALID' using errcode = '22023';
  end if;

  select grant_row.*
  into v_grant
  from public.net_system_hacking_grants as grant_row
  where grant_row.actor_identity_link_id = v_actor_id
    and grant_row.target_identity_link_id = requested_target_identity_link_id
  for share;

  if not found or not v_grant.enabled or v_grant.method <> 'roll' then
    raise exception 'NET_SYSTEM_HACKING_ROLL_GRANT_REQUIRED' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.net_system_hacking_sessions
    where actor_identity_link_id = v_actor_id
  ) then
    raise exception 'NET_SYSTEM_HACKING_ROLL_SESSION_ACTIVE' using errcode = '42501';
  end if;

  select attempt_row.*
  into v_existing
  from public.net_system_hacking_roll_attempts as attempt_row
  where attempt_row.actor_identity_link_id = v_actor_id
  for update;

  if found and v_existing.target_identity_link_id <> requested_target_identity_link_id then
    raise exception 'NET_SYSTEM_HACKING_ROLL_ATTEMPT_TARGET_MISMATCH' using errcode = '42501';
  end if;

  insert into public.net_system_hacking_roll_attempts (
    actor_identity_link_id, target_identity_link_id
  ) values (
    v_actor_id, requested_target_identity_link_id
  )
  on conflict (actor_identity_link_id) do update
  set target_identity_link_id = excluded.target_identity_link_id
  returning * into v_saved;

  select context.*
  into v_context
  from public.net_runtime_action_context(v_actor_id) as context;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    auth.uid(), null,
    v_context.persona_subject_kind, v_context.persona_subject_id,
    coalesce(v_context.action_mode, 'system'), 'hacking.roll.attempt.requested',
    'hacking-roll-requested-by-actor', 'net-identity-link', requested_target_identity_link_id
  );

  return jsonb_build_object(
    'pending', true,
    'target_identity_link_id', v_saved.target_identity_link_id,
    'requested_at', v_saved.requested_at
  );
end;
$$;

revoke all on function public.request_net_system_hacking_roll_attempt(uuid)
  from public, anon, authenticated;
grant execute on function public.request_net_system_hacking_roll_attempt(uuid)
  to authenticated;

-- Current effective hacking SOURCE identity only. Lets the actor recover
-- their own pending attempt after a reload/remount without any polling --
-- the caller decides when to check (e.g. a manual "CHECK STATUS" click).
create or replace function public.fetch_net_system_hacking_roll_attempt()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.current_net_runtime_source_identity_link_id();
  v_attempt public.net_system_hacking_roll_attempts%rowtype;
begin
  if v_actor_id is null then
    return jsonb_build_object('pending', false);
  end if;

  select attempt_row.*
  into v_attempt
  from public.net_system_hacking_roll_attempts as attempt_row
  where attempt_row.actor_identity_link_id = v_actor_id;

  if not found then
    return jsonb_build_object('pending', false);
  end if;

  return jsonb_build_object(
    'pending', true,
    'target_identity_link_id', v_attempt.target_identity_link_id,
    'requested_at', v_attempt.requested_at
  );
end;
$$;

revoke all on function public.fetch_net_system_hacking_roll_attempt()
  from public, anon, authenticated;
grant execute on function public.fetch_net_system_hacking_roll_attempt()
  to authenticated;

-- ==================================================================
-- GM: CONFIRM SUCCESS (now requires a matching pending attempt) / MARK FAILED
-- ==================================================================

-- Same contract as before (GM-only, explicit actor/target, establishes the
-- real hacking session via the unchanged shared helper) plus one addition:
-- success now also requires a matching pending attempt, which is consumed
-- (deleted) in the same transaction as session establishment -- both commit
-- or neither does. The persistent grant is never touched here.
create or replace function public.confirm_net_system_hacking_roll_success(
  requested_actor_identity_link_id uuid,
  requested_target_identity_link_id uuid
)
returns public.net_system_hacking_sessions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_gm_id uuid := public.assert_net_system_admin();
  v_grant public.net_system_hacking_grants%rowtype;
  v_attempt public.net_system_hacking_roll_attempts%rowtype;
  v_context record;
  v_result public.net_system_hacking_sessions;
begin
  if requested_actor_identity_link_id is null
    or requested_target_identity_link_id is null
    or requested_actor_identity_link_id = requested_target_identity_link_id
  then
    raise exception 'NET_SYSTEM_HACKING_ROLL_REQUEST_INVALID' using errcode = '22023';
  end if;

  select grant_row.*
  into v_grant
  from public.net_system_hacking_grants as grant_row
  where grant_row.actor_identity_link_id = requested_actor_identity_link_id
    and grant_row.target_identity_link_id = requested_target_identity_link_id
  for share;

  if not found or not v_grant.enabled or v_grant.method <> 'roll' then
    raise exception 'NET_SYSTEM_HACKING_ROLL_GRANT_REQUIRED' using errcode = '42501';
  end if;

  select attempt_row.*
  into v_attempt
  from public.net_system_hacking_roll_attempts as attempt_row
  where attempt_row.actor_identity_link_id = requested_actor_identity_link_id
  for update;

  if not found or v_attempt.target_identity_link_id <> requested_target_identity_link_id then
    raise exception 'NET_SYSTEM_HACKING_ROLL_ATTEMPT_REQUIRED' using errcode = '42501';
  end if;

  v_result := public.net_system_hacking_establish_compromised_access(
    v_gm_id,
    requested_actor_identity_link_id,
    requested_target_identity_link_id,
    'roll'
  );

  delete from public.net_system_hacking_roll_attempts
  where actor_identity_link_id = requested_actor_identity_link_id;

  select context.*
  into v_context
  from public.net_runtime_action_context(requested_actor_identity_link_id) as context;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    auth.uid(), null,
    v_context.persona_subject_kind, v_context.persona_subject_id,
    'system', 'hacking.roll.confirm.success',
    'hacking-roll-confirmed-by-gm', 'net-identity-link', requested_target_identity_link_id
  );

  return v_result;
end;
$$;

revoke all on function public.confirm_net_system_hacking_roll_success(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_net_system_hacking_roll_success(uuid, uuid)
  to authenticated;

-- GM-only. Clears exactly the matching pending attempt -- no session is ever
-- created, and the persistent grant is never touched (enabled or otherwise),
-- so the actor can immediately request another roll attempt against the
-- same target.
create or replace function public.fail_net_system_hacking_roll_attempt(
  requested_actor_identity_link_id uuid,
  requested_target_identity_link_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_gm_id uuid := public.assert_net_system_admin();
  v_attempt public.net_system_hacking_roll_attempts%rowtype;
  v_context record;
begin
  if requested_actor_identity_link_id is null or requested_target_identity_link_id is null then
    raise exception 'NET_SYSTEM_HACKING_ROLL_REQUEST_INVALID' using errcode = '22023';
  end if;

  delete from public.net_system_hacking_roll_attempts
  where actor_identity_link_id = requested_actor_identity_link_id
    and target_identity_link_id = requested_target_identity_link_id
  returning * into v_attempt;

  if not found then
    raise exception 'NET_SYSTEM_HACKING_ROLL_ATTEMPT_REQUIRED' using errcode = '42501';
  end if;

  select context.*
  into v_context
  from public.net_runtime_action_context(requested_actor_identity_link_id) as context;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    v_gm_id, null,
    v_context.persona_subject_kind, v_context.persona_subject_id,
    'system', 'hacking.roll.attempt.failed',
    'hacking-roll-marked-failed-by-gm', 'net-identity-link', requested_target_identity_link_id
  );

  return true;
end;
$$;

revoke all on function public.fail_net_system_hacking_roll_attempt(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fail_net_system_hacking_roll_attempt(uuid, uuid)
  to authenticated;

-- ==================================================================
-- GM: GRANTS LISTING NOW INCLUDES PENDING STATE
-- ==================================================================

-- Identical to the foundation version except for the added left join, so
-- Silver's existing grants list (and its existing manual refresh) surfaces
-- roll_pending / roll_requested_at with no new fetch call needed.
create or replace function public.fetch_net_system_hacking_grants(
  requested_actor_identity_link_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_system_admin_read();

  if requested_actor_identity_link_id is null then
    raise exception 'NET_SYSTEM_HACKING_ACTOR_REQUIRED' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'target_identity_link_id', grant_row.target_identity_link_id,
      'enabled', grant_row.enabled,
      'method', grant_row.method,
      'granted_by_profile_id', grant_row.granted_by_profile_id,
      'created_at', grant_row.created_at,
      'updated_at', grant_row.updated_at,
      'roll_pending', attempt_row.actor_identity_link_id is not null,
      'roll_requested_at', attempt_row.requested_at
    ) order by grant_row.updated_at desc)
    from public.net_system_hacking_grants as grant_row
    left join public.net_system_hacking_roll_attempts as attempt_row
      on attempt_row.actor_identity_link_id = grant_row.actor_identity_link_id
      and attempt_row.target_identity_link_id = grant_row.target_identity_link_id
    where grant_row.actor_identity_link_id = requested_actor_identity_link_id
    limit 200
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fetch_net_system_hacking_grants(uuid)
  from public, anon, authenticated;
grant execute on function public.fetch_net_system_hacking_grants(uuid)
  to authenticated;

-- ==================================================================
-- GM: GRANT MUTATION -- STALE PENDING ATTEMPT CLEANUP
-- ==================================================================

-- Identical to the foundation version except for two additions: a pending
-- roll attempt is cleared whenever the method actually changes (same
-- condition already used to invalidate an active session -- new grants have
-- nothing to clear), and revocation always clears any pending attempt for
-- this exact actor -> target relation, exactly as it already does for an
-- active session.
create or replace function public.set_net_system_hacking_grant(
  requested_actor_identity_link_id uuid,
  requested_target_identity_link_id uuid,
  requested_method text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_gm_id uuid := public.assert_net_system_admin();
  v_method text := lower(btrim(coalesce(requested_method, '')));
  v_existing_method text;
  v_session_invalidated boolean := false;
  v_saved public.net_system_hacking_grants%rowtype;
begin
  if requested_actor_identity_link_id is null
    or requested_target_identity_link_id is null
    or requested_actor_identity_link_id = requested_target_identity_link_id
  then
    raise exception 'NET_SYSTEM_HACKING_GRANT_ACTOR_TARGET_INVALID' using errcode = '22023';
  end if;
  if v_method not in ('roll', 'credential') then
    raise exception 'NET_SYSTEM_HACKING_GRANT_METHOD_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.net_identity_links where id = requested_actor_identity_link_id
  ) then
    raise exception 'NET_SYSTEM_HACKING_GRANT_ACTOR_UNAVAILABLE' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.net_identity_links
    where id = requested_target_identity_link_id
      and (
        (identity_kind = 'player' and playability = 'playable')
        or
        (identity_kind = 'npc' and playability = 'non-playable')
      )
  ) then
    raise exception 'NET_SYSTEM_HACKING_GRANT_TARGET_UNAVAILABLE' using errcode = '22023';
  end if;

  -- Locked ahead of the upsert so a concurrent credential attempt can't
  -- establish a session between reading the old method and clearing it.
  select grant_row.method
  into v_existing_method
  from public.net_system_hacking_grants as grant_row
  where grant_row.actor_identity_link_id = requested_actor_identity_link_id
    and grant_row.target_identity_link_id = requested_target_identity_link_id
  for update;

  insert into public.net_system_hacking_grants (
    actor_identity_link_id, target_identity_link_id, enabled, method, granted_by_profile_id
  ) values (
    requested_actor_identity_link_id, requested_target_identity_link_id, true, v_method, v_gm_id
  )
  on conflict (actor_identity_link_id, target_identity_link_id) do update
  set
    enabled = true,
    method = excluded.method,
    granted_by_profile_id = excluded.granted_by_profile_id
  returning * into v_saved;

  -- A method change (credential <-> roll) invalidates any active session for
  -- this exact actor -> target relation; the grant itself stays enabled.
  -- New grants (v_existing_method is null) have no session or pending
  -- attempt to invalidate.
  if v_existing_method is not null and v_existing_method <> v_method then
    delete from public.net_system_hacking_sessions
    where actor_identity_link_id = requested_actor_identity_link_id
      and target_identity_link_id = requested_target_identity_link_id;
    v_session_invalidated := found;

    delete from public.net_system_hacking_roll_attempts
    where actor_identity_link_id = requested_actor_identity_link_id
      and target_identity_link_id = requested_target_identity_link_id;
  end if;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    v_gm_id, null, null, null, 'system', 'hacking.grant.enable',
    'authoritative-gm-hacking-grant:' || v_method
      || case when v_session_invalidated then ':method-changed-session-cleared' else '' end,
    'net-identity-link', requested_target_identity_link_id
  );

  return jsonb_build_object(
    'actor_identity_link_id', v_saved.actor_identity_link_id,
    'target_identity_link_id', v_saved.target_identity_link_id,
    'enabled', v_saved.enabled,
    'method', v_saved.method,
    'granted_by_profile_id', v_saved.granted_by_profile_id,
    'created_at', v_saved.created_at,
    'updated_at', v_saved.updated_at
  );
end;
$$;

create or replace function public.revoke_net_system_hacking_grant(
  requested_actor_identity_link_id uuid,
  requested_target_identity_link_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_gm_id uuid := public.assert_net_system_admin();
  v_grant public.net_system_hacking_grants%rowtype;
begin
  if requested_actor_identity_link_id is null or requested_target_identity_link_id is null then
    raise exception 'NET_SYSTEM_HACKING_GRANT_ACTOR_TARGET_INVALID' using errcode = '22023';
  end if;

  update public.net_system_hacking_grants
  set enabled = false
  where actor_identity_link_id = requested_actor_identity_link_id
    and target_identity_link_id = requested_target_identity_link_id
  returning * into v_grant;

  if not found then
    raise exception 'NET_SYSTEM_HACKING_GRANT_NOT_FOUND' using errcode = '22023';
  end if;

  -- Revocation must stop access immediately. Clear only a hacking session
  -- (and any pending roll attempt) for this exact actor -> target relation
  -- -- never a session/attempt for the same actor against a different
  -- target, and never Silver's own separate, direct GM compromised-session
  -- tool (net_gm_persona_sessions), which this file never reads, writes, or
  -- references.
  delete from public.net_system_hacking_sessions
  where actor_identity_link_id = requested_actor_identity_link_id
    and target_identity_link_id = requested_target_identity_link_id;

  delete from public.net_system_hacking_roll_attempts
  where actor_identity_link_id = requested_actor_identity_link_id
    and target_identity_link_id = requested_target_identity_link_id;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    v_gm_id, null, null, null, 'system', 'hacking.grant.revoke',
    'authoritative-gm-hacking-grant-revoke', 'net-identity-link', requested_target_identity_link_id
  );

  return jsonb_build_object(
    'actor_identity_link_id', v_grant.actor_identity_link_id,
    'target_identity_link_id', v_grant.target_identity_link_id,
    'enabled', v_grant.enabled,
    'method', v_grant.method,
    'granted_by_profile_id', v_grant.granted_by_profile_id,
    'created_at', v_grant.created_at,
    'updated_at', v_grant.updated_at
  );
end;
$$;

revoke all on function public.set_net_system_hacking_grant(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.revoke_net_system_hacking_grant(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.set_net_system_hacking_grant(uuid, uuid, text)
  to authenticated;
grant execute on function public.revoke_net_system_hacking_grant(uuid, uuid)
  to authenticated;

commit;
