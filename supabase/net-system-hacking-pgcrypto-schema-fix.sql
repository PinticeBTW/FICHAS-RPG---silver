-- HACKING CREDENTIAL: pgcrypto schema resolution hotfix.
-- Forward-only. Run after the deployed supabase/net-system-hacking-foundation.sql.
--
-- public.attempt_net_system_credential_access(...) and
-- public.set_net_system_credential(...) call crypt(...)/gen_salt(...)
-- unqualified. Supabase installs pgcrypto into the `extensions` schema, and
-- both functions intentionally use `set search_path = public, pg_temp` (no
-- broader search_path -- unqualified calls into `extensions` never resolve),
-- so Postgres raises "function gen_salt(unknown, integer) does not exist"
-- the moment a credential is set. This migration does not broaden
-- search_path (that would reopen unrelated ambient-schema resolution for
-- every statement in these SECURITY DEFINER functions); it schema-qualifies
-- every crypt(...)/gen_salt(...) call as extensions.crypt(.../
-- extensions.gen_salt(...) instead -- the identical fix already applied to
-- WAVE post fingerprinting (net-altara-wave-post-digest-fix.sql,
-- extensions.digest(...)). Hashing semantics (bcrypt / 'bf' / cost 10) are
-- byte-for-byte unchanged; only function resolution changes. Neither
-- function's signature, volatility, SECURITY DEFINER status, search_path,
-- or authorization logic changes -- every other line is reproduced verbatim
-- from net-system-hacking-foundation.sql.

begin;

do $preflight$
declare
  v_attempt_definition text;
  v_set_definition text;
begin
  if to_regclass('public.net_system_credentials') is null
    or to_regclass('public.net_system_hacking_grants') is null
    or to_regclass('public.net_system_hacking_sessions') is null
    or to_regprocedure('public.attempt_net_system_credential_access(uuid,text)') is null
    or to_regprocedure('public.set_net_system_credential(uuid,text,text)') is null
    or to_regprocedure(
      'public.net_system_hacking_establish_compromised_access(uuid,uuid,uuid,text)'
    ) is null
  then
    raise exception 'NET_SYSTEM_HACKING_PGCRYPTO_SCHEMA_FIX_DEPENDENCY_REQUIRED. This migration requires net-system-hacking-foundation.sql to be deployed first.'
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

  select pg_catalog.pg_get_functiondef(
    'public.attempt_net_system_credential_access(uuid,text)'::regprocedure
  ) into v_attempt_definition;

  if pg_catalog.strpos(pg_catalog.lower(v_attempt_definition), ':= crypt(') = 0
    or pg_catalog.strpos(pg_catalog.lower(v_attempt_definition), ':= extensions.crypt(') > 0
    or pg_catalog.strpos(pg_catalog.lower(v_attempt_definition), ', gen_salt(') = 0
    or pg_catalog.strpos(pg_catalog.lower(v_attempt_definition), ', extensions.gen_salt(') > 0
  then
    raise exception 'NET_SYSTEM_HACKING_ATTEMPT_ACCESS_DEFINITION_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.set_net_system_credential(uuid,text,text)'::regprocedure
  ) into v_set_definition;

  if pg_catalog.strpos(pg_catalog.lower(v_set_definition), ', crypt(') = 0
    or pg_catalog.strpos(pg_catalog.lower(v_set_definition), ', extensions.crypt(') > 0
    or pg_catalog.strpos(pg_catalog.lower(v_set_definition), ', gen_salt(') = 0
    or pg_catalog.strpos(pg_catalog.lower(v_set_definition), ', extensions.gen_salt(') > 0
  then
    raise exception 'NET_SYSTEM_HACKING_SET_CREDENTIAL_DEFINITION_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$preflight$;

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
    v_identity_link_id, v_kind, extensions.crypt(v_credential, extensions.gen_salt('bf', 10)), auth.uid()
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

revoke all on function public.set_net_system_credential(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.set_net_system_credential(uuid, text, text)
  to authenticated;

comment on function public.attempt_net_system_credential_access(uuid, text) is
  'Verifies a fictional OS credential (bcrypt via extensions.crypt/extensions.gen_salt) and establishes a hacking session on success. Timing-equalized against a dummy hash. Never returns credential_hash.';
comment on function public.set_net_system_credential(uuid, text, text) is
  'Sets/changes the fictional OS credential (bcrypt via extensions.crypt/extensions.gen_salt, cost 10). Never returns credential_hash.';

commit;
