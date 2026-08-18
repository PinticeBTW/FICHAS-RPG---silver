-- HACKING system foundation (Batch 1: server foundation only, no UI).
--
-- public.net_gm_persona_sessions (mode = 'compromised-session', established
-- in supabase/net-compromised-session.sql) is Silver's own direct, GM-only
-- narrative tool -- it is keyed one-row-per-gm_profile_id and is completely
-- orthogonal to hacking. A successful hack must NOT write into it: doing so
-- would hijack Silver's own GM session for an action a normal player (who
-- may not even be a GM) performed, and a normal player has no way to read a
-- row keyed by Silver's gm_profile_id in the first place. Hacking instead
-- gets its own minimal, uniform state -- public.net_system_hacking_sessions,
-- keyed by the ACTOR's identity_link_id (the same
-- current_net_effective_runtime_identity_link_id() every other
-- identity-scoped app already resolves to). This one mechanism covers a
-- normal player hacking as themselves, Silver via TAKE CONTROL hacking as
-- the controlled identity, and Silver via ACT AS hacking as an NPC, with no
-- special-casing: whoever the effective runtime identity resolves to is the
-- session key, regardless of which authenticated account is behind it.
-- Silver's own compromised-session tool (net_gm_persona_sessions) is not
-- read, written, or altered anywhere in this file.
--
-- Dependency order: this migration must run AFTER
-- supabase/net-economy-gm-readonly-fetch-fix.sql (defines
-- public.assert_net_system_admin_read(), reused below for the read-only
-- grants-listing RPC) and after every file that establishes
-- public.current_net_effective_runtime_identity_link_id() /
-- public.assert_net_effective_runtime_identity() / public.assert_net_system_admin()
-- / public.net_runtime_action_context() (supabase/net-effective-runtime-identity.sql,
-- supabase/net-nonfinancial-runtime-control-parity.sql). The preflight check
-- below fails loudly if run out of order instead of silently misbehaving.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_os_families') is null
    or to_regclass('public.net_action_audit') is null
    or to_regprocedure('public.set_updated_at()') is null
    or to_regprocedure('public.assert_net_system_admin()') is null
    or to_regprocedure('public.assert_net_system_admin_read()') is null
    or to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.assert_net_effective_runtime_identity(uuid,text,boolean)') is null
    or to_regprocedure('public.net_runtime_action_context(uuid)') is null
  then
    raise exception 'NET_SYSTEM_HACKING_DEPENDENCY_REQUIRED. This migration requires supabase/net-economy-gm-readonly-fetch-fix.sql (assert_net_system_admin_read) and the effective-runtime-identity / GM-system-admin foundations to be deployed first.'
      using errcode = '55000';
  end if;
end;
$$;

create extension if not exists pgcrypto;

-- ==================================================================
-- TABLES
-- ==================================================================

-- Fictional in-world OS credential for one exact identity/system. Never
-- stores plaintext; credential_hash is a pgcrypto bcrypt digest
-- (crypt(input, gen_salt('bf', 10))), the standard proven Postgres password
-- hashing primitive -- no home-made hashing. RLS is enabled with zero
-- policies: this table is reachable exclusively through the bounded
-- SECURITY DEFINER RPCs below, none of which ever return credential_hash.
create table if not exists public.net_system_credentials (
  identity_link_id uuid primary key
    references public.net_identity_links (id) on delete cascade,
  credential_kind text not null check (credential_kind in ('pin', 'password')),
  credential_hash text not null,
  set_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.net_system_credentials is
  'One fictional OS credential (PIN or password) per identity/system. credential_hash is a pgcrypto bcrypt digest; the raw credential and hash are never returned to any client.';

alter table public.net_system_credentials enable row level security;
revoke all on public.net_system_credentials from public, anon, authenticated;

drop trigger if exists net_system_credentials_set_updated_at on public.net_system_credentials;
create trigger net_system_credentials_set_updated_at
before update on public.net_system_credentials
for each row
execute procedure public.set_updated_at();

-- Persistent GM-authored actor -> target hacking permission. One row per
-- relation; disabling never deletes the row (Silver can re-enable later).
-- RLS is enabled with zero policies: reachable only through the bounded GM
-- RPCs below, never through direct table access.
create table if not exists public.net_system_hacking_grants (
  id uuid primary key default gen_random_uuid(),
  actor_identity_link_id uuid not null
    references public.net_identity_links (id) on delete cascade,
  target_identity_link_id uuid not null
    references public.net_identity_links (id) on delete cascade,
  enabled boolean not null default true,
  method text not null check (method in ('roll', 'credential')),
  granted_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_system_hacking_grants_actor_target_distinct
    check (actor_identity_link_id <> target_identity_link_id),
  unique (actor_identity_link_id, target_identity_link_id)
);

comment on table public.net_system_hacking_grants is
  'Persistent, GM-authored permission for one identity to attempt hacking another. enabled=false blocks new access but the row is retained. Only GM System mode (not TAKE CONTROL/ACT AS/compromised-session) may create, update, or revoke a grant.';

alter table public.net_system_hacking_grants enable row level security;
revoke all on public.net_system_hacking_grants from public, anon, authenticated;

drop trigger if exists net_system_hacking_grants_set_updated_at on public.net_system_hacking_grants;
create trigger net_system_hacking_grants_set_updated_at
before update on public.net_system_hacking_grants
for each row
execute procedure public.set_updated_at();

-- One active compromised-access session per ACTOR identity (not per GM, not
-- per authenticated account) -- the same one-row-per-key shape
-- net_gm_persona_sessions already uses, but keyed by whichever identity
-- current_net_effective_runtime_identity_link_id() resolves to. This is the
-- single mechanism for a normal player hacking as themselves, Silver via
-- TAKE CONTROL hacking as the controlled identity, and Silver via ACT AS
-- hacking as an NPC: the session belongs to the fictional actor, not to
-- whichever human is currently piloting it. granted_by_profile_id is
-- audit/authorization provenance only (which GM authorised the grant this
-- session came from) -- it never determines who the session belongs to.
create table if not exists public.net_system_hacking_sessions (
  actor_identity_link_id uuid primary key
    references public.net_identity_links (id) on delete cascade,
  target_identity_link_id uuid not null
    references public.net_identity_links (id) on delete cascade,
  established_via text not null check (established_via in ('credential', 'roll')),
  granted_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_system_hacking_sessions_actor_target_distinct
    check (actor_identity_link_id <> target_identity_link_id)
);

comment on table public.net_system_hacking_sessions is
  'Active compromised-access session, one per actor identity, established by a successful hack. Independent of net_gm_persona_sessions -- never hijacks or is hijacked by Silver''s own direct GM compromised-session tool.';

alter table public.net_system_hacking_sessions enable row level security;
revoke all on public.net_system_hacking_sessions from public, anon, authenticated;

drop trigger if exists net_system_hacking_sessions_set_updated_at on public.net_system_hacking_sessions;
create trigger net_system_hacking_sessions_set_updated_at
before update on public.net_system_hacking_sessions
for each row
execute procedure public.set_updated_at();

-- ==================================================================
-- INTERNAL HELPER (not directly callable by any client role)
-- ==================================================================

-- Shared state transition for a successful hack (credential or GM-confirmed
-- roll): upserts the actor's own hacking session row. Target eligibility
-- mirrors the canonical effective-runtime-identity / ACT AS predicate
-- (playable player OR non-playable NPC) rather than requiring a player
-- target, so an eligible NPC system (e.g. a NetWatch NPC) can be a hacking
-- target, not only another player.
create or replace function public.net_system_hacking_establish_compromised_access(
  requested_granted_by_profile_id uuid,
  requested_actor_identity_link_id uuid,
  requested_target_identity_link_id uuid,
  requested_established_via text
)
returns public.net_system_hacking_sessions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_saved public.net_system_hacking_sessions%rowtype;
begin
  if not exists (
    select 1
    from public.net_identity_links as identity_link
    where identity_link.id = requested_target_identity_link_id
      and (
        (identity_link.identity_kind = 'player' and identity_link.playability = 'playable')
        or
        (identity_link.identity_kind = 'npc' and identity_link.playability = 'non-playable')
      )
  ) then
    raise exception 'NET_SYSTEM_HACKING_TARGET_INVALID' using errcode = '42501';
  end if;

  insert into public.net_system_hacking_sessions (
    actor_identity_link_id,
    target_identity_link_id,
    established_via,
    granted_by_profile_id
  )
  values (
    requested_actor_identity_link_id,
    requested_target_identity_link_id,
    requested_established_via,
    requested_granted_by_profile_id
  )
  on conflict (actor_identity_link_id) do update
  set
    target_identity_link_id = excluded.target_identity_link_id,
    established_via = excluded.established_via,
    granted_by_profile_id = excluded.granted_by_profile_id
  returning * into v_saved;

  return v_saved;
end;
$$;

revoke all on function public.net_system_hacking_establish_compromised_access(uuid, uuid, uuid, text)
  from public, anon, authenticated;

-- ==================================================================
-- CREDENTIAL ACCESS ATTEMPT (method = credential)
-- ==================================================================

-- Generic-denial hacking attempt. The actor is always the CURRENT effective
-- runtime identity (current_net_effective_runtime_identity_link_id()) --
-- never a client-supplied id -- so this works identically whether the
-- caller is a player's own account or Silver via TAKE CONTROL/ACT AS.
-- Every failure path (missing actor, missing/disabled grant, wrong method,
-- no credential configured, wrong credential, invalid target) raises the
-- exact same exception, and a bcrypt comparison always runs (against a
-- freshly-generated per-call dummy hash when no real credential exists) so
-- the presence/absence of a target credential cannot be inferred from
-- response timing.
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
  v_actor_id uuid := public.current_net_effective_runtime_identity_link_id();
  v_grant public.net_system_hacking_grants%rowtype;
  v_credential public.net_system_credentials%rowtype;
  v_dummy_hash text := crypt('net-hacking-timing-guard-' || gen_random_uuid()::text, gen_salt('bf', 10));
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

      v_verified := crypt(
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

-- ==================================================================
-- ROLL ACCESS FOUNDATION (method = roll; no dice math here)
-- ==================================================================

-- A roll-mode grant alone never compromises the target. This is only the
-- narrow, GM-System-only contract a later batch's confirmed-roll-resolution
-- flow will call once the actual dice mechanic exists.
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

  v_result := public.net_system_hacking_establish_compromised_access(
    v_gm_id,
    requested_actor_identity_link_id,
    requested_target_identity_link_id,
    'roll'
  );

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
-- HACKING SESSION LIFECYCLE (fetch / end)
-- ==================================================================

-- The current effective runtime identity's own active hacking session, if
-- any. No actor parameter -- current_net_effective_runtime_identity_link_id()
-- is the only source, exactly as every write path above already requires,
-- so this can never be used to read another identity's session. A null
-- effective actor (e.g. GM System mode) naturally yields zero matching rows
-- rather than needing a special case. Never returns credential/hash data --
-- net_system_credentials is not touched here at all.
create or replace function public.fetch_net_system_hacking_session()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.current_net_effective_runtime_identity_link_id();
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

-- Voluntary self-disconnect. No parameters: the actor is server-derived, and
-- the delete is scoped to exactly that actor's own row, so this can never
-- end anyone else's session. Never touches net_system_hacking_grants -- the
-- persistent permission stays enabled/unchanged. Because credentials are
-- never cached anywhere and every attempt independently re-verifies against
-- net_system_credentials, a later credential-mode attempt against the same
-- target after ending necessarily requires the credential again; no extra
-- state is needed to enforce that.
create or replace function public.end_net_system_hacking_session()
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.current_net_effective_runtime_identity_link_id();
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

revoke all on function public.fetch_net_system_hacking_session()
  from public, anon, authenticated;
revoke all on function public.end_net_system_hacking_session()
  from public, anon, authenticated;
grant execute on function public.fetch_net_system_hacking_session() to authenticated;
grant execute on function public.end_net_system_hacking_session() to authenticated;

-- ==================================================================
-- SYSTEM OWNER CREDENTIAL MANAGEMENT (own effective runtime identity only)
-- ==================================================================

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
  v_identity_link_id := public.assert_net_effective_runtime_identity(
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

create or replace function public.set_net_system_credential(
  requested_expected_identity_link_id uuid,
  requested_credential_kind text,
  requested_credential text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_kind text := lower(btrim(coalesce(requested_credential_kind, '')));
  v_credential text := coalesce(requested_credential, '');
  v_context record;
begin
  v_identity_link_id := public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, null, false
  );

  if v_kind not in ('pin', 'password') then
    raise exception 'NET_SYSTEM_CREDENTIAL_KIND_INVALID' using errcode = '22023';
  end if;
  if v_kind = 'pin' and v_credential !~ '^[0-9]{4,8}$' then
    raise exception 'NET_SYSTEM_CREDENTIAL_PIN_INVALID' using errcode = '22023';
  end if;
  if v_kind = 'password' and char_length(v_credential) not between 4 and 72 then
    raise exception 'NET_SYSTEM_CREDENTIAL_PASSWORD_INVALID' using errcode = '22023';
  end if;

  insert into public.net_system_credentials (
    identity_link_id, credential_kind, credential_hash, set_by_profile_id
  ) values (
    v_identity_link_id, v_kind, crypt(v_credential, gen_salt('bf', 10)), auth.uid()
  )
  on conflict (identity_link_id) do update
  set
    credential_kind = excluded.credential_kind,
    credential_hash = excluded.credential_hash,
    set_by_profile_id = excluded.set_by_profile_id;

  select context.*
  into v_context
  from public.net_runtime_action_context(v_identity_link_id) as context;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    auth.uid(), null,
    v_context.persona_subject_kind, v_context.persona_subject_id,
    v_context.action_mode, 'system-credential.set',
    v_context.authorization_basis, 'net-identity-link', v_identity_link_id
  );

  return jsonb_build_object(
    'identity_link_id', v_identity_link_id,
    'configured', true,
    'credential_kind', v_kind,
    'updated_at', timezone('utc', clock_timestamp())
  );
end;
$$;

create or replace function public.clear_net_system_credential(
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
  v_context record;
begin
  v_identity_link_id := public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, null, false
  );

  delete from public.net_system_credentials
  where identity_link_id = v_identity_link_id;

  select context.*
  into v_context
  from public.net_runtime_action_context(v_identity_link_id) as context;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    auth.uid(), null,
    v_context.persona_subject_kind, v_context.persona_subject_id,
    v_context.action_mode, 'system-credential.clear',
    v_context.authorization_basis, 'net-identity-link', v_identity_link_id
  );

  return jsonb_build_object(
    'identity_link_id', v_identity_link_id,
    'configured', false,
    'credential_kind', null,
    'updated_at', null
  );
end;
$$;

revoke all on function public.fetch_net_system_credential_status(uuid)
  from public, anon, authenticated;
revoke all on function public.set_net_system_credential(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.clear_net_system_credential(uuid)
  from public, anon, authenticated;
grant execute on function public.fetch_net_system_credential_status(uuid) to authenticated;
grant execute on function public.set_net_system_credential(uuid, text, text) to authenticated;
grant execute on function public.clear_net_system_credential(uuid) to authenticated;

-- ==================================================================
-- GM HACKING PERMISSION RPCs (GM System mode only; take-control/act-as/
-- compromised-session cannot administer grants -- enforced by
-- assert_net_system_admin() / assert_net_system_admin_read() requiring
-- profiles.role = 'gm' AND net_gm_persona_sessions.mode = 'none', never a
-- client-supplied flag)
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
      'updated_at', grant_row.updated_at
    ) order by grant_row.updated_at desc)
    from public.net_system_hacking_grants as grant_row
    where grant_row.actor_identity_link_id = requested_actor_identity_link_id
    limit 200
  ), '[]'::jsonb);
end;
$$;

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
  -- New grants (v_existing_method is null) have no session to invalidate.
  if v_existing_method is not null and v_existing_method <> v_method then
    delete from public.net_system_hacking_sessions
    where actor_identity_link_id = requested_actor_identity_link_id
      and target_identity_link_id = requested_target_identity_link_id;
    v_session_invalidated := found;
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
  -- file never reads, writes, or references.
  delete from public.net_system_hacking_sessions
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

revoke all on function public.fetch_net_system_hacking_grants(uuid)
  from public, anon, authenticated;
revoke all on function public.set_net_system_hacking_grant(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.revoke_net_system_hacking_grant(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fetch_net_system_hacking_grants(uuid) to authenticated;
grant execute on function public.set_net_system_hacking_grant(uuid, uuid, text) to authenticated;
grant execute on function public.revoke_net_system_hacking_grant(uuid, uuid) to authenticated;

commit;
