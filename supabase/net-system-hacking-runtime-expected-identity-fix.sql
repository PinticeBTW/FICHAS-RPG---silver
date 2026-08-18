-- Fixes the NET_RUNTIME_IDENTITY_CONTEXT_CHANGED resolver mismatch: while a
-- hacking session is active but the player has not yet clicked ENTER SYSTEM
-- (net_system_hacking_roll_attempts/... establishes the session; "entered"
-- is a purely client-side, localStorage-only toggle -- see
-- netSystemHackingEnteredStore.ts -- that intentionally never reaches the
-- server and never grants or removes authority), Settings/credential-status
-- still legitimately requests the actor's own SOURCE identity
-- (e.g. Adrian). assert_net_effective_runtime_identity(...) and its
-- read-only sibling (net-system-hacking-runtime-projection.sql) currently
-- resolve the effective identity to the hacking TARGET (e.g. Vanessa
-- Schneider) unconditionally the instant an active session exists, with no
-- way for the caller to say "I still mean my own identity" -- so the
-- existing stale-identity guard correctly (but wrongly, given the actual
-- intent) rejects Adrian's own, legitimate request with
-- NET_RUNTIME_IDENTITY_CONTEXT_CHANGED. This is a sustained SOURCE/TARGET
-- resolver disagreement, not a transient request race, and it can persist
-- for as long as the player leaves the session un-entered.
--
-- net-system-hacking-runtime-projection.sql is NOT edited -- both affected
-- functions are redefined here via create-or-replace with their existing
-- signatures, matching this codebase's established layering convention.
--
-- FIX: a hacking session grants authority to the target, but the caller's
-- explicit requested_expected_identity_link_id is only a DISAMBIGUATION
-- signal, never an authorization grant. While a hacking session exists for
-- the resolved SOURCE, the caller may resolve to exactly one of two
-- server-resolved rows -- the canonical SOURCE (pre-ENTER SYSTEM: still
-- using their own OS even though compromised access already exists) or the
-- exact session TARGET (post-ENTER SYSTEM: mounted compromised runtime) --
-- and nothing else. The requested UUID is only ever COMPARED against these
-- two independently server-resolved rows; it is never used to look anything
-- up, so this cannot become arbitrary identity selection: a caller
-- expecting a third, unrelated identity still falls through to the
-- unchanged stale-identity check and is rejected exactly as before. When no
-- hacking session exists, or when requested_expected_identity_link_id is
-- null, behavior is byte-for-byte unchanged from the currently-deployed
-- functions.
--
-- The GM take-control branch is untouched: hacking sessions are
-- player-source-keyed only (see the unchanged `elsif v_role = 'player'`
-- gating below), so GM SYSTEM with no TAKE CONTROL/ACT AS session still
-- resolves no identity at all (NET_RUNTIME_CONTROL_REQUIRED), exactly as
-- today.
--
-- Every existing OS-service-scope and app-install check, and the final
-- `return v_identity.id`, run unchanged against whichever of SOURCE/TARGET
-- was selected -- these checks were already identity-agnostic (they operate
-- on v_identity, whatever it holds), so no separate hacking-aware branch is
-- needed there. Nothing about auth.uid(), net_system_hacking_sessions,
-- net_system_hacking_grants, TAKE CONTROL, ACT AS, finance, or the
-- ROLL/CREDENTIAL lifecycle RPCs is touched by this migration.

begin;

do $preflight$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_active_identities') is null
    or to_regclass('public.net_system_hacking_sessions') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_os_families') is null
    or to_regclass('public.net_os_service_scopes') is null
    or to_regclass('public.net_identity_app_installs') is null
    or to_regtype('public.app_role') is null
    or to_regprocedure('public.current_user_controls_playable_net_identity_link(uuid)') is null
    or to_regprocedure('public.assert_net_effective_runtime_identity(uuid,text,boolean)') is null
    or to_regprocedure('public.assert_net_effective_runtime_identity_read(uuid,text,boolean)') is null
  then
    raise exception 'NET_SYSTEM_HACKING_RUNTIME_EXPECTED_IDENTITY_FIX_DEPENDENCY_REQUIRED. This migration requires net-effective-runtime-identity.sql, net-system-hacking-credential-status-fix.sql, and net-system-hacking-runtime-projection.sql to be deployed first.'
      using errcode = '55000';
  end if;
end;
$preflight$;

-- ==================================================================
-- WRITE VARIANT (volatile, row-locking) -- every mutation RPC boundary.
-- ==================================================================

create or replace function public.assert_net_effective_runtime_identity(
  requested_expected_identity_link_id uuid,
  requested_service_id text default null,
  requested_require_install boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
  v_identity public.net_identity_links%rowtype;
  v_session public.net_gm_persona_sessions%rowtype;
  v_hacking_session public.net_system_hacking_sessions%rowtype;
  v_target_identity public.net_identity_links%rowtype;
  v_target_resolved boolean := false;
  v_identity_resolved boolean := false;
begin
  if v_actor is null then
    raise exception 'NET_RUNTIME_AUTH_REQUIRED' using errcode = '42501';
  end if;

  select profile.role
  into v_role
  from public.profiles as profile
  where profile.id = v_actor
  for share;

  if not found then
    raise exception 'NET_RUNTIME_PROFILE_REQUIRED' using errcode = '42501';
  end if;

  if v_role = 'gm' then
    select gm_session.*
    into v_session
    from public.net_gm_persona_sessions as gm_session
    where gm_session.gm_profile_id = v_actor
      and gm_session.mode = 'take-control'
    for share;

    if not found then
      raise exception 'NET_RUNTIME_CONTROL_REQUIRED' using errcode = '42501';
    end if;

    select identity_link.*
    into v_identity
    from public.net_identity_links as identity_link
    where identity_link.subject_kind = v_session.subject_kind
      and identity_link.subject_id = v_session.subject_id
      and (
        (identity_link.identity_kind = 'player' and identity_link.playability = 'playable')
        or
        (identity_link.identity_kind = 'npc' and identity_link.playability = 'non-playable')
      )
    for share;
    v_identity_resolved := found;
  elsif v_role = 'player' then
    select identity_link.*
    into v_identity
    from public.net_active_identities as active_identity
    join public.net_identity_links as identity_link
      on identity_link.id = active_identity.identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
    where active_identity.profile_id = v_actor
      and public.current_user_controls_playable_net_identity_link(identity_link.id)
    for share of active_identity, identity_link;
    v_identity_resolved := found;

    if v_identity_resolved then
      select session_row.*
      into v_hacking_session
      from public.net_system_hacking_sessions as session_row
      where session_row.actor_identity_link_id = v_identity.id
      for share;

      if found then
        select identity_link.*
        into v_target_identity
        from public.net_identity_links as identity_link
        where identity_link.id = v_hacking_session.target_identity_link_id
        for share;
        v_target_resolved := found;

        -- Disambiguation only, never authorization: requested_expected_
        -- identity_link_id is compared against the target row above, never
        -- used to look it up. v_identity already holds the canonical SOURCE
        -- row and is left untouched unless the caller's expectation exactly
        -- matches this session's own TARGET -- a third, unrelated uuid
        -- falls through unchanged and is rejected below exactly as before.
        if v_target_resolved and requested_expected_identity_link_id = v_target_identity.id then
          v_identity := v_target_identity;
        end if;
      end if;
    end if;
  else
    raise exception 'NET_RUNTIME_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  if not v_identity_resolved
    or requested_expected_identity_link_id is null
    or requested_expected_identity_link_id is distinct from v_identity.id
  then
    raise exception 'NET_RUNTIME_IDENTITY_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  if requested_service_id is not null then
    perform 1
    from public.net_identity_os_assignments as assignment
    join public.net_os_families as os_family
      on os_family.id = assignment.primary_os_id
      and os_family.status = 'active'
    join public.net_os_service_scopes as service_scope
      on service_scope.service_id = requested_service_id
      and (
        service_scope.scope_kind = 'global'
        or (
          service_scope.scope_kind = 'primary-os'
          and service_scope.required_os_id = assignment.primary_os_id
        )
      )
    where assignment.identity_link_id = v_identity.id
    for share of assignment, os_family, service_scope;

    if not found then
      raise exception 'NET_OS_SERVICE_ACCESS_DENIED' using errcode = '42501';
    end if;

    if coalesce(requested_require_install, false) then
      perform 1
      from public.net_identity_app_installs as install
      where install.identity_link_id = v_identity.id
        and install.app_id = requested_service_id
      for share;

      if not found then
        raise exception 'NET_RUNTIME_APP_NOT_INSTALLED' using errcode = '42501';
      end if;
    end if;
  elsif coalesce(requested_require_install, false) then
    raise exception 'NET_RUNTIME_INSTALL_SERVICE_REQUIRED' using errcode = '22023';
  end if;

  return v_identity.id;
end;
$$;

revoke all on function public.assert_net_effective_runtime_identity(uuid, text, boolean)
  from public, anon, authenticated;

-- ==================================================================
-- READ VARIANT (stable, no row locks) -- identical disambiguation, applied
-- the same way, with the exact same lock-free query shapes it already had.
-- ==================================================================

create or replace function public.assert_net_effective_runtime_identity_read(
  requested_expected_identity_link_id uuid,
  requested_service_id text default null,
  requested_require_install boolean default false
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
  v_identity public.net_identity_links%rowtype;
  v_session public.net_gm_persona_sessions%rowtype;
  v_hacking_session public.net_system_hacking_sessions%rowtype;
  v_target_identity public.net_identity_links%rowtype;
  v_target_resolved boolean := false;
  v_identity_resolved boolean := false;
begin
  if v_actor is null then
    raise exception 'NET_RUNTIME_AUTH_REQUIRED' using errcode = '42501';
  end if;

  select profile.role
  into v_role
  from public.profiles as profile
  where profile.id = v_actor;

  if not found then
    raise exception 'NET_RUNTIME_PROFILE_REQUIRED' using errcode = '42501';
  end if;

  if v_role = 'gm' then
    select gm_session.*
    into v_session
    from public.net_gm_persona_sessions as gm_session
    where gm_session.gm_profile_id = v_actor
      and gm_session.mode = 'take-control';

    if not found then
      raise exception 'NET_RUNTIME_CONTROL_REQUIRED' using errcode = '42501';
    end if;

    select identity_link.*
    into v_identity
    from public.net_identity_links as identity_link
    where identity_link.subject_kind = v_session.subject_kind
      and identity_link.subject_id = v_session.subject_id
      and (
        (identity_link.identity_kind = 'player' and identity_link.playability = 'playable')
        or
        (identity_link.identity_kind = 'npc' and identity_link.playability = 'non-playable')
      );
    v_identity_resolved := found;
  elsif v_role = 'player' then
    select identity_link.*
    into v_identity
    from public.net_active_identities as active_identity
    join public.net_identity_links as identity_link
      on identity_link.id = active_identity.identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
    where active_identity.profile_id = v_actor
      and public.current_user_controls_playable_net_identity_link(identity_link.id);
    v_identity_resolved := found;

    if v_identity_resolved then
      select session_row.*
      into v_hacking_session
      from public.net_system_hacking_sessions as session_row
      where session_row.actor_identity_link_id = v_identity.id;

      if found then
        select identity_link.*
        into v_target_identity
        from public.net_identity_links as identity_link
        where identity_link.id = v_hacking_session.target_identity_link_id;
        v_target_resolved := found;

        -- Same disambiguation-only substitution as the write variant above.
        if v_target_resolved and requested_expected_identity_link_id = v_target_identity.id then
          v_identity := v_target_identity;
        end if;
      end if;
    end if;
  else
    raise exception 'NET_RUNTIME_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  if not v_identity_resolved
    or requested_expected_identity_link_id is null
    or requested_expected_identity_link_id is distinct from v_identity.id
  then
    raise exception 'NET_RUNTIME_IDENTITY_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  if requested_service_id is not null then
    perform 1
    from public.net_identity_os_assignments as assignment
    join public.net_os_families as os_family
      on os_family.id = assignment.primary_os_id
      and os_family.status = 'active'
    join public.net_os_service_scopes as service_scope
      on service_scope.service_id = requested_service_id
      and (
        service_scope.scope_kind = 'global'
        or (
          service_scope.scope_kind = 'primary-os'
          and service_scope.required_os_id = assignment.primary_os_id
        )
      )
    where assignment.identity_link_id = v_identity.id;

    if not found then
      raise exception 'NET_OS_SERVICE_ACCESS_DENIED' using errcode = '42501';
    end if;

    if coalesce(requested_require_install, false) then
      perform 1
      from public.net_identity_app_installs as install
      where install.identity_link_id = v_identity.id
        and install.app_id = requested_service_id;

      if not found then
        raise exception 'NET_RUNTIME_APP_NOT_INSTALLED' using errcode = '42501';
      end if;
    end if;
  elsif coalesce(requested_require_install, false) then
    raise exception 'NET_RUNTIME_INSTALL_SERVICE_REQUIRED' using errcode = '22023';
  end if;

  return v_identity.id;
end;
$$;

revoke all on function public.assert_net_effective_runtime_identity_read(uuid, text, boolean)
  from public, anon, authenticated;

commit;
