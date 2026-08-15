-- One authoritative runtime identity for normal play, GM TAKE CONTROL, and
-- network-NPC ACT AS. This migration does not transfer ownership and does not
-- create auth profiles. Run after net-multi-os-unified-gm-control.sql and the
-- deployed PULSE/ECHO/account/system-profile migrations.

begin;

do $$
declare
  v_before_insert_triggers text[];
  v_unexpected_pulse_callers text;
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_active_identities') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_os_families') is null
    or to_regclass('public.net_os_service_scopes') is null
    or to_regclass('public.net_identity_app_installs') is null
    or to_regclass('public.net_identity_system_profiles') is null
    or to_regclass('public.net_app_account_policies') is null
    or to_regclass('public.net_app_accounts') is null
    or to_regclass('public.net_action_audit') is null
    or to_regclass('public.net_pulse_posts') is null
    or to_regclass('public.net_pulse_profiles') is null
    or to_regclass('public.net_pulse_realtime_state') is null
    or to_regclass('storage.objects') is null
    or to_regtype('public.app_role') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.current_user_controls_playable_net_identity_link(uuid)') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
    or to_regprocedure('public.normalize_net_app_handle(text)') is null
    or to_regprocedure('public.net_identity_account_handle_seed(uuid)') is null
    or to_regprocedure('public.net_wallpaper_identity_link_id(text)') is null
    or to_regprocedure('public.assert_net_pulse_account_context(uuid,boolean)') is null
    or to_regprocedure('public.assert_net_echo_account_context(uuid,boolean)') is null
    or to_regprocedure('public.bind_net_pulse_take_control_audit()') is null
    or to_regprocedure('public.net_pulse_action_audit_context(uuid)') is null
  then
    raise exception 'NET_RUNTIME_IDENTITY_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.net_gm_persona_sessions'::regclass
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) like '%take-control%'
  ) then
    raise exception 'NET_RUNTIME_TAKE_CONTROL_MODE_REQUIRED'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from information_schema.columns as column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'net_identity_system_profiles'
      and column_row.column_name = 'wallpaper_preset_id'
  ) then
    raise exception 'NET_RUNTIME_SYSTEM_PROFILE_SHAPE_REQUIRED'
      using errcode = '55000';
  end if;

  -- Production already includes net-pulse-gm-take-control-context.sql. Refuse
  -- to transition an unknown trigger graph: same-event PostgreSQL triggers run
  -- in name order, so leaving the old player-only binder beside the new
  -- player/NPC normalizer would let the old trigger reject NPC ACT AS first.
  select array_agg(trigger_row.tgname order by trigger_row.tgname)
  into v_before_insert_triggers
  from pg_catalog.pg_trigger as trigger_row
  where trigger_row.tgrelid = 'public.net_action_audit'::regclass
    and not trigger_row.tgisinternal
    and (trigger_row.tgtype & 1) = 1
    and (trigger_row.tgtype & 2) = 2
    and (trigger_row.tgtype & 4) = 4;

  if v_before_insert_triggers is distinct from
    array['net_action_audit_bind_pulse_take_control']::text[]
  then
    raise exception 'NET_RUNTIME_PULSE_AUDIT_TRIGGER_REVIEW_REQUIRED: %',
      coalesce(array_to_string(v_before_insert_triggers, ', '), '<none>')
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgrelid = 'public.net_action_audit'::regclass
      and trigger_row.tgname = 'net_action_audit_bind_pulse_take_control'
      and trigger_row.tgfoid =
        'public.bind_net_pulse_take_control_audit()'::regprocedure
      and not trigger_row.tgisinternal
      and (trigger_row.tgtype & 1) = 1
      and (trigger_row.tgtype & 2) = 2
      and (trigger_row.tgtype & 4) = 4
  ) then
    raise exception 'NET_RUNTIME_PULSE_AUDIT_BINDING_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  -- PL/pgSQL call references are not guaranteed to appear in pg_depend. Scan
  -- deployed function definitions as well and fail closed before retiring the
  -- obsolete helper if any unexpected function still names it.
  select string_agg(
    format('%I.%I(%s)', function_schema.nspname, function_row.proname,
      pg_get_function_identity_arguments(function_row.oid)),
    ', ' order by function_schema.nspname, function_row.proname,
      pg_get_function_identity_arguments(function_row.oid)
  )
  into v_unexpected_pulse_callers
  from pg_catalog.pg_proc as function_row
  join pg_catalog.pg_namespace as function_schema
    on function_schema.oid = function_row.pronamespace
  where case
      when function_row.prokind in ('f', 'p')
        then pg_get_functiondef(function_row.oid)
      else ''
    end ilike '%net_pulse_action_audit_context%'
    and function_row.oid not in (
  'public.net_pulse_action_audit_context(uuid)'::regprocedure,
  'public.bind_net_pulse_take_control_audit()'::regprocedure,

  -- Expected callers from the already-deployed
  -- net-pulse-gm-take-control-context migration.
  -- This migration replaces all three before retiring
  -- net_pulse_action_audit_context().
  'public.create_net_pulse_post(uuid,text,uuid)'::regprocedure,
  'public.delete_net_pulse_post(uuid)'::regprocedure,
  'public.update_net_pulse_public_profile(uuid,text,text,text,boolean,boolean,text)'::regprocedure
);

  if v_unexpected_pulse_callers is not null then
    raise exception 'NET_RUNTIME_PULSE_AUDIT_DEPENDENCY_REVIEW_REQUIRED: %',
      v_unexpected_pulse_callers
      using errcode = '55000';
  end if;
end;
$$;

comment on column public.net_gm_persona_sessions.mode is
  'none is GM System. take-control is the authoritative runtime identity mode for player/playable TAKE CONTROL and network NPC/non-playable ACT AS. The authenticated actor remains gm_profile_id.';

-- Comparison-only resolver. GM role is checked first so a stale normal-player
-- row can never shadow or replace the exact GM control session.
create or replace function public.current_net_effective_runtime_identity_link_id()
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

-- RLS/Storage-safe predicate. It grants capability only for the exact current
-- runtime link; it does not expose a caller-selected ownership primitive.
create or replace function public.current_user_has_net_runtime_service_for_link(
  requested_identity_link_id uuid,
  requested_service_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select requested_identity_link_id is not null
    and requested_service_id is not null
    and requested_identity_link_id = public.current_net_effective_runtime_identity_link_id()
    and public.net_identity_link_can_access_service(
      requested_identity_link_id,
      requested_service_id
    );
$$;

-- Transaction-locking assertion for every runtime read/mutation boundary.
-- The selected identity UUID is only a stale-request assertion; the server
-- derives the actual identity from auth.uid() and the authoritative session.
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

  action_mode := 'owner';
  authorization_basis := 'controlled-playable-identity';
  persona_subject_kind := null;
  persona_subject_id := null;
  return next;
end;
$$;

-- Raw app-account reads previously evaluated a revoked internal helper from an
-- RLS policy. Replace them with one exact, bounded runtime RPC.
create or replace function public.fetch_net_runtime_app_accounts(
  requested_expected_identity_link_id uuid
)
returns setof public.net_app_accounts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_entity_id text;
begin
  v_identity_link_id := public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id,
    null,
    false
  );

  select identity_link.entity_id
  into v_entity_id
  from public.net_identity_links as identity_link
  where identity_link.id = v_identity_link_id;

  return query
  select account.*
  from public.net_app_accounts as account
  where account.status in ('active', 'suspended')
    and (
      account.identity_link_id = v_identity_link_id
      or (v_entity_id is not null and account.entity_id = v_entity_id)
    )
    and public.net_identity_link_can_access_service(
      v_identity_link_id,
      account.app_id
    )
    and (
      account.app_id not in ('echo', 'pulse')
      or exists (
        select 1
        from public.net_identity_app_installs as install
        where install.identity_link_id = v_identity_link_id
          and install.app_id = account.app_id
      )
    )
  order by account.created_at, account.id;
end;
$$;

create or replace function public.fetch_net_gm_inspected_app_accounts(
  requested_expected_identity_link_id uuid
)
returns setof public.net_app_accounts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.net_gm_persona_sessions%rowtype;
  v_identity public.net_identity_links%rowtype;
  v_entity_id text;
begin
  if v_actor is null or not public.is_current_user_gm() then
    raise exception 'NET_RUNTIME_GM_REQUIRED' using errcode = '42501';
  end if;

  select gm_session.* into v_session
  from public.net_gm_persona_sessions as gm_session
  where gm_session.gm_profile_id = v_actor
    and gm_session.mode in ('inspect', 'compromised-session')
  for share;

  if not found then
    raise exception 'NET_RUNTIME_INSPECTION_REQUIRED' using errcode = '42501';
  end if;

  select identity_link.* into v_identity
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = v_session.subject_kind
    and identity_link.subject_id = v_session.subject_id
    and identity_link.id = requested_expected_identity_link_id
  for share;

  if not found then
    raise exception 'NET_RUNTIME_IDENTITY_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  v_entity_id := v_identity.entity_id;

  return query
  select account.*
  from public.net_app_accounts as account
  where account.status in ('active', 'suspended')
    and (
      account.identity_link_id = v_identity.id
      or (v_entity_id is not null and account.entity_id = v_entity_id)
    )
    and public.net_identity_link_can_access_service(v_identity.id, account.app_id)
  order by account.created_at, account.id;
end;
$$;

create or replace function public.fetch_net_runtime_identity_system(
  requested_expected_identity_link_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_primary_os_id text;
  v_settings_service_id text;
  v_profile public.net_identity_system_profiles%rowtype;
  v_installs jsonb;
begin
  v_identity_link_id := public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id,
    null,
    false
  );

  select assignment.primary_os_id
  into v_primary_os_id
  from public.net_identity_os_assignments as assignment
  join public.net_os_families as os_family
    on os_family.id = assignment.primary_os_id
    and os_family.status = 'active'
  where assignment.identity_link_id = v_identity_link_id;

  v_settings_service_id := case v_primary_os_id
    when 'veil' then 'veil-settings'
    when 'altara' then 'altara-settings'
    else null
  end;

  if v_settings_service_id is null then
    raise exception 'NET_RUNTIME_OS_UNAVAILABLE' using errcode = '42501';
  end if;

  perform public.assert_net_effective_runtime_identity(
    v_identity_link_id,
    v_settings_service_id,
    false
  );

  select system_profile.*
  into v_profile
  from public.net_identity_system_profiles as system_profile
  where system_profile.identity_link_id = v_identity_link_id;

  select coalesce(jsonb_agg(
    jsonb_build_object('app_id', install.app_id)
    order by install.installed_at, install.app_id
  ), '[]'::jsonb)
  into v_installs
  from public.net_identity_app_installs as install
  where install.identity_link_id = v_identity_link_id
    and public.net_identity_link_can_access_service(v_identity_link_id, install.app_id);

  return jsonb_build_object(
    'identity_link_id', v_identity_link_id,
    'profile', case when v_profile.identity_link_id is null
      then null
      else to_jsonb(v_profile)
    end,
    'installs', v_installs
  );
end;
$$;

-- Existing compromised/inspect surfaces remain explicitly read-only and do
-- not become runtime identities. This keeps their stale-request binding while
-- the normal/control path above remains the only mutation authority.
create or replace function public.fetch_net_gm_inspected_identity_system(
  requested_expected_identity_link_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.net_gm_persona_sessions%rowtype;
  v_identity public.net_identity_links%rowtype;
  v_profile public.net_identity_system_profiles%rowtype;
  v_installs jsonb;
begin
  if v_actor is null or not public.is_current_user_gm() then
    raise exception 'NET_RUNTIME_GM_REQUIRED' using errcode = '42501';
  end if;

  select gm_session.* into v_session
  from public.net_gm_persona_sessions as gm_session
  where gm_session.gm_profile_id = v_actor
    and gm_session.mode in ('inspect', 'compromised-session')
  for share;

  if not found then
    raise exception 'NET_RUNTIME_INSPECTION_REQUIRED' using errcode = '42501';
  end if;

  select identity_link.* into v_identity
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = v_session.subject_kind
    and identity_link.subject_id = v_session.subject_id
    and identity_link.id = requested_expected_identity_link_id
  for share;

  if not found then
    raise exception 'NET_RUNTIME_IDENTITY_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  select system_profile.* into v_profile
  from public.net_identity_system_profiles as system_profile
  where system_profile.identity_link_id = v_identity.id;

  select coalesce(jsonb_agg(
    jsonb_build_object('app_id', install.app_id)
    order by install.installed_at, install.app_id
  ), '[]'::jsonb)
  into v_installs
  from public.net_identity_app_installs as install
  where install.identity_link_id = v_identity.id
    and public.net_identity_link_can_access_service(v_identity.id, install.app_id);

  return jsonb_build_object(
    'identity_link_id', v_identity.id,
    'profile', case when v_profile.identity_link_id is null
      then null
      else to_jsonb(v_profile)
    end,
    'installs', v_installs
  );
end;
$$;

-- Preserve every currently installable app ID; only the actor boundary changes.
create or replace function public.set_net_identity_app_install(
  requested_identity_link_id uuid,
  requested_app_id text,
  requested_installed boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_context record;
begin
  if requested_app_id is null
    or requested_app_id not in (
      'echo', 'pulse', 'nvn', 'vox-bank', 'shneider-bank',
      'altara-bank', 'altara-news'
    )
  then
    raise exception 'This application is not an installable optional OS module.'
      using errcode = '22023';
  end if;
  if requested_installed is null then
    raise exception 'Installation state is required.' using errcode = '22023';
  end if;

  v_identity_link_id := public.assert_net_effective_runtime_identity(
    requested_identity_link_id,
    requested_app_id,
    false
  );

  if requested_installed then
    insert into public.net_identity_app_installs (identity_link_id, app_id)
    values (v_identity_link_id, requested_app_id)
    on conflict (identity_link_id, app_id) do update
    set updated_at = timezone('utc', now());
  else
    delete from public.net_identity_app_installs as install
    where install.identity_link_id = v_identity_link_id
      and install.app_id = requested_app_id;
  end if;

  select context.*
  into v_context
  from public.net_runtime_action_context(v_identity_link_id) as context;

  insert into public.net_action_audit (
    authenticated_actor_profile_id,
    presented_account_id,
    persona_subject_kind,
    persona_subject_id,
    action_mode,
    action_type,
    authorization_basis,
    resource_type,
    resource_id
  ) values (
    auth.uid(),
    null,
    v_context.persona_subject_kind,
    v_context.persona_subject_id,
    v_context.action_mode,
    case when requested_installed then 'net.app.install' else 'net.app.uninstall' end,
    v_context.authorization_basis || ':' || requested_app_id,
    'net-identity-link',
    v_identity_link_id
  );

  return requested_installed;
end;
$$;

-- Internal account workers preserve the deployed policy/handle/concurrency
-- behavior. They remain execution-revoked; public wrappers establish runtime
-- authority and installation before calling them.
create or replace function public.ensure_net_app_account_unscoped(
  requested_identity_link_id uuid,
  requested_app_id text
)
returns public.net_app_accounts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_policy public.net_app_account_policies%rowtype;
  v_link public.net_identity_links%rowtype;
  v_existing public.net_app_accounts%rowtype;
  v_saved public.net_app_accounts%rowtype;
  v_base_handle text;
  v_candidate_handle text;
  v_suffix text := left(replace(requested_identity_link_id::text, '-', ''), 6);
  v_attempt integer := 1;
begin
  select policy.* into v_policy
  from public.net_app_account_policies as policy
  where policy.app_id = requested_app_id
  for share;

  if not found
    or not v_policy.account_available
    or v_policy.account_mode not in ('system-identity', 'automatic')
  then
    raise exception 'This application does not support automatic account provisioning.'
      using errcode = '22023';
  end if;

  select identity_link.* into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id
  for share;

  if not found then
    raise exception 'NET_RUNTIME_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  select account.* into v_existing
  from public.net_app_accounts as account
  where account.app_id = requested_app_id
    and (
      account.identity_link_id = requested_identity_link_id
      or (v_link.entity_id is not null and account.entity_id = v_link.entity_id)
    )
  order by (account.identity_link_id = requested_identity_link_id) desc
  limit 1;

  if found then return v_existing; end if;

  v_base_handle := public.net_identity_account_handle_seed(requested_identity_link_id);
  v_candidate_handle := left(v_base_handle, 32);

  loop
    begin
      insert into public.net_app_accounts (
        app_id, identity_link_id, handle, status
      ) values (
        requested_app_id, requested_identity_link_id, v_candidate_handle, 'active'
      ) returning * into v_saved;
      return v_saved;
    exception when unique_violation then
      select account.* into v_existing
      from public.net_app_accounts as account
      where account.app_id = requested_app_id
        and account.identity_link_id = requested_identity_link_id;
      if found then return v_existing; end if;

      v_attempt := v_attempt + 1;
      v_candidate_handle := left(v_base_handle, greatest(1, 32 - char_length(v_suffix) - 2))
        || '-' || v_suffix;
      if v_attempt > 2 then
        v_candidate_handle := left(v_base_handle, greatest(1, 32 - char_length(v_suffix) - 5))
          || '-' || v_suffix || '-' || v_attempt::text;
      end if;
      if v_attempt > 100 then
        raise exception 'No collision-free application handle could be provisioned.'
          using errcode = '23505';
      end if;
    end;
  end loop;
end;
$$;

create or replace function public.create_net_app_account_unscoped(
  requested_identity_link_id uuid,
  requested_app_id text,
  requested_handle text,
  requested_display_name_override text default null,
  requested_avatar_url_override text default null
)
returns public.net_app_accounts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_policy public.net_app_account_policies%rowtype;
  v_link public.net_identity_links%rowtype;
  v_handle text := public.normalize_net_app_handle(requested_handle);
  v_display_name text := nullif(btrim(requested_display_name_override), '');
  v_avatar_url text := nullif(btrim(requested_avatar_url_override), '');
  v_saved public.net_app_accounts%rowtype;
begin
  select policy.* into v_policy
  from public.net_app_account_policies as policy
  where policy.app_id = requested_app_id
  for share;

  if not found or v_policy.account_mode <> 'explicit' then
    raise exception 'This application does not support explicit account creation.'
      using errcode = '22023';
  end if;
  if not v_policy.account_available then
    raise exception 'This application is not currently available.' using errcode = '22023';
  end if;
  if requested_app_id = 'loop' then
    raise exception 'LOOP accounts are not available yet.' using errcode = '22023';
  end if;
  if v_handle is null then
    raise exception 'Application handle is invalid.' using errcode = '22023';
  end if;
  if v_display_name is not null and char_length(v_display_name) > 40 then
    raise exception 'Display-name overrides are limited to 40 characters.' using errcode = '22001';
  end if;
  if v_avatar_url is not null and char_length(v_avatar_url) > 2048 then
    raise exception 'Avatar overrides are limited to 2048 characters.' using errcode = '22001';
  end if;

  select identity_link.* into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id
  for share;

  if not found then
    raise exception 'NET_RUNTIME_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.net_app_accounts as account
    where account.app_id = requested_app_id
      and (
        account.identity_link_id = requested_identity_link_id
        or (v_link.entity_id is not null and account.entity_id = v_link.entity_id)
      )
  ) then
    raise exception 'An application account already exists for this identity.' using errcode = '23505';
  end if;

  begin
    insert into public.net_app_accounts (
      app_id,
      identity_link_id,
      handle,
      display_name_override,
      avatar_url_override,
      status
    ) values (
      requested_app_id,
      requested_identity_link_id,
      v_handle,
      v_display_name,
      v_avatar_url,
      'active'
    ) returning * into v_saved;
  exception when unique_violation then
    raise exception 'The application account or handle was registered by another request.'
      using errcode = '23505';
  end;

  return v_saved;
end;
$$;

create or replace function public.ensure_net_app_account(
  requested_identity_link_id uuid,
  requested_app_id text
)
returns public.net_app_accounts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  v_identity_link_id := public.assert_net_effective_runtime_identity(
    requested_identity_link_id,
    requested_app_id,
    requested_app_id in ('echo', 'pulse')
  );
  return public.ensure_net_app_account_unscoped(v_identity_link_id, requested_app_id);
end;
$$;

create or replace function public.create_net_app_account(
  requested_identity_link_id uuid,
  requested_app_id text,
  requested_handle text,
  requested_display_name_override text default null,
  requested_avatar_url_override text default null
)
returns public.net_app_accounts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  v_identity_link_id := public.assert_net_effective_runtime_identity(
    requested_identity_link_id,
    requested_app_id,
    requested_app_id in ('echo', 'pulse')
  );
  return public.create_net_app_account_unscoped(
    v_identity_link_id,
    requested_app_id,
    requested_handle,
    requested_display_name_override,
    requested_avatar_url_override
  );
end;
$$;

create or replace function public.enforce_net_app_account_os_scope()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return new; end if;
  if new.identity_link_id is null then
    raise exception 'NET_OS_SERVICE_ACCESS_DENIED' using errcode = '42501';
  end if;
  perform public.assert_net_effective_runtime_identity(
    new.identity_link_id,
    new.app_id,
    new.app_id in ('echo', 'pulse')
  );
  return new;
end;
$$;

create or replace function public.audit_net_runtime_app_account_create()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_context record;
begin
  if auth.uid() is null or new.identity_link_id is null then
    return null;
  end if;

  if new.identity_link_id is distinct from public.current_net_effective_runtime_identity_link_id() then
    raise exception 'NET_RUNTIME_IDENTITY_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  select context.* into v_context
  from public.net_runtime_action_context(new.identity_link_id) as context;

  insert into public.net_action_audit (
    authenticated_actor_profile_id,
    presented_account_id,
    persona_subject_kind,
    persona_subject_id,
    action_mode,
    action_type,
    authorization_basis,
    resource_type,
    resource_id
  ) values (
    auth.uid(),
    new.id,
    v_context.persona_subject_kind,
    v_context.persona_subject_id,
    v_context.action_mode,
    'net.app-account.create',
    v_context.authorization_basis || ':' || new.app_id,
    'net-app-account',
    new.id
  );
  return null;
end;
$$;

drop trigger if exists net_app_accounts_audit_runtime_create
  on public.net_app_accounts;
create trigger net_app_accounts_audit_runtime_create
after insert on public.net_app_accounts
for each row execute procedure public.audit_net_runtime_app_account_create();

-- PULSE and ECHO retain their public RPC families. Replacing these common
-- comparison guards makes every existing guarded call use the exact runtime
-- identity without duplicating product mutation logic.
create or replace function public.current_net_pulse_owner_account_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pulse_account.id
  from public.net_app_accounts as pulse_account
  where pulse_account.identity_link_id = public.current_net_effective_runtime_identity_link_id()
    and pulse_account.app_id = 'pulse'
    and pulse_account.status = 'active'
    and public.net_identity_link_can_access_service(pulse_account.identity_link_id, 'pulse')
    and exists (
      select 1
      from public.net_identity_app_installs as install
      where install.identity_link_id = pulse_account.identity_link_id
        and install.app_id = 'pulse'
    )
  limit 1;
$$;

create or replace function public.assert_net_pulse_account_context(
  requested_expected_account_id uuid,
  requested_require_account boolean default true
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_account_id uuid;
begin
  v_identity_link_id := public.current_net_effective_runtime_identity_link_id();
  if v_identity_link_id is null then
    raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  perform public.assert_net_effective_runtime_identity(v_identity_link_id, 'pulse', true);

  select account.id
  into v_account_id
  from public.net_app_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.app_id = 'pulse'
    and account.status = 'active'
  for share;

  if requested_expected_account_id is distinct from v_account_id then
    raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  if coalesce(requested_require_account, true) and v_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;
  return v_account_id;
end;
$$;

create or replace function public.assert_net_active_identity_context(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id,
    'pulse',
    true
  );
end;
$$;

-- These four legacy PULSE workers are execution-revoked below, but they still
-- re-authorise internally. Preserve every content/profile rule while replacing
-- their old owned-player predicate with the same locked runtime-account guard
-- used by the authenticated public wrappers.
create or replace function public.create_net_pulse_post(
  requested_author_account_id uuid,
  requested_body text,
  requested_parent_post_id uuid default null
)
returns public.net_pulse_posts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_author_account public.net_app_accounts%rowtype;
  v_parent_post public.net_pulse_posts%rowtype;
  v_normalized_body text := btrim(coalesce(requested_body, ''));
  v_saved_post public.net_pulse_posts%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_author_account_id is null then
    raise exception 'A PULSE author account is required.' using errcode = '22023';
  end if;

  perform public.assert_net_pulse_account_context(
    requested_author_account_id,
    true
  );

  select account.*
  into v_author_account
  from public.net_app_accounts as account
  where account.id = requested_author_account_id;

  if not found
    or v_author_account.app_id <> 'pulse'
    or v_author_account.identity_link_id is null
  then
    raise exception 'The requested account cannot author PULSE content.' using errcode = '42501';
  end if;
  if v_author_account.status <> 'active' then
    raise exception 'Only an active PULSE account may author content.' using errcode = '42501';
  end if;
  if v_normalized_body = '' then
    raise exception 'PULSE content cannot be empty.' using errcode = '22023';
  end if;
  if char_length(v_normalized_body) > 360 then
    raise exception 'PULSE content is limited to 360 characters.' using errcode = '22001';
  end if;

  if requested_parent_post_id is not null then
    select post.*
    into v_parent_post
    from public.net_pulse_posts as post
    where post.id = requested_parent_post_id;

    if not found then
      raise exception 'The requested parent PULSE does not exist.' using errcode = '23503';
    end if;
  end if;

  insert into public.net_pulse_posts (
    author_account_id,
    parent_post_id,
    body
  ) values (
    v_author_account.id,
    requested_parent_post_id,
    v_normalized_body
  )
  returning * into v_saved_post;

  insert into public.net_action_audit (
    authenticated_actor_profile_id,
    presented_account_id,
    persona_subject_kind,
    persona_subject_id,
    action_mode,
    action_type,
    authorization_basis,
    resource_type,
    resource_id
  ) values (
    v_actor,
    v_author_account.id,
    null,
    null,
    'owner',
    case when requested_parent_post_id is null
      then 'pulse.post.create'
      else 'pulse.reply.create'
    end,
    'controlled-playable-identity',
    'pulse-post',
    v_saved_post.id
  );

  return v_saved_post;
end;
$$;

create or replace function public.upsert_net_pulse_profile(
  requested_account_id uuid,
  requested_bio text,
  requested_visibility text,
  requested_show_district boolean,
  requested_discoverable boolean,
  requested_default_feed text
)
returns public.net_pulse_profiles
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.net_app_accounts%rowtype;
  v_normalized_bio text := nullif(btrim(coalesce(requested_bio, '')), '');
  v_saved_profile public.net_pulse_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  perform public.assert_net_pulse_account_context(requested_account_id, true);

  select account.*
  into v_account
  from public.net_app_accounts as account
  where account.id = requested_account_id;

  if not found
    or v_account.app_id <> 'pulse'
    or v_account.identity_link_id is null
  then
    raise exception 'The authenticated actor cannot manage this PULSE profile.' using errcode = '42501';
  end if;
  if v_account.status <> 'active' then
    raise exception 'Only an active PULSE account may edit its profile.' using errcode = '42501';
  end if;
  if v_normalized_bio is not null and char_length(v_normalized_bio) > 240 then
    raise exception 'PULSE bios are limited to 240 characters.' using errcode = '22001';
  end if;
  if requested_visibility is null or requested_visibility not in ('public', 'limited') then
    raise exception 'PULSE profile visibility is invalid.' using errcode = '22023';
  end if;
  if requested_default_feed is null or requested_default_feed not in ('city', 'following', 'raw') then
    raise exception 'PULSE default feed is invalid.' using errcode = '22023';
  end if;

  insert into public.net_pulse_profiles (
    account_id,
    bio,
    visibility,
    show_district,
    discoverable,
    default_feed
  ) values (
    v_account.id,
    v_normalized_bio,
    requested_visibility,
    coalesce(requested_show_district, false),
    coalesce(requested_discoverable, true),
    requested_default_feed
  )
  on conflict (account_id) do update set
    bio = excluded.bio,
    visibility = excluded.visibility,
    show_district = excluded.show_district,
    discoverable = excluded.discoverable,
    default_feed = excluded.default_feed
  returning * into v_saved_profile;

  return v_saved_profile;
end;
$$;

create or replace function public.update_net_pulse_public_profile(
  requested_account_id uuid,
  requested_handle text,
  requested_bio text,
  requested_visibility text,
  requested_show_district boolean,
  requested_discoverable boolean,
  requested_default_feed text
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
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_target_account public.net_app_accounts%rowtype;
  v_normalized_handle text := public.normalize_net_app_handle(requested_handle);
  v_normalized_bio text := nullif(btrim(coalesce(requested_bio, '')), '');
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  perform public.assert_net_pulse_account_context(requested_account_id, true);

  select account.*
  into v_target_account
  from public.net_app_accounts as account
  where account.id = requested_account_id
  for update;

  if not found
    or v_target_account.app_id <> 'pulse'
    or v_target_account.identity_link_id is null
  then
    raise exception 'The authenticated actor cannot manage this PULSE profile.' using errcode = '42501';
  end if;
  if v_target_account.status <> 'active' then
    raise exception 'Only an active PULSE account may edit its profile.' using errcode = '42501';
  end if;
  if v_normalized_handle is null then
    raise exception 'PULSE_HANDLE_INVALID' using errcode = '22023';
  end if;
  if v_normalized_bio is not null and char_length(v_normalized_bio) > 240 then
    raise exception 'PULSE bios are limited to 240 characters.' using errcode = '22001';
  end if;
  if requested_visibility is null or requested_visibility not in ('public', 'limited') then
    raise exception 'PULSE profile visibility is invalid.' using errcode = '22023';
  end if;
  if requested_default_feed is null or requested_default_feed not in ('city', 'following', 'raw') then
    raise exception 'PULSE default feed is invalid.' using errcode = '22023';
  end if;

  begin
    update public.net_app_accounts as account
    set handle = v_normalized_handle
    where account.id = v_target_account.id;
  exception
    when unique_violation then
      raise exception 'PULSE_HANDLE_TAKEN' using errcode = '23505';
  end;

  insert into public.net_pulse_profiles as profile (
    account_id,
    bio,
    visibility,
    show_district,
    discoverable,
    default_feed
  ) values (
    v_target_account.id,
    v_normalized_bio,
    requested_visibility,
    coalesce(requested_show_district, false),
    coalesce(requested_discoverable, true),
    requested_default_feed
  )
  on conflict on constraint net_pulse_profiles_pkey do update set
    bio = excluded.bio,
    visibility = excluded.visibility,
    show_district = excluded.show_district,
    discoverable = excluded.discoverable,
    default_feed = excluded.default_feed;

  insert into public.net_action_audit (
    authenticated_actor_profile_id,
    presented_account_id,
    action_mode,
    action_type,
    authorization_basis,
    resource_type,
    resource_id
  ) values (
    v_actor,
    v_target_account.id,
    'owner',
    'pulse.profile.update',
    'controlled-playable-identity',
    'pulse-profile',
    v_target_account.id
  );

  return query
  select
    account.id,
    account.handle,
    profile.bio,
    profile.visibility,
    profile.show_district,
    profile.discoverable,
    profile.default_feed,
    profile.created_at,
    profile.updated_at
  from public.net_app_accounts as account
  join public.net_pulse_profiles as profile
    on profile.account_id = account.id
  where account.id = v_target_account.id;
end;
$$;

create or replace function public.delete_net_pulse_post(
  requested_post_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_target_post public.net_pulse_posts%rowtype;
  v_author_account public.net_app_accounts%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select post.*
  into v_target_post
  from public.net_pulse_posts as post
  where post.id = requested_post_id;

  if not found or v_target_post.deleted_at is not null then
    raise exception 'The requested PULSE is not available.' using errcode = 'P0002';
  end if;

  select account.*
  into v_author_account
  from public.net_app_accounts as account
  where account.id = v_target_post.author_account_id;

  if not found
    or v_author_account.app_id <> 'pulse'
    or v_author_account.identity_link_id is null
  then
    raise exception 'Only the controlling identity may delete this PULSE.' using errcode = '42501';
  end if;

  perform public.assert_net_pulse_account_context(v_author_account.id, true);

  select post.*
  into v_target_post
  from public.net_pulse_posts as post
  where post.id = requested_post_id
  for update;

  if not found or v_target_post.deleted_at is not null
    or v_target_post.author_account_id is distinct from v_author_account.id
  then
    raise exception 'The requested PULSE changed before deletion.' using errcode = 'P0001';
  end if;
  if now() > v_target_post.created_at + interval '10 minutes' then
    raise exception 'The 10-minute deletion window has closed.' using errcode = '42501';
  end if;

  update public.net_pulse_posts as post
  set deleted_at = now()
  where post.id = v_target_post.id;

  insert into public.net_action_audit (
    authenticated_actor_profile_id,
    presented_account_id,
    persona_subject_kind,
    persona_subject_id,
    action_mode,
    action_type,
    authorization_basis,
    resource_type,
    resource_id
  ) values (
    v_actor,
    v_author_account.id,
    null,
    null,
    'owner',
    case when v_target_post.parent_post_id is null
      then 'pulse.post.delete'
      else 'pulse.reply.delete'
    end,
    'controlled-playable-identity-within-delete-window',
    'pulse-post',
    v_target_post.id
  );

  return v_target_post.id;
end;
$$;

create or replace function public.assert_net_echo_active_identity_context(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id,
    'echo',
    true
  );
end;
$$;

create or replace function public.assert_net_echo_account_context(
  requested_expected_account_id uuid,
  requested_require_account boolean default true
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_account_id uuid;
begin
  v_identity_link_id := public.current_net_effective_runtime_identity_link_id();
  if v_identity_link_id is null then
    raise exception 'ECHO_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  perform public.assert_net_effective_runtime_identity(v_identity_link_id, 'echo', true);

  select account.id into v_account_id
  from public.net_app_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.app_id = 'echo'
    and account.status = 'active'
  for share;

  if requested_expected_account_id is distinct from v_account_id then
    raise exception 'ECHO_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  if coalesce(requested_require_account, true) and v_account_id is null then
    raise exception 'An active, controlled ECHO account is required.' using errcode = '42501';
  end if;
  return v_account_id;
end;
$$;

-- Retire the already-deployed player-only PULSE audit binder before installing
-- the effective-runtime normalizer. DROP FUNCTION deliberately omits CASCADE:
-- any unreviewed dependency aborts this transaction instead of being removed.
drop trigger net_action_audit_bind_pulse_take_control
  on public.net_action_audit;
drop function public.bind_net_pulse_take_control_audit();
drop function public.net_pulse_action_audit_context(uuid);

-- Legacy PULSE workers already write complete immutable audit rows. Rewrite
-- only their owner-shaped rows when the authenticated actor is a GM in exact
-- TAKE CONTROL, preserving all existing action types/resource identifiers.
create or replace function public.normalize_net_runtime_pulse_audit()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_context record;
begin
  if new.action_mode <> 'owner'
    or new.presented_account_id is null
    or new.action_type not like 'pulse.%'
    or not public.is_current_user_gm()
  then
    return new;
  end if;

  select account.identity_link_id
  into v_identity_link_id
  from public.net_app_accounts as account
  where account.id = new.presented_account_id
    and account.app_id = 'pulse';

  if v_identity_link_id is null
    or v_identity_link_id is distinct from public.current_net_effective_runtime_identity_link_id()
  then
    raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  select context.*
  into v_context
  from public.net_runtime_action_context(v_identity_link_id) as context;

  if v_context.action_mode is null then
    raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  new.action_mode := v_context.action_mode;
  new.authorization_basis := v_context.authorization_basis
    || case
      when new.authorization_basis like '%within-delete-window%'
        then '-within-delete-window'
      else ''
    end;
  new.persona_subject_kind := v_context.persona_subject_kind;
  new.persona_subject_id := v_context.persona_subject_id;
  return new;
end;
$$;

drop trigger if exists net_action_audit_normalize_runtime_pulse
  on public.net_action_audit;
create trigger net_action_audit_normalize_runtime_pulse
before insert on public.net_action_audit
for each row execute procedure public.normalize_net_runtime_pulse_audit();

do $$
declare
  v_before_insert_triggers text[];
begin
  select array_agg(trigger_row.tgname order by trigger_row.tgname)
  into v_before_insert_triggers
  from pg_catalog.pg_trigger as trigger_row
  where trigger_row.tgrelid = 'public.net_action_audit'::regclass
    and not trigger_row.tgisinternal
    and (trigger_row.tgtype & 1) = 1
    and (trigger_row.tgtype & 2) = 2
    and (trigger_row.tgtype & 4) = 4;

  if v_before_insert_triggers is distinct from
    array['net_action_audit_normalize_runtime_pulse']::text[]
    or to_regprocedure('public.bind_net_pulse_take_control_audit()') is not null
    or to_regprocedure('public.net_pulse_action_audit_context(uuid)') is not null
  then
    raise exception 'NET_RUNTIME_PULSE_AUDIT_POSTCONDITION_FAILED: %',
      coalesce(array_to_string(v_before_insert_triggers, ', '), '<none>')
      using errcode = '55000';
  end if;
end;
$$;

create or replace function public.set_net_identity_wallpaper(
  requested_identity_link_id uuid,
  requested_wallpaper_path text,
  requested_fit text,
  requested_position text
)
returns public.net_identity_system_profiles
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_path text := nullif(btrim(requested_wallpaper_path), '');
  v_saved public.net_identity_system_profiles%rowtype;
  v_service_id text;
begin
  select case assignment.primary_os_id
    when 'veil' then 'veil-settings'
    when 'altara' then 'altara-settings'
    else null
  end
  into v_service_id
  from public.net_identity_os_assignments as assignment
  where assignment.identity_link_id = requested_identity_link_id;

  if v_service_id is null then
    raise exception 'NET_RUNTIME_OS_UNAVAILABLE' using errcode = '42501';
  end if;

  perform public.assert_net_effective_runtime_identity(
    requested_identity_link_id,
    v_service_id,
    false
  );

  if v_path is null
    or split_part(v_path, '/', 1) <> requested_identity_link_id::text
    or split_part(v_path, '/', 2) = ''
    or v_path like '%..%'
  then
    raise exception 'Wallpaper path does not belong to the requested identity.'
      using errcode = '22023';
  end if;
  if requested_fit is null
    or requested_fit not in ('cover', 'contain')
    or requested_position is null
    or requested_position not in ('center', 'top', 'bottom')
  then
    raise exception 'Unsupported wallpaper presentation.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects as object
    where object.bucket_id = 'net-wallpapers' and object.name = v_path
  ) then
    raise exception 'Wallpaper object is unavailable.' using errcode = '22023';
  end if;

  insert into public.net_identity_system_profiles (
    identity_link_id, wallpaper_path, wallpaper_preset_id,
    wallpaper_fit, wallpaper_position
  ) values (
    requested_identity_link_id, v_path, null,
    requested_fit, requested_position
  )
  on conflict (identity_link_id) do update set
    wallpaper_path = excluded.wallpaper_path,
    wallpaper_preset_id = null,
    wallpaper_fit = excluded.wallpaper_fit,
    wallpaper_position = excluded.wallpaper_position
  returning * into v_saved;
  return v_saved;
end;
$$;

create or replace function public.set_net_identity_wallpaper_preset(
  requested_identity_link_id uuid,
  requested_preset_id text
)
returns public.net_identity_system_profiles
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_preset_id text := nullif(lower(btrim(requested_preset_id)), '');
  v_saved public.net_identity_system_profiles%rowtype;
begin
  perform public.assert_net_effective_runtime_identity(
    requested_identity_link_id,
    'altara-settings',
    false
  );
  if v_preset_id is null
    or v_preset_id not in ('altara-nocturne', 'altara-atlas', 'altara-silk')
  then
    raise exception 'Unsupported ALTARA wallpaper preset.' using errcode = '22023';
  end if;

  insert into public.net_identity_system_profiles (
    identity_link_id, wallpaper_path, wallpaper_preset_id,
    wallpaper_fit, wallpaper_position
  ) values (
    requested_identity_link_id, null, v_preset_id, 'cover', 'center'
  )
  on conflict (identity_link_id) do update set
    wallpaper_path = null,
    wallpaper_preset_id = excluded.wallpaper_preset_id,
    wallpaper_fit = 'cover',
    wallpaper_position = 'center'
  returning * into v_saved;
  return v_saved;
end;
$$;

create or replace function public.clear_net_identity_wallpaper(
  requested_identity_link_id uuid
)
returns public.net_identity_system_profiles
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_saved public.net_identity_system_profiles%rowtype;
  v_service_id text;
begin
  select case assignment.primary_os_id
    when 'veil' then 'veil-settings'
    when 'altara' then 'altara-settings'
    else null
  end
  into v_service_id
  from public.net_identity_os_assignments as assignment
  where assignment.identity_link_id = requested_identity_link_id;

  if v_service_id is null then
    raise exception 'NET_RUNTIME_OS_UNAVAILABLE' using errcode = '42501';
  end if;

  perform public.assert_net_effective_runtime_identity(
    requested_identity_link_id,
    v_service_id,
    false
  );

  insert into public.net_identity_system_profiles (
    identity_link_id, wallpaper_path, wallpaper_preset_id,
    wallpaper_fit, wallpaper_position
  ) values (
    requested_identity_link_id, null, null, 'cover', 'center'
  )
  on conflict (identity_link_id) do update set
    wallpaper_path = null,
    wallpaper_preset_id = null,
    wallpaper_fit = 'cover',
    wallpaper_position = 'center'
  returning * into v_saved;
  return v_saved;
end;
$$;

-- Storage-facing predicates accept one object name and expose only a boolean.
-- The legacy path parser remains internal; authenticated Storage RLS never
-- invokes it directly. Runtime actors may read their just-uploaded exact row
-- before saving it as the active wallpaper. Inspect/compromised GM sessions
-- may read only the exact wallpaper_path returned by the locked system-profile
-- snapshot and never gain write authority.
create or replace function public.current_user_can_read_net_runtime_wallpaper_object(
  requested_object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_identity_link_id uuid;
begin
  if v_actor is null
    or requested_object_name is null
    or split_part(requested_object_name, '/', 2) = ''
    or requested_object_name like '%..%'
  then
    return false;
  end if;

  v_identity_link_id := public.net_wallpaper_identity_link_id(
    requested_object_name
  );
  if v_identity_link_id is null then
    return false;
  end if;

  if v_identity_link_id = public.current_net_effective_runtime_identity_link_id()
    and (
      public.net_identity_link_can_access_service(
        v_identity_link_id, 'veil-settings'
      )
      or public.net_identity_link_can_access_service(
        v_identity_link_id, 'altara-settings'
      )
    )
  then
    return true;
  end if;

  if public.is_current_user_gm() and exists (
    select 1
    from public.net_gm_persona_sessions as gm_session
    join public.net_identity_links as identity_link
      on identity_link.subject_kind = gm_session.subject_kind
      and identity_link.subject_id = gm_session.subject_id
      and identity_link.id = v_identity_link_id
    join public.net_identity_system_profiles as system_profile
      on system_profile.identity_link_id = identity_link.id
      and system_profile.wallpaper_path = requested_object_name
    where gm_session.gm_profile_id = v_actor
      and gm_session.mode in ('inspect', 'compromised-session')
      and (
        public.net_identity_link_can_access_service(
          identity_link.id, 'veil-settings'
        )
        or public.net_identity_link_can_access_service(
          identity_link.id, 'altara-settings'
        )
      )
  ) then
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.current_user_can_mutate_net_runtime_wallpaper_object(
  requested_object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  if auth.uid() is null
    or requested_object_name is null
    or split_part(requested_object_name, '/', 2) = ''
    or requested_object_name like '%..%'
  then
    return false;
  end if;

  v_identity_link_id := public.net_wallpaper_identity_link_id(
    requested_object_name
  );
  if v_identity_link_id is null
    or v_identity_link_id is distinct from
      public.current_net_effective_runtime_identity_link_id()
  then
    return false;
  end if;

  return public.net_identity_link_can_access_service(
      v_identity_link_id, 'veil-settings'
    )
    or public.net_identity_link_can_access_service(
      v_identity_link_id, 'altara-settings'
    );
end;
$$;

drop policy if exists net_wallpapers_select_authorised on storage.objects;
create policy net_wallpapers_select_authorised
on storage.objects for select to authenticated
using (
  bucket_id = 'net-wallpapers'
  and public.current_user_can_read_net_runtime_wallpaper_object(name)
);

drop policy if exists net_wallpapers_insert_controlled on storage.objects;
create policy net_wallpapers_insert_controlled
on storage.objects for insert to authenticated
with check (
  bucket_id = 'net-wallpapers'
  and public.current_user_can_mutate_net_runtime_wallpaper_object(name)
);

drop policy if exists net_wallpapers_update_controlled on storage.objects;
create policy net_wallpapers_update_controlled
on storage.objects for update to authenticated
using (
  bucket_id = 'net-wallpapers'
  and public.current_user_can_mutate_net_runtime_wallpaper_object(name)
)
with check (
  bucket_id = 'net-wallpapers'
  and public.current_user_can_mutate_net_runtime_wallpaper_object(name)
);

drop policy if exists net_wallpapers_delete_controlled on storage.objects;
create policy net_wallpapers_delete_controlled
on storage.objects for delete to authenticated
using (
  bucket_id = 'net-wallpapers'
  and public.current_user_can_mutate_net_runtime_wallpaper_object(name)
);

-- Before removing legacy direct table privileges, prove that no policy on a
-- different relation, authenticated SECURITY INVOKER function, or readable
-- view still expects caller-level access to these three implementation tables.
-- SECURITY DEFINER functions are intentionally excluded: they execute with
-- their fixed owner boundary and are the replacement access contract.
do $$
declare
  v_policy_dependencies text;
  v_invoker_dependencies text;
  v_view_dependencies text;
begin
  select string_agg(
    format('%I.%I:%I', relation_schema.nspname, relation_row.relname,
      policy_row.polname),
    ', ' order by relation_schema.nspname, relation_row.relname,
      policy_row.polname
  )
  into v_policy_dependencies
  from pg_catalog.pg_policy as policy_row
  join pg_catalog.pg_class as relation_row
    on relation_row.oid = policy_row.polrelid
  join pg_catalog.pg_namespace as relation_schema
    on relation_schema.oid = relation_row.relnamespace
  where policy_row.polrelid not in (
      'public.net_app_accounts'::regclass,
      'public.net_identity_app_installs'::regclass,
      'public.net_identity_system_profiles'::regclass
    )
    and concat_ws(' ',
      pg_get_expr(policy_row.polqual, policy_row.polrelid),
      pg_get_expr(policy_row.polwithcheck, policy_row.polrelid)
    ) ~* '\m(net_app_accounts|net_identity_app_installs|net_identity_system_profiles)\M';

  if v_policy_dependencies is not null then
    raise exception 'NET_RUNTIME_TABLE_POLICY_DEPENDENCY_REVIEW_REQUIRED: %',
      v_policy_dependencies
      using errcode = '55000';
  end if;

  select string_agg(
    format('%I.%I(%s)', function_schema.nspname, function_row.proname,
      pg_get_function_identity_arguments(function_row.oid)),
    ', ' order by function_schema.nspname, function_row.proname,
      pg_get_function_identity_arguments(function_row.oid)
  )
  into v_invoker_dependencies
  from pg_catalog.pg_proc as function_row
  join pg_catalog.pg_namespace as function_schema
    on function_schema.oid = function_row.pronamespace
  where function_schema.nspname = 'public'
    and not function_row.prosecdef
    and has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
    and case
      when function_row.prokind in ('f', 'p')
        then pg_get_functiondef(function_row.oid)
      else ''
    end ~* '\m(net_app_accounts|net_identity_app_installs|net_identity_system_profiles)\M';

  if v_invoker_dependencies is not null then
    raise exception 'NET_RUNTIME_TABLE_INVOKER_DEPENDENCY_REVIEW_REQUIRED: %',
      v_invoker_dependencies
      using errcode = '55000';
  end if;

  select string_agg(
    format('%I.%I', view_row.schemaname, view_row.viewname),
    ', ' order by view_row.schemaname, view_row.viewname
  )
  into v_view_dependencies
  from pg_catalog.pg_views as view_row
  where has_table_privilege(
      'authenticated',
      format('%I.%I', view_row.schemaname, view_row.viewname),
      'SELECT'
    )
    and view_row.definition
      ~* '\m(net_app_accounts|net_identity_app_installs|net_identity_system_profiles)\M';

  if v_view_dependencies is not null then
    raise exception 'NET_RUNTIME_TABLE_VIEW_DEPENDENCY_REVIEW_REQUIRED: %',
      v_view_dependencies
      using errcode = '55000';
  end if;
end;
$$;

-- App-account/system tables are no longer client query surfaces. Their exact
-- runtime RPCs avoid RLS policies invoking private helpers as the caller.
revoke all on table public.net_app_accounts
  from public, anon, authenticated;
revoke all on table public.net_identity_app_installs
  from public, anon, authenticated;
revoke all on table public.net_identity_system_profiles
  from public, anon, authenticated;

revoke all on function public.current_net_effective_runtime_identity_link_id()
  from public, anon, authenticated;
revoke all on function public.current_user_has_net_runtime_service_for_link(uuid, text)
  from public, anon, authenticated;
revoke all on function public.assert_net_effective_runtime_identity(uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.net_runtime_action_context(uuid)
  from public, anon, authenticated;
revoke all on function public.ensure_net_app_account_unscoped(uuid, text)
  from public, anon, authenticated;
revoke all on function public.create_net_app_account_unscoped(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.enforce_net_app_account_os_scope()
  from public, anon, authenticated;
revoke all on function public.audit_net_runtime_app_account_create()
  from public, anon, authenticated;
revoke all on function public.current_net_pulse_owner_account_id()
  from public, anon, authenticated;
revoke all on function public.assert_net_pulse_account_context(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.assert_net_active_identity_context(uuid)
  from public, anon, authenticated;
revoke all on function public.create_net_pulse_post(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.upsert_net_pulse_profile(uuid, text, text, boolean, boolean, text)
  from public, anon, authenticated;
revoke all on function public.update_net_pulse_public_profile(uuid, text, text, text, boolean, boolean, text)
  from public, anon, authenticated;
revoke all on function public.delete_net_pulse_post(uuid)
  from public, anon, authenticated;
revoke all on function public.assert_net_echo_active_identity_context(uuid)
  from public, anon, authenticated;
revoke all on function public.assert_net_echo_account_context(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.normalize_net_runtime_pulse_audit()
  from public, anon, authenticated;
revoke all on function public.net_wallpaper_identity_link_id(text)
  from public, anon, authenticated;
revoke all on function public.current_user_can_read_net_runtime_wallpaper_object(text)
  from public, anon, authenticated;
revoke all on function public.current_user_can_mutate_net_runtime_wallpaper_object(text)
  from public, anon, authenticated;

-- Storage RLS invokes only these boolean object predicates. The path parser
-- and the broader link/service comparison helper remain private.
grant execute on function public.current_user_can_read_net_runtime_wallpaper_object(text)
  to authenticated;
grant execute on function public.current_user_can_mutate_net_runtime_wallpaper_object(text)
  to authenticated;

revoke all on function public.fetch_net_runtime_app_accounts(uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_gm_inspected_app_accounts(uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_runtime_identity_system(uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_gm_inspected_identity_system(uuid)
  from public, anon, authenticated;
revoke all on function public.set_net_identity_app_install(uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.ensure_net_app_account(uuid, text)
  from public, anon, authenticated;
revoke all on function public.create_net_app_account(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.set_net_identity_wallpaper(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.set_net_identity_wallpaper_preset(uuid, text)
  from public, anon, authenticated;
revoke all on function public.clear_net_identity_wallpaper(uuid)
  from public, anon, authenticated;

grant execute on function public.fetch_net_runtime_app_accounts(uuid)
  to authenticated;
grant execute on function public.fetch_net_gm_inspected_app_accounts(uuid)
  to authenticated;
grant execute on function public.fetch_net_runtime_identity_system(uuid)
  to authenticated;
grant execute on function public.fetch_net_gm_inspected_identity_system(uuid)
  to authenticated;
grant execute on function public.set_net_identity_app_install(uuid, text, boolean)
  to authenticated;
grant execute on function public.ensure_net_app_account(uuid, text)
  to authenticated;
grant execute on function public.create_net_app_account(uuid, text, text, text, text)
  to authenticated;
grant execute on function public.set_net_identity_wallpaper(uuid, text, text, text)
  to authenticated;
grant execute on function public.set_net_identity_wallpaper_preset(uuid, text)
  to authenticated;
grant execute on function public.clear_net_identity_wallpaper(uuid)
  to authenticated;

commit;
