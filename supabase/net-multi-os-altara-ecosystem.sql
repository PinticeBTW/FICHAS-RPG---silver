-- ALTARA OS clean ecosystem, authoritative app installs, and shared wallpaper access.
-- Run once after the deployed multi-OS foundation and independent-bank migrations.
-- This migration changes access only: historical installs, accounts, balances,
-- application data, and immutable ledger history are preserved.

begin;

-- The current canon keeps every existing New Vega service inside VEIL. The
-- ALTARA base applications use new stable IDs; the retired legacy `altara`
-- account/app identifier is deliberately untouched and never reused.
insert into public.net_os_service_scopes (
  service_id,
  scope_kind,
  required_os_id
)
values
  ('echo', 'primary-os', 'veil'),
  ('pulse', 'primary-os', 'veil'),
  ('iden', 'primary-os', 'veil'),
  ('vlt', 'primary-os', 'veil'),
  ('vox-bank', 'primary-os', 'veil'),
  ('shneider-bank', 'primary-os', 'veil'),
  ('nvn', 'primary-os', 'veil'),
  ('net-store', 'primary-os', 'veil'),
  ('veil-settings', 'primary-os', 'veil'),
  ('loop', 'primary-os', 'veil'),
  ('altara-messenger', 'primary-os', 'altara'),
  ('altara-bank', 'primary-os', 'altara'),
  ('altara-store', 'primary-os', 'altara'),
  ('altara-settings', 'primary-os', 'altara')
on conflict (service_id) do update
set
  scope_kind = excluded.scope_kind,
  required_os_id = excluded.required_os_id,
  updated_at = timezone('utc', now());

-- Authenticated clients retain the deployed read-only table grant because the
-- app-account catalogue uses it, but every ownership shape must now pass the
-- application's authoritative OS scope. PostgreSQL OR-combines permissive
-- policies, so fail closed if an unexpected SELECT/ALL policy could bypass the
-- single reviewed policy below.
do $$
declare
  v_unexpected_policies text;
begin
  select string_agg(policy.policyname, ', ' order by policy.policyname)
  into v_unexpected_policies
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'net_app_accounts'
    and policy.cmd in ('SELECT', 'ALL')
    and policy.policyname <> 'net_app_accounts_select_authorised';

  if v_unexpected_policies is not null then
    raise exception 'NET_APP_ACCOUNTS_POLICY_REVIEW_REQUIRED: %',
      v_unexpected_policies
      using errcode = '23514';
  end if;
end;
$$;

drop policy if exists net_app_accounts_select_authorised
  on public.net_app_accounts;
create policy net_app_accounts_select_authorised
on public.net_app_accounts
for select
to authenticated
using (
  public.is_current_user_gm()
  or (
    identity_link_id is not null
    and public.current_user_controls_net_service_for_link(
      identity_link_id,
      app_id
    )
  )
  or (
    (entity_id is not null or organisation_id is not null)
    and public.current_user_can_access_net_service(app_id)
  )
);

-- Preserve the intended direct-read contract and keep all direct client writes
-- closed after replacing the policy.
revoke all on table public.net_app_accounts from public, anon, authenticated;
grant select on table public.net_app_accounts to authenticated;

-- Placeholder/system products never provision social or financial accounts.
-- The existing retired `altara` policy and any historical rows remain intact.
insert into public.net_app_account_policies (app_id, account_mode, account_available)
values
  ('altara-messenger', 'none', false),
  ('altara-bank', 'none', false),
  ('altara-store', 'none', false),
  ('altara-settings', 'none', false)
on conflict (app_id) do update
set
  account_mode = excluded.account_mode,
  account_available = excluded.account_available,
  updated_at = timezone('utc', now());

-- Preserve every existing install row. Only ALTARA BANK joins the optional
-- installation domain; system applications remain implicit.
alter table public.net_identity_app_installs
  drop constraint if exists net_identity_app_installs_app_id_check;
alter table public.net_identity_app_installs
  add constraint net_identity_app_installs_app_id_check
  check (app_id in (
    'echo',
    'pulse',
    'nvn',
    'vox-bank',
    'shneider-bank',
    'altara-bank'
  )) not valid;
alter table public.net_identity_app_installs
  validate constraint net_identity_app_installs_app_id_check;

create or replace function public.set_net_identity_app_install(
  requested_identity_link_id uuid,
  requested_app_id text,
  requested_installed boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(
      requested_identity_link_id
    )
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;
  if requested_app_id is null
    or requested_app_id not in (
      'echo',
      'pulse',
      'nvn',
      'vox-bank',
      'shneider-bank',
      'altara-bank'
    )
  then
    raise exception 'This application is not an installable optional OS module.'
      using errcode = '22023';
  end if;
  if requested_installed is null then
    raise exception 'Installation state is required.' using errcode = '22023';
  end if;

  -- The central scope registry is the install authority. Stale rows from a
  -- previous OS remain stored but cannot be read, launched, or recreated
  -- through this RPC under the wrong primary OS.
  perform public.assert_net_identity_service_access(
    requested_identity_link_id,
    requested_app_id
  );

  if requested_installed then
    insert into public.net_identity_app_installs (identity_link_id, app_id)
    values (requested_identity_link_id, requested_app_id)
    on conflict (identity_link_id, app_id) do update
    set updated_at = timezone('utc', now());
  else
    delete from public.net_identity_app_installs
    where identity_link_id = requested_identity_link_id
      and app_id = requested_app_id;
  end if;

  return requested_installed;
end;
$$;

-- A system profile and its private object can be reached through exactly the
-- settings service for the identity's current primary OS. Object paths remain
-- identity-prefixed; no bucket is made public and no cross-identity branch is
-- added.
drop policy if exists net_identity_system_profiles_select_authorised
  on public.net_identity_system_profiles;
create policy net_identity_system_profiles_select_authorised
on public.net_identity_system_profiles
for select
to authenticated
using (
  public.is_current_user_gm()
  or public.current_user_controls_net_service_for_link(
    identity_link_id,
    'veil-settings'
  )
  or public.current_user_controls_net_service_for_link(
    identity_link_id,
    'altara-settings'
  )
);

drop policy if exists net_wallpapers_select_authorised on storage.objects;
create policy net_wallpapers_select_authorised
on storage.objects
for select
to authenticated
using (
  bucket_id = 'net-wallpapers'
  and (
    public.is_current_user_gm()
    or public.current_user_controls_net_service_for_link(
      public.net_wallpaper_identity_link_id(name),
      'veil-settings'
    )
    or public.current_user_controls_net_service_for_link(
      public.net_wallpaper_identity_link_id(name),
      'altara-settings'
    )
  )
);

drop policy if exists net_wallpapers_insert_controlled on storage.objects;
create policy net_wallpapers_insert_controlled
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'net-wallpapers'
  and (
    public.current_user_controls_net_service_for_link(
      public.net_wallpaper_identity_link_id(name),
      'veil-settings'
    )
    or public.current_user_controls_net_service_for_link(
      public.net_wallpaper_identity_link_id(name),
      'altara-settings'
    )
  )
);

drop policy if exists net_wallpapers_update_controlled on storage.objects;
create policy net_wallpapers_update_controlled
on storage.objects
for update
to authenticated
using (
  bucket_id = 'net-wallpapers'
  and (
    public.current_user_controls_net_service_for_link(
      public.net_wallpaper_identity_link_id(name),
      'veil-settings'
    )
    or public.current_user_controls_net_service_for_link(
      public.net_wallpaper_identity_link_id(name),
      'altara-settings'
    )
  )
)
with check (
  bucket_id = 'net-wallpapers'
  and (
    public.current_user_controls_net_service_for_link(
      public.net_wallpaper_identity_link_id(name),
      'veil-settings'
    )
    or public.current_user_controls_net_service_for_link(
      public.net_wallpaper_identity_link_id(name),
      'altara-settings'
    )
  )
);

drop policy if exists net_wallpapers_delete_controlled on storage.objects;
create policy net_wallpapers_delete_controlled
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'net-wallpapers'
  and (
    public.current_user_controls_net_service_for_link(
      public.net_wallpaper_identity_link_id(name),
      'veil-settings'
    )
    or public.current_user_controls_net_service_for_link(
      public.net_wallpaper_identity_link_id(name),
      'altara-settings'
    )
  )
);

-- PULSE's RPC family shares these comparison-only context assertions. Adding
-- the central service check here gates reads and writes without rewriting its
-- bounded pagination, abuse budgets, or compromised-session contracts.
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
  v_actor uuid := auth.uid();
  v_identity_link_id uuid;
  v_account_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select identity_link.id, pulse_account.id
  into v_identity_link_id, v_account_id
  from public.net_active_identities as active_identity
  join public.net_identity_links as identity_link
    on identity_link.id = active_identity.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  left join public.net_app_accounts as pulse_account
    on pulse_account.identity_link_id = identity_link.id
    and pulse_account.app_id = 'pulse'
    and pulse_account.status = 'active'
  where active_identity.profile_id = v_actor
    and public.current_user_controls_playable_net_identity_link(identity_link.id)
  for share of active_identity;

  if requested_expected_account_id is distinct from v_account_id then
    raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  if coalesce(requested_require_account, true) and v_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;

  perform public.assert_net_identity_service_access(v_identity_link_id, 'pulse');
  return v_account_id;
end;
$$;

-- The historical name is generic, but its complete deployed call graph is
-- PULSE-only: the PULSE account INSERT trigger and the PULSE account-creation
-- RPC family. Keep the signature for compatibility and enforce PULSE here.
create or replace function public.assert_net_active_identity_context(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_identity_link_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select identity_link.id
  into v_identity_link_id
  from public.net_active_identities as active_identity
  join public.net_identity_links as identity_link
    on identity_link.id = active_identity.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  where active_identity.profile_id = v_actor
    and public.current_user_controls_playable_net_identity_link(identity_link.id)
  for share of active_identity;

  if requested_expected_identity_link_id is null
    or requested_expected_identity_link_id is distinct from v_identity_link_id
  then
    raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  perform public.assert_net_identity_service_access(v_identity_link_id, 'pulse');
  return v_identity_link_id;
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
  v_actor uuid := auth.uid();
  v_session public.net_gm_persona_sessions%rowtype;
  v_context record;
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.is_current_user_gm() then
    raise exception 'Only an authoritative GM may use a compromised session.'
      using errcode = '42501';
  end if;

  select session_row.*
  into v_session
  from public.net_gm_persona_sessions as session_row
  where session_row.gm_profile_id = v_actor
  for share;

  if not found
    or v_session.mode <> 'compromised-session'
    or requested_expected_session_generation is null
    or requested_expected_session_generation <> v_session.session_generation
  then
    raise exception 'PULSE_COMPROMISED_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  select current_context.*
  into v_context
  from public.resolve_current_compromised_pulse_context() as current_context;

  if not found
    or requested_expected_account_id is null
    or requested_expected_account_id is distinct from v_context.pulse_account_id
  then
    raise exception 'PULSE_COMPROMISED_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  perform public.assert_net_identity_service_access(v_context.identity_link_id, 'pulse');

  return query select
    v_context.actor_profile_id,
    v_context.persona_subject_kind,
    v_context.persona_subject_id,
    v_context.identity_link_id,
    v_context.pulse_account_id;
end;
$$;

drop policy if exists net_pulse_realtime_state_select_authenticated
  on public.net_pulse_realtime_state;
create policy net_pulse_realtime_state_select_authenticated
on public.net_pulse_realtime_state
for select
to authenticated
using (
  channel = 'public'
  and (
    public.is_current_user_gm()
    or exists (
      select 1
      from public.net_active_identities as active_identity
      where active_identity.profile_id = auth.uid()
        and public.current_user_controls_net_service_for_link(
          active_identity.identity_link_id,
          'pulse'
        )
    )
  )
);

-- Extend the existing identity-scoped system profile rather than creating a
-- second ALTARA wallpaper model. Null remains the VEIL/default presentation;
-- ALTARA built-ins use an explicit stable preset ID.
alter table public.net_identity_system_profiles
  add column if not exists wallpaper_preset_id text;

comment on column public.net_identity_system_profiles.wallpaper_preset_id is
  'Optional OS-native built-in wallpaper ID. Custom bytes remain in the private net-wallpapers bucket.';

create or replace function public.set_net_identity_wallpaper(
  requested_identity_link_id uuid,
  requested_wallpaper_path text,
  requested_fit text,
  requested_position text
)
returns public.net_identity_system_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_normalized_path text := nullif(btrim(requested_wallpaper_path), '');
  v_saved_profile public.net_identity_system_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(
      requested_identity_link_id
    )
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;
  if not (
    public.net_identity_link_can_access_service(
      requested_identity_link_id,
      'veil-settings'
    )
    or public.net_identity_link_can_access_service(
      requested_identity_link_id,
      'altara-settings'
    )
  ) then
    raise exception 'NET_OS_SERVICE_ACCESS_DENIED' using errcode = '42501';
  end if;

  if v_normalized_path is null
    or split_part(v_normalized_path, '/', 1) <> requested_identity_link_id::text
    or split_part(v_normalized_path, '/', 2) = ''
    or v_normalized_path like '%..%'
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
    select 1
    from storage.objects as object
    where object.bucket_id = 'net-wallpapers'
      and object.name = v_normalized_path
  ) then
    raise exception 'Wallpaper object is unavailable.' using errcode = '22023';
  end if;

  insert into public.net_identity_system_profiles (
    identity_link_id,
    wallpaper_path,
    wallpaper_preset_id,
    wallpaper_fit,
    wallpaper_position
  ) values (
    requested_identity_link_id,
    v_normalized_path,
    null,
    requested_fit,
    requested_position
  )
  on conflict (identity_link_id) do update
  set
    wallpaper_path = excluded.wallpaper_path,
    wallpaper_preset_id = null,
    wallpaper_fit = excluded.wallpaper_fit,
    wallpaper_position = excluded.wallpaper_position
  returning * into v_saved_profile;

  return v_saved_profile;
end;
$$;

create or replace function public.set_net_identity_wallpaper_preset(
  requested_identity_link_id uuid,
  requested_preset_id text
)
returns public.net_identity_system_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_preset_id text := nullif(lower(btrim(requested_preset_id)), '');
  v_saved_profile public.net_identity_system_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(
      requested_identity_link_id
    )
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;
  perform public.assert_net_identity_service_access(
    requested_identity_link_id,
    'altara-settings'
  );
  if v_preset_id is null
    or v_preset_id not in (
      'altara-nocturne',
      'altara-atlas',
      'altara-silk'
    )
  then
    raise exception 'Unsupported ALTARA wallpaper preset.' using errcode = '22023';
  end if;

  insert into public.net_identity_system_profiles (
    identity_link_id,
    wallpaper_path,
    wallpaper_preset_id,
    wallpaper_fit,
    wallpaper_position
  ) values (
    requested_identity_link_id,
    null,
    v_preset_id,
    'cover',
    'center'
  )
  on conflict (identity_link_id) do update
  set
    wallpaper_path = null,
    wallpaper_preset_id = excluded.wallpaper_preset_id,
    wallpaper_fit = 'cover',
    wallpaper_position = 'center'
  returning * into v_saved_profile;

  return v_saved_profile;
end;
$$;

create or replace function public.clear_net_identity_wallpaper(
  requested_identity_link_id uuid
)
returns public.net_identity_system_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_saved_profile public.net_identity_system_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(
      requested_identity_link_id
    )
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;
  if not (
    public.net_identity_link_can_access_service(
      requested_identity_link_id,
      'veil-settings'
    )
    or public.net_identity_link_can_access_service(
      requested_identity_link_id,
      'altara-settings'
    )
  ) then
    raise exception 'NET_OS_SERVICE_ACCESS_DENIED' using errcode = '42501';
  end if;

  insert into public.net_identity_system_profiles (
    identity_link_id,
    wallpaper_path,
    wallpaper_preset_id,
    wallpaper_fit,
    wallpaper_position
  ) values (
    requested_identity_link_id,
    null,
    null,
    'cover',
    'center'
  )
  on conflict (identity_link_id) do update
  set
    wallpaper_path = null,
    wallpaper_preset_id = null,
    wallpaper_fit = 'cover',
    wallpaper_position = 'center'
  returning * into v_saved_profile;

  return v_saved_profile;
end;
$$;

-- VOX and SHNEIDER were previously global. Preserve every deployed function
-- body behind execution-revoked names and restore the stable PostgREST surface
-- with one central service assertion per institution.
do $$
begin
  if to_regprocedure(
    'public.fetch_net_economy_vox_bank_unscoped(timestamptz,uuid,integer)'
  ) is null then
    if to_regprocedure(
      'public.fetch_net_economy_vox_bank(timestamptz,uuid,integer)'
    ) is null then
      raise exception 'NET_OS_VOX_FETCH_BOUNDARY_REVIEW_REQUIRED' using errcode = '42883';
    end if;
    execute 'alter function public.fetch_net_economy_vox_bank(timestamptz, uuid, integer) rename to fetch_net_economy_vox_bank_unscoped';
  end if;
  if to_regprocedure('public.open_net_economy_vox_bank_unscoped()') is null then
    if to_regprocedure('public.open_net_economy_vox_bank()') is null then
      raise exception 'NET_OS_VOX_OPEN_BOUNDARY_REVIEW_REQUIRED' using errcode = '42883';
    end if;
    execute 'alter function public.open_net_economy_vox_bank() rename to open_net_economy_vox_bank_unscoped';
  end if;
  if to_regprocedure('public.claim_net_economy_vox_bank_yield_unscoped(uuid)') is null then
    if to_regprocedure('public.claim_net_economy_vox_bank_yield(uuid)') is null then
      raise exception 'NET_OS_VOX_YIELD_BOUNDARY_REVIEW_REQUIRED' using errcode = '42883';
    end if;
    execute 'alter function public.claim_net_economy_vox_bank_yield(uuid) rename to claim_net_economy_vox_bank_yield_unscoped';
  end if;
  if to_regprocedure(
    'public.search_net_economy_vox_bank_payees_unscoped(text,integer)'
  ) is null then
    if to_regprocedure(
      'public.search_net_economy_vox_bank_payees(text,integer)'
    ) is null then
      raise exception 'NET_OS_VOX_SEARCH_BOUNDARY_REVIEW_REQUIRED' using errcode = '42883';
    end if;
    execute 'alter function public.search_net_economy_vox_bank_payees(text, integer) rename to search_net_economy_vox_bank_payees_unscoped';
  end if;
  if to_regprocedure(
    'public.transfer_net_economy_vox_bank_payment_unscoped(text,bigint,uuid)'
  ) is null then
    if to_regprocedure(
      'public.transfer_net_economy_vox_bank_payment(text,bigint,uuid)'
    ) is null then
      raise exception 'NET_OS_VOX_PAYMENT_BOUNDARY_REVIEW_REQUIRED' using errcode = '42883';
    end if;
    execute 'alter function public.transfer_net_economy_vox_bank_payment(text, bigint, uuid) rename to transfer_net_economy_vox_bank_payment_unscoped';
  end if;

  if to_regprocedure(
    'public.fetch_net_economy_shneider_bank_unscoped(timestamptz,uuid,integer)'
  ) is null then
    if to_regprocedure(
      'public.fetch_net_economy_shneider_bank(timestamptz,uuid,integer)'
    ) is null then
      raise exception 'NET_OS_SHNEIDER_FETCH_BOUNDARY_REVIEW_REQUIRED' using errcode = '42883';
    end if;
    execute 'alter function public.fetch_net_economy_shneider_bank(timestamptz, uuid, integer) rename to fetch_net_economy_shneider_bank_unscoped';
  end if;
  if to_regprocedure('public.open_net_economy_shneider_bank_unscoped()') is null then
    if to_regprocedure('public.open_net_economy_shneider_bank()') is null then
      raise exception 'NET_OS_SHNEIDER_OPEN_BOUNDARY_REVIEW_REQUIRED' using errcode = '42883';
    end if;
    execute 'alter function public.open_net_economy_shneider_bank() rename to open_net_economy_shneider_bank_unscoped';
  end if;
  if to_regprocedure(
    'public.search_net_economy_shneider_bank_payees_unscoped(text,integer)'
  ) is null then
    if to_regprocedure(
      'public.search_net_economy_shneider_bank_payees(text,integer)'
    ) is null then
      raise exception 'NET_OS_SHNEIDER_SEARCH_BOUNDARY_REVIEW_REQUIRED' using errcode = '42883';
    end if;
    execute 'alter function public.search_net_economy_shneider_bank_payees(text, integer) rename to search_net_economy_shneider_bank_payees_unscoped';
  end if;
  if to_regprocedure(
    'public.transfer_net_economy_shneider_bank_payment_unscoped(text,bigint,uuid)'
  ) is null then
    if to_regprocedure(
      'public.transfer_net_economy_shneider_bank_payment(text,bigint,uuid)'
    ) is null then
      raise exception 'NET_OS_SHNEIDER_PAYMENT_BOUNDARY_REVIEW_REQUIRED' using errcode = '42883';
    end if;
    execute 'alter function public.transfer_net_economy_shneider_bank_payment(text, bigint, uuid) rename to transfer_net_economy_shneider_bank_payment_unscoped';
  end if;
end;
$$;

create or replace function public.fetch_net_economy_vox_bank(
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('vox-bank');
  return public.fetch_net_economy_vox_bank_unscoped(
    requested_cursor_at,
    requested_cursor_id,
    requested_limit
  );
end;
$$;

create or replace function public.open_net_economy_vox_bank()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('vox-bank');
  return public.open_net_economy_vox_bank_unscoped();
end;
$$;

create or replace function public.claim_net_economy_vox_bank_yield(
  requested_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('vox-bank');
  return public.claim_net_economy_vox_bank_yield_unscoped(
    requested_request_key
  );
end;
$$;

create or replace function public.search_net_economy_vox_bank_payees(
  requested_query text,
  requested_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('vox-bank');
  return public.search_net_economy_vox_bank_payees_unscoped(
    requested_query,
    requested_limit
  );
end;
$$;

create or replace function public.transfer_net_economy_vox_bank_payment(
  requested_payment_identifier text,
  requested_amount bigint,
  requested_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('vox-bank');
  return public.transfer_net_economy_vox_bank_payment_unscoped(
    requested_payment_identifier,
    requested_amount,
    requested_request_key
  );
end;
$$;

create or replace function public.transfer_net_economy_vox_bank(
  requested_direction text,
  requested_amount bigint,
  requested_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('vox-bank');
  perform public.assert_current_user_net_service_access('vlt');
  return public.transfer_net_economy_vox_bank_unscoped(
    requested_direction,
    requested_amount,
    requested_request_key
  );
end;
$$;

create or replace function public.fetch_net_economy_shneider_bank(
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('shneider-bank');
  return public.fetch_net_economy_shneider_bank_unscoped(
    requested_cursor_at,
    requested_cursor_id,
    requested_limit
  );
end;
$$;

create or replace function public.open_net_economy_shneider_bank()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('shneider-bank');
  return public.open_net_economy_shneider_bank_unscoped();
end;
$$;

create or replace function public.search_net_economy_shneider_bank_payees(
  requested_query text,
  requested_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('shneider-bank');
  return public.search_net_economy_shneider_bank_payees_unscoped(
    requested_query,
    requested_limit
  );
end;
$$;

create or replace function public.transfer_net_economy_shneider_bank_payment(
  requested_payment_identifier text,
  requested_amount bigint,
  requested_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('shneider-bank');
  return public.transfer_net_economy_shneider_bank_payment_unscoped(
    requested_payment_identifier,
    requested_amount,
    requested_request_key
  );
end;
$$;

create or replace function public.transfer_net_economy_shneider_bank(
  requested_direction text,
  requested_amount bigint,
  requested_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('shneider-bank');
  perform public.assert_current_user_net_service_access('vlt');
  return public.transfer_net_economy_shneider_bank_unscoped(
    requested_direction,
    requested_amount,
    requested_request_key
  );
end;
$$;

-- Bank/VLT rows remain stored but disappear from the read-only sheet selector
-- when the identity's primary OS cannot access the corresponding service.
create or replace function public.fetch_net_economy_sheet_account_sources(
  requested_subject_kind text,
  requested_subject_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_identity_count integer;
  v_primary_os_id text;
  v_vlt public.net_economy_accounts%rowtype;
  v_vox public.net_economy_accounts%rowtype;
  v_shneider public.net_economy_accounts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.net_economy_current_user_can_view_sheet_subject(
    requested_subject_kind,
    requested_subject_id
  ) then
    raise exception 'ECONOMY_SHEET_VIEW_DENIED' using errcode = '42501';
  end if;

  select count(*) into v_identity_count
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = requested_subject_kind
    and identity_link.subject_id = requested_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';
  if v_identity_count = 0 then
    return jsonb_build_object(
      'server_now', timezone('utc', clock_timestamp()),
      'primary_os_id', null,
      'vlt', null,
      'vox_bank', null,
      'shneider_bank', null
    );
  end if;
  if v_identity_count > 1 then
    raise exception 'ECONOMY_SHEET_IDENTITY_AMBIGUOUS' using errcode = '23514';
  end if;

  select identity_link.id, assignment.primary_os_id
  into v_identity_link_id, v_primary_os_id
  from public.net_identity_links as identity_link
  join public.net_identity_os_assignments as assignment
    on assignment.identity_link_id = identity_link.id
  where identity_link.subject_kind = requested_subject_kind
    and identity_link.subject_id = requested_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if not found then
    raise exception 'NET_OS_ASSIGNMENT_REQUIRED' using errcode = '23514';
  end if;

  if public.net_identity_link_can_access_service(v_identity_link_id, 'vlt') then
    select * into v_vlt
    from public.net_economy_accounts as account
    where account.identity_link_id = v_identity_link_id
      and account.account_kind = 'wallet'
      and account.currency_code = 'VG';
  end if;
  if public.net_identity_link_can_access_service(v_identity_link_id, 'vox-bank') then
    select * into v_vox
    from public.net_economy_accounts as account
    where account.identity_link_id = v_identity_link_id
      and account.account_kind = 'bank'
      and account.institution_id = '00000000-0000-0000-0000-00000000e100'::uuid
      and account.currency_code = 'VG';
  end if;
  if public.net_identity_link_can_access_service(v_identity_link_id, 'shneider-bank') then
    select * into v_shneider
    from public.net_economy_accounts as account
    where account.identity_link_id = v_identity_link_id
      and account.account_kind = 'bank'
      and account.institution_id = '00000000-0000-0000-0000-00000000e101'::uuid
      and account.currency_code = 'VG';
  end if;

  return jsonb_build_object(
    'server_now', timezone('utc', clock_timestamp()),
    'primary_os_id', v_primary_os_id,
    'vlt', case when v_vlt.id is null then null else jsonb_build_object(
      'account_id', v_vlt.id,
      'balance_amount', v_vlt.balance_amount,
      'updated_at', v_vlt.updated_at
    ) end,
    'vox_bank', case when v_vox.id is null then null else jsonb_build_object(
      'account_id', v_vox.id,
      'balance_amount', v_vox.balance_amount,
      'updated_at', v_vox.updated_at
    ) end,
    'shneider_bank', case when v_shneider.id is null then null else jsonb_build_object(
      'account_id', v_shneider.id,
      'balance_amount', v_shneider.balance_amount,
      'updated_at', v_shneider.updated_at
    ) end
  );
end;
$$;

-- The single economy Realtime table remains the only channel. Its RLS now
-- applies institution scope instead of treating every bank row as global.
create or replace function public.current_user_can_read_net_economy_wallet_revision(
  requested_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and (
      public.is_current_user_gm()
      or exists (
        select 1
        from public.net_economy_accounts as account
        where account.id = requested_account_id
          and account.identity_link_id is not null
          and public.current_user_controls_playable_net_identity_link(
            account.identity_link_id
          )
          and (
            (
              account.account_kind = 'wallet'
              and public.net_identity_link_can_access_service(
                account.identity_link_id,
                'vlt'
              )
            )
            or (
              account.account_kind = 'bank'
              and account.institution_id = '00000000-0000-0000-0000-00000000e100'::uuid
              and public.net_identity_link_can_access_service(
                account.identity_link_id,
                'vox-bank'
              )
            )
            or (
              account.account_kind = 'bank'
              and account.institution_id = '00000000-0000-0000-0000-00000000e101'::uuid
              and public.net_identity_link_can_access_service(
                account.identity_link_id,
                'shneider-bank'
              )
            )
          )
      )
    );
$$;

-- Keep all internal helpers execution-revoked. Only the bounded client RPCs
-- and the new ALTARA preset mutation are executable by authenticated users.
revoke all on function public.fetch_net_economy_vox_bank_unscoped(
  timestamptz,
  uuid,
  integer
) from public, anon, authenticated;
revoke all on function public.open_net_economy_vox_bank_unscoped()
  from public, anon, authenticated;
revoke all on function public.claim_net_economy_vox_bank_yield_unscoped(uuid)
  from public, anon, authenticated;
revoke all on function public.search_net_economy_vox_bank_payees_unscoped(text, integer)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_vox_bank_payment_unscoped(text, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_vox_bank_unscoped(text, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_economy_shneider_bank_unscoped(
  timestamptz,
  uuid,
  integer
) from public, anon, authenticated;
revoke all on function public.open_net_economy_shneider_bank_unscoped()
  from public, anon, authenticated;
revoke all on function public.search_net_economy_shneider_bank_payees_unscoped(text, integer)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_shneider_bank_payment_unscoped(text, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_shneider_bank_unscoped(text, bigint, uuid)
  from public, anon, authenticated;

revoke all on function public.set_net_identity_app_install(uuid, text, boolean)
  from public, anon;
revoke all on function public.set_net_identity_wallpaper(uuid, text, text, text)
  from public, anon;
revoke all on function public.set_net_identity_wallpaper_preset(uuid, text)
  from public, anon;
revoke all on function public.clear_net_identity_wallpaper(uuid)
  from public, anon;
grant execute on function public.set_net_identity_app_install(uuid, text, boolean)
  to authenticated;
grant execute on function public.set_net_identity_wallpaper(uuid, text, text, text)
  to authenticated;
grant execute on function public.set_net_identity_wallpaper_preset(uuid, text)
  to authenticated;
grant execute on function public.clear_net_identity_wallpaper(uuid)
  to authenticated;

revoke all on function public.fetch_net_economy_vox_bank(timestamptz, uuid, integer)
  from public, anon;
revoke all on function public.open_net_economy_vox_bank()
  from public, anon;
revoke all on function public.claim_net_economy_vox_bank_yield(uuid)
  from public, anon;
revoke all on function public.search_net_economy_vox_bank_payees(text, integer)
  from public, anon;
revoke all on function public.transfer_net_economy_vox_bank_payment(text, bigint, uuid)
  from public, anon;
revoke all on function public.transfer_net_economy_vox_bank(text, bigint, uuid)
  from public, anon;
revoke all on function public.fetch_net_economy_shneider_bank(timestamptz, uuid, integer)
  from public, anon;
revoke all on function public.open_net_economy_shneider_bank()
  from public, anon;
revoke all on function public.search_net_economy_shneider_bank_payees(text, integer)
  from public, anon;
revoke all on function public.transfer_net_economy_shneider_bank_payment(text, bigint, uuid)
  from public, anon;
revoke all on function public.transfer_net_economy_shneider_bank(text, bigint, uuid)
  from public, anon;

grant execute on function public.fetch_net_economy_vox_bank(timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.open_net_economy_vox_bank()
  to authenticated;
grant execute on function public.claim_net_economy_vox_bank_yield(uuid)
  to authenticated;
grant execute on function public.search_net_economy_vox_bank_payees(text, integer)
  to authenticated;
grant execute on function public.transfer_net_economy_vox_bank_payment(text, bigint, uuid)
  to authenticated;
grant execute on function public.transfer_net_economy_vox_bank(text, bigint, uuid)
  to authenticated;
grant execute on function public.fetch_net_economy_shneider_bank(timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.open_net_economy_shneider_bank()
  to authenticated;
grant execute on function public.search_net_economy_shneider_bank_payees(text, integer)
  to authenticated;
grant execute on function public.transfer_net_economy_shneider_bank_payment(text, bigint, uuid)
  to authenticated;
grant execute on function public.transfer_net_economy_shneider_bank(text, bigint, uuid)
  to authenticated;

-- Reassert helper privileges after CREATE OR REPLACE. These functions are
-- reached only from RLS policies or bounded SECURITY DEFINER callers.
revoke all on function public.assert_net_pulse_account_context(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.assert_net_active_identity_context(uuid)
  from public, anon, authenticated;
revoke all on function public.assert_net_pulse_compromised_context(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.current_user_can_read_net_economy_wallet_revision(uuid)
  from public, anon;
grant execute on function public.current_user_can_read_net_economy_wallet_revision(uuid)
  to authenticated;

commit;
