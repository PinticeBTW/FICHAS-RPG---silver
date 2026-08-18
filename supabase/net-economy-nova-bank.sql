-- NOVA BANK V1: independent ALTARA-only FINIT/SECTUS banking on the shared
-- immutable economy ledger. This migration creates no customer account and
-- moves no money. Installation and explicit zero-balance account opening are
-- separate actions.

begin;

do $preflight$
declare
  v_install_constraint text;
  v_install_ids text[];
  v_admin_definition text;
  v_installer_source text;
  v_installer_security_definer boolean;
  v_installer_volatility "char";
  v_installer_config text[];
  v_installer_language name;
  v_installer_return_type oid;
  v_revision_source text;
  v_revision_security_definer boolean;
  v_revision_volatility "char";
  v_revision_config text[];
  v_revision_language name;
  v_revision_return_type oid;
  v_expected_installer_source constant text := $installer$
declare
  v_identity_link_id uuid;
  v_context record;
begin
  if requested_app_id is null
    or requested_app_id not in (
      'echo', 'pulse', 'nvn', 'vox-bank', 'shneider-bank',
      'altara-bank', 'altara-news', 'altara-music', 'altara-wave'
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

  select context.* into v_context
  from public.net_runtime_action_context(v_identity_link_id) as context;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    auth.uid(), null, v_context.persona_subject_kind, v_context.persona_subject_id,
    v_context.action_mode,
    case when requested_installed then 'net.app.install' else 'net.app.uninstall' end,
    v_context.authorization_basis || ':' || requested_app_id,
    'net-identity-link', v_identity_link_id
  );

  return requested_installed;
end;
$installer$;
  v_expected_revision_source constant text := $revision$
  select auth.uid() is not null
    and (
      public.current_user_is_net_system_admin()
      or exists (
        select 1
        from public.net_economy_accounts as account
        where account.id = requested_account_id
          and account.identity_link_id = public.current_net_effective_runtime_identity_link_id()
          and public.net_economy_identity_is_runtime_financial_candidate(account.identity_link_id)
          and case
            when account.account_kind = 'wallet'
              and (
                account.currency_code = 'VG'
                or (
                  account.currency_code = 'KARMA'
                  and public.net_economy_identity_can_use_karma(
                    account.identity_link_id
                  )
                )
              )
              then public.net_identity_link_can_access_service(
                account.identity_link_id,
                'vlt'
              )
            when account.account_kind = 'bank'
              and account.institution_id = '00000000-0000-0000-0000-00000000e100'::uuid
              then public.net_identity_link_can_access_service(account.identity_link_id, 'vox-bank')
            when account.account_kind = 'bank'
              and account.institution_id = '00000000-0000-0000-0000-00000000e101'::uuid
              then public.net_identity_link_can_access_service(account.identity_link_id, 'shneider-bank')
            when account.account_kind = 'bank'
              and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
              then account.status = 'active'
                and account.currency_code = (
                  select assignment.currency_code
                  from public.net_economy_identity_currency_assignments as assignment
                  where assignment.identity_link_id = account.identity_link_id
                )
                and public.net_identity_link_can_access_service(account.identity_link_id, 'altara-bank')
            else false
          end
      )
    );
$revision$;
begin
  if to_regclass('public.net_economy_accounts') is null
    or to_regclass('public.net_economy_transactions') is null
    or to_regclass('public.net_economy_transaction_entries') is null
    or to_regclass('public.net_economy_wallet_realtime_state') is null
    or to_regclass('public.net_economy_institutions') is null
    or to_regclass('public.net_economy_currencies') is null
    or to_regclass('public.net_economy_identity_currency_assignments') is null
    or to_regclass('public.net_economy_fx_rates') is null
    or to_regclass('public.net_economy_fx_rate_audit') is null
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
    or to_regprocedure('public.set_updated_at()') is null
    or to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.assert_net_effective_runtime_identity(uuid,text,boolean)') is null
    or to_regprocedure('public.net_runtime_action_context(uuid)') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
    or to_regprocedure('public.net_economy_identity_is_runtime_financial_candidate(uuid)') is null
    or to_regprocedure('public.net_economy_identity_display_name(uuid)') is null
    or to_regprocedure('public.net_economy_currency_json(text)') is null
    or to_regprocedure('public.net_economy_altara_clearing_account_id(text)') is null
    or to_regprocedure('public.net_altara_identity_presentation(uuid)') is null
    or to_regprocedure('public.normalize_net_app_handle(text)') is null
    or to_regprocedure('public.net_identity_account_handle_seed(uuid)') is null
    or to_regprocedure('public.net_economy_identity_can_use_karma(uuid)') is null
    or to_regprocedure('public.current_user_is_net_system_admin()') is null
    or to_regprocedure('public.set_net_identity_app_install(uuid,text,boolean)') is null
    or to_regprocedure('public.current_user_can_read_net_economy_wallet_revision(uuid)') is null
  then
    raise exception 'NOVA_BANK_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;

  if to_regclass('public.net_economy_nova_bank_fx_operations') is not null
    or to_regprocedure('public.fetch_net_economy_nova_bank(uuid,timestamptz,uuid,integer)') is not null
  then
    raise exception 'NOVA_BANK_SCHEMA_COLLISION_REVIEW_REQUIRED' using errcode = '42P07';
  end if;

  if exists (
    select 1
    from public.net_economy_accounts as account
    where account.institution_id = '00000000-0000-0000-0000-00000000e103'::uuid
  ) or exists (
    select 1
    from public.net_economy_institutions as institution
    where institution.institution_code = 'NOVA'
      and institution.id <> '00000000-0000-0000-0000-00000000e103'::uuid
  ) then
    raise exception 'NOVA_BANK_INSTITUTION_COLLISION_REVIEW_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.net_os_families as os_family
    where os_family.id = 'altara' and os_family.status = 'active'
  ) or not exists (
    select 1 from public.net_economy_currencies as currency
    where currency.currency_code in ('FINIT', 'SECTUS')
      and currency.status = 'active'
      and currency.decimals = 0
    having count(*) = 2
  ) then
    raise exception 'NOVA_BANK_ALTARA_CURRENCY_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.net_economy_accounts as account
    where account.id = '00000000-0000-0000-0000-00000000e003'::uuid
      and account.account_kind = 'system'
      and account.identity_link_id is null
      and account.institution_id is null
      and account.payment_identifier is null
      and account.currency_code = 'FINIT'
      and account.status = 'active'
  ) or not exists (
    select 1 from public.net_economy_accounts as account
    where account.id = '00000000-0000-0000-0000-00000000e004'::uuid
      and account.account_kind = 'system'
      and account.identity_link_id is null
      and account.institution_id is null
      and account.payment_identifier is null
      and account.currency_code = 'SECTUS'
      and account.status = 'active'
  )
    or public.net_economy_altara_clearing_account_id('FINIT')
      is distinct from '00000000-0000-0000-0000-00000000e003'::uuid
    or public.net_economy_altara_clearing_account_id('SECTUS')
      is distinct from '00000000-0000-0000-0000-00000000e004'::uuid
    or public.net_economy_altara_clearing_account_id('KARMA') is not null
  then
    raise exception 'NOVA_BANK_CLEARING_ACCOUNT_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.net_economy_transactions'::regclass
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) like '%bank-transfer%'
      and pg_get_constraintdef(constraint_row.oid) like '%bank-fx-debit%'
      and pg_get_constraintdef(constraint_row.oid) like '%bank-fx-credit%'
  ) or not exists (
    select 1 from pg_trigger as trigger_row
    where trigger_row.tgrelid = 'public.net_economy_transaction_entries'::regclass
      and trigger_row.tgname = 'net_economy_entries_balance_check'
      and not trigger_row.tgisinternal
      and trigger_row.tgfoid = 'public.net_economy_assert_balanced_transaction()'::regprocedure
  ) or not exists (
    select 1 from pg_trigger as trigger_row
    where trigger_row.tgrelid = 'public.net_economy_accounts'::regclass
      and trigger_row.tgname = 'net_economy_accounts_signal_wallet_change'
      and not trigger_row.tgisinternal
      and trigger_row.tgfoid = 'public.net_economy_signal_wallet_change()'::regprocedure
  ) then
    raise exception 'NOVA_BANK_LEDGER_CONTRACT_REVIEW_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_economy_wallet_realtime_state'
  ) then
    raise exception 'NOVA_BANK_ECONOMY_REALTIME_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_get_constraintdef(constraint_row.oid, true)
  into v_install_constraint
  from pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.net_identity_app_installs'::regclass
    and constraint_row.conname = 'net_identity_app_installs_app_id_check'
    and constraint_row.contype = 'c';

  select array_agg((capture)[1] order by (capture)[1])
  into v_install_ids
  from regexp_matches(coalesce(v_install_constraint, ''), '''([^'']+)''', 'g')
    as matches(capture);

  if v_install_ids is distinct from array[
    'altara-bank', 'altara-music', 'altara-news', 'altara-wave', 'echo',
    'nvn', 'pulse', 'shneider-bank', 'vox-bank'
  ]::text[] then
    raise exception 'NOVA_BANK_INSTALL_DOMAIN_REVIEW_REQUIRED'
      using errcode = '55000', detail = coalesce(v_install_constraint, 'missing');
  end if;

  select procedure_row.prosrc, procedure_row.prosecdef,
    procedure_row.provolatile, procedure_row.proconfig,
    language_row.lanname, procedure_row.prorettype
  into v_installer_source, v_installer_security_definer,
    v_installer_volatility, v_installer_config,
    v_installer_language, v_installer_return_type
  from pg_proc as procedure_row
  join pg_namespace as namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  join pg_language as language_row
    on language_row.oid = procedure_row.prolang
  where procedure_row.oid =
    'public.set_net_identity_app_install(uuid,text,boolean)'::regprocedure::oid
    and namespace_row.nspname = 'public';

  if btrim(v_installer_source) is distinct from btrim(v_expected_installer_source)
    or not v_installer_security_definer
    or v_installer_volatility <> 'v'
    or v_installer_language <> 'plpgsql'
    or v_installer_return_type <> 'boolean'::regtype::oid
    or v_installer_config is distinct from array['search_path=public, pg_temp']::text[]
  then
    raise exception 'NOVA_BANK_INSTALLER_SOURCE_REVIEW_REQUIRED'
      using errcode = '55000',
        detail = 'Expected exact WAVE-final effective-runtime installer contract.';
  end if;

  select procedure_row.prosrc, procedure_row.prosecdef,
    procedure_row.provolatile, procedure_row.proconfig,
    language_row.lanname, procedure_row.prorettype
  into v_revision_source, v_revision_security_definer,
    v_revision_volatility, v_revision_config,
    v_revision_language, v_revision_return_type
  from pg_proc as procedure_row
  join pg_namespace as namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  join pg_language as language_row
    on language_row.oid = procedure_row.prolang
  where procedure_row.oid =
    'public.current_user_can_read_net_economy_wallet_revision(uuid)'::regprocedure::oid
    and namespace_row.nspname = 'public';

  if btrim(v_revision_source) is distinct from btrim(v_expected_revision_source)
    or not v_revision_security_definer
    or v_revision_volatility <> 's'
    or v_revision_language <> 'sql'
    or v_revision_return_type <> 'boolean'::regtype::oid
    or v_revision_config is distinct from array['search_path=public, pg_temp']::text[]
  then
    raise exception 'NOVA_BANK_REALTIME_PREDICATE_SOURCE_REVIEW_REQUIRED'
      using errcode = '55000',
        detail = 'Expected exact financial-runtime-parity revision predicate contract.';
  end if;

  v_admin_definition := lower(pg_get_functiondef(
    'public.current_user_is_net_system_admin()'::regprocedure::oid
  ));
  if pg_catalog.strpos(v_admin_definition, 'gm_session.mode <> ''none''') = 0 then
    raise exception 'NOVA_BANK_GM_SYSTEM_MODE_REVIEW_REQUIRED' using errcode = '55000';
  end if;
end;
$preflight$;

insert into public.net_os_service_scopes (service_id, scope_kind, required_os_id)
values ('nova-bank', 'primary-os', 'altara')
on conflict (service_id) do update set
  scope_kind = excluded.scope_kind,
  required_os_id = excluded.required_os_id,
  updated_at = timezone('utc', now());

insert into public.net_app_account_policies (app_id, account_mode, account_available)
values ('nova-bank', 'none', false)
on conflict (app_id) do update set
  account_mode = excluded.account_mode,
  account_available = excluded.account_available,
  updated_at = timezone('utc', now());

alter table public.net_identity_app_installs
  drop constraint net_identity_app_installs_app_id_check;
alter table public.net_identity_app_installs
  add constraint net_identity_app_installs_app_id_check
  check (app_id in (
    'echo', 'pulse', 'nvn', 'vox-bank', 'shneider-bank',
    'altara-bank', 'altara-news', 'altara-music', 'altara-wave', 'nova-bank'
  )) not valid;
alter table public.net_identity_app_installs
  validate constraint net_identity_app_installs_app_id_check;

-- Preserve the deployed effective-runtime installer and extend only its
-- bounded optional-app domain with NOVA BANK.
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
      'altara-bank', 'altara-news', 'altara-music', 'altara-wave', 'nova-bank'
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

  select context.* into v_context
  from public.net_runtime_action_context(v_identity_link_id) as context;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    auth.uid(), null, v_context.persona_subject_kind, v_context.persona_subject_id,
    v_context.action_mode,
    case when requested_installed then 'net.app.install' else 'net.app.uninstall' end,
    v_context.authorization_basis || ':' || requested_app_id,
    'net-identity-link', v_identity_link_id
  );

  return requested_installed;
end;
$$;

insert into public.net_economy_institutions (
  id, institution_code, display_name, owner_name, status,
  yield_rate_basis_points, yield_period, maximum_yield_amount
) values (
  '00000000-0000-0000-0000-00000000e103'::uuid,
  'NOVA', 'NOVA BANK', 'NOVA FINANCIAL', 'active',
  0, interval '365 days', 1
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from public.net_economy_institutions as institution
    where institution.id = '00000000-0000-0000-0000-00000000e103'::uuid
      and institution.institution_code = 'NOVA'
      and institution.display_name = 'NOVA BANK'
      and institution.owner_name = 'NOVA FINANCIAL'
      and institution.status = 'active'
      and institution.yield_rate_basis_points = 0
  ) then
    raise exception 'NOVA_BANK_INSTITUTION_CONFIG_CONFLICT' using errcode = '23514';
  end if;
end;
$$;

-- One currently active NOVA account per identity, independent of currency.
-- Historical closed accounts remain immutable and deliberately block V1
-- reopening. Any future reopening contract requires its own reviewed change.
create unique index net_economy_accounts_nova_identity_active_unique
  on public.net_economy_accounts (identity_link_id)
  where account_kind = 'bank'
    and institution_id = '00000000-0000-0000-0000-00000000e103'::uuid
    and status = 'active';

create index net_economy_accounts_nova_directory_idx
  on public.net_economy_accounts (
    institution_id, status, currency_code, payment_identifier
  )
  where account_kind = 'bank'
    and institution_id = '00000000-0000-0000-0000-00000000e103'::uuid;

create or replace function public.net_economy_enforce_nova_bank_currency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.institution_id = '00000000-0000-0000-0000-00000000e103'::uuid
    and (
      new.account_kind <> 'bank'
      or new.currency_code not in ('FINIT', 'SECTUS')
      or not exists (
        select 1 from public.net_economy_currencies as currency
        where currency.currency_code = new.currency_code
          and currency.status = 'active'
          and currency.decimals = 0
      )
    )
  then
    raise exception 'NOVA_BANK_CURRENCY_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists net_economy_accounts_enforce_nova_bank_currency
  on public.net_economy_accounts;
create trigger net_economy_accounts_enforce_nova_bank_currency
before insert or update on public.net_economy_accounts
for each row execute procedure public.net_economy_enforce_nova_bank_currency();

create table public.net_economy_nova_bank_fx_operations (
  id uuid primary key default gen_random_uuid(),
  sender_identity_link_id uuid not null
    references public.net_identity_links (id) on delete restrict,
  recipient_identity_link_id uuid not null
    references public.net_identity_links (id) on delete restrict,
  sender_account_id uuid not null
    references public.net_economy_accounts (id) on delete restrict,
  recipient_account_id uuid not null
    references public.net_economy_accounts (id) on delete restrict,
  source_currency_code text not null
    references public.net_economy_currencies (currency_code) on delete restrict,
  target_currency_code text not null
    references public.net_economy_currencies (currency_code) on delete restrict,
  source_amount bigint not null,
  target_amount bigint not null,
  source_units bigint not null,
  target_units bigint not null,
  rate_revision uuid not null
    references public.net_economy_fx_rate_audit (revision) on delete restrict,
  source_transaction_id uuid not null unique
    references public.net_economy_transactions (id) on delete restrict,
  target_transaction_id uuid not null unique
    references public.net_economy_transactions (id) on delete restrict,
  request_scope text not null,
  request_key uuid not null,
  request_fingerprint text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (request_scope, request_key),
  constraint net_economy_nova_fx_identity_valid check (
    sender_identity_link_id <> recipient_identity_link_id
    and sender_account_id <> recipient_account_id
  ),
  constraint net_economy_nova_fx_currency_valid check (
    source_currency_code in ('FINIT', 'SECTUS')
    and target_currency_code in ('FINIT', 'SECTUS')
    and source_currency_code <> target_currency_code
  ),
  constraint net_economy_nova_fx_amount_valid check (
    source_amount between 1 and 1000000000
    and target_amount between 1 and 1000000000
  ),
  constraint net_economy_nova_fx_rate_units_valid check (
    source_units between 1 and 1000000000
    and target_units between 1 and 1000000000
  ),
  constraint net_economy_nova_fx_request_valid check (
    request_scope = btrim(request_scope)
    and char_length(request_scope) between 1 and 100
    and request_fingerprint ~ '^[0-9a-f]{32}$'
  )
);

comment on table public.net_economy_nova_bank_fx_operations is
  'Private NOVA-only pairing of two balanced single-currency ledger transactions. It never aliases ALTARA BANK FX operations.';

create or replace function public.net_economy_assert_nova_bank_context(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  v_identity_link_id := public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id,
    'nova-bank',
    true
  );
  if not public.net_economy_identity_is_runtime_financial_candidate(v_identity_link_id) then
    raise exception 'NOVA_BANK_PERSONAL_IDENTITY_REQUIRED' using errcode = '42501';
  end if;
  return v_identity_link_id;
end;
$$;

create or replace function public.net_economy_lock_nova_bank_authority(
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
  v_role public.app_role;
  v_expected_count integer := case
    when requested_recipient_identity_link_id is null
      or requested_recipient_identity_link_id = requested_sender_identity_link_id
    then 1 else 2 end;
  v_locked_count integer;
begin
  if v_actor is null then
    raise exception 'NOVA_BANK_AUTH_REQUIRED' using errcode = '42501';
  end if;

  perform 1
  from public.net_identity_links as identity_link
  where identity_link.id in (
    requested_sender_identity_link_id,
    requested_recipient_identity_link_id
  )
    and public.net_economy_identity_is_runtime_financial_candidate(identity_link.id)
  order by identity_link.id
  for share;
  get diagnostics v_locked_count = row_count;
  if v_locked_count <> v_expected_count then
    raise exception 'NOVA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;

  perform 1
  from public.net_identity_os_assignments as assignment
  where assignment.identity_link_id in (
    requested_sender_identity_link_id,
    requested_recipient_identity_link_id
  )
    and assignment.primary_os_id = 'altara'
  order by assignment.identity_link_id
  for share;
  get diagnostics v_locked_count = row_count;
  if v_locked_count <> v_expected_count then
    raise exception 'NOVA_BANK_OS_CONTEXT_CHANGED' using errcode = '42501';
  end if;

  perform 1 from public.net_os_families as os_family
  where os_family.id = 'altara' and os_family.status = 'active'
  for share;
  if not found then
    raise exception 'NOVA_BANK_OS_UNAVAILABLE' using errcode = '55000';
  end if;

  perform 1 from public.net_os_service_scopes as service_scope
  where service_scope.service_id = 'nova-bank'
    and service_scope.scope_kind = 'primary-os'
    and service_scope.required_os_id = 'altara'
  for share;
  if not found then
    raise exception 'NOVA_BANK_SERVICE_UNAVAILABLE' using errcode = '55000';
  end if;

  perform 1 from public.net_economy_institutions as institution
  where institution.id = '00000000-0000-0000-0000-00000000e103'::uuid
    and institution.institution_code = 'NOVA'
    and institution.status = 'active'
  for share;
  if not found then
    raise exception 'NOVA_BANK_INSTITUTION_UNAVAILABLE' using errcode = '55000';
  end if;

  perform 1 from public.net_identity_app_installs as install
  where install.identity_link_id = requested_sender_identity_link_id
    and install.app_id = 'nova-bank'
  for share;
  if not found then
    raise exception 'NOVA_BANK_APP_NOT_INSTALLED' using errcode = '42501';
  end if;

  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_actor
  for share;
  if not found then
    raise exception 'NOVA_BANK_AUTH_REQUIRED' using errcode = '42501';
  end if;

  if v_role = 'gm' then
    perform 1
    from public.net_gm_persona_sessions as gm_session
    join public.net_identity_links as identity_link
      on identity_link.subject_kind = gm_session.subject_kind
      and identity_link.subject_id = gm_session.subject_id
    where gm_session.gm_profile_id = v_actor
      and gm_session.mode = 'take-control'
      and identity_link.id = requested_sender_identity_link_id
    for share of gm_session;
    if not found then
      raise exception 'NOVA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
    end if;
  elsif v_role = 'player' then
    perform 1 from public.net_active_identities as active_identity
    where active_identity.profile_id = v_actor
      and active_identity.identity_link_id = requested_sender_identity_link_id
    for share;
    if not found then
      raise exception 'NOVA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
    end if;
  else
    raise exception 'NOVA_BANK_PERSONAL_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  perform 1
  from public.net_economy_identity_currency_assignments as assignment
  join public.net_economy_currencies as currency
    on currency.currency_code = assignment.currency_code
    and currency.status = 'active'
    and currency.decimals = 0
  where assignment.identity_link_id in (
    requested_sender_identity_link_id,
    requested_recipient_identity_link_id
  )
    and assignment.currency_code in ('FINIT', 'SECTUS')
  order by assignment.identity_link_id
  for share of assignment, currency;
  get diagnostics v_locked_count = row_count;
  if v_locked_count <> v_expected_count then
    raise exception 'NOVA_BANK_CURRENCY_CONTEXT_CHANGED' using errcode = '40001';
  end if;

  if public.current_net_effective_runtime_identity_link_id()
      is distinct from requested_sender_identity_link_id
  then
    raise exception 'NOVA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;
  if not public.net_identity_link_can_access_service(
    requested_sender_identity_link_id, 'nova-bank'
  ) then
    raise exception 'NOVA_BANK_OS_CONTEXT_CHANGED' using errcode = '42501';
  end if;
  if requested_recipient_identity_link_id is not null
    and requested_recipient_identity_link_id <> requested_sender_identity_link_id
    and not public.net_identity_link_can_access_service(
      requested_recipient_identity_link_id, 'nova-bank'
    )
  then
    raise exception 'NOVA_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.net_economy_audit_nova_bank_action(
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
  v_context record;
begin
  if auth.uid() is null
    or requested_identity_link_id is null
    or requested_action_type is null
    or requested_resource_type is null
    or requested_resource_id is null
    or char_length(requested_action_type) not between 1 and 100
    or char_length(requested_resource_type) not between 1 and 80
    or public.current_net_effective_runtime_identity_link_id()
      is distinct from requested_identity_link_id
  then
    raise exception 'NOVA_BANK_AUDIT_CONTEXT_INVALID' using errcode = '42501';
  end if;

  select * into v_context
  from public.net_runtime_action_context(requested_identity_link_id);
  if v_context.action_mode is null then
    raise exception 'NOVA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    auth.uid(), null,
    v_context.persona_subject_kind, v_context.persona_subject_id,
    v_context.action_mode, requested_action_type,
    v_context.authorization_basis,
    requested_resource_type, requested_resource_id
  );
end;
$$;

create or replace function public.net_economy_nova_bank_history_page(
  requested_account_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns jsonb
language sql
stable
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
      transaction_record.currency_code,
      transaction_record.note,
      entry.created_at,
      coalesce(
        transfer_counterparty.payment_identifier,
        fx_counterparty.payment_identifier
      ) as counterparty_payment_identifier,
      coalesce(
        transfer_counterparty.display_name,
        fx_counterparty.display_name
      ) as counterparty_display_name,
      fx_operation.id as fx_operation_id,
      fx_operation.source_currency_code as fx_source_currency_code,
      fx_operation.target_currency_code as fx_target_currency_code,
      fx_operation.source_amount as fx_source_amount,
      fx_operation.target_amount as fx_target_amount,
      fx_operation.source_units as fx_source_units,
      fx_operation.target_units as fx_target_units,
      fx_operation.rate_revision as fx_rate_revision
    from public.net_economy_transaction_entries as entry
    join public.net_economy_transactions as transaction_record
      on transaction_record.id = entry.transaction_id
    left join public.net_economy_nova_bank_fx_operations as fx_operation
      on fx_operation.source_transaction_id = transaction_record.id
      or fx_operation.target_transaction_id = transaction_record.id
    left join lateral (
      select
        other_account.payment_identifier,
        public.net_economy_identity_display_name(
          other_account.identity_link_id
        ) as display_name
      from public.net_economy_transaction_entries as other_entry
      join public.net_economy_accounts as other_account
        on other_account.id = other_entry.account_id
      where transaction_record.transaction_kind = 'bank-transfer'
        and other_entry.transaction_id = entry.transaction_id
        and other_entry.account_id <> requested_account_id
        and other_account.account_kind = 'bank'
        and other_account.institution_id =
          '00000000-0000-0000-0000-00000000e103'::uuid
      limit 1
    ) as transfer_counterparty on true
    left join lateral (
      select
        other_account.payment_identifier,
        public.net_economy_identity_display_name(
          other_account.identity_link_id
        ) as display_name
      from public.net_economy_accounts as other_account
      where fx_operation.id is not null
        and other_account.id = case
          when fx_operation.sender_account_id = requested_account_id
            then fx_operation.recipient_account_id
          else fx_operation.sender_account_id
        end
      limit 1
    ) as fx_counterparty on true
    cross join settings
    where entry.account_id = requested_account_id
      and transaction_record.transaction_kind in (
        'bank-transfer', 'bank-fx-debit', 'bank-fx-credit'
      )
      and (
        requested_cursor_at is null
        or (entry.created_at, entry.transaction_id)
          < (requested_cursor_at, requested_cursor_id)
      )
    order by entry.created_at desc, entry.transaction_id desc
    limit (select page_limit + 1 from settings)
  ), trimmed as (
    select * from page
    order by created_at desc, transaction_id desc
    limit (select page_limit from settings)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'transaction_id', trimmed.transaction_id,
        'amount', trimmed.amount,
        'transaction_kind', trimmed.transaction_kind,
        'currency_code', trimmed.currency_code,
        'counterparty_payment_identifier', trimmed.counterparty_payment_identifier,
        'counterparty_display_name', trimmed.counterparty_display_name,
        'note', trimmed.note,
        'created_at', trimmed.created_at,
        'fx_operation_id', trimmed.fx_operation_id,
        'fx_source_currency_code', trimmed.fx_source_currency_code,
        'fx_target_currency_code', trimmed.fx_target_currency_code,
        'fx_source_amount', trimmed.fx_source_amount,
        'fx_target_amount', trimmed.fx_target_amount,
        'fx_source_units', trimmed.fx_source_units,
        'fx_target_units', trimmed.fx_target_units,
        'fx_rate_revision', trimmed.fx_rate_revision
      ) order by trimmed.created_at desc, trimmed.transaction_id desc)
      from trimmed
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

create or replace function public.net_economy_nova_bank_payload(
  requested_identity_link_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.net_identity_links%rowtype;
  v_institution public.net_economy_institutions%rowtype;
  v_assignment public.net_economy_identity_currency_assignments%rowtype;
  v_bank public.net_economy_accounts%rowtype;
  v_other_bank public.net_economy_accounts%rowtype;
  v_account_count bigint;
  v_empty_activity jsonb := jsonb_build_object(
    'items', '[]'::jsonb, 'has_more', false,
    'next_cursor_at', null, 'next_cursor_id', null
  );
begin
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'ECONOMY_CURSOR_INVALID' using errcode = '22023';
  end if;

  select * into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id
    and public.net_economy_identity_is_runtime_financial_candidate(identity_link.id);
  if not found then
    raise exception 'NOVA_BANK_PERSONAL_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  select * into v_institution
  from public.net_economy_institutions as institution
  where institution.id = '00000000-0000-0000-0000-00000000e103'::uuid
    and institution.institution_code = 'NOVA'
    and institution.status = 'active';
  if not found then
    raise exception 'NOVA_BANK_INSTITUTION_UNAVAILABLE' using errcode = '55000';
  end if;

  select * into v_assignment
  from public.net_economy_identity_currency_assignments as assignment
  where assignment.identity_link_id = v_link.id
    and assignment.currency_code in ('FINIT', 'SECTUS');

  select count(*) into v_account_count
  from public.net_economy_accounts as account
  where account.identity_link_id = v_link.id
    and account.account_kind = 'bank'
    and account.institution_id = v_institution.id;
  if v_account_count > 1 then
    raise exception 'NOVA_BANK_ACCOUNT_HISTORY_REVIEW_REQUIRED'
      using errcode = '23514';
  end if;

  select * into v_other_bank
  from public.net_economy_accounts as account
  where account.identity_link_id = v_link.id
    and account.account_kind = 'bank'
    and account.institution_id = v_institution.id
  order by account.created_at desc, account.id desc
  limit 1;

  if v_other_bank.id is not null and v_other_bank.status <> 'active' then
    raise exception 'NOVA_BANK_ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  if v_other_bank.id is not null
    and v_other_bank.currency_code is distinct from v_assignment.currency_code
  then
    raise exception 'NOVA_BANK_CURRENCY_CHANGE_REVIEW_REQUIRED' using errcode = '23514';
  end if;

  if v_assignment.currency_code is not null then
    select * into v_bank
    from public.net_economy_accounts as account
    where account.identity_link_id = v_link.id
      and account.account_kind = 'bank'
      and account.institution_id = v_institution.id
      and account.currency_code = v_assignment.currency_code
      and account.status = 'active';
  end if;

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
    'currency_required', v_assignment.currency_code is null,
    'home_currency', public.net_economy_currency_json(v_assignment.currency_code),
    'bank', case when v_bank.id is null then null else jsonb_build_object(
      'account_id', v_bank.id,
      'payment_identifier', v_bank.payment_identifier,
      'balance_amount', v_bank.balance_amount,
      'currency_code', v_bank.currency_code,
      'currency', public.net_economy_currency_json(v_bank.currency_code),
      'status', v_bank.status,
      'opened_at', v_bank.created_at,
      'updated_at', v_bank.updated_at
    ) end,
    'activity', case when v_bank.id is null then v_empty_activity else
      public.net_economy_nova_bank_history_page(
        v_bank.id, requested_cursor_at, requested_cursor_id, requested_limit
      )
    end
  );
end;
$$;

create or replace function public.fetch_net_economy_nova_bank(
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
  v_identity_link_id := public.net_economy_assert_nova_bank_context(
    requested_expected_identity_link_id
  );
  perform 1 from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e103'::uuid
  order by account.created_at, account.id
  for share;
  perform public.net_economy_lock_nova_bank_authority(v_identity_link_id, null);
  perform public.net_economy_assert_nova_bank_context(
    requested_expected_identity_link_id
  );
  return public.net_economy_nova_bank_payload(
    v_identity_link_id, requested_cursor_at, requested_cursor_id, requested_limit
  );
end;
$$;

create or replace function public.open_net_economy_nova_bank(
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
  v_assignment public.net_economy_identity_currency_assignments%rowtype;
  v_existing public.net_economy_accounts%rowtype;
  v_saved public.net_economy_accounts%rowtype;
  v_account_count bigint;
  v_seed text;
  v_suffix text;
  v_identifier text;
  v_attempt integer := 0;
begin
  v_identity_link_id := public.net_economy_assert_nova_bank_context(
    requested_expected_identity_link_id
  );
  perform pg_advisory_xact_lock(hashtextextended(
    'nova-bank-open:' || v_identity_link_id::text, 0
  ));
  perform public.net_economy_lock_nova_bank_authority(v_identity_link_id, null);

  select * into v_assignment
  from public.net_economy_identity_currency_assignments as assignment
  where assignment.identity_link_id = v_identity_link_id
    and assignment.currency_code in ('FINIT', 'SECTUS')
  for share;
  if not found then
    raise exception 'NOVA_BANK_CURRENCY_REQUIRED' using errcode = '22023';
  end if;

  select count(*) into v_account_count
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id =
      '00000000-0000-0000-0000-00000000e103'::uuid;
  if v_account_count > 1 then
    raise exception 'NOVA_BANK_ACCOUNT_HISTORY_REVIEW_REQUIRED'
      using errcode = '23514';
  end if;

  select * into v_existing
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e103'::uuid
  order by account.created_at desc, account.id desc
  limit 1
  for update;
  if found then
    if v_existing.status <> 'active' then
      raise exception 'NOVA_BANK_ACCOUNT_INACTIVE' using errcode = '42501';
    end if;
    if v_existing.currency_code <> v_assignment.currency_code then
      raise exception 'NOVA_BANK_CURRENCY_CHANGE_REVIEW_REQUIRED' using errcode = '23514';
    end if;
    perform public.net_economy_assert_nova_bank_context(
      requested_expected_identity_link_id
    );
    return public.net_economy_nova_bank_payload(v_identity_link_id, null, null, 20);
  end if;

  perform public.net_economy_assert_nova_bank_context(
    requested_expected_identity_link_id
  );
  v_seed := coalesce(
    public.normalize_net_app_handle(
      public.net_identity_account_handle_seed(v_identity_link_id)
    ),
    'client'
  );
  v_suffix := left(replace(v_identity_link_id::text, '-', ''), 8);

  loop
    v_identifier := 'nova-'
      || left(v_seed, greatest(1, 32 - char_length(v_suffix)
        - case when v_attempt > 0 then 4 else 1 end))
      || '-' || v_suffix
      || case when v_attempt > 0 then '-' || v_attempt::text else '' end;
    begin
      insert into public.net_economy_accounts (
        identity_link_id, account_kind, institution_id,
        payment_identifier, currency_code, status, balance_amount
      ) values (
        v_identity_link_id, 'bank',
        '00000000-0000-0000-0000-00000000e103'::uuid,
        v_identifier, v_assignment.currency_code, 'active', 0
      ) returning * into v_saved;
      exit;
    exception
      when unique_violation then
        select count(*) into v_account_count
        from public.net_economy_accounts as account
        where account.identity_link_id = v_identity_link_id
          and account.account_kind = 'bank'
          and account.institution_id =
            '00000000-0000-0000-0000-00000000e103'::uuid;
        if v_account_count > 1 then
          raise exception 'NOVA_BANK_ACCOUNT_HISTORY_REVIEW_REQUIRED'
            using errcode = '23514';
        end if;

        select * into v_existing
        from public.net_economy_accounts as account
        where account.identity_link_id = v_identity_link_id
          and account.account_kind = 'bank'
          and account.institution_id =
            '00000000-0000-0000-0000-00000000e103'::uuid
        order by account.created_at desc, account.id desc
        limit 1;
        if found then
          if v_existing.status <> 'active' then
            raise exception 'NOVA_BANK_ACCOUNT_INACTIVE' using errcode = '42501';
          end if;
          if v_existing.currency_code <> v_assignment.currency_code then
            raise exception 'NOVA_BANK_CURRENCY_CHANGE_REVIEW_REQUIRED'
              using errcode = '23514';
          end if;
          return public.net_economy_nova_bank_payload(
            v_identity_link_id, null, null, 20
          );
        end if;
        v_attempt := v_attempt + 1;
        if v_attempt > 99 then
          raise exception 'NOVA_BANK_PAYMENT_IDENTIFIER_UNAVAILABLE'
            using errcode = '23505';
        end if;
    end;
  end loop;

  insert into public.net_economy_wallet_realtime_state (account_id)
  values (v_saved.id)
  on conflict (account_id) do nothing;
  perform public.net_economy_audit_nova_bank_action(
    v_identity_link_id,
    'economy.nova-bank.open',
    'economy-account',
    v_saved.id
  );
  return public.net_economy_nova_bank_payload(v_identity_link_id, null, null, 20);
end;
$$;

create or replace function public.search_net_economy_nova_bank_payees(
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
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := least(greatest(coalesce(requested_limit, 12), 1), 20);
  v_sender public.net_economy_accounts%rowtype;
begin
  v_identity_link_id := public.net_economy_assert_nova_bank_context(
    requested_expected_identity_link_id
  );
  if char_length(v_query) < 2 or char_length(v_query) > 80 then
    raise exception 'NOVA_BANK_DIRECTORY_QUERY_INVALID' using errcode = '22023';
  end if;

  select account.* into v_sender
  from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e103'::uuid
    and account.status = 'active'
  for share of account, assignment;
  if not found then
    raise exception 'NOVA_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;
  perform public.net_economy_lock_nova_bank_authority(v_identity_link_id, null);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'display_name', result.display_name,
      'payment_identifier', result.payment_identifier,
      'currency', public.net_economy_currency_json(result.currency_code),
      'avatar_ref', result.avatar_ref
    ) order by result.display_name, result.payment_identifier)
    from (
      select
        account.payment_identifier,
        account.currency_code,
        public.net_economy_identity_display_name(account.identity_link_id)
          as display_name,
        public.net_altara_identity_presentation(account.identity_link_id)
          ->> 'avatar_url' as avatar_ref
      from public.net_economy_accounts as account
      join public.net_identity_links as identity_link
        on identity_link.id = account.identity_link_id
        and public.net_economy_identity_is_runtime_financial_candidate(identity_link.id)
      join public.net_economy_identity_currency_assignments as assignment
        on assignment.identity_link_id = account.identity_link_id
        and assignment.currency_code = account.currency_code
      where account.account_kind = 'bank'
        and account.institution_id =
          '00000000-0000-0000-0000-00000000e103'::uuid
        and account.status = 'active'
        and account.id <> v_sender.id
        and public.net_identity_link_can_access_service(
          account.identity_link_id, 'nova-bank'
        )
        and (
          lower(account.payment_identifier)
            like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
              escape '\'
          or lower(public.net_economy_identity_display_name(
            account.identity_link_id
          )) like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
              escape '\'
        )
      order by display_name, account.payment_identifier
      limit v_limit
    ) as result
  ), '[]'::jsonb);
end;
$$;

create or replace function public.quote_net_economy_nova_bank_payment(
  requested_expected_identity_link_id uuid,
  requested_payment_identifier text,
  requested_source_amount bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_identifier text := lower(btrim(coalesce(requested_payment_identifier, '')));
  v_sender public.net_economy_accounts%rowtype;
  v_recipient public.net_economy_accounts%rowtype;
  v_rate public.net_economy_fx_rates%rowtype;
  v_source_units bigint := 1;
  v_target_units bigint := 1;
  v_target_amount bigint;
begin
  v_identity_link_id := public.net_economy_assert_nova_bank_context(
    requested_expected_identity_link_id
  );
  if left(v_identifier, 1) = '@' then v_identifier := substr(v_identifier, 2); end if;
  if v_identifier = '' or char_length(v_identifier) > 40
    or requested_source_amount is null
    or requested_source_amount < 1
    or requested_source_amount > 1000000000
  then
    raise exception 'NOVA_BANK_PAYMENT_INVALID' using errcode = '22023';
  end if;

  select account.* into v_sender
  from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e103'::uuid
    and account.status = 'active';
  select account.* into v_recipient
  from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.payment_identifier = v_identifier
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e103'::uuid
    and account.status = 'active';
  if v_sender.id is null then
    raise exception 'NOVA_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;
  if v_recipient.id is null or v_recipient.id = v_sender.id then
    raise exception 'NOVA_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;

  perform 1 from public.net_economy_accounts as account
  where account.id in (v_sender.id, v_recipient.id)
  order by account.id for share;
  perform public.net_economy_lock_nova_bank_authority(
    v_identity_link_id, v_recipient.identity_link_id
  );
  perform public.net_economy_assert_nova_bank_context(
    requested_expected_identity_link_id
  );

  select account.* into v_sender
  from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.id = v_sender.id
    and account.identity_link_id = v_identity_link_id
    and account.status = 'active';
  select account.* into v_recipient
  from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.id = v_recipient.id
    and account.payment_identifier = v_identifier
    and account.status = 'active'
    and public.net_identity_link_can_access_service(
      account.identity_link_id, 'nova-bank'
    );
  if v_sender.id is null then
    raise exception 'NOVA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;
  if v_recipient.id is null then
    raise exception 'NOVA_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;

  if v_sender.currency_code = v_recipient.currency_code then
    v_target_amount := requested_source_amount;
  else
    select * into v_rate
    from public.net_economy_fx_rates as rate
    where rate.currency_a = least(v_sender.currency_code, v_recipient.currency_code)
      and rate.currency_b = greatest(v_sender.currency_code, v_recipient.currency_code)
      and rate.active
    for share;
    if not found then
      raise exception 'NOVA_BANK_FX_RATE_UNAVAILABLE' using errcode = '22023';
    end if;
    if v_sender.currency_code = v_rate.currency_a then
      v_source_units := v_rate.units_a;
      v_target_units := v_rate.units_b;
    else
      v_source_units := v_rate.units_b;
      v_target_units := v_rate.units_a;
    end if;
    v_target_amount := (requested_source_amount * v_target_units) / v_source_units;
    if v_target_amount < 1 then
      raise exception 'NOVA_BANK_FX_AMOUNT_TOO_SMALL' using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object(
    'server_now', timezone('utc', clock_timestamp()),
    'recipient', jsonb_build_object(
      'display_name', public.net_economy_identity_display_name(
        v_recipient.identity_link_id
      ),
      'payment_identifier', v_recipient.payment_identifier,
      'currency', public.net_economy_currency_json(v_recipient.currency_code),
      'avatar_ref', public.net_altara_identity_presentation(
        v_recipient.identity_link_id
      ) ->> 'avatar_url'
    ),
    'source_currency', public.net_economy_currency_json(v_sender.currency_code),
    'target_currency', public.net_economy_currency_json(v_recipient.currency_code),
    'source_amount', requested_source_amount,
    'target_amount', v_target_amount,
    'source_units', v_source_units,
    'target_units', v_target_units,
    'rate_revision', v_rate.revision,
    'same_currency', v_sender.currency_code = v_recipient.currency_code
  );
end;
$$;

create or replace function public.transfer_net_economy_nova_bank_payment(
  requested_expected_identity_link_id uuid,
  requested_payment_identifier text,
  requested_source_amount bigint,
  requested_rate_revision uuid,
  requested_note text,
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
  v_note text := nullif(btrim(coalesce(requested_note, '')), '');
  v_sender public.net_economy_accounts%rowtype;
  v_recipient public.net_economy_accounts%rowtype;
  v_rate public.net_economy_fx_rates%rowtype;
  v_existing public.net_economy_transactions%rowtype;
  v_existing_fx public.net_economy_nova_bank_fx_operations%rowtype;
  v_source_transaction public.net_economy_transactions%rowtype;
  v_target_transaction public.net_economy_transactions%rowtype;
  v_source_clearing public.net_economy_accounts%rowtype;
  v_target_clearing public.net_economy_accounts%rowtype;
  v_source_units bigint := 1;
  v_target_units bigint := 1;
  v_target_amount bigint;
  v_scope text := 'nova-bank-pay:' || auth.uid()::text;
  v_target_scope text := 'nova-bank-fx-target:' || auth.uid()::text;
  v_fingerprint text;
begin
  v_identity_link_id := public.net_economy_assert_nova_bank_context(
    requested_expected_identity_link_id
  );
  if left(v_identifier, 1) = '@' then v_identifier := substr(v_identifier, 2); end if;
  if v_identifier = '' or char_length(v_identifier) > 40
    or requested_source_amount is null
    or requested_source_amount < 1
    or requested_source_amount > 1000000000
    or requested_request_key is null
    or (v_note is not null and char_length(v_note) > 200)
  then
    raise exception 'NOVA_BANK_PAYMENT_INVALID' using errcode = '22023';
  end if;

  select account.* into v_sender
  from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e103'::uuid
    and account.status = 'active';
  select account.* into v_recipient
  from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.payment_identifier = v_identifier
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e103'::uuid
    and account.status = 'active';
  if v_sender.id is null then
    raise exception 'NOVA_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;
  if v_recipient.id is null then
    raise exception 'NOVA_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;
  if v_sender.id = v_recipient.id then
    raise exception 'ECONOMY_SELF_TRANSFER_INVALID' using errcode = '22023';
  end if;

  if v_sender.currency_code <> v_recipient.currency_code then
    select * into v_source_clearing
    from public.net_economy_accounts as account
    where account.id = public.net_economy_altara_clearing_account_id(
      v_sender.currency_code
    );
    select * into v_target_clearing
    from public.net_economy_accounts as account
    where account.id = public.net_economy_altara_clearing_account_id(
      v_recipient.currency_code
    );
  end if;

  perform 1 from public.net_economy_accounts as account
  where account.id in (
    v_sender.id, v_recipient.id, v_source_clearing.id, v_target_clearing.id
  )
  order by account.id for update;
  perform public.net_economy_lock_nova_bank_authority(
    v_identity_link_id, v_recipient.identity_link_id
  );
  perform public.net_economy_assert_nova_bank_context(
    requested_expected_identity_link_id
  );

  select account.* into v_sender
  from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.id = v_sender.id
    and account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e103'::uuid
    and account.status = 'active';
  select account.* into v_recipient
  from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.id = v_recipient.id
    and account.payment_identifier = v_identifier
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e103'::uuid
    and account.status = 'active'
    and public.net_identity_link_can_access_service(
      account.identity_link_id, 'nova-bank'
    );
  if v_sender.id is null then
    raise exception 'NOVA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;
  if v_recipient.id is null then
    raise exception 'NOVA_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;

  select * into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;
  if found then
    if v_existing.transaction_kind = 'bank-transfer' then
      v_fingerprint := md5(
        v_identity_link_id::text || ':'
        || '00000000-0000-0000-0000-00000000e103'::uuid::text || ':'
        || v_sender.id::text || ':' || v_recipient.id::text || ':'
        || v_sender.currency_code || ':' || v_recipient.currency_code || ':'
        || requested_source_amount::text || ':'
        || coalesce(v_note, '') || ':same'
      );
      if v_sender.currency_code <> v_recipient.currency_code
        or requested_rate_revision is not null
        or v_existing.request_fingerprint <> v_fingerprint
        or v_existing.note is distinct from v_note
      then
        raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
      end if;
    elsif v_existing.transaction_kind = 'bank-fx-debit' then
      select * into v_existing_fx
      from public.net_economy_nova_bank_fx_operations as operation
      where operation.source_transaction_id = v_existing.id;
      if v_existing_fx.id is null
        or v_existing_fx.sender_account_id <> v_sender.id
        or v_existing_fx.recipient_account_id <> v_recipient.id
        or v_existing_fx.source_amount <> requested_source_amount
        or v_existing_fx.rate_revision is distinct from requested_rate_revision
        or v_existing.note is distinct from v_note
        or v_existing.request_fingerprint <> v_existing_fx.request_fingerprint
      then
        raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
      end if;
    else
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.net_economy_nova_bank_payload(v_identity_link_id, null, null, 20);
  end if;

  if v_sender.balance_amount < requested_source_amount then
    raise exception 'ECONOMY_BANK_INSUFFICIENT_FUNDS' using errcode = '22023';
  end if;

  if v_sender.currency_code = v_recipient.currency_code then
    if requested_rate_revision is not null then
      raise exception 'NOVA_BANK_FX_RATE_CHANGED' using errcode = '40001';
    end if;
    v_target_amount := requested_source_amount;
    v_fingerprint := md5(
      v_identity_link_id::text || ':'
      || '00000000-0000-0000-0000-00000000e103'::uuid::text || ':'
      || v_sender.id::text || ':' || v_recipient.id::text || ':'
      || v_sender.currency_code || ':' || v_recipient.currency_code || ':'
      || requested_source_amount::text || ':' || coalesce(v_note, '') || ':same'
    );
    insert into public.net_economy_transactions (
      transaction_kind, initiated_by_profile_id, request_scope, request_key,
      request_fingerprint, note, currency_code
    ) values (
      'bank-transfer', v_actor, v_scope, requested_request_key,
      v_fingerprint, v_note, v_sender.currency_code
    ) returning * into v_source_transaction;
    insert into public.net_economy_transaction_entries (
      transaction_id, account_id, amount, created_at
    ) values
      (v_source_transaction.id, v_sender.id,
        -requested_source_amount, v_source_transaction.created_at),
      (v_source_transaction.id, v_recipient.id,
        requested_source_amount, v_source_transaction.created_at);
    update public.net_economy_accounts
    set balance_amount = balance_amount - requested_source_amount
    where id = v_sender.id;
    update public.net_economy_accounts
    set balance_amount = balance_amount + requested_source_amount
    where id = v_recipient.id;
  else
    select * into v_rate
    from public.net_economy_fx_rates as rate
    where rate.currency_a = least(v_sender.currency_code, v_recipient.currency_code)
      and rate.currency_b = greatest(v_sender.currency_code, v_recipient.currency_code)
      and rate.active
    for share;
    if not found then
      raise exception 'NOVA_BANK_FX_RATE_UNAVAILABLE' using errcode = '22023';
    end if;
    if requested_rate_revision is null
      or requested_rate_revision <> v_rate.revision
    then
      raise exception 'NOVA_BANK_FX_RATE_CHANGED' using errcode = '40001';
    end if;
    if v_sender.currency_code = v_rate.currency_a then
      v_source_units := v_rate.units_a;
      v_target_units := v_rate.units_b;
    else
      v_source_units := v_rate.units_b;
      v_target_units := v_rate.units_a;
    end if;
    v_target_amount := (requested_source_amount * v_target_units) / v_source_units;
    if v_target_amount < 1 or v_target_amount > 1000000000 then
      raise exception 'NOVA_BANK_FX_AMOUNT_INVALID' using errcode = '22023';
    end if;
    select * into v_source_clearing
    from public.net_economy_accounts as account
    where account.id = v_source_clearing.id
      and account.account_kind = 'system'
      and account.currency_code = v_sender.currency_code
      and account.status = 'active';
    select * into v_target_clearing
    from public.net_economy_accounts as account
    where account.id = v_target_clearing.id
      and account.account_kind = 'system'
      and account.currency_code = v_recipient.currency_code
      and account.status = 'active';
    if v_source_clearing.id is null or v_target_clearing.id is null then
      raise exception 'NOVA_BANK_FX_CLEARING_UNAVAILABLE' using errcode = '55000';
    end if;
    v_fingerprint := md5(
      v_identity_link_id::text || ':'
      || '00000000-0000-0000-0000-00000000e103'::uuid::text || ':'
      || v_sender.id::text || ':' || v_recipient.id::text || ':'
      || v_sender.currency_code || ':' || v_recipient.currency_code || ':'
      || requested_source_amount::text || ':' || v_target_amount::text || ':'
      || v_rate.revision::text || ':' || v_source_units::text || ':'
      || v_target_units::text || ':' || coalesce(v_note, '')
    );
    insert into public.net_economy_transactions (
      transaction_kind, initiated_by_profile_id, request_scope, request_key,
      request_fingerprint, note, currency_code
    ) values (
      'bank-fx-debit', v_actor, v_scope, requested_request_key,
      v_fingerprint, v_note, v_sender.currency_code
    ) returning * into v_source_transaction;
    insert into public.net_economy_transactions (
      transaction_kind, initiated_by_profile_id, request_scope, request_key,
      request_fingerprint, note, currency_code
    ) values (
      'bank-fx-credit', v_actor, v_target_scope, requested_request_key,
      v_fingerprint, v_note, v_recipient.currency_code
    ) returning * into v_target_transaction;
    insert into public.net_economy_transaction_entries (
      transaction_id, account_id, amount, created_at
    ) values
      (v_source_transaction.id, v_sender.id,
        -requested_source_amount, v_source_transaction.created_at),
      (v_source_transaction.id, v_source_clearing.id,
        requested_source_amount, v_source_transaction.created_at),
      (v_target_transaction.id, v_target_clearing.id,
        -v_target_amount, v_target_transaction.created_at),
      (v_target_transaction.id, v_recipient.id,
        v_target_amount, v_target_transaction.created_at);
    update public.net_economy_accounts
    set balance_amount = balance_amount - requested_source_amount
    where id = v_sender.id;
    update public.net_economy_accounts
    set balance_amount = balance_amount + requested_source_amount
    where id = v_source_clearing.id;
    update public.net_economy_accounts
    set balance_amount = balance_amount - v_target_amount
    where id = v_target_clearing.id;
    update public.net_economy_accounts
    set balance_amount = balance_amount + v_target_amount
    where id = v_recipient.id;
    insert into public.net_economy_nova_bank_fx_operations (
      sender_identity_link_id, recipient_identity_link_id,
      sender_account_id, recipient_account_id,
      source_currency_code, target_currency_code,
      source_amount, target_amount, source_units, target_units,
      rate_revision, source_transaction_id, target_transaction_id,
      request_scope, request_key, request_fingerprint
    ) values (
      v_identity_link_id, v_recipient.identity_link_id,
      v_sender.id, v_recipient.id,
      v_sender.currency_code, v_recipient.currency_code,
      requested_source_amount, v_target_amount,
      v_source_units, v_target_units, v_rate.revision,
      v_source_transaction.id, v_target_transaction.id,
      v_scope, requested_request_key, v_fingerprint
    );
  end if;

  perform public.net_economy_audit_nova_bank_action(
    v_identity_link_id,
    'economy.nova-bank.transfer',
    'economy-transaction',
    v_source_transaction.id
  );
  return public.net_economy_nova_bank_payload(v_identity_link_id, null, null, 20);
end;
$$;

-- Extend the existing single Economy revision predicate with the independent
-- NOVA institution. GM System remains mode-aware; controlled GM contexts see
-- only their exact runtime identity's account.
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
      public.current_user_is_net_system_admin()
      or exists (
        select 1
        from public.net_economy_accounts as account
        where account.id = requested_account_id
          and account.identity_link_id =
            public.current_net_effective_runtime_identity_link_id()
          and public.net_economy_identity_is_runtime_financial_candidate(
            account.identity_link_id
          )
          and case
            when account.account_kind = 'wallet'
              and (
                account.currency_code = 'VG'
                or (
                  account.currency_code = 'KARMA'
                  and public.net_economy_identity_can_use_karma(
                    account.identity_link_id
                  )
                )
              )
              then public.net_identity_link_can_access_service(
                account.identity_link_id, 'vlt'
              )
            when account.account_kind = 'bank'
              and account.institution_id =
                '00000000-0000-0000-0000-00000000e100'::uuid
              then public.net_identity_link_can_access_service(
                account.identity_link_id, 'vox-bank'
              )
            when account.account_kind = 'bank'
              and account.institution_id =
                '00000000-0000-0000-0000-00000000e101'::uuid
              then public.net_identity_link_can_access_service(
                account.identity_link_id, 'shneider-bank'
              )
            when account.account_kind = 'bank'
              and account.institution_id =
                '00000000-0000-0000-0000-00000000e102'::uuid
              then account.status = 'active'
                and account.currency_code = (
                  select assignment.currency_code
                  from public.net_economy_identity_currency_assignments as assignment
                  where assignment.identity_link_id = account.identity_link_id
                )
                and public.net_identity_link_can_access_service(
                  account.identity_link_id, 'altara-bank'
                )
            when account.account_kind = 'bank'
              and account.institution_id =
                '00000000-0000-0000-0000-00000000e103'::uuid
              then account.status = 'active'
                and account.currency_code in ('FINIT', 'SECTUS')
                and account.currency_code = (
                  select assignment.currency_code
                  from public.net_economy_identity_currency_assignments as assignment
                  where assignment.identity_link_id = account.identity_link_id
                )
                and public.net_identity_link_can_access_service(
                  account.identity_link_id, 'nova-bank'
                )
                and exists (
                  select 1
                  from public.net_identity_app_installs as install
                  where install.identity_link_id = account.identity_link_id
                    and install.app_id = 'nova-bank'
                )
            else false
          end
      )
    );
$$;

alter table public.net_economy_nova_bank_fx_operations enable row level security;
revoke all on table public.net_economy_nova_bank_fx_operations
  from public, anon, authenticated;

revoke all on function public.net_economy_enforce_nova_bank_currency()
  from public, anon, authenticated;
revoke all on function public.net_economy_assert_nova_bank_context(uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_lock_nova_bank_authority(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_audit_nova_bank_action(uuid,text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_nova_bank_history_page(uuid,timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_nova_bank_payload(uuid,timestamptz,uuid,integer)
  from public, anon, authenticated;

revoke all on function public.fetch_net_economy_nova_bank(uuid,timestamptz,uuid,integer)
  from public, anon;
revoke all on function public.open_net_economy_nova_bank(uuid)
  from public, anon;
revoke all on function public.search_net_economy_nova_bank_payees(uuid,text,integer)
  from public, anon;
revoke all on function public.quote_net_economy_nova_bank_payment(uuid,text,bigint)
  from public, anon;
revoke all on function public.transfer_net_economy_nova_bank_payment(uuid,text,bigint,uuid,text,uuid)
  from public, anon;

grant execute on function public.fetch_net_economy_nova_bank(uuid,timestamptz,uuid,integer)
  to authenticated;
grant execute on function public.open_net_economy_nova_bank(uuid)
  to authenticated;
grant execute on function public.search_net_economy_nova_bank_payees(uuid,text,integer)
  to authenticated;
grant execute on function public.quote_net_economy_nova_bank_payment(uuid,text,bigint)
  to authenticated;
grant execute on function public.transfer_net_economy_nova_bank_payment(uuid,text,bigint,uuid,text,uuid)
  to authenticated;

revoke all on function public.current_user_can_read_net_economy_wallet_revision(uuid)
  from public, anon;
grant execute on function public.current_user_can_read_net_economy_wallet_revision(uuid)
  to authenticated;

revoke all on function public.set_net_identity_app_install(uuid,text,boolean)
  from public, anon;
grant execute on function public.set_net_identity_app_install(uuid,text,boolean)
  to authenticated;

-- The existing per-account revision table remains the only Economy Realtime
-- publication. The private NOVA FX pairing table is never streamed raw.
do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_economy_nova_bank_fx_operations'
  ) then
    alter publication supabase_realtime
      drop table public.net_economy_nova_bank_fx_operations;
  end if;
exception
  when undefined_object then null;
end;
$$;

do $postflight$
declare
  v_function record;
begin
  if not exists (
    select 1 from public.net_economy_institutions as institution
    where institution.id = '00000000-0000-0000-0000-00000000e103'::uuid
      and institution.institution_code = 'NOVA'
  ) or not exists (
    select 1 from public.net_os_service_scopes as service_scope
    where service_scope.service_id = 'nova-bank'
      and service_scope.scope_kind = 'primary-os'
      and service_scope.required_os_id = 'altara'
  ) or not exists (
    select 1 from pg_trigger as trigger_row
    where trigger_row.tgrelid = 'public.net_economy_accounts'::regclass
      and trigger_row.tgname = 'net_economy_accounts_enforce_nova_bank_currency'
      and not trigger_row.tgisinternal
  ) or exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_economy_nova_bank_fx_operations'
  ) then
    raise exception 'NOVA_BANK_POSTFLIGHT_FAILED' using errcode = '55000';
  end if;

  for v_function in
    select procedure_row.oid, procedure_row.proname
    from pg_proc as procedure_row
    join pg_namespace as namespace on namespace.oid = procedure_row.pronamespace
    where namespace.nspname = 'public'
      and (
        procedure_row.proname like '%nova_bank%'
        or procedure_row.proname = 'current_user_can_read_net_economy_wallet_revision'
        or procedure_row.proname = 'set_net_identity_app_install'
      )
  loop
    if pg_catalog.strpos(
        lower(pg_get_functiondef(v_function.oid)),
        'security definer'
      ) > 0
      and pg_catalog.strpos(
        lower(pg_get_functiondef(v_function.oid)),
        'set search_path to ''public'', ''pg_temp'''
      ) = 0
    then
      raise exception 'NOVA_BANK_SEARCH_PATH_REVIEW_REQUIRED: %', v_function.proname
        using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;

commit;
