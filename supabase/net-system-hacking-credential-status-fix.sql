-- Fixes "cannot execute SELECT FOR SHARE in a read-only transaction" on
-- SYSTEM SECURITY status (both VEIL and ALTARA Settings -> Security).
--
-- public.fetch_net_system_credential_status(...) is declared `stable`, so
-- PostgREST executes it inside a READ ONLY transaction. It calls
-- public.assert_net_effective_runtime_identity(...) (net-effective-runtime-
-- identity.sql), which is `volatile` and takes several `for share` row
-- locks (profile role, GM take-control session, resolved identity link,
-- active-identity row, OS-service-scope join) because it is also the
-- assertion used by mutation RPCs that legitimately need that locking. This
-- is the identical bug class already fixed once for Home Currency
-- (net-economy-gm-readonly-fetch-fix.sql: assert_net_system_admin_read())
-- and once for PULSE take-control parity: a shared, lock-taking assertion
-- called from a `stable` fetch path.
--
-- assert_net_effective_runtime_identity(...) is not modified here -- it is
-- called from many mutation RPCs across the whole NET product surface and
-- must keep its locking semantics for those callers. Instead this adds a
-- read-only-safe sibling, assert_net_effective_runtime_identity_read(...),
-- that performs the exact same authority decision (GM role + take-control
-- target, or player + owned active identity; same stale-request comparison
-- against requested_expected_identity_link_id; same OS-service-scope and
-- install checks) via plain SELECTs with no row locks, and repoints
-- fetch_net_system_credential_status at it. No identity authority was
-- widened or weakened: every check, every raised exception, and every
-- errcode is unchanged -- only the locking clauses were removed.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_active_identities') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_os_families') is null
    or to_regclass('public.net_os_service_scopes') is null
    or to_regclass('public.net_identity_app_installs') is null
    or to_regprocedure('public.current_user_controls_playable_net_identity_link(uuid)') is null
    or to_regprocedure('public.assert_net_effective_runtime_identity(uuid,text,boolean)') is null
    or to_regprocedure('public.fetch_net_system_credential_status(uuid)') is null
  then
    raise exception 'NET_SYSTEM_HACKING_CREDENTIAL_STATUS_FIX_DEPENDENCY_REQUIRED. This migration requires net-effective-runtime-identity.sql and net-system-hacking-foundation.sql to be deployed first.'
      using errcode = '55000';
  end if;
end;
$$;

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
  else
    raise exception 'NET_RUNTIME_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  if not found
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

create or replace function public.fetch_net_system_credential_status(
  requested_expected_identity_link_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_credential public.net_system_credentials%rowtype;
begin
  v_identity_link_id := public.assert_net_effective_runtime_identity_read(
    requested_expected_identity_link_id, null, false
  );

  select credential_row.*
  into v_credential
  from public.net_system_credentials as credential_row
  where credential_row.identity_link_id = v_identity_link_id;

  return jsonb_build_object(
    'identity_link_id', v_identity_link_id,
    'configured', found,
    'credential_kind', case when found then v_credential.credential_kind else null end,
    'updated_at', case when found then v_credential.updated_at else null end
  );
end;
$$;

commit;
