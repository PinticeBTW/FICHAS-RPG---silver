-- ALTARA BANK V1: independent ALTARA-only VG banking on the shared ledger.
-- Run once after the deployed multi-OS ALTARA ecosystem, independent banks,
-- Karma/sheet economy, and unified GM-control migrations.
--
-- The migration snapshots only the dormant VLT VG principal owned by the
-- player/playable identities assigned ALTARA OS at deployment time. Money is
-- not moved by this migration. A later explicit account-open action adopts
-- that fixed snapshot through one balanced ledger transaction. Future OS
-- changes cannot create new adoption eligibility.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.net_economy_accounts') is null
    or to_regclass('public.net_economy_transactions') is null
    or to_regclass('public.net_economy_transaction_entries') is null
    or to_regclass('public.net_economy_wallet_realtime_state') is null
    or to_regclass('public.net_economy_institutions') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_os_families') is null
    or to_regclass('public.net_os_service_scopes') is null
    or to_regclass('public.net_identity_app_installs') is null
    or to_regclass('public.net_app_account_policies') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_active_identities') is null
    or to_regclass('public.net_action_audit') is null
    or to_regclass('public.profiles') is null
    or to_regclass('public.character_sheet_forms') is null
    or to_regclass('public.npc_cards') is null
    or to_regclass('public.character_stats') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
    or to_regprocedure('public.assert_net_identity_service_access(uuid,text)') is null
    or to_regprocedure('public.current_user_controls_playable_net_identity_link(uuid)') is null
    or to_regprocedure('public.assert_net_economy_gm()') is null
    or to_regprocedure('public.net_economy_identity_display_name(uuid)') is null
    or to_regprocedure('public.net_economy_cash_display(bigint)') is null
    or to_regprocedure('public.net_economy_karma_display(bigint)') is null
    or to_regprocedure('public.net_economy_current_user_can_view_sheet_subject(text,uuid)') is null
    or to_regprocedure('public.net_economy_apply_sheet_karma_request(text,uuid,jsonb)') is null
    or to_regprocedure('public.net_economy_apply_sheet_karma_absolute_balance(uuid,bigint,text,uuid)') is null
    or to_regprocedure('public.patch_npc_card_field_data_v2(uuid,jsonb,text[])') is null
    or to_regprocedure('public.patch_character_sheet_field_data_v2(uuid,jsonb,text[],text)') is null
    or to_regprocedure(
      'public.save_character_stats_bidirectional_v2(uuid,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)'
    ) is null
  then
    raise exception 'ALTARA_BANK_DEPENDENCY_REVIEW_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.net_os_service_scopes as service_scope
    where service_scope.service_id = 'altara-bank'
      and service_scope.scope_kind = 'primary-os'
      and service_scope.required_os_id = 'altara'
  ) then
    raise exception 'ALTARA_BANK_SERVICE_SCOPE_REVIEW_REQUIRED' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.net_os_families as os_family
    where os_family.id = 'altara'
      and os_family.status = 'active'
  ) then
    raise exception 'ALTARA_BANK_ACTIVE_OS_REQUIRED' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.net_os_service_scopes as service_scope
    where service_scope.service_id = 'vlt'
      and service_scope.scope_kind = 'primary-os'
      and service_scope.required_os_id = 'veil'
  ) then
    raise exception 'ALTARA_BANK_DORMANT_VLT_SCOPE_REVIEW_REQUIRED' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.net_economy_accounts as account
    where account.id = '00000000-0000-0000-0000-00000000e001'::uuid
      and account.account_kind = 'system'
      and account.currency_code = 'VG'
  ) then
    raise exception 'ALTARA_BANK_VG_CLEARING_ACCOUNT_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_constraint as table_constraint
    where table_constraint.conrelid = 'public.net_identity_app_installs'::regclass
      and table_constraint.contype = 'c'
      and pg_get_constraintdef(table_constraint.oid) like '%altara-bank%'
  ) then
    raise exception 'ALTARA_BANK_INSTALL_DOMAIN_REVIEW_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_constraint as table_constraint
    where table_constraint.conrelid = 'public.net_economy_transactions'::regclass
      and table_constraint.contype = 'c'
      and pg_get_constraintdef(table_constraint.oid) like '%bank-deposit%'
      and pg_get_constraintdef(table_constraint.oid) like '%bank-transfer%'
  ) then
    raise exception 'ALTARA_BANK_LEDGER_KIND_REVIEW_REQUIRED' using errcode = '55000';
  end if;

  if to_regclass(
    'public.net_economy_accounts_bank_identity_institution_currency_unique'
  ) is null then
    raise exception 'ALTARA_BANK_ACCOUNT_UNIQUENESS_REVIEW_REQUIRED' using errcode = '55000';
  end if;
end;
$$;

-- ALTARA BANK changes only the CASH source. Fail closed unless the deployed
-- sheet endpoints still interpret an intentional Karma patch before the
-- BEFORE mirror trigger canonicalizes the stored presentation. The legacy
-- character endpoint must likewise retain the already-deployed, OS-gated
-- absolute-balance helper. This migration deliberately does not replace any
-- of those Karma functions.
do $$
declare
  v_npc_patch regprocedure :=
    to_regprocedure('public.patch_npc_card_field_data_v2(uuid,jsonb,text[])');
  v_profile_patch regprocedure :=
    to_regprocedure('public.patch_character_sheet_field_data_v2(uuid,jsonb,text[],text)');
  v_karma_request regprocedure :=
    to_regprocedure('public.net_economy_apply_sheet_karma_request(text,uuid,jsonb)');
  v_karma_absolute regprocedure :=
    to_regprocedure('public.net_economy_apply_sheet_karma_absolute_balance(uuid,bigint,text,uuid)');
  v_legacy_save regprocedure := to_regprocedure(
    'public.save_character_stats_bidirectional_v2(uuid,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)'
  );
begin
  if v_legacy_save is null
    or position(
      'net_economy_apply_sheet_karma_request'
      in lower(pg_get_functiondef(v_npc_patch::oid))
    ) = 0
    or position(
      'net_economy_apply_sheet_karma_request'
      in lower(pg_get_functiondef(v_profile_patch::oid))
    ) = 0
    or position(
      'net_economy_apply_sheet_karma_absolute_balance'
      in lower(pg_get_functiondef(v_legacy_save::oid))
    ) = 0
    or position(
      'net_identity_link_can_access_service'
      in lower(pg_get_functiondef(v_karma_request::oid))
    ) = 0
    or position(
      'net_economy_apply_sheet_karma_absolute_balance'
      in lower(pg_get_functiondef(v_karma_request::oid))
    ) = 0
    or position(
      '9f9873b5-89fd-40d5-9682-e20173b10e85'
      in lower(pg_get_functiondef(v_karma_request::oid))
    ) = 0
    or position(
      'assert_net_identity_service_access'
      in lower(pg_get_functiondef(v_karma_absolute::oid))
    ) = 0
    or position(
      'net_economy_apply_sheet_karma_absolute_balance_unscoped'
      in lower(pg_get_functiondef(v_karma_absolute::oid))
    ) = 0
  then
    raise exception 'ALTARA_BANK_KARMA_SHEET_PATH_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_trigger as sheet_trigger
    where sheet_trigger.tgrelid = 'public.character_sheet_forms'::regclass
      and sheet_trigger.tgname = 'character_sheet_forms_enforce_economy_cash'
      and not sheet_trigger.tgisinternal
      and sheet_trigger.tgfoid =
        'public.net_economy_enforce_cash_mirror()'::regprocedure
      and pg_get_triggerdef(sheet_trigger.oid) ilike
        '%before insert or update of field_data%'
  ) or not exists (
    select 1
    from pg_trigger as sheet_trigger
    where sheet_trigger.tgrelid = 'public.npc_cards'::regclass
      and sheet_trigger.tgname = 'npc_cards_enforce_economy_cash'
      and not sheet_trigger.tgisinternal
      and sheet_trigger.tgfoid =
        'public.net_economy_enforce_cash_mirror()'::regprocedure
      and pg_get_triggerdef(sheet_trigger.oid) ilike
        '%before insert or update of field_data%'
  ) or not exists (
    select 1
    from pg_trigger as account_trigger
    where account_trigger.tgrelid = 'public.net_economy_accounts'::regclass
      and account_trigger.tgname = 'net_economy_accounts_sync_cash'
      and not account_trigger.tgisinternal
      and account_trigger.tgfoid =
        'public.net_economy_sync_cash_mirror()'::regprocedure
      and pg_get_triggerdef(account_trigger.oid) ilike
        '%after update of balance_amount%'
  ) then
    raise exception 'ALTARA_BANK_SHEET_TRIGGER_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

-- Institution e102 is reserved by this migration. A pre-existing account or
-- the ALTARA code under another UUID is ambiguous live financial state and
-- must be reviewed rather than adopted implicitly.
do $$
begin
  if exists (
    select 1
    from public.net_economy_accounts as account
    where account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
  ) then
    raise exception 'ALTARA_BANK_PREEXISTING_ACCOUNT_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.net_economy_institutions as institution
    where institution.institution_code = 'ALTARA'
      and institution.id <> '00000000-0000-0000-0000-00000000e102'::uuid
  ) then
    raise exception 'ALTARA_BANK_INSTITUTION_CODE_CONFLICT'
      using errcode = '23514';
  end if;
end;
$$;

-- ALTARA BANK has no separate social/app account. App installation and bank
-- account opening remain deliberately separate actions.
insert into public.net_app_account_policies (app_id, account_mode, account_available)
values ('altara-bank', 'none', false)
on conflict (app_id) do update
set
  account_mode = excluded.account_mode,
  account_available = excluded.account_available,
  updated_at = timezone('utc', now());

insert into public.net_economy_institutions (
  id,
  institution_code,
  display_name,
  owner_name,
  status,
  yield_rate_basis_points,
  yield_period,
  maximum_yield_amount
)
values (
  '00000000-0000-0000-0000-00000000e102'::uuid,
  'ALTARA',
  'ALTARA BANK',
  'ALTARA',
  'active',
  0,
  interval '7 days',
  1
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.net_economy_institutions as institution
    where institution.id = '00000000-0000-0000-0000-00000000e102'::uuid
      and institution.institution_code = 'ALTARA'
      and institution.display_name = 'ALTARA BANK'
      and institution.owner_name = 'ALTARA'
      and institution.status = 'active'
      and institution.yield_rate_basis_points = 0
      and institution.yield_period = interval '7 days'
      and institution.maximum_yield_amount = 1
  ) then
    raise exception 'ALTARA_BANK_INSTITUTION_CONFIG_CONFLICT' using errcode = '23514';
  end if;
end;
$$;

-- Preserve the deployed generic bank constraint while making ALTARA's VG-only
-- account shape authoritative against privileged/internal writes too.
create or replace function public.net_economy_enforce_independent_bank_currency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.institution_id in (
    '00000000-0000-0000-0000-00000000e100'::uuid,
    '00000000-0000-0000-0000-00000000e101'::uuid,
    '00000000-0000-0000-0000-00000000e102'::uuid
  ) and (new.account_kind <> 'bank' or new.currency_code <> 'VG') then
    raise exception 'ECONOMY_BANK_CURRENCY_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- The immutable eligibility snapshot prevents a later OS change or later VLT
-- credit from being mistaken for pre-ALTARA historical principal.
create table public.net_economy_altara_bank_adoptions (
  identity_link_id uuid primary key
    references public.net_identity_links (id) on delete restrict,
  source_wallet_account_id uuid not null unique
    references public.net_economy_accounts (id) on delete restrict,
  eligible_amount bigint not null,
  captured_at timestamptz not null default timezone('utc', now()),
  destination_bank_account_id uuid
    references public.net_economy_accounts (id) on delete restrict,
  adoption_transaction_id uuid unique
    references public.net_economy_transactions (id) on delete restrict,
  adopted_at timestamptz,
  constraint net_economy_altara_bank_adoptions_amount_valid check (
    eligible_amount between 0 and 1000000000
  ),
  constraint net_economy_altara_bank_adoptions_completion_valid check (
    (adopted_at is null
      and destination_bank_account_id is null
      and adoption_transaction_id is null)
    or
    (adopted_at is not null
      and destination_bank_account_id is not null
      and (
        (eligible_amount = 0 and adoption_transaction_id is null)
        or (eligible_amount > 0 and adoption_transaction_id is not null)
      ))
  )
);

comment on table public.net_economy_altara_bank_adoptions is
  'Private immutable deployment-time eligibility for one explicit, ledgered transfer of dormant VLT VG into ALTARA BANK. It never follows later OS changes.';

-- Freeze account writes briefly while the deployment-time principal snapshot
-- is captured. No balance is changed here.
lock table public.net_economy_accounts in share row exclusive mode;
lock table public.net_identity_links in share mode;
lock table public.net_identity_os_assignments in share mode;
lock table public.net_os_families in share mode;

do $$
declare
  v_invalid_identity_link_id uuid;
  v_invalid_wallet_id uuid;
  v_invalid_amount bigint;
begin
  select identity_link.id
  into v_invalid_identity_link_id
  from public.net_identity_links as identity_link
  join public.net_identity_os_assignments as assignment
    on assignment.identity_link_id = identity_link.id
    and assignment.primary_os_id = 'altara'
  join public.net_os_families as os_family
    on os_family.id = assignment.primary_os_id
    and os_family.status = 'active'
  where identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
    and (
      select count(*)
      from public.net_economy_accounts as wallet
      where wallet.identity_link_id = identity_link.id
        and wallet.account_kind = 'wallet'
        and wallet.currency_code = 'VG'
        and wallet.status = 'active'
    ) > 1
  order by identity_link.id
  limit 1;

  if v_invalid_identity_link_id is not null then
    raise exception 'ALTARA_BANK_ADOPTION_SOURCE_REVIEW_REQUIRED: identity %',
      v_invalid_identity_link_id using errcode = '23514';
  end if;

  -- A closed zero wallet has no principal to adopt. Any non-active wallet that
  -- still carries VG is ambiguous historical money and must never be silently
  -- omitted from the one-time snapshot.
  select wallet.id
  into v_invalid_wallet_id
  from public.net_identity_links as identity_link
  join public.net_identity_os_assignments as assignment
    on assignment.identity_link_id = identity_link.id
    and assignment.primary_os_id = 'altara'
  join public.net_os_families as os_family
    on os_family.id = assignment.primary_os_id
    and os_family.status = 'active'
  join public.net_economy_accounts as wallet
    on wallet.identity_link_id = identity_link.id
    and wallet.account_kind = 'wallet'
    and wallet.currency_code = 'VG'
    and wallet.status <> 'active'
    and wallet.balance_amount <> 0
  where identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  order by wallet.id
  limit 1;

  if v_invalid_wallet_id is not null then
    raise exception 'ALTARA_BANK_INACTIVE_SOURCE_BALANCE_REVIEW_REQUIRED: wallet %',
      v_invalid_wallet_id using errcode = '23514';
  end if;

  select wallet.balance_amount
  into v_invalid_amount
  from public.net_identity_links as identity_link
  join public.net_identity_os_assignments as assignment
    on assignment.identity_link_id = identity_link.id
    and assignment.primary_os_id = 'altara'
  join public.net_os_families as os_family
    on os_family.id = assignment.primary_os_id
    and os_family.status = 'active'
  join public.net_economy_accounts as wallet
    on wallet.identity_link_id = identity_link.id
    and wallet.account_kind = 'wallet'
    and wallet.currency_code = 'VG'
    and wallet.status = 'active'
  where identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
    and wallet.balance_amount > 1000000000
  order by wallet.balance_amount desc
  limit 1;

  if v_invalid_amount is not null then
    raise exception 'ALTARA_BANK_ADOPTION_AMOUNT_REVIEW_REQUIRED: %',
      v_invalid_amount using errcode = '22003';
  end if;

  select wallet.id
  into v_invalid_wallet_id
  from public.net_identity_links as identity_link
  join public.net_identity_os_assignments as assignment
    on assignment.identity_link_id = identity_link.id
    and assignment.primary_os_id = 'altara'
  join public.net_os_families as os_family
    on os_family.id = assignment.primary_os_id
    and os_family.status = 'active'
  join public.net_economy_accounts as wallet
    on wallet.identity_link_id = identity_link.id
    and wallet.account_kind = 'wallet'
    and wallet.currency_code = 'VG'
    and wallet.status = 'active'
  left join public.net_economy_transaction_entries as entry
    on entry.account_id = wallet.id
  where identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  group by wallet.id, wallet.balance_amount
  having coalesce(sum(entry.amount), 0) <> wallet.balance_amount
  order by wallet.id
  limit 1;

  if v_invalid_wallet_id is not null then
    raise exception 'ALTARA_BANK_ADOPTION_LEDGER_RECONCILIATION_REQUIRED: wallet %',
      v_invalid_wallet_id using errcode = '23514';
  end if;
end;
$$;

insert into public.net_economy_altara_bank_adoptions (
  identity_link_id,
  source_wallet_account_id,
  eligible_amount
)
select
  identity_link.id,
  wallet.id,
  wallet.balance_amount
from public.net_identity_links as identity_link
join public.net_identity_os_assignments as assignment
  on assignment.identity_link_id = identity_link.id
  and assignment.primary_os_id = 'altara'
join public.net_os_families as os_family
  on os_family.id = assignment.primary_os_id
  and os_family.status = 'active'
join public.net_economy_accounts as wallet
  on wallet.identity_link_id = identity_link.id
  and wallet.account_kind = 'wallet'
  and wallet.currency_code = 'VG'
  and wallet.status = 'active'
where identity_link.identity_kind = 'player'
  and identity_link.playability = 'playable'
on conflict (identity_link_id) do nothing;

-- Personal ALTARA BANK authority is deliberately narrower than identity
-- capability. It allows a normal owner or GM TAKE CONTROL of a player/playable
-- identity, never GM System and never NPC ACT AS. The optional app must also be
-- installed, but a stale install can never override the service/OS assertion.
create or replace function public.net_economy_assert_altara_bank_player_context(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_identity_link_id uuid;
begin
  if v_actor is null then
    raise exception 'ALTARA_BANK_AUTH_REQUIRED' using errcode = '42501';
  end if;

  select profile.role::text
  into v_role
  from public.profiles as profile
  where profile.id = v_actor;

  if not found then
    raise exception 'ALTARA_BANK_AUTH_REQUIRED' using errcode = '42501';
  end if;

  if v_role = 'gm' then
    select identity_link.id
    into v_identity_link_id
    from public.net_gm_persona_sessions as gm_session
    join public.net_identity_links as identity_link
      on identity_link.subject_kind = gm_session.subject_kind
      and identity_link.subject_id = gm_session.subject_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
    where gm_session.gm_profile_id = v_actor
      and gm_session.mode = 'take-control';
  else
    select identity_link.id
    into v_identity_link_id
    from public.net_active_identities as active_identity
    join public.net_identity_links as identity_link
      on identity_link.id = active_identity.identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
    where active_identity.profile_id = v_actor
      and public.current_user_controls_playable_net_identity_link(identity_link.id);
  end if;

  if v_identity_link_id is null then
    raise exception 'ALTARA_BANK_PERSONAL_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  if requested_expected_identity_link_id is null
    or requested_expected_identity_link_id <> v_identity_link_id
  then
    raise exception 'ALTARA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;

  perform public.assert_net_identity_service_access(
    v_identity_link_id,
    'altara-bank'
  );

  if not exists (
    select 1
    from public.net_identity_app_installs as install
    where install.identity_link_id = v_identity_link_id
      and install.app_id = 'altara-bank'
  ) then
    raise exception 'ALTARA_BANK_APP_NOT_INSTALLED' using errcode = '42501';
  end if;

  return v_identity_link_id;
end;
$$;

create or replace function public.net_economy_audit_altara_bank_personal_action(
  requested_identity_link_id uuid,
  requested_action_type text,
  requested_resource_type text,
  requested_resource_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_link public.net_identity_links%rowtype;
  v_action_mode text;
  v_authorization_basis text;
begin
  select profile.role::text
  into v_role
  from public.profiles as profile
  where profile.id = v_actor;

  select *
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if v_actor is null or v_link.id is null then
    raise exception 'ALTARA_BANK_AUDIT_CONTEXT_INVALID' using errcode = '42501';
  end if;

  if v_role = 'gm' then
    if not exists (
      select 1
      from public.net_gm_persona_sessions as gm_session
      where gm_session.gm_profile_id = v_actor
        and gm_session.mode = 'take-control'
        and gm_session.subject_kind = v_link.subject_kind
        and gm_session.subject_id = v_link.subject_id
    ) then
      raise exception 'ALTARA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
    end if;
    v_action_mode := 'gm-persona';
    v_authorization_basis := 'authoritative-gm-take-control-player';
  else
    if not exists (
      select 1
      from public.net_active_identities as active_identity
      where active_identity.profile_id = v_actor
        and active_identity.identity_link_id = v_link.id
    ) or not public.current_user_controls_playable_net_identity_link(v_link.id)
    then
      raise exception 'ALTARA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
    end if;
    v_action_mode := 'owner';
    v_authorization_basis := 'controlled-active-identity';
  end if;

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
    null,
    case when v_role = 'gm' then v_link.subject_kind else null end,
    case when v_role = 'gm' then v_link.subject_id else null end,
    v_action_mode,
    requested_action_type,
    v_authorization_basis,
    requested_resource_type,
    requested_resource_id
  );
end;
$$;

-- Serialize every authority row which can invalidate a personal bank action.
-- Callers take account locks first, then use this stable identity-UUID order,
-- matching payment/open lock order. Capability never substitutes for control.
create or replace function public.net_economy_lock_altara_bank_authority(
  requested_sender_identity_link_id uuid,
  requested_recipient_identity_link_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_locked_identity_count integer;
  v_expected_identity_count integer;
begin
  if v_actor is null then
    raise exception 'ALTARA_BANK_AUTH_REQUIRED' using errcode = '42501';
  end if;

  perform 1
  from public.net_identity_links as identity_link
  where identity_link.id in (
    requested_sender_identity_link_id,
    requested_recipient_identity_link_id
  )
  order by identity_link.id
  for share;
  get diagnostics v_locked_identity_count = row_count;

  v_expected_identity_count := case
    when requested_recipient_identity_link_id is null
      or requested_recipient_identity_link_id = requested_sender_identity_link_id
    then 1
    else 2
  end;

  if v_locked_identity_count <> v_expected_identity_count then
    raise exception 'ALTARA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;

  perform 1
  from public.net_identity_os_assignments as assignment
  where assignment.identity_link_id in (
    requested_sender_identity_link_id,
    requested_recipient_identity_link_id
  )
  order by assignment.identity_link_id
  for share;

  perform 1
  from public.net_os_families as os_family
  join public.net_identity_os_assignments as assignment
    on assignment.primary_os_id = os_family.id
  where assignment.identity_link_id in (
    requested_sender_identity_link_id,
    requested_recipient_identity_link_id
  )
  order by os_family.id
  for share of os_family;

  perform 1
  from public.net_os_service_scopes as service_scope
  where service_scope.service_id = 'altara-bank'
  for share;

  perform 1
  from public.net_economy_institutions as institution
  where institution.id = '00000000-0000-0000-0000-00000000e102'::uuid
    and institution.institution_code = 'ALTARA'
    and institution.status = 'active'
  for share;
  if not found then
    raise exception 'ALTARA_BANK_INSTITUTION_UNAVAILABLE' using errcode = '55000';
  end if;

  -- The sender install is part of personal authority. A recipient need not
  -- keep the launcher installed to receive into an existing active account.
  perform 1
  from public.net_identity_app_installs as install
  where install.identity_link_id = requested_sender_identity_link_id
    and install.app_id = 'altara-bank'
  for share;

  perform 1
  from public.profiles as profile
  where profile.id = v_actor
  for share;

  select profile.role::text
  into v_role
  from public.profiles as profile
  where profile.id = v_actor;

  if v_role = 'gm' then
    perform 1
    from public.net_gm_persona_sessions as gm_session
    where gm_session.gm_profile_id = v_actor
    for share;
  else
    perform 1
    from public.net_active_identities as active_identity
    where active_identity.profile_id = v_actor
    for share;
  end if;
end;
$$;

create or replace function public.net_economy_altara_bank_history_page(
  requested_account_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with settings as (
    select least(greatest(coalesce(requested_limit, 20), 1), 40) as page_limit
  ), page as (
    select
      entry.transaction_id,
      entry.amount,
      transaction_record.transaction_kind,
      transaction_record.note,
      entry.created_at,
      counterparty.payment_identifier as counterparty_payment_identifier,
      counterparty.display_name as counterparty_display_name
    from public.net_economy_transaction_entries as entry
    join public.net_economy_transactions as transaction_record
      on transaction_record.id = entry.transaction_id
    left join lateral (
      select
        other_account.payment_identifier,
        public.net_economy_identity_display_name(other_account.identity_link_id) as display_name
      from public.net_economy_transaction_entries as other_entry
      join public.net_economy_accounts as other_account
        on other_account.id = other_entry.account_id
      where transaction_record.transaction_kind = 'bank-transfer'
        and other_entry.transaction_id = entry.transaction_id
        and other_entry.account_id <> requested_account_id
        and other_account.account_kind = 'bank'
        and other_account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
        and other_account.currency_code = 'VG'
      limit 1
    ) as counterparty on true
    cross join settings
    where entry.account_id = requested_account_id
      and transaction_record.currency_code = 'VG'
      and transaction_record.transaction_kind in (
        'bank-deposit', 'bank-transfer', 'gm-credit', 'gm-debit'
      )
      and (
        requested_cursor_at is null
        or (entry.created_at, entry.transaction_id)
          < (requested_cursor_at, requested_cursor_id)
      )
    order by entry.created_at desc, entry.transaction_id desc
    limit (select page_limit + 1 from settings)
  ), trimmed as (
    select *
    from page
    order by created_at desc, transaction_id desc
    limit (select page_limit from settings)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'transaction_id', trimmed.transaction_id,
          'amount', trimmed.amount,
          'direction', case when trimmed.amount > 0 then 'incoming' else 'outgoing' end,
          'transaction_kind', trimmed.transaction_kind,
          'counterparty_payment_identifier', trimmed.counterparty_payment_identifier,
          'counterparty_display_name', trimmed.counterparty_display_name,
          'note', trimmed.note,
          'created_at', trimmed.created_at
        ) order by trimmed.created_at desc, trimmed.transaction_id desc
      ) from trimmed
    ), '[]'::jsonb),
    'has_more', (select count(*) from page) > (select page_limit from settings),
    'next_cursor_at', (
      select trimmed.created_at from trimmed
      order by trimmed.created_at asc, trimmed.transaction_id asc limit 1
    ),
    'next_cursor_id', (
      select trimmed.transaction_id from trimmed
      order by trimmed.created_at asc, trimmed.transaction_id asc limit 1
    )
  );
$$;

create or replace function public.net_economy_altara_bank_payload(
  requested_identity_link_id uuid,
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
declare
  v_link public.net_identity_links%rowtype;
  v_institution public.net_economy_institutions%rowtype;
  v_bank public.net_economy_accounts%rowtype;
  v_adoption public.net_economy_altara_bank_adoptions%rowtype;
  v_empty_activity jsonb := jsonb_build_object(
    'items', '[]'::jsonb,
    'has_more', false,
    'next_cursor_at', null,
    'next_cursor_id', null
  );
begin
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'ECONOMY_CURSOR_INVALID' using errcode = '22023';
  end if;

  select * into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';
  if not found then
    raise exception 'ALTARA_BANK_PERSONAL_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  select * into v_institution
  from public.net_economy_institutions as institution
  where institution.id = '00000000-0000-0000-0000-00000000e102'::uuid
    and institution.institution_code = 'ALTARA';
  if not found then
    raise exception 'ALTARA_BANK_INSTITUTION_UNAVAILABLE' using errcode = '55000';
  end if;

  select * into v_bank
  from public.net_economy_accounts as account
  where account.identity_link_id = v_link.id
    and account.account_kind = 'bank'
    and account.institution_id = v_institution.id
    and account.currency_code = 'VG';

  select * into v_adoption
  from public.net_economy_altara_bank_adoptions as adoption
  where adoption.identity_link_id = v_link.id;

  return jsonb_build_object(
    'server_now', timezone('utc', clock_timestamp()),
    'identity', jsonb_build_object(
      'identity_link_id', v_link.id,
      'display_name', public.net_economy_identity_display_name(v_link.id)
    ),
    'institution', jsonb_build_object(
      'institution_code', v_institution.institution_code,
      'display_name', v_institution.display_name,
      'owner_name', v_institution.owner_name,
      'status', v_institution.status
    ),
    'bank', case when v_bank.id is null then null else jsonb_build_object(
      'account_id', v_bank.id,
      'payment_identifier', v_bank.payment_identifier,
      'balance_amount', v_bank.balance_amount,
      'currency_code', v_bank.currency_code,
      'status', v_bank.status,
      'opened_at', v_bank.created_at,
      'updated_at', v_bank.updated_at
    ) end,
    'historical_adoption', case when v_adoption.identity_link_id is null then
      jsonb_build_object(
        'eligible_amount', 0,
        'adopted', true,
        'adopted_at', null
      )
    else jsonb_build_object(
      'eligible_amount', v_adoption.eligible_amount,
      'adopted', v_adoption.adopted_at is not null,
      'adopted_at', v_adoption.adopted_at
    ) end,
    'activity', case when v_bank.id is null then v_empty_activity else
      public.net_economy_altara_bank_history_page(
        v_bank.id,
        requested_cursor_at,
        requested_cursor_id,
        requested_limit
      )
    end
  );
end;
$$;

-- Central CASH mirror selection: VEIL reads its VLT VG wallet; ALTARA reads
-- ALTARA BANK if one exists. No account means the neutral em dash.
create or replace function public.net_economy_sync_identity_cash_mirror(
  requested_identity_link_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.net_identity_links%rowtype;
  v_primary_os_id text;
  v_account public.net_economy_accounts%rowtype;
  v_display text := '—';
  v_previous_origin text := current_setting('app.net_economy_origin', true);
begin
  select identity_link.*
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if not found then
    return;
  end if;

  select assignment.primary_os_id
  into v_primary_os_id
  from public.net_identity_os_assignments as assignment
  where assignment.identity_link_id = v_link.id;

  if v_primary_os_id = 'veil' then
    select * into v_account
    from public.net_economy_accounts as account
    where account.identity_link_id = v_link.id
      and account.account_kind = 'wallet'
      and account.currency_code = 'VG';
  elsif v_primary_os_id = 'altara' then
    select * into v_account
    from public.net_economy_accounts as account
    where account.identity_link_id = v_link.id
      and account.account_kind = 'bank'
      and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
      and account.currency_code = 'VG'
      and account.status = 'active';
  end if;

  if v_account.id is not null then
    v_display := public.net_economy_cash_display(v_account.balance_amount);
  end if;

  perform set_config('app.net_economy_origin', 'economy-mirror', true);
  begin
    if v_link.subject_kind = 'profile-sheet' then
      update public.character_sheet_forms as sheet
      set field_data = jsonb_set(
        coalesce(sheet.field_data, '{}'::jsonb),
        '{CASH}', to_jsonb(v_display), true
      )
      where sheet.profile_id = v_link.subject_id
        and sheet.field_data ->> 'CASH' is distinct from v_display;
    elsif v_link.subject_kind = 'npc-card' then
      update public.npc_cards as card
      set field_data = jsonb_set(
        coalesce(card.field_data, '{}'::jsonb),
        '{CASH}', to_jsonb(v_display), true
      )
      where card.id = v_link.subject_id
        and card.field_data ->> 'CASH' is distinct from v_display;
    end if;
  exception
    when others then
      perform set_config('app.net_economy_origin', coalesce(v_previous_origin, ''), true);
      raise;
  end;
  perform set_config('app.net_economy_origin', coalesce(v_previous_origin, ''), true);
end;
$$;

-- OS changes switch which preserved account is presented as CASH. They never
-- move funds, but the stored read-only mirror must reconcile immediately.
create or replace function public.net_economy_sync_cash_mirror_on_os_assignment()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  if tg_op = 'DELETE' then
    v_identity_link_id := old.identity_link_id;
  else
    v_identity_link_id := new.identity_link_id;
  end if;

  if tg_op = 'UPDATE' then
    if new.primary_os_id is not distinct from old.primary_os_id then
      return new;
    end if;
  end if;

  perform public.net_economy_sync_identity_cash_mirror(v_identity_link_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists net_economy_os_assignment_sync_cash_mirror
  on public.net_identity_os_assignments;
create trigger net_economy_os_assignment_sync_cash_mirror
after insert or update or delete on public.net_identity_os_assignments
for each row execute procedure public.net_economy_sync_cash_mirror_on_os_assignment();

create or replace function public.net_economy_open_altara_bank_for_link(
  requested_identity_link_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_institution public.net_economy_institutions%rowtype;
  v_bank public.net_economy_accounts%rowtype;
  v_source public.net_economy_accounts%rowtype;
  v_adoption public.net_economy_altara_bank_adoptions%rowtype;
  v_existing public.net_economy_transactions%rowtype;
  v_transaction public.net_economy_transactions%rowtype;
  v_created boolean := false;
  v_identifier text;
  v_fingerprint text;
begin
  perform public.assert_net_identity_service_access(
    requested_identity_link_id,
    'altara-bank'
  );

  select * into v_institution
  from public.net_economy_institutions as institution
  where institution.id = '00000000-0000-0000-0000-00000000e102'::uuid
    and institution.institution_code = 'ALTARA'
    and institution.status = 'active';
  if not found then
    raise exception 'ALTARA_BANK_INSTITUTION_UNAVAILABLE' using errcode = '55000';
  end if;

  select * into v_bank
  from public.net_economy_accounts as account
  where account.identity_link_id = requested_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = v_institution.id
    and account.currency_code = 'VG';

  if not found then
    -- The public identifier is an opaque random 96-bit token, stored once. It
    -- cannot be reversed into the identity-link UUID; concurrent opens select
    -- the account that won the unique identity/institution constraint.
    v_identifier := 'altara-' || left(
      replace(gen_random_uuid()::text, '-', ''),
      24
    );
    insert into public.net_economy_accounts (
      identity_link_id,
      account_kind,
      institution_id,
      payment_identifier,
      currency_code,
      status,
      balance_amount
    ) values (
      requested_identity_link_id,
      'bank',
      v_institution.id,
      v_identifier,
      'VG',
      'active',
      0
    )
    on conflict do nothing
    returning * into v_bank;

    if v_bank.id is null then
      select * into v_bank
      from public.net_economy_accounts as account
      where account.identity_link_id = requested_identity_link_id
        and account.account_kind = 'bank'
        and account.institution_id = v_institution.id
        and account.currency_code = 'VG'
        and account.status = 'active';
      if not found then
        raise exception 'ALTARA_BANK_ACCOUNT_UNAVAILABLE' using errcode = '55000';
      end if;
    else
      v_created := true;
    end if;
  end if;

  if v_bank.status <> 'active' then
    raise exception 'ALTARA_BANK_ACCOUNT_INACTIVE' using errcode = '22023';
  end if;

  insert into public.net_economy_wallet_realtime_state (account_id)
  values (v_bank.id)
  on conflict (account_id) do nothing;

  select * into v_adoption
  from public.net_economy_altara_bank_adoptions as adoption
  where adoption.identity_link_id = requested_identity_link_id;

  if v_adoption.identity_link_id is not null and v_adoption.adopted_at is null then
    perform 1
    from public.net_economy_accounts as account
    where account.id in (v_adoption.source_wallet_account_id, v_bank.id)
    order by account.id
    for update;

    select * into v_adoption
    from public.net_economy_altara_bank_adoptions as adoption
    where adoption.identity_link_id = requested_identity_link_id
    for update;

    perform public.net_economy_lock_altara_bank_authority(
      requested_identity_link_id,
      null
    );
    perform public.net_economy_assert_altara_bank_player_context(
      requested_identity_link_id
    );

    -- A concurrent exact open may have completed adoption while this call was
    -- waiting for the deterministic account locks. In that case the operation
    -- is already complete and this call simply returns the canonical payload.
    if v_adoption.adopted_at is null then
      select * into v_source
      from public.net_economy_accounts as account
      where account.id = v_adoption.source_wallet_account_id
        and account.identity_link_id = requested_identity_link_id
        and account.account_kind = 'wallet'
        and account.currency_code = 'VG'
        and account.status = 'active';
      select * into v_bank
      from public.net_economy_accounts as account
      where account.id = v_bank.id
        and account.identity_link_id = requested_identity_link_id
        and account.account_kind = 'bank'
        and account.institution_id = v_institution.id
        and account.currency_code = 'VG'
        and account.status = 'active';

      if v_source.id is null or v_bank.id is null then
        raise exception 'ALTARA_BANK_ADOPTION_ACCOUNT_MISMATCH' using errcode = '23514';
      end if;

      -- Move exactly the deployment snapshot. Later VLT credits stay dormant
      -- and are not duplicated into ALTARA BANK; a later debit that consumed
      -- any captured principal fails closed for manual review.
      if v_source.balance_amount < v_adoption.eligible_amount then
        raise exception 'ALTARA_BANK_ADOPTION_BALANCE_BELOW_SNAPSHOT' using errcode = '40001';
      end if;

      if v_adoption.eligible_amount > 0 then
        v_fingerprint := md5(
          requested_identity_link_id::text || ':'
          || v_source.id::text || ':' || v_bank.id::text || ':'
          || v_adoption.eligible_amount::text
        );

        select * into v_existing
        from public.net_economy_transactions as transaction_record
        where transaction_record.request_scope = 'altara-bank-adoption'
          and transaction_record.request_key = requested_identity_link_id;

        if found then
          raise exception 'ALTARA_BANK_ADOPTION_STATE_INCONSISTENT' using errcode = '23514';
        end if;

        insert into public.net_economy_transactions (
          transaction_kind,
          initiated_by_profile_id,
          request_scope,
          request_key,
          request_fingerprint,
          note,
          currency_code
        ) values (
          'bank-deposit',
          v_actor,
          'altara-bank-adoption',
          requested_identity_link_id,
          v_fingerprint,
          'Historical VLT adoption',
          'VG'
        ) returning * into v_transaction;

        insert into public.net_economy_transaction_entries (
          transaction_id,
          account_id,
          amount,
          created_at
        ) values
          (v_transaction.id, v_source.id, -v_adoption.eligible_amount, v_transaction.created_at),
          (v_transaction.id, v_bank.id, v_adoption.eligible_amount, v_transaction.created_at);

        update public.net_economy_accounts as account
        set balance_amount = account.balance_amount - v_adoption.eligible_amount
        where account.id = v_source.id;
        update public.net_economy_accounts as account
        set balance_amount = account.balance_amount + v_adoption.eligible_amount
        where account.id = v_bank.id;

        update public.net_economy_altara_bank_adoptions as adoption
        set
          destination_bank_account_id = v_bank.id,
          adoption_transaction_id = v_transaction.id,
          adopted_at = v_transaction.created_at
        where adoption.identity_link_id = requested_identity_link_id;

        perform public.net_economy_audit_altara_bank_personal_action(
          requested_identity_link_id,
          'economy.altara-bank.adopt-vlt',
          'economy-transaction',
          v_transaction.id
        );
      else
        update public.net_economy_altara_bank_adoptions as adoption
        set
          destination_bank_account_id = v_bank.id,
          adoption_transaction_id = null,
          adopted_at = timezone('utc', clock_timestamp())
        where adoption.identity_link_id = requested_identity_link_id;
      end if;
    end if;
  else
    -- Even an ordinary zero-balance open/fetch-after-open must finish under
    -- the same locked actor/OS/install context that authorized it.
    perform 1
    from public.net_economy_accounts as account
    where account.id = v_bank.id
    for update;

    perform public.net_economy_lock_altara_bank_authority(
      requested_identity_link_id,
      null
    );
    perform public.net_economy_assert_altara_bank_player_context(
      requested_identity_link_id
    );

    select * into v_bank
    from public.net_economy_accounts as account
    where account.id = v_bank.id
      and account.identity_link_id = requested_identity_link_id
      and account.account_kind = 'bank'
      and account.institution_id = v_institution.id
      and account.currency_code = 'VG'
      and account.status = 'active';
    if v_bank.id is null then
      raise exception 'ALTARA_BANK_ACCOUNT_UNAVAILABLE' using errcode = '55000';
    end if;
  end if;

  if v_created then
    perform public.net_economy_audit_altara_bank_personal_action(
      requested_identity_link_id,
      'economy.altara-bank.open',
      'economy-account',
      v_bank.id
    );
  end if;

  perform public.net_economy_sync_identity_cash_mirror(requested_identity_link_id);

  return public.net_economy_altara_bank_payload(
    requested_identity_link_id,
    null,
    null,
    20
  );
end;
$$;

create or replace function public.fetch_net_economy_altara_bank(
  requested_expected_identity_link_id uuid,
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
declare
  v_identity_link_id uuid;
begin
  v_identity_link_id := public.net_economy_assert_altara_bank_player_context(
    requested_expected_identity_link_id
  );
  perform public.net_economy_lock_altara_bank_authority(
    v_identity_link_id,
    null
  );
  perform public.net_economy_assert_altara_bank_player_context(
    requested_expected_identity_link_id
  );
  return public.net_economy_altara_bank_payload(
    v_identity_link_id,
    requested_cursor_at,
    requested_cursor_id,
    requested_limit
  );
end;
$$;

create or replace function public.open_net_economy_altara_bank(
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
begin
  v_identity_link_id := public.net_economy_assert_altara_bank_player_context(
    requested_expected_identity_link_id
  );
  return public.net_economy_open_altara_bank_for_link(v_identity_link_id);
end;
$$;

create or replace function public.search_net_economy_altara_bank_payees(
  requested_expected_identity_link_id uuid,
  requested_query text,
  requested_limit integer default 12
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_source_account_id uuid;
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := least(greatest(coalesce(requested_limit, 12), 1), 20);
begin
  v_identity_link_id := public.net_economy_assert_altara_bank_player_context(
    requested_expected_identity_link_id
  );
  perform public.net_economy_lock_altara_bank_authority(
    v_identity_link_id,
    null
  );
  perform public.net_economy_assert_altara_bank_player_context(
    requested_expected_identity_link_id
  );

  if char_length(v_query) < 2 or char_length(v_query) > 80 then
    return '[]'::jsonb;
  end if;
  if left(v_query, 1) = '@' then
    v_query := substr(v_query, 2);
  end if;

  select account.id into v_source_account_id
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and account.currency_code = 'VG'
    and account.status = 'active';
  if not found then
    raise exception 'ALTARA_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'display_name', directory.display_name,
        'payment_identifier', directory.payment_identifier
      ) order by directory.display_name, directory.payment_identifier
    )
    from (
      select
        public.net_economy_identity_display_name(account.identity_link_id) as display_name,
        account.payment_identifier
      from public.net_economy_accounts as account
      join public.net_identity_links as identity_link
        on identity_link.id = account.identity_link_id
        and identity_link.identity_kind = 'player'
        and identity_link.playability = 'playable'
      where account.account_kind = 'bank'
        and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
        and account.currency_code = 'VG'
        and account.status = 'active'
        and account.id <> v_source_account_id
        and public.net_identity_link_can_access_service(
          account.identity_link_id,
          'altara-bank'
        )
        and (
          lower(public.net_economy_identity_display_name(account.identity_link_id))
            like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
          or account.payment_identifier
            like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
        )
      order by display_name, account.payment_identifier
      limit v_limit
    ) as directory
  ), '[]'::jsonb);
end;
$$;

create or replace function public.transfer_net_economy_altara_bank_payment(
  requested_expected_identity_link_id uuid,
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
declare
  v_actor uuid := auth.uid();
  v_identity_link_id uuid;
  v_identifier text := lower(btrim(coalesce(requested_payment_identifier, '')));
  v_sender public.net_economy_accounts%rowtype;
  v_recipient public.net_economy_accounts%rowtype;
  v_existing public.net_economy_transactions%rowtype;
  v_transaction public.net_economy_transactions%rowtype;
  v_scope text;
  v_fingerprint text;
begin
  v_identity_link_id := public.net_economy_assert_altara_bank_player_context(
    requested_expected_identity_link_id
  );

  if left(v_identifier, 1) = '@' then
    v_identifier := substr(v_identifier, 2);
  end if;
  if v_identifier = '' or char_length(v_identifier) > 40 then
    raise exception 'ALTARA_BANK_PAYEE_REQUIRED' using errcode = '22023';
  end if;
  if requested_amount is null or requested_amount < 1 or requested_amount > 1000000000 then
    raise exception 'ECONOMY_AMOUNT_INVALID' using errcode = '22023';
  end if;
  if requested_request_key is null then
    raise exception 'ECONOMY_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;

  select * into v_sender
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and account.currency_code = 'VG';
  if not found then
    raise exception 'ALTARA_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;

  -- Resolve the stable public recipient account first so an exact idempotent
  -- retry can return its original result even if the recipient later becomes
  -- inactive. New transfers perform the eligibility checks below.
  select * into v_recipient
  from public.net_economy_accounts as account
  where account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and account.currency_code = 'VG'
    and account.payment_identifier = v_identifier;
  if not found then
    raise exception 'ALTARA_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;
  if v_recipient.id = v_sender.id then
    raise exception 'ECONOMY_SELF_TRANSFER_INVALID' using errcode = '22023';
  end if;

  -- All same-bank products share the actor-wide request namespace. The
  -- institution is part of the fingerprint, so reusing a request UUID across
  -- VOX, SHNEIDER, or ALTARA conflicts instead of creating another payment.
  v_scope := 'bank-pay:' || v_actor::text;
  v_fingerprint := md5(
    v_identity_link_id::text || ':'
    || '00000000-0000-0000-0000-00000000e102'::uuid::text || ':'
    || v_sender.id::text || ':'
    || v_recipient.id::text || ':' || requested_amount::text
  );

  select * into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;
  if found then
    if v_existing.transaction_kind <> 'bank-transfer'
      or v_existing.currency_code <> 'VG'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.net_economy_altara_bank_payload(v_identity_link_id, null, null, 20);
  end if;

  if v_recipient.status <> 'active'
    or not exists (
      select 1
      from public.net_identity_links as identity_link
      where identity_link.id = v_recipient.identity_link_id
        and identity_link.identity_kind = 'player'
        and identity_link.playability = 'playable'
    )
    or not public.net_identity_link_can_access_service(
      v_recipient.identity_link_id,
      'altara-bank'
    )
  then
    raise exception 'ALTARA_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;

  perform 1
  from public.net_economy_accounts as account
  where account.id in (v_sender.id, v_recipient.id)
  order by account.id
  for update;

  select * into v_sender
  from public.net_economy_accounts as account
  where account.id = v_sender.id;
  select * into v_recipient
  from public.net_economy_accounts as account
  where account.id = v_recipient.id;

  if v_sender.identity_link_id <> v_identity_link_id
    or v_sender.account_kind <> 'bank'
    or v_sender.institution_id <> '00000000-0000-0000-0000-00000000e102'::uuid
    or v_sender.currency_code <> 'VG'
  then
    raise exception 'ALTARA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;
  if v_recipient.account_kind <> 'bank'
    or v_recipient.institution_id <> '00000000-0000-0000-0000-00000000e102'::uuid
    or v_recipient.currency_code <> 'VG'
    or v_recipient.payment_identifier <> v_identifier
  then
    raise exception 'ALTARA_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;

  -- Control/active-identity, OS scope, and install state may have changed while
  -- this request waited for account locks. Rebind before any ledger mutation.
  perform public.net_economy_lock_altara_bank_authority(
    v_identity_link_id,
    v_recipient.identity_link_id
  );
  perform public.net_economy_assert_altara_bank_player_context(
    requested_expected_identity_link_id
  );

  select * into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;
  if found then
    if v_existing.transaction_kind <> 'bank-transfer'
      or v_existing.currency_code <> 'VG'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.net_economy_altara_bank_payload(v_identity_link_id, null, null, 20);
  end if;

  if v_sender.status <> 'active' or v_recipient.status <> 'active' then
    raise exception 'ALTARA_BANK_ACCOUNT_INACTIVE' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.net_identity_links as identity_link
    where identity_link.id = v_recipient.identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
  ) or not public.net_identity_link_can_access_service(
      v_recipient.identity_link_id,
      'altara-bank'
    )
  then
    raise exception 'ALTARA_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;
  if v_sender.balance_amount < requested_amount then
    raise exception 'ECONOMY_BANK_INSUFFICIENT_FUNDS' using errcode = '22023';
  end if;

  insert into public.net_economy_transactions (
    transaction_kind,
    initiated_by_profile_id,
    request_scope,
    request_key,
    request_fingerprint,
    note,
    currency_code
  ) values (
    'bank-transfer',
    v_actor,
    v_scope,
    requested_request_key,
    v_fingerprint,
    null,
    'VG'
  )
  on conflict (request_scope, request_key) do nothing
  returning * into v_transaction;

  if v_transaction.id is null then
    select * into v_existing
    from public.net_economy_transactions as transaction_record
    where transaction_record.request_scope = v_scope
      and transaction_record.request_key = requested_request_key;
    if not found
      or v_existing.transaction_kind <> 'bank-transfer'
      or v_existing.currency_code <> 'VG'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.net_economy_altara_bank_payload(v_identity_link_id, null, null, 20);
  end if;

  insert into public.net_economy_transaction_entries (
    transaction_id,
    account_id,
    amount,
    created_at
  ) values
    (v_transaction.id, v_sender.id, -requested_amount, v_transaction.created_at),
    (v_transaction.id, v_recipient.id, requested_amount, v_transaction.created_at);

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount - requested_amount
  where account.id = v_sender.id;
  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount + requested_amount
  where account.id = v_recipient.id;

  perform public.net_economy_audit_altara_bank_personal_action(
    v_identity_link_id,
    'economy.altara-bank.transfer',
    'economy-transaction',
    v_transaction.id
  );

  return public.net_economy_altara_bank_payload(v_identity_link_id, null, null, 20);
end;
$$;

create or replace function public.fetch_net_economy_gm_altara_bank_directory(
  requested_query text default null,
  requested_limit integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := least(greatest(coalesce(requested_limit, 40), 1), 60);
begin
  perform public.assert_net_economy_gm();
  if char_length(v_query) > 80 then
    raise exception 'ECONOMY_DIRECTORY_QUERY_INVALID' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'account_id', directory.account_id,
        'identity_link_id', directory.identity_link_id,
        'display_name', directory.display_name,
        'payment_identifier', directory.payment_identifier,
        'balance_amount', directory.balance_amount,
        'status', directory.status,
        'service_available', directory.service_available,
        'opened_at', directory.opened_at,
        'updated_at', directory.updated_at
      ) order by directory.display_name, directory.payment_identifier
    )
    from (
      select
        account.id as account_id,
        account.identity_link_id,
        public.net_economy_identity_display_name(account.identity_link_id) as display_name,
        account.payment_identifier,
        account.balance_amount,
        account.status,
        public.net_identity_link_can_access_service(
          account.identity_link_id,
          'altara-bank'
        ) as service_available,
        account.created_at as opened_at,
        account.updated_at
      from public.net_economy_accounts as account
      join public.net_identity_links as identity_link
        on identity_link.id = account.identity_link_id
        and identity_link.identity_kind = 'player'
        and identity_link.playability = 'playable'
      where account.account_kind = 'bank'
        and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
        and account.currency_code = 'VG'
        and (
          v_query = ''
          or account.payment_identifier
            like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
          or lower(public.net_economy_identity_display_name(account.identity_link_id))
            like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
        )
      order by display_name, account.payment_identifier
      limit v_limit
    ) as directory
  ), '[]'::jsonb);
end;
$$;

create or replace function public.fetch_net_economy_gm_altara_bank(
  requested_payment_identifier text,
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
declare
  v_identifier text := lower(btrim(coalesce(requested_payment_identifier, '')));
  v_identity_link_id uuid;
begin
  perform public.assert_net_economy_gm();
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'ECONOMY_CURSOR_INVALID' using errcode = '22023';
  end if;

  select account.identity_link_id
  into v_identity_link_id
  from public.net_economy_accounts as account
  where account.payment_identifier = v_identifier
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and account.currency_code = 'VG';
  if not found then
    raise exception 'ALTARA_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;

  return public.net_economy_altara_bank_payload(
    v_identity_link_id,
    requested_cursor_at,
    requested_cursor_id,
    requested_limit
  );
end;
$$;

create or replace function public.adjust_net_economy_gm_altara_bank(
  requested_payment_identifier text,
  requested_action text,
  requested_amount bigint,
  requested_reason text,
  requested_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_identifier text := lower(btrim(coalesce(requested_payment_identifier, '')));
  v_action text := lower(btrim(coalesce(requested_action, '')));
  v_reason text := btrim(coalesce(requested_reason, ''));
  v_account_id uuid;
  v_account public.net_economy_accounts%rowtype;
  v_system public.net_economy_accounts%rowtype;
  v_existing public.net_economy_transactions%rowtype;
  v_transaction public.net_economy_transactions%rowtype;
  v_kind text;
  v_delta bigint;
  v_scope text;
  v_fingerprint text;
begin
  v_actor := public.assert_net_economy_gm();
  perform 1
  from public.profiles as profile
  where profile.id = v_actor
  for share;
  v_actor := public.assert_net_economy_gm();

  if v_action not in ('credit', 'debit') then
    raise exception 'ECONOMY_ADJUSTMENT_INVALID' using errcode = '22023';
  end if;
  if requested_amount is null or requested_amount < 1 or requested_amount > 1000000000 then
    raise exception 'ECONOMY_AMOUNT_INVALID' using errcode = '22023';
  end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 200 then
    raise exception 'ECONOMY_REASON_INVALID' using errcode = '22023';
  end if;
  if requested_request_key is null then
    raise exception 'ECONOMY_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;

  select * into v_account
  from public.net_economy_accounts as account
  where account.payment_identifier = v_identifier
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and account.currency_code = 'VG';
  if not found then
    raise exception 'ALTARA_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;
  v_account_id := v_account.id;

  v_kind := case v_action when 'credit' then 'gm-credit' else 'gm-debit' end;
  v_delta := case v_action when 'credit' then requested_amount else -requested_amount end;
  -- Share the deployed actor-wide GM adjustment namespace so one request UUID
  -- cannot be replayed against another economy product.
  v_scope := 'gm:' || v_actor::text;
  v_fingerprint := md5(
    v_account.id::text || ':' || v_action || ':'
    || requested_amount::text || ':' || v_reason
  );

  select * into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;
  if found then
    if v_existing.transaction_kind <> v_kind
      or v_existing.currency_code <> 'VG'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.fetch_net_economy_gm_altara_bank(
      v_identifier, null, null, 20
    );
  end if;

  perform 1
  from public.net_economy_accounts as account
  where account.id in (
    v_account_id,
    '00000000-0000-0000-0000-00000000e001'::uuid
  )
  order by account.id
  for update;

  select * into v_account
  from public.net_economy_accounts as account
  where account.id = v_account_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and account.currency_code = 'VG';
  select * into v_system
  from public.net_economy_accounts as account
  where account.id = '00000000-0000-0000-0000-00000000e001'::uuid
    and account.account_kind = 'system'
    and account.currency_code = 'VG';

  if v_account.id is null or v_system.id is null then
    raise exception 'ALTARA_BANK_ACCOUNT_UNAVAILABLE' using errcode = '55000';
  end if;

  select * into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;
  if found then
    if v_existing.transaction_kind <> v_kind
      or v_existing.currency_code <> 'VG'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.fetch_net_economy_gm_altara_bank(
      v_identifier, null, null, 20
    );
  end if;

  if v_account.status <> 'active' then
    raise exception 'ALTARA_BANK_ACCOUNT_INACTIVE' using errcode = '22023';
  end if;
  if v_action = 'debit' and v_account.balance_amount < requested_amount then
    raise exception 'ECONOMY_BANK_INSUFFICIENT_FUNDS' using errcode = '22023';
  end if;

  insert into public.net_economy_transactions (
    transaction_kind,
    initiated_by_profile_id,
    request_scope,
    request_key,
    request_fingerprint,
    note,
    currency_code
  ) values (
    v_kind,
    v_actor,
    v_scope,
    requested_request_key,
    v_fingerprint,
    v_reason,
    'VG'
  )
  on conflict (request_scope, request_key) do nothing
  returning * into v_transaction;

  if v_transaction.id is null then
    select * into v_existing
    from public.net_economy_transactions as transaction_record
    where transaction_record.request_scope = v_scope
      and transaction_record.request_key = requested_request_key;
    if not found
      or v_existing.transaction_kind <> v_kind
      or v_existing.currency_code <> 'VG'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.fetch_net_economy_gm_altara_bank(
      v_identifier, null, null, 20
    );
  end if;

  insert into public.net_economy_transaction_entries (
    transaction_id,
    account_id,
    amount,
    created_at
  ) values
    (v_transaction.id, v_account.id, v_delta, v_transaction.created_at),
    (v_transaction.id, v_system.id, -v_delta, v_transaction.created_at);

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount + v_delta
  where account.id = v_account.id;
  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount - v_delta
  where account.id = v_system.id;

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
    null,
    null,
    null,
    'system',
    case v_action
      when 'credit' then 'economy.altara-bank.credit'
      else 'economy.altara-bank.debit'
    end,
    'authoritative-gm-economy-control',
    'economy-transaction',
    v_transaction.id
  );

  return public.fetch_net_economy_gm_altara_bank(
    v_identifier, null, null, 20
  );
end;
$$;

-- Raw character-sheet writes remain non-authoritative. This replaces only the
-- CASH source choice while preserving the deployed Karma and Adrian '--'
-- canonicalization semantics.
create or replace function public.net_economy_enforce_cash_mirror()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_adrian_subject_id constant uuid :=
    '9f9873b5-89fd-40d5-9682-e20173b10e85'::uuid;
  v_new_row jsonb := to_jsonb(new);
  v_subject_id uuid;
  v_identity_link_id uuid;
  v_identity_count integer;
  v_primary_os_id text;
  v_cash_account public.net_economy_accounts%rowtype;
  v_karma_account public.net_economy_accounts%rowtype;
  v_cash_display text := '—';
begin
  v_subject_id := case tg_argv[0]
    when 'profile-sheet' then nullif(v_new_row ->> 'profile_id', '')::uuid
    when 'npc-card' then nullif(v_new_row ->> 'id', '')::uuid
    else null
  end;
  if v_subject_id is null then
    return new;
  end if;

  select count(*) into v_identity_count
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = tg_argv[0]
    and identity_link.subject_id = v_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';
  if v_identity_count = 0 then
    return new;
  end if;
  if v_identity_count > 1 then
    raise exception 'ECONOMY_SHEET_IDENTITY_AMBIGUOUS' using errcode = '23514';
  end if;

  select identity_link.id, assignment.primary_os_id
  into v_identity_link_id, v_primary_os_id
  from public.net_identity_links as identity_link
  left join public.net_identity_os_assignments as assignment
    on assignment.identity_link_id = identity_link.id
  where identity_link.subject_kind = tg_argv[0]
    and identity_link.subject_id = v_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if v_primary_os_id = 'veil' then
    select * into v_cash_account
    from public.net_economy_accounts as account
    where account.identity_link_id = v_identity_link_id
      and account.account_kind = 'wallet'
      and account.currency_code = 'VG';
  elsif v_primary_os_id = 'altara' then
    select * into v_cash_account
    from public.net_economy_accounts as account
    where account.identity_link_id = v_identity_link_id
      and account.account_kind = 'bank'
      and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
      and account.currency_code = 'VG'
      and account.status = 'active';
  end if;

  if v_cash_account.id is not null then
    v_cash_display := public.net_economy_cash_display(v_cash_account.balance_amount);
  end if;

  select * into v_karma_account
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'KARMA';

  new.field_data := jsonb_set(
    coalesce(new.field_data, '{}'::jsonb),
    '{CASH}',
    to_jsonb(v_cash_display),
    true
  );
  new.field_data := jsonb_set(
    coalesce(new.field_data, '{}'::jsonb)
      - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
    '{KARMA}',
    to_jsonb(case
      when v_karma_account.id is not null then
        public.net_economy_karma_display(v_karma_account.balance_amount)
      when tg_argv[0] = 'npc-card' and v_subject_id = v_adrian_subject_id then
        '--'
      else '-'
    end),
    true
  );
  return new;
end;
$$;

create or replace function public.net_economy_sync_cash_mirror()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.net_identity_links%rowtype;
  v_primary_os_id text;
  v_display text;
  v_previous_origin text := current_setting('app.net_economy_origin', true);
begin
  if new.balance_amount is not distinct from old.balance_amount
    or nullif(v_previous_origin, '') = 'sheet-adjustment'
  then
    return new;
  end if;

  select identity_link.*
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = new.identity_link_id;
  if not found then
    return new;
  end if;

  select assignment.primary_os_id
  into v_primary_os_id
  from public.net_identity_os_assignments as assignment
  where assignment.identity_link_id = v_link.id;

  if new.currency_code = 'VG' then
    if (v_primary_os_id = 'veil' and new.account_kind = 'wallet')
      or (
        v_primary_os_id = 'altara'
        and new.account_kind = 'bank'
        and new.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
      )
    then
      perform public.net_economy_sync_identity_cash_mirror(v_link.id);
    end if;
    return new;
  end if;

  if new.account_kind <> 'wallet' or new.currency_code <> 'KARMA' then
    return new;
  end if;

  v_display := public.net_economy_karma_display(new.balance_amount);
  perform set_config('app.net_economy_origin', 'economy-mirror', true);
  begin
    if v_link.subject_kind = 'profile-sheet' then
      update public.character_sheet_forms as sheet
      set field_data = jsonb_set(
        coalesce(sheet.field_data, '{}'::jsonb)
          - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
        '{KARMA}', to_jsonb(v_display), true
      )
      where sheet.profile_id = v_link.subject_id
        and (
          sheet.field_data ->> 'KARMA' is distinct from v_display
          or sheet.field_data ?| array['Karma', 'karma', 'K4rma', 'K4RMA']
        );
    elsif v_link.subject_kind = 'npc-card' then
      update public.npc_cards as card
      set field_data = jsonb_set(
        coalesce(card.field_data, '{}'::jsonb)
          - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
        '{KARMA}', to_jsonb(v_display), true
      )
      where card.id = v_link.subject_id
        and (
          card.field_data ->> 'KARMA' is distinct from v_display
          or card.field_data ?| array['Karma', 'karma', 'K4rma', 'K4RMA']
        );
    elsif v_link.subject_kind = 'character' then
      update public.character_stats as character_stat
      set karma = new.balance_amount::integer
      where character_stat.character_id = v_link.subject_id
        and character_stat.karma is distinct from new.balance_amount::integer;
    end if;
  exception
    when others then
      perform set_config('app.net_economy_origin', coalesce(v_previous_origin, ''), true);
      raise;
  end;
  perform set_config('app.net_economy_origin', coalesce(v_previous_origin, ''), true);
  return new;
end;
$$;

-- The bounded sheet selector now projects exactly one active ecosystem. No
-- view call opens an account or moves money.
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
  v_altara public.net_economy_accounts%rowtype;
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
      'shneider_bank', null,
      'altara_bank', null
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

  if v_primary_os_id = 'veil' then
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
  elsif v_primary_os_id = 'altara'
    and public.net_identity_link_can_access_service(v_identity_link_id, 'altara-bank')
  then
    select * into v_altara
    from public.net_economy_accounts as account
    where account.identity_link_id = v_identity_link_id
      and account.account_kind = 'bank'
      and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
      and account.currency_code = 'VG'
      and account.status = 'active';
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
    ) end,
    'altara_bank', case when v_altara.id is null then null else jsonb_build_object(
      'account_id', v_altara.id,
      'balance_amount', v_altara.balance_amount,
      'updated_at', v_altara.updated_at
    ) end
  );
end;
$$;

-- Reuse the one deployed Economy Realtime table and channel. A normal client
-- can see only revisions for its controlled, service-eligible accounts; GM
-- keeps the existing intentional administration branch. The revision is not
-- install-gated: it contains no balance/history and is also the authorized
-- invalidation source for the sheet CASH mirror after a bank app is removed.
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
            or (
              account.account_kind = 'bank'
              and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
              and public.net_identity_link_can_access_service(
                account.identity_link_id,
                'altara-bank'
              )
            )
          )
      )
    );
$$;

alter table public.net_economy_altara_bank_adoptions enable row level security;
revoke all on table public.net_economy_altara_bank_adoptions
  from public, anon, authenticated;

-- Existing core economy tables remain RPC-only. Reasserting these grants is
-- intentional because this migration adds no raw financial read surface.
revoke all on table public.net_economy_accounts from public, anon, authenticated;
revoke all on table public.net_economy_transactions from public, anon, authenticated;
revoke all on table public.net_economy_transaction_entries from public, anon, authenticated;

revoke all on function public.net_economy_enforce_independent_bank_currency()
  from public, anon, authenticated;
revoke all on function public.net_economy_assert_altara_bank_player_context(uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_audit_altara_bank_personal_action(uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_lock_altara_bank_authority(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_altara_bank_history_page(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_altara_bank_payload(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_sync_identity_cash_mirror(uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_sync_cash_mirror_on_os_assignment()
  from public, anon, authenticated;
revoke all on function public.net_economy_open_altara_bank_for_link(uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_enforce_cash_mirror()
  from public, anon, authenticated;
revoke all on function public.net_economy_sync_cash_mirror()
  from public, anon, authenticated;

revoke all on function public.fetch_net_economy_altara_bank(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.open_net_economy_altara_bank(uuid)
  from public, anon, authenticated;
revoke all on function public.search_net_economy_altara_bank_payees(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_altara_bank_payment(uuid, text, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_economy_gm_altara_bank_directory(text, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_economy_gm_altara_bank(text, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.adjust_net_economy_gm_altara_bank(text, text, bigint, text, uuid)
  from public, anon, authenticated;

grant execute on function public.fetch_net_economy_altara_bank(uuid, timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.open_net_economy_altara_bank(uuid)
  to authenticated;
grant execute on function public.search_net_economy_altara_bank_payees(uuid, text, integer)
  to authenticated;
grant execute on function public.transfer_net_economy_altara_bank_payment(uuid, text, bigint, uuid)
  to authenticated;
grant execute on function public.fetch_net_economy_gm_altara_bank_directory(text, integer)
  to authenticated;
grant execute on function public.fetch_net_economy_gm_altara_bank(text, timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.adjust_net_economy_gm_altara_bank(text, text, bigint, text, uuid)
  to authenticated;

revoke all on function public.fetch_net_economy_sheet_account_sources(text, uuid)
  from public, anon;
grant execute on function public.fetch_net_economy_sheet_account_sources(text, uuid)
  to authenticated;

revoke all on function public.current_user_can_read_net_economy_wallet_revision(uuid)
  from public, anon;
grant execute on function public.current_user_can_read_net_economy_wallet_revision(uuid)
  to authenticated;

comment on function public.net_economy_assert_altara_bank_player_context(uuid) is
  'Internal personal-bank actor boundary: normal owner or GM TAKE CONTROL of player/playable ALTARA identity with the app installed; NPC control never qualifies.';
comment on function public.net_economy_lock_altara_bank_authority(uuid, uuid) is
  'Internal post-account-lock serialization of identity, OS, service, install, profile, and active/control-session authority rows before a personal ledger mutation.';
comment on function public.transfer_net_economy_altara_bank_payment(uuid, text, bigint, uuid) is
  'Bounded same-ALTARA-BANK VG transfer with actor-scoped idempotency, deterministic account locks, and post-lock funds checks.';

-- No raw financial/adoption table is published. Realtime remains the existing
-- per-account revision publication only.
do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_economy_altara_bank_adoptions'
  ) then
    alter publication supabase_realtime
      drop table public.net_economy_altara_bank_adoptions;
  end if;
exception
  when undefined_object then null;
end;
$$;

commit;
