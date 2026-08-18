-- HACKING: full runtime-takeover parity, implemented once at the shared
-- effective-runtime-identity layer instead of per application.
--
-- Product decision: a successful hack projects the actor's runtime onto the
-- target exactly like Silver's TAKE CONTROL already does -- full normal app
-- functionality against the target's own data, not a read-only snapshot.
-- This migration does not touch any of the ~15 individual app RPCs. Every
-- one of them already resolves identity exclusively through
-- current_net_effective_runtime_identity_link_id() / assert_net_effective_
-- runtime_identity(...) / assert_net_effective_runtime_identity_read(...),
-- so redefining those three functions here is sufficient for all of them to
-- automatically inherit hacking-target authority, including the raw Storage
-- RLS policies on the net-wallpapers bucket and the ALTARA MUSIC / VOX AUDIO
-- buckets that already call these same functions transitively via
-- current_user_can_read/mutate_net_runtime_wallpaper_object(...) and
-- current_user_has_net_runtime_service_for_link(...) -- unchanged here,
-- inheriting automatically. Existing OS/service-scope/install checks inside
-- assert_net_effective_runtime_identity(...) already operate on whichever
-- identity it resolves to, so once that identity is the target, those
-- checks correctly apply to the target's own OS/installs -- no separate
-- "hacking-aware" OR-check was added anywhere.
--
-- SOURCE vs PROJECTED, and why a second helper exists: if the shared
-- resolver simply became "target when hacking, else caller" with no way to
-- ask for the un-projected identity, the hacking lifecycle RPCs
-- (fetch/end_net_system_hacking_session, credential attempts, the player-
-- facing grant list) would recursively look up *the target's own* hacking
-- state instead of the actor's -- silently breaking DISCONNECT (it would
-- search for a session keyed by Vanessa, which doesn't exist, since sessions
-- are keyed by actor_identity_link_id = the source). To avoid that circular
-- resolution, current_net_runtime_source_identity_link_id() is added as an
-- exact, byte-for-byte copy of current_net_effective_runtime_identity_link_
-- id()'s PRE-hacking behaviour (GM take-control OR the caller's own active
-- identity -- never hacking-aware), and every hacking-lifecycle RPC below is
-- repointed at it. current_net_effective_runtime_identity_link_id() itself
-- becomes: resolve source via the new helper, then project onto the active
-- hacking target if (and only if) one exists for that exact source -- this
-- is the single, non-recursive projection step every application inherits.
--
-- assert_net_effective_runtime_identity(...) (volatile, used by every
-- mutation RPC) gets the identical projection, plus a FOR SHARE lock on the
-- matched net_system_hacking_sessions row (protects an in-flight mutation
-- against a concurrent DISCONNECT racing it, consistent with every other
-- lock already in this function) and re-resolves the full target
-- net_identity_links row so the requested_expected_identity_link_id
-- stale-check and the OS/service-scope/install checks below it all
-- naturally evaluate against the target, not the source. Its read-only
-- sibling assert_net_effective_runtime_identity_read(...) (added by
-- net-system-hacking-credential-status-fix.sql) gets the same projection,
-- without locks.
--
-- Both assert functions previously had a latent bug this migration also
-- fixes while touching this logic: the final stale-identity check relied on
-- the ambient FOUND variable, which gets silently overwritten by *any*
-- later SELECT. Adding the hacking-session lookup in between the identity
-- resolution and that check would have made a genuinely-resolved identity
-- with *no* active hacking session incorrectly fail as "context changed"
-- (FOUND reflects the hacking-session lookup that found nothing, not the
-- identity resolution that succeeded). Fixed by capturing resolution
-- success into an explicit v_identity_resolved boolean immediately after
-- each resolving SELECT, used for the check instead of the ambient FOUND.
--
-- AUDIT: net_runtime_action_context(...) (called from ~12 files this
-- migration does not touch) gains a third branch: when the caller is a
-- player whose source identity has an active hacking session targeting
-- requested_identity_link_id, it returns the existing 'compromised-session'
-- action_mode (already a valid net_action_audit.action_mode value -- no
-- schema/enum change needed) with authorization_basis set to
-- 'authoritative-hacking-session-source:<source_identity_link_id>', and
-- persona_subject_kind/id identifying the TARGET's subject -- exactly the
-- same "which subject was this performed as" semantics the existing
-- gm-persona branch already uses for take-control. authenticated_actor_
-- profile_id (always auth.uid()) is untouched by any of this, so the real
-- logged-in account is never lost. This makes every one of the ~12 files
-- that already call net_runtime_action_context(...) automatically record
-- correct hacking provenance with zero per-file changes -- but only for the
-- fields those files already forward from its return value. None of them
-- currently have a dedicated typed column for "source identity" (only
-- persona_subject_kind/id for "acted-as identity"), so embedding the source
-- id in authorization_basis (a free-text column with only a non-empty
-- check) was chosen over adding a new net_action_audit column specifically
-- to avoid requiring per-file INSERT changes across ~15 files to populate
-- it -- see the accompanying report for the exact remaining limitation.
--
-- Hacking-lifecycle RPCs repointed from current_net_effective_runtime_
-- identity_link_id() to current_net_runtime_source_identity_link_id():
-- fetch_net_system_hacking_session, end_net_system_hacking_session,
-- attempt_net_system_credential_access, fetch_net_system_hacking_targets,
-- fetch_net_system_hacking_target_system (the last of these is no longer
-- called by the frontend after this batch's ENTER SYSTEM rewrite, but is
-- kept correct for consistency rather than left silently wrong).
-- attempt_net_system_credential_access is reproduced here with its
-- pgcrypto extensions-schema qualification already applied (net-system-
-- hacking-pgcrypto-schema-fix.sql) since this migration fully re-creates
-- it regardless of whether that hotfix has been deployed yet.
--
-- confirm_net_system_hacking_roll_success, set/revoke_net_system_hacking_
-- grant, and fetch_net_system_hacking_grants are NOT touched: all four take
-- explicit actor/target identity parameters and are gated by
-- assert_net_system_admin() (GM-only), never resolving identity through
-- either helper this migration changes.
--
-- Deliberately NOT touched: current_user_controls_playable_net_identity_link
-- / current_user_controls_net_identity_link (raw ownership predicates used
-- directly by RLS policies on net_universal_profiles and others). These
-- must keep checking genuine ownership -- weakening them would let Adrian
-- bypass RLS to access Vanessa's rows outside the audited RPC surface
-- entirely. Full parity is achieved only through the audited, SECURITY
-- DEFINER RPC layer, exactly as TAKE CONTROL already works.

begin;

do $preflight$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_active_identities') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_os_families') is null
    or to_regclass('public.net_os_service_scopes') is null
    or to_regclass('public.net_identity_app_installs') is null
    or to_regclass('public.net_system_hacking_sessions') is null
    or to_regclass('public.net_system_hacking_grants') is null
    or to_regclass('public.net_system_credentials') is null
    or to_regclass('public.net_action_audit') is null
    or to_regprocedure('public.current_user_controls_playable_net_identity_link(uuid)') is null
    or to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.assert_net_effective_runtime_identity(uuid,text,boolean)') is null
    or to_regprocedure('public.assert_net_effective_runtime_identity_read(uuid,text,boolean)') is null
    or to_regprocedure('public.net_runtime_action_context(uuid)') is null
    or to_regprocedure('public.fetch_net_system_hacking_session()') is null
    or to_regprocedure('public.end_net_system_hacking_session()') is null
    or to_regprocedure('public.attempt_net_system_credential_access(uuid,text)') is null
    or to_regprocedure('public.fetch_net_system_hacking_targets()') is null
    or to_regprocedure('public.fetch_net_system_hacking_target_system()') is null
    or to_regprocedure('public.net_system_hacking_establish_compromised_access(uuid,uuid,uuid,text)') is null
    or to_regprocedure('public.net_altara_identity_presentation(uuid)') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
  then
    raise exception 'NET_SYSTEM_HACKING_RUNTIME_PROJECTION_DEPENDENCY_REQUIRED. This migration requires net-effective-runtime-identity.sql, net-system-hacking-foundation.sql, net-system-hacking-player-access.sql, and net-system-hacking-credential-status-fix.sql to be deployed first.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_extension as extension_row
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = extension_row.extnamespace
    where extension_row.extname = 'pgcrypto'
      and namespace_row.nspname = 'extensions'
  )
    or to_regprocedure('extensions.crypt(text,text)') is null
    or to_regprocedure('extensions.gen_salt(text,integer)') is null
  then
    raise exception 'NET_SYSTEM_HACKING_PGCRYPTO_EXTENSIONS_SCHEMA_REQUIRED'
      using errcode = '55000';
  end if;
end;
$preflight$;

-- ==================================================================
-- SOURCE vs EFFECTIVE (PROJECTED) RUNTIME IDENTITY
-- ==================================================================

-- Exact pre-hacking behaviour of current_net_effective_runtime_identity_
-- link_id(): GM take-control target, or the caller's own active playable
-- identity. Never hacking-aware. Every hacking-lifecycle RPC uses this, not
-- the (now projection-aware) function below, so DISCONNECT/session status/
-- credential attempts always operate on the actor doing the hacking, never
-- on whichever identity that actor is currently projected onto.
create or replace function public.current_net_runtime_source_identity_link_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
  v_identity_link_id uuid;
begin
  if v_actor is null then
    return null;
  end if;

  select profile.role
  into v_role
  from public.profiles as profile
  where profile.id = v_actor;

  if not found then
    return null;
  end if;

  if v_role = 'gm' then
    select identity_link.id
    into v_identity_link_id
    from public.net_gm_persona_sessions as gm_session
    join public.net_identity_links as identity_link
      on identity_link.subject_kind = gm_session.subject_kind
      and identity_link.subject_id = gm_session.subject_id
    where gm_session.gm_profile_id = v_actor
      and gm_session.mode = 'take-control'
      and (
        (identity_link.identity_kind = 'player' and identity_link.playability = 'playable')
        or
        (identity_link.identity_kind = 'npc' and identity_link.playability = 'non-playable')
      );
    return v_identity_link_id;
  end if;

  if v_role = 'player' then
    select identity_link.id
    into v_identity_link_id
    from public.net_active_identities as active_identity
    join public.net_identity_links as identity_link
      on identity_link.id = active_identity.identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
    where active_identity.profile_id = v_actor
      and public.current_user_controls_playable_net_identity_link(identity_link.id);
    return v_identity_link_id;
  end if;

  return null;
end;
$$;

revoke all on function public.current_net_runtime_source_identity_link_id()
  from public, anon, authenticated;

-- Every application already calls this exact function name. Projection
-- happens here, once: resolve the source, then substitute the active
-- hacking target for that exact source if one exists.
create or replace function public.current_net_effective_runtime_identity_link_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_identity_link_id uuid := public.current_net_runtime_source_identity_link_id();
  v_target_identity_link_id uuid;
begin
  if v_source_identity_link_id is null then
    return null;
  end if;

  select session_row.target_identity_link_id
  into v_target_identity_link_id
  from public.net_system_hacking_sessions as session_row
  where session_row.actor_identity_link_id = v_source_identity_link_id;

  if found then
    return v_target_identity_link_id;
  end if;

  return v_source_identity_link_id;
end;
$$;

revoke all on function public.current_net_effective_runtime_identity_link_id()
  from public, anon, authenticated;

-- Transaction-locking assertion for every runtime read/mutation boundary.
-- The selected identity UUID is only a stale-request assertion; the server
-- derives the actual identity from auth.uid() and the authoritative
-- session, now including hacking projection.
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
        into v_identity
        from public.net_identity_links as identity_link
        where identity_link.id = v_hacking_session.target_identity_link_id
        for share;
        v_identity_resolved := found;
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

-- Read-only-safe sibling (net-system-hacking-credential-status-fix.sql),
-- same projection, no locks.
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
        into v_identity
        from public.net_identity_links as identity_link
        where identity_link.id = v_hacking_session.target_identity_link_id;
        v_identity_resolved := found;
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

-- ==================================================================
-- AUDIT PROVENANCE
-- ==================================================================

create or replace function public.net_runtime_action_context(
  requested_identity_link_id uuid
)
returns table (
  action_mode text,
  authorization_basis text,
  persona_subject_kind text,
  persona_subject_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.app_role;
  v_source_identity_link_id uuid;
begin
  select profile.role
  into v_role
  from public.profiles as profile
  where profile.id = auth.uid();

  if v_role = 'gm' then
    return query
    select
      'gm-persona'::text,
      case identity_link.identity_kind
        when 'npc' then 'authoritative-gm-take-control-npc'
        else 'authoritative-gm-take-control-player'
      end::text,
      gm_session.subject_kind,
      gm_session.subject_id
    from public.net_gm_persona_sessions as gm_session
    join public.net_identity_links as identity_link
      on identity_link.subject_kind = gm_session.subject_kind
      and identity_link.subject_id = gm_session.subject_id
    where gm_session.gm_profile_id = auth.uid()
      and gm_session.mode = 'take-control'
      and identity_link.id = requested_identity_link_id;
    return;
  end if;

  v_source_identity_link_id := public.current_net_runtime_source_identity_link_id();

  if v_source_identity_link_id is not null
    and v_source_identity_link_id is distinct from requested_identity_link_id
    and exists (
      select 1
      from public.net_system_hacking_sessions as session_row
      where session_row.actor_identity_link_id = v_source_identity_link_id
        and session_row.target_identity_link_id = requested_identity_link_id
    )
  then
    return query
    select
      'compromised-session'::text,
      ('authoritative-hacking-session-source:' || v_source_identity_link_id::text)::text,
      identity_link.subject_kind,
      identity_link.subject_id
    from public.net_identity_links as identity_link
    where identity_link.id = requested_identity_link_id;
    return;
  end if;

  action_mode := 'owner';
  authorization_basis := 'controlled-playable-identity';
  persona_subject_kind := null;
  persona_subject_id := null;
  return next;
end;
$$;

revoke all on function public.net_runtime_action_context(uuid)
  from public, anon, authenticated;

-- ==================================================================
-- HACKING LIFECYCLE -- always SOURCE-anchored, never projected
-- ==================================================================

create or replace function public.fetch_net_system_hacking_session()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.current_net_runtime_source_identity_link_id();
  v_session public.net_system_hacking_sessions%rowtype;
  v_target_os_id text;
begin
  select session_row.*
  into v_session
  from public.net_system_hacking_sessions as session_row
  where session_row.actor_identity_link_id = v_actor_id;

  if not found then
    return jsonb_build_object('active', false);
  end if;

  select assignment.primary_os_id
  into v_target_os_id
  from public.net_identity_os_assignments as assignment
  where assignment.identity_link_id = v_session.target_identity_link_id;

  return jsonb_build_object(
    'active', true,
    'target_identity_link_id', v_session.target_identity_link_id,
    'target_os_id', v_target_os_id,
    'established_via', v_session.established_via,
    'created_at', v_session.created_at,
    'updated_at', v_session.updated_at
  );
end;
$$;

revoke all on function public.fetch_net_system_hacking_session()
  from public, anon, authenticated;
grant execute on function public.fetch_net_system_hacking_session() to authenticated;

create or replace function public.end_net_system_hacking_session()
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.current_net_runtime_source_identity_link_id();
  v_session public.net_system_hacking_sessions%rowtype;
  v_context record;
begin
  if v_actor_id is null then
    return false;
  end if;

  delete from public.net_system_hacking_sessions
  where actor_identity_link_id = v_actor_id
  returning * into v_session;

  if not found then
    return false;
  end if;

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
    v_context.action_mode, 'hacking.session.end',
    'hacking-session-actor-disconnect', 'net-identity-link', v_session.target_identity_link_id
  );

  return true;
end;
$$;

revoke all on function public.end_net_system_hacking_session()
  from public, anon, authenticated;
grant execute on function public.end_net_system_hacking_session() to authenticated;

create or replace function public.attempt_net_system_credential_access(
  requested_target_identity_link_id uuid,
  requested_credential text
)
returns public.net_system_hacking_sessions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.current_net_runtime_source_identity_link_id();
  v_grant public.net_system_hacking_grants%rowtype;
  v_credential public.net_system_credentials%rowtype;
  v_dummy_hash text := extensions.crypt('net-hacking-timing-guard-' || gen_random_uuid()::text, extensions.gen_salt('bf', 10));
  v_verified boolean;
  v_context record;
  v_denial_reason text;
  v_result public.net_system_hacking_sessions;
begin
  if v_actor_id is null or requested_target_identity_link_id is null then
    v_denial_reason := 'hacking-actor-unavailable';
  elsif v_actor_id = requested_target_identity_link_id then
    v_denial_reason := 'hacking-actor-target-same';
  elsif not exists (
    select 1
    from public.net_identity_links as identity_link
    where identity_link.id = requested_target_identity_link_id
      and (
        (identity_link.identity_kind = 'player' and identity_link.playability = 'playable')
        or
        (identity_link.identity_kind = 'npc' and identity_link.playability = 'non-playable')
      )
  ) then
    -- Same eligibility predicate as current_net_effective_runtime_identity_link_id()
    -- / ACT AS: a playable player or a non-playable, network-eligible NPC.
    -- Checked up front (and re-checked, fail-closed, inside
    -- net_system_hacking_establish_compromised_access) so a target that
    -- somehow stopped being eligible between grant creation and this attempt
    -- can never raise a different, more specific exception than the generic
    -- denial below.
    v_denial_reason := 'hacking-target-invalid';
  elsif not exists (
    select 1
    from public.net_identity_os_assignments as assignment
    join public.net_os_families as os_family
      on os_family.id = assignment.primary_os_id
      and os_family.status = 'active'
    where assignment.identity_link_id = requested_target_identity_link_id
  ) then
    v_denial_reason := 'hacking-target-os-invalid';
  else
    select grant_row.*
    into v_grant
    from public.net_system_hacking_grants as grant_row
    where grant_row.actor_identity_link_id = v_actor_id
      and grant_row.target_identity_link_id = requested_target_identity_link_id
    for share;

    if not found then
      v_denial_reason := 'hacking-grant-missing';
    elsif not v_grant.enabled then
      v_denial_reason := 'hacking-grant-disabled';
    elsif v_grant.method <> 'credential' then
      v_denial_reason := 'hacking-grant-wrong-method';
    else
      select credential_row.*
      into v_credential
      from public.net_system_credentials as credential_row
      where credential_row.identity_link_id = requested_target_identity_link_id
      for share;

      v_verified := extensions.crypt(
        coalesce(requested_credential, ''),
        coalesce(v_credential.credential_hash, v_dummy_hash)
      ) = coalesce(v_credential.credential_hash, v_dummy_hash);

      if not found then
        v_denial_reason := 'hacking-target-no-credential';
      elsif not v_verified then
        v_denial_reason := 'hacking-credential-incorrect';
      end if;
    end if;
  end if;

  select context.*
  into v_context
  from public.net_runtime_action_context(v_actor_id) as context;

  if v_denial_reason is not null then
    insert into public.net_action_audit (
      authenticated_actor_profile_id, presented_account_id,
      persona_subject_kind, persona_subject_id, action_mode, action_type,
      authorization_basis, resource_type, resource_id
    ) values (
      auth.uid(), null,
      v_context.persona_subject_kind, v_context.persona_subject_id,
      coalesce(v_context.action_mode, 'system'), 'hacking.credential.attempt.denied',
      v_denial_reason, 'net-identity-link', requested_target_identity_link_id
    );
    raise exception 'NET_SYSTEM_HACKING_ACCESS_DENIED' using errcode = '42501';
  end if;

  v_result := public.net_system_hacking_establish_compromised_access(
    v_grant.granted_by_profile_id,
    v_actor_id,
    requested_target_identity_link_id,
    'credential'
  );

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    auth.uid(), null,
    v_context.persona_subject_kind, v_context.persona_subject_id,
    v_context.action_mode, 'hacking.credential.attempt.success',
    'hacking-credential-verified', 'net-identity-link', requested_target_identity_link_id
  );

  return v_result;
end;
$$;

revoke all on function public.attempt_net_system_credential_access(uuid, text)
  from public, anon, authenticated;
grant execute on function public.attempt_net_system_credential_access(uuid, text)
  to authenticated;

create or replace function public.fetch_net_system_hacking_targets()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.current_net_runtime_source_identity_link_id();
begin
  if v_actor_id is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'target_identity_link_id', grant_row.target_identity_link_id,
      'display_name', presentation ->> 'display_name',
      'avatar_url', presentation ->> 'avatar_url',
      'os_id', assignment.primary_os_id,
      'method', grant_row.method
    ) order by grant_row.updated_at desc)
    from public.net_system_hacking_grants as grant_row
    cross join lateral public.net_altara_identity_presentation(
      grant_row.target_identity_link_id
    ) as presentation
    left join public.net_identity_os_assignments as assignment
      on assignment.identity_link_id = grant_row.target_identity_link_id
    where grant_row.actor_identity_link_id = v_actor_id
      and grant_row.enabled = true
    limit 100
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fetch_net_system_hacking_targets()
  from public, anon, authenticated;
grant execute on function public.fetch_net_system_hacking_targets() to authenticated;

-- No longer called by the frontend after this batch's ENTER SYSTEM rewrite
-- (superseded by mounting the real OS runtime against the projected
-- identity). Kept correct rather than left silently wrong.
create or replace function public.fetch_net_system_hacking_target_system()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.current_net_runtime_source_identity_link_id();
  v_session public.net_system_hacking_sessions%rowtype;
  v_profile public.net_identity_system_profiles%rowtype;
  v_installs jsonb;
begin
  if v_actor_id is null then
    raise exception 'NET_SYSTEM_HACKING_SESSION_REQUIRED' using errcode = '42501';
  end if;

  select session_row.*
  into v_session
  from public.net_system_hacking_sessions as session_row
  where session_row.actor_identity_link_id = v_actor_id;

  if not found then
    raise exception 'NET_SYSTEM_HACKING_SESSION_REQUIRED' using errcode = '42501';
  end if;

  select system_profile.* into v_profile
  from public.net_identity_system_profiles as system_profile
  where system_profile.identity_link_id = v_session.target_identity_link_id;

  select coalesce(jsonb_agg(
    jsonb_build_object('app_id', install.app_id)
    order by install.installed_at, install.app_id
  ), '[]'::jsonb)
  into v_installs
  from public.net_identity_app_installs as install
  where install.identity_link_id = v_session.target_identity_link_id
    and public.net_identity_link_can_access_service(v_session.target_identity_link_id, install.app_id);

  return jsonb_build_object(
    'identity_link_id', v_session.target_identity_link_id,
    'display_name', public.net_altara_identity_presentation(v_session.target_identity_link_id) ->> 'display_name',
    'os_id', (
      select assignment.primary_os_id
      from public.net_identity_os_assignments as assignment
      where assignment.identity_link_id = v_session.target_identity_link_id
    ),
    'profile', case when v_profile.identity_link_id is null
      then null
      else to_jsonb(v_profile)
    end,
    'installs', v_installs
  );
end;
$$;

revoke all on function public.fetch_net_system_hacking_target_system()
  from public, anon, authenticated;
grant execute on function public.fetch_net_system_hacking_target_system() to authenticated;

-- ==================================================================
-- TARGET RESOLVED IDENTITY (new -- required for the frontend to mount the
-- real OS runtime, not a snapshot)
-- ==================================================================

-- The frontend's own identity-resolution chain (NetResolvedIdentity) needs
-- more than wallpaper/app-list data to mount the real OS runtime as the
-- target: subject_kind/subject_id, identity_kind, campaign_id, and
-- entity_id (world link) are all required by existing app props that
-- already consume NetResolvedIdentity. A normal player's own client-side
-- candidate resolution cannot produce this for a hacking target -- it is
-- scoped to identities the authenticated profile itself owns, by design,
-- exactly like every other RLS boundary in this product. This RPC is the
-- narrow, safe, source-anchored substitute: reuses the same non-owner-
-- leaking net_altara_identity_presentation() display/avatar projection
-- already used for the player-facing hacking target list, adds the
-- classification fields net_identity_links already stores, and explicitly
-- never returns owner_profile_id. authoring_status is fixed to
-- 'identity-ready': the credential/roll-authorised eligibility check every
-- hacking session already passed (attempt_net_system_credential_access /
-- confirm_net_system_hacking_roll_success) requires the target to be a
-- genuinely valid playable or network-eligible NPC identity, so this is not
-- a fabricated assumption.
create or replace function public.fetch_net_system_hacking_target_resolved_identity()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.current_net_runtime_source_identity_link_id();
  v_session public.net_system_hacking_sessions%rowtype;
  v_link public.net_identity_links%rowtype;
  v_presentation jsonb;
begin
  if v_actor_id is null then
    raise exception 'NET_SYSTEM_HACKING_SESSION_REQUIRED' using errcode = '42501';
  end if;

  select session_row.*
  into v_session
  from public.net_system_hacking_sessions as session_row
  where session_row.actor_identity_link_id = v_actor_id;

  if not found then
    raise exception 'NET_SYSTEM_HACKING_SESSION_REQUIRED' using errcode = '42501';
  end if;

  select identity_link.*
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = v_session.target_identity_link_id;

  if not found then
    raise exception 'NET_SYSTEM_HACKING_SESSION_REQUIRED' using errcode = '42501';
  end if;

  v_presentation := public.net_altara_identity_presentation(v_link.id);

  return jsonb_build_object(
    'identity_link_id', v_link.id,
    'subject_kind', v_link.subject_kind,
    'subject_id', v_link.subject_id,
    'identity_kind', v_link.identity_kind,
    'entity_id', v_link.entity_id,
    'campaign_id', v_link.campaign_id,
    'display_name', v_presentation ->> 'display_name',
    'avatar_url', v_presentation ->> 'avatar_url'
  );
end;
$$;

revoke all on function public.fetch_net_system_hacking_target_resolved_identity()
  from public, anon, authenticated;
grant execute on function public.fetch_net_system_hacking_target_resolved_identity() to authenticated;

commit;
