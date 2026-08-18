-- TRUE Realtime sync for the ROLL hacking lifecycle -- REVISED.
--
-- SECURITY FIX: the first draft of this (never-applied) migration relied on
-- Postgres Changes DELETE events (success/fail/revoke all deleted the
-- pending-attempt row) as the invalidation signal, gated by an RLS SELECT
-- policy. Supabase Realtime does NOT apply RLS policies to DELETE events --
-- only INSERT/UPDATE are policy-checked before being sent to a subscriber.
-- A DELETE-based signal would therefore have been either unfiltered
-- (leaking every actor's resolve events to every authenticated client) or
-- silently undelivered, neither of which is acceptable. This revision
-- removes DELETE from the design entirely: net_system_hacking_roll_attempts
-- becomes STATEFUL (one row per actor, a status column instead of
-- presence/absence of the row), so every lifecycle transition this feature
-- needs is an INSERT or an UPDATE -- both of which Realtime does apply RLS
-- to -- and the row is never deleted.
--
-- net-system-hacking-roll-attempts.sql (creating this table and its
-- request/fetch/confirm/fail RPCs, plus the grant-mutation cleanup) is
-- already applied and is NOT edited here. Every function below is
-- redefined via create-or-replace with its existing signature, matching
-- this codebase's established layering convention.
--
-- Client contract unchanged: subscribers never read the Realtime payload as
-- authoritative. On any INSERT/UPDATE they re-fetch through the existing
-- RPCs (fetch_net_system_hacking_roll_attempt + a session refetch for the
-- player, fetch_net_system_hacking_grants for the GM).
--
-- replica identity: left at Postgres default. The previous draft set FULL
-- specifically to make a DELETE's old row reliable; with DELETE removed
-- from the design entirely, there is no remaining requirement -- an
-- INSERT/UPDATE's new row is always fully present in the WAL regardless of
-- replica identity, and RLS re-evaluation for those events runs against
-- that new row.
--
-- RLS: unchanged from the previous draft -- still exactly two parties:
--   - Silver (GM System mode, not TAKE CONTROL/ACT AS/compromised-session):
--     current_user_is_net_system_admin().
--   - The row's own actor: current_net_runtime_source_identity_link_id().
-- Not broadened; still the same canonical predicates, still one policy.
--
-- Scope discipline unchanged: only net_system_hacking_roll_attempts and its
-- directly-dependent RPCs are touched here. net_system_hacking_sessions,
-- net_system_credentials, grant CRUD's own authorization rules, and every
-- runtime-projection / CREDENTIAL-flow function are untouched.

begin;

do $preflight$
begin
  if to_regclass('public.net_system_hacking_roll_attempts') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_system_hacking_grants') is null
    or to_regclass('public.net_system_hacking_sessions') is null
    or to_regclass('public.net_action_audit') is null
    or to_regprocedure('public.current_user_is_net_system_admin()') is null
    or to_regprocedure('public.current_net_runtime_source_identity_link_id()') is null
    or to_regprocedure('public.assert_net_system_admin()') is null
    or to_regprocedure('public.assert_net_system_admin_read()') is null
    or to_regprocedure('public.net_runtime_action_context(uuid)') is null
    or to_regprocedure('public.net_system_hacking_establish_compromised_access(uuid,uuid,uuid,text)') is null
    or to_regprocedure('public.request_net_system_hacking_roll_attempt(uuid)') is null
    or to_regprocedure('public.fetch_net_system_hacking_roll_attempt()') is null
    or to_regprocedure('public.confirm_net_system_hacking_roll_success(uuid,uuid)') is null
    or to_regprocedure('public.fail_net_system_hacking_roll_attempt(uuid,uuid)') is null
    or to_regprocedure('public.fetch_net_system_hacking_grants(uuid)') is null
    or to_regprocedure('public.set_net_system_hacking_grant(uuid,uuid,text)') is null
    or to_regprocedure('public.revoke_net_system_hacking_grant(uuid,uuid)') is null
  then
    raise exception 'NET_SYSTEM_HACKING_ROLL_REALTIME_DEPENDENCY_REQUIRED. This migration requires supabase/net-system-hacking-roll-attempts.sql and supabase/net-nonfinancial-runtime-control-parity.sql to be deployed first.'
      using errcode = '55000';
  end if;
end;
$preflight$;

-- ==================================================================
-- SCHEMA -- one row per actor stays true; the row now carries a lifecycle
-- status instead of being deleted on resolution. NOT NULL DEFAULT 'pending'
-- means every existing row (all of which predate this column and are, by
-- construction, attempts nothing has resolved yet) becomes 'pending' with
-- no separate backfill statement required.
-- ==================================================================

alter table public.net_system_hacking_roll_attempts
  add column if not exists status text not null default 'pending';

do $add_status_check$
begin
  alter table public.net_system_hacking_roll_attempts
    add constraint net_system_hacking_roll_attempts_status_valid
    check (status in ('pending', 'succeeded', 'failed', 'cancelled'));
exception
  when duplicate_object then null;
end;
$add_status_check$;

comment on column public.net_system_hacking_roll_attempts.status is
  'pending: awaiting Silver. succeeded/failed: Silver resolved it (session established, or not). cancelled: the underlying grant was revoked or changed method while pending. The row is reused (never deleted) on the next request from the same actor.';

-- ==================================================================
-- PLAYER: REQUEST -- reuses a resolved row instead of requiring a fresh
-- insert; still refuses a different target while genuinely pending.
-- ==================================================================

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
  v_requested_at timestamptz := timezone('utc', clock_timestamp());
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

  -- Locked ahead of the upsert: a genuinely pending attempt against a
  -- different target fails safely instead of silently being redirected.
  -- A pending attempt against the SAME target, or any resolved
  -- (succeeded/failed/cancelled) row, both fall through to the upsert
  -- below, which reuses the one row per actor with fresh pending state.
  select attempt_row.*
  into v_existing
  from public.net_system_hacking_roll_attempts as attempt_row
  where attempt_row.actor_identity_link_id = v_actor_id
  for update;

  if found
    and v_existing.status = 'pending'
    and v_existing.target_identity_link_id <> requested_target_identity_link_id
  then
    raise exception 'NET_SYSTEM_HACKING_ROLL_ATTEMPT_TARGET_MISMATCH' using errcode = '42501';
  end if;

  insert into public.net_system_hacking_roll_attempts (
    actor_identity_link_id, target_identity_link_id, status, requested_at
  ) values (
    v_actor_id, requested_target_identity_link_id, 'pending', v_requested_at
  )
  on conflict (actor_identity_link_id) do update
  set
    target_identity_link_id = excluded.target_identity_link_id,
    status = 'pending',
    requested_at = excluded.requested_at
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

-- ==================================================================
-- PLAYER: FETCH OWN PENDING ATTEMPT -- only status='pending' counts as
-- awaiting; any resolved status reads to the caller as no pending attempt.
-- ==================================================================

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
  where attempt_row.actor_identity_link_id = v_actor_id
    and attempt_row.status = 'pending';

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
-- GM: CONFIRM SUCCESS -- requires status='pending', establishes the
-- session, then UPDATEs to 'succeeded' (never deletes). Both happen inside
-- this one function call, i.e. one transaction: if session establishment
-- raises, the status update is never reached and nothing commits.
-- ==================================================================

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

  if not found
    or v_attempt.status <> 'pending'
    or v_attempt.target_identity_link_id <> requested_target_identity_link_id
  then
    raise exception 'NET_SYSTEM_HACKING_ROLL_ATTEMPT_REQUIRED' using errcode = '42501';
  end if;

  v_result := public.net_system_hacking_establish_compromised_access(
    v_gm_id,
    requested_actor_identity_link_id,
    requested_target_identity_link_id,
    'roll'
  );

  update public.net_system_hacking_roll_attempts
  set status = 'succeeded'
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

-- ==================================================================
-- GM: MARK FAILED -- requires a matching pending row, creates no session,
-- UPDATEs to 'failed' (never deletes), grant untouched.
-- ==================================================================

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

  update public.net_system_hacking_roll_attempts
  set status = 'failed'
  where actor_identity_link_id = requested_actor_identity_link_id
    and target_identity_link_id = requested_target_identity_link_id
    and status = 'pending'
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
-- GM: GRANTS LISTING -- roll_pending only true for a matching status
-- ='pending' row (a succeeded/failed/cancelled row must never read back
-- as pending).
-- ==================================================================

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
      and attempt_row.status = 'pending'
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
-- GM: GRANT MUTATION -- a stale pending attempt is cancelled (UPDATE), not
-- deleted, when its grant is revoked or changed away from its resolved
-- method. Identical triggering conditions to the previously-applied
-- net-system-hacking-roll-attempts.sql; only the DELETE became an UPDATE.
-- ==================================================================

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

    update public.net_system_hacking_roll_attempts
    set status = 'cancelled'
    where actor_identity_link_id = requested_actor_identity_link_id
      and target_identity_link_id = requested_target_identity_link_id
      and status = 'pending';
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
  -- for this exact actor -> target relation -- never a session for the same
  -- actor against a different target, and never Silver's own separate,
  -- direct GM compromised-session tool (net_gm_persona_sessions), which this
  -- file never reads, writes, or references. A pending roll attempt for
  -- this same relation is cancelled the same way (UPDATE, never deleted).
  delete from public.net_system_hacking_sessions
  where actor_identity_link_id = requested_actor_identity_link_id
    and target_identity_link_id = requested_target_identity_link_id;

  update public.net_system_hacking_roll_attempts
  set status = 'cancelled'
  where actor_identity_link_id = requested_actor_identity_link_id
    and target_identity_link_id = requested_target_identity_link_id
    and status = 'pending';

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

-- ==================================================================
-- RLS -- unchanged predicates/shape from the previous draft: Silver (GM
-- System mode) or the row's own actor, nothing broader.
-- ==================================================================

create or replace function public.current_user_can_read_net_system_hacking_roll_attempt(
  requested_actor_identity_link_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and (
      public.current_user_is_net_system_admin()
      or requested_actor_identity_link_id = public.current_net_runtime_source_identity_link_id()
    );
$$;

revoke all on function public.current_user_can_read_net_system_hacking_roll_attempt(uuid)
  from public, anon, authenticated;
grant execute on function public.current_user_can_read_net_system_hacking_roll_attempt(uuid)
  to authenticated;

drop policy if exists net_system_hacking_roll_attempts_realtime_select_authorized
  on public.net_system_hacking_roll_attempts;
create policy net_system_hacking_roll_attempts_realtime_select_authorized
on public.net_system_hacking_roll_attempts
for select
to authenticated
using (
  public.current_user_can_read_net_system_hacking_roll_attempt(actor_identity_link_id)
);

-- RLS alone does not grant access -- authenticated still needs the
-- underlying table-level privilege the foundation migration revoked
-- (net-system-hacking-roll-attempts.sql keeps it RPC-only for writes; this
-- adds read-only, RLS-filtered access solely for the Realtime/PostgREST
-- select path used above).
grant select on public.net_system_hacking_roll_attempts to authenticated;

-- ==================================================================
-- PUBLICATION -- add only this table
-- ==================================================================

do $publication$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_system_hacking_roll_attempts'
  ) then
    alter publication supabase_realtime
      add table public.net_system_hacking_roll_attempts;
  end if;
end;
$publication$;

comment on table public.net_system_hacking_roll_attempts is
  'One stateful ROLL attempt row per actor identity: status pending/succeeded/failed/cancelled, reused (never deleted) across requests. Independent of net_system_hacking_grants (permission) and net_system_hacking_sessions (established access). Realtime-published for INSERT/UPDATE invalidation only -- subscribers always re-fetch through the canonical RPCs, never trust the payload. DELETE is not part of this table''s lifecycle and is not relied on for any signal.';

commit;
