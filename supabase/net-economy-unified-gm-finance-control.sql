-- Unified GM Finance Control and ALTARA multi-bank sheet projection.
-- Forward-only: run after net-financial-runtime-control-parity.sql and
-- net-economy-nova-bank.sql. This migration does not open customer accounts,
-- assign currencies, migrate balances, or add another Realtime channel.

begin;

do $$
declare
  v_gm_assertion_source text;
  v_sheet_source text;
  v_shared_bank_history_source text;
  v_nova_history_source text;
  v_gm_assertion_security_definer boolean;
  v_gm_assertion_volatility "char";
  v_gm_assertion_config text[];
begin
  if to_regclass('public.net_economy_accounts') is null
    or to_regclass('public.net_economy_transactions') is null
    or to_regclass('public.net_economy_transaction_entries') is null
    or to_regclass('public.net_economy_institutions') is null
    or to_regclass('public.net_economy_currencies') is null
    or to_regclass('public.net_economy_identity_currency_assignments') is null
    or to_regclass('public.net_economy_wallet_realtime_state') is null
    or to_regclass('public.net_economy_vox_bank_state') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_os_families') is null
    or to_regclass('public.net_os_service_scopes') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_action_audit') is null
    or to_regprocedure('public.assert_net_system_admin()') is null
    or to_regprocedure('public.current_user_is_net_system_admin()') is null
    or to_regprocedure('public.assert_net_economy_gm()') is null
    or to_regprocedure('public.net_economy_identity_is_runtime_financial_candidate(uuid)') is null
    or to_regprocedure('public.net_economy_identity_can_use_karma(uuid)') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
    or to_regprocedure('public.net_economy_currency_json(text)') is null
    or to_regprocedure('public.net_economy_identity_display_name(uuid)') is null
    or to_regprocedure('public.net_altara_identity_presentation(uuid)') is null
    or to_regprocedure('public.net_economy_current_user_can_view_sheet_subject(text,uuid)') is null
    or to_regprocedure('public.fetch_net_economy_sheet_account_sources(text,uuid)') is null
    or to_regprocedure('public.net_economy_bank_history_page(uuid,uuid,timestamptz,uuid,integer)') is null
    or to_regprocedure('public.net_economy_nova_bank_history_page(uuid,timestamptz,uuid,integer)') is null
  then
    raise exception 'NET_GM_FINANCE_CONTROL_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;

  select procedure_record.prosrc,
    procedure_record.prosecdef,
    procedure_record.provolatile,
    procedure_record.proconfig
  into v_gm_assertion_source,
    v_gm_assertion_security_definer,
    v_gm_assertion_volatility,
    v_gm_assertion_config
  from pg_catalog.pg_proc as procedure_record
  where procedure_record.oid = 'public.assert_net_economy_gm()'::regprocedure::oid;

  if btrim(v_gm_assertion_source) <> btrim($expected$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_current_user_gm() then
    raise exception 'ECONOMY_GM_REQUIRED' using errcode = '42501';
  end if;
  return v_actor;
end;
$expected$)
    or not v_gm_assertion_security_definer
    or v_gm_assertion_volatility <> 's'
    or not ('search_path=public, pg_temp' = any(coalesce(v_gm_assertion_config, array[]::text[])))
  then
    raise exception 'NET_GM_FINANCE_CONTROL_GM_ASSERTION_SOURCE_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select procedure_record.prosrc into v_sheet_source
  from pg_catalog.pg_proc as procedure_record
  where procedure_record.oid =
    'public.fetch_net_economy_sheet_account_sources(text,uuid)'::regprocedure::oid;

  if pg_catalog.strpos(
      v_sheet_source,
      'public.net_economy_identity_is_runtime_financial_candidate'
    ) = 0
    or pg_catalog.strpos(v_sheet_source, '''altara_bank''') = 0
    or pg_catalog.strpos(v_sheet_source, '''nova_bank''') > 0
  then
    raise exception 'NET_GM_FINANCE_CONTROL_SHEET_SOURCE_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select procedure_record.prosrc into v_shared_bank_history_source
  from pg_catalog.pg_proc as procedure_record
  where procedure_record.oid =
    'public.net_economy_bank_history_page(uuid,uuid,timestamptz,uuid,integer)'::regprocedure::oid;
  select procedure_record.prosrc into v_nova_history_source
  from pg_catalog.pg_proc as procedure_record
  where procedure_record.oid =
    'public.net_economy_nova_bank_history_page(uuid,timestamptz,uuid,integer)'::regprocedure::oid;
  if pg_catalog.strpos(v_shared_bank_history_source, '''bank-yield'', ''bank-transfer''') = 0
    or pg_catalog.strpos(v_shared_bank_history_source, '''gm-credit''') > 0
    or pg_catalog.strpos(v_nova_history_source, '''bank-fx-credit''') = 0
    or pg_catalog.strpos(v_nova_history_source, '''gm-credit''') > 0
  then
    raise exception 'NET_GM_FINANCE_CONTROL_HISTORY_SOURCE_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

    if (
    select count(*)
    from public.net_economy_institutions as institution
    where institution.id in (
      '00000000-0000-0000-0000-00000000e100'::uuid,
      '00000000-0000-0000-0000-00000000e101'::uuid,
      '00000000-0000-0000-0000-00000000e102'::uuid,
      '00000000-0000-0000-0000-00000000e103'::uuid
    )
      and institution.status = 'active'
  ) <> 4 then
    raise exception 'NET_GM_FINANCE_CONTROL_INSTITUTION_SET_REQUIRED'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.net_economy_accounts as account
    where account.id = '00000000-0000-0000-0000-00000000e001'::uuid
      and account.account_kind = 'system'
      and account.currency_code = 'VG'
      and account.status = 'active'
  ) or not exists (
    select 1 from public.net_economy_accounts as account
    where account.id = '00000000-0000-0000-0000-00000000e002'::uuid
      and account.account_kind = 'system'
      and account.currency_code = 'KARMA'
      and account.status = 'active'
  ) then
    raise exception 'NET_GM_FINANCE_CONTROL_LEGACY_TREASURY_REQUIRED'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from public.net_economy_accounts as account
    where account.id in (
      '00000000-0000-0000-0000-00000000e005'::uuid,
      '00000000-0000-0000-0000-00000000e006'::uuid
    )
  ) then
    raise exception 'NET_GM_FINANCE_CONTROL_TREASURY_ID_CONFLICT'
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.net_action_audit'::regclass
      and constraint_record.conname = 'net_action_audit_action_mode_check'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid) like '%system%'
  ) then
    raise exception 'NET_GM_FINANCE_CONTROL_AUDIT_SYSTEM_MODE_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

-- The legacy helper was role-only. Preserve every caller/signature while
-- making the canonical GM economy boundary explicitly GM-System-only.
create or replace function public.assert_net_economy_gm()
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return public.assert_net_system_admin();
end;
$$;

comment on function public.assert_net_economy_gm() is
  'Canonical GM economy assertion. Requires GM System mode; TAKE CONTROL, ACT AS, INSPECT, and compromised-session are not administrative adjustment authority.';

-- Existing VG/KARMA administration already owns e001/e002. FINIT/SECTUS get
-- dedicated administrative treasuries so GM issuance never changes the FX
-- clearing positions held in e003/e004.
insert into public.net_economy_accounts (
  id,
  identity_link_id,
  account_kind,
  institution_id,
  payment_identifier,
  currency_code,
  status,
  balance_amount
)
values
  (
    '00000000-0000-0000-0000-00000000e005'::uuid,
    null, 'system', null, null, 'FINIT', 'active', 0
  ),
  (
    '00000000-0000-0000-0000-00000000e006'::uuid,
    null, 'system', null, null, 'SECTUS', 'active', 0
  );

create or replace function public.net_economy_gm_treasury_account_id(
  requested_currency_code text
)
returns uuid
language sql
immutable
set search_path = public, pg_temp
as $$
  select case upper(btrim(coalesce(requested_currency_code, '')))
    when 'VG' then '00000000-0000-0000-0000-00000000e001'::uuid
    when 'KARMA' then '00000000-0000-0000-0000-00000000e002'::uuid
    when 'FINIT' then '00000000-0000-0000-0000-00000000e005'::uuid
    when 'SECTUS' then '00000000-0000-0000-0000-00000000e006'::uuid
    else null
  end;
$$;

create or replace function public.net_economy_gm_finance_account_service(
  requested_account_id uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when account.account_kind = 'wallet' then 'vlt'
    when account.institution_id = '00000000-0000-0000-0000-00000000e100'::uuid then 'vox-bank'
    when account.institution_id = '00000000-0000-0000-0000-00000000e101'::uuid then 'shneider-bank'
    when account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid then 'altara-bank'
    when account.institution_id = '00000000-0000-0000-0000-00000000e103'::uuid then 'nova-bank'
    else null
  end
  from public.net_economy_accounts as account
  where account.id = requested_account_id
    and account.account_kind <> 'system';
$$;

create or replace function public.net_economy_gm_finance_account_is_current(
  requested_identity_link_id uuid,
  requested_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select requested_identity_link_id is not null
    and requested_account_id is not null
    and exists (
      select 1
      from public.net_identity_links as identity_link
      join public.net_identity_os_assignments as assignment
        on assignment.identity_link_id = identity_link.id
      join public.net_os_families as os_family
        on os_family.id = assignment.primary_os_id
        and os_family.status = 'active'
      join public.net_economy_accounts as account
        on account.id = requested_account_id
        and account.identity_link_id = identity_link.id
        and account.account_kind <> 'system'
      left join public.net_economy_identity_currency_assignments as currency_assignment
        on currency_assignment.identity_link_id = identity_link.id
      where identity_link.id = requested_identity_link_id
        and public.net_economy_identity_is_runtime_financial_candidate(identity_link.id)
        and public.net_identity_link_can_access_service(
          identity_link.id,
          public.net_economy_gm_finance_account_service(account.id)
        )
        and (
          (
            assignment.primary_os_id = 'veil'
            and (
              (
                account.account_kind = 'wallet'
                and account.currency_code = 'VG'
              )
              or (
                account.account_kind = 'wallet'
                and account.currency_code = 'KARMA'
                and public.net_economy_identity_can_use_karma(identity_link.id)
              )
              or (
                account.account_kind = 'bank'
                and account.currency_code = 'VG'
                and account.institution_id in (
                  '00000000-0000-0000-0000-00000000e100'::uuid,
                  '00000000-0000-0000-0000-00000000e101'::uuid
                )
              )
            )
          )
          or (
            assignment.primary_os_id = 'altara'
            and currency_assignment.currency_code in ('FINIT', 'SECTUS')
            and account.account_kind = 'bank'
            and account.institution_id in (
              '00000000-0000-0000-0000-00000000e102'::uuid,
              '00000000-0000-0000-0000-00000000e103'::uuid
            )
            and account.currency_code = currency_assignment.currency_code
          )
        )
    );
$$;

create or replace function public.net_economy_gm_finance_identity_payload(
  requested_identity_link_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  -- Individually typed scalars: a rowtype/record variable cannot share a
  -- multiple-item INTO list with scalar targets (PostgreSQL 42601).
  v_identity_link_id public.net_identity_links.id%type;
  v_identity_kind public.net_identity_links.identity_kind%type;
  v_identity_playability public.net_identity_links.playability%type;
  v_identity_subject_kind public.net_identity_links.subject_kind%type;
  v_identity_subject_id public.net_identity_links.subject_id%type;
  v_primary_os_id text;
  v_home_currency_code text;
  v_presentation jsonb;
  v_accounts jsonb;
  v_altara_total numeric;
  v_altara_account_count integer;
begin
  select identity_link.id, identity_link.identity_kind, identity_link.playability,
    identity_link.subject_kind, identity_link.subject_id,
    assignment.primary_os_id, currency_assignment.currency_code
  into v_identity_link_id, v_identity_kind, v_identity_playability,
    v_identity_subject_kind, v_identity_subject_id,
    v_primary_os_id, v_home_currency_code
  from public.net_identity_links as identity_link
  join public.net_identity_os_assignments as assignment
    on assignment.identity_link_id = identity_link.id
  join public.net_os_families as os_family
    on os_family.id = assignment.primary_os_id
    and os_family.status = 'active'
  left join public.net_economy_identity_currency_assignments as currency_assignment
    on currency_assignment.identity_link_id = identity_link.id
  where identity_link.id = requested_identity_link_id
    and public.net_economy_identity_is_runtime_financial_candidate(identity_link.id);
  if not found then
    raise exception 'ECONOMY_FINANCE_IDENTITY_NOT_FOUND' using errcode = '22023';
  end if;

  v_presentation := public.net_altara_identity_presentation(v_identity_link_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'account_id', account.id,
    'account_kind', account.account_kind,
    'institution_code', case
      when account.account_kind = 'wallet' then 'VLT'
      else institution.institution_code
    end,
    'institution_name', case
      when account.account_kind = 'wallet' and account.currency_code = 'KARMA' then 'VLT // KARMA'
      when account.account_kind = 'wallet' then 'VLT WALLET'
      else institution.display_name
    end,
    'payment_identifier', account.payment_identifier,
    'currency', public.net_economy_currency_json(account.currency_code),
    'balance_amount', account.balance_amount,
    'status', account.status,
    'updated_at', account.updated_at
  ) order by
    case
      when account.account_kind = 'wallet' and account.currency_code = 'VG' then 1
      when account.account_kind = 'wallet' and account.currency_code = 'KARMA' then 2
      when account.institution_id = '00000000-0000-0000-0000-00000000e100'::uuid then 3
      when account.institution_id = '00000000-0000-0000-0000-00000000e101'::uuid then 4
      when account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid then 5
      when account.institution_id = '00000000-0000-0000-0000-00000000e103'::uuid then 6
      else 99
    end,
    account.created_at,
    account.id
  ), '[]'::jsonb)
  into v_accounts
  from public.net_economy_accounts as account
  left join public.net_economy_institutions as institution
    on institution.id = account.institution_id
  where public.net_economy_gm_finance_account_is_current(
    v_identity_link_id, account.id
  );

  if v_primary_os_id = 'altara' and v_home_currency_code in ('FINIT', 'SECTUS') then
    select count(*), coalesce(sum(account.balance_amount::numeric), 0)
    into v_altara_account_count, v_altara_total
    from public.net_economy_accounts as account
    where account.identity_link_id = v_identity_link_id
      and account.account_kind = 'bank'
      and account.institution_id in (
        '00000000-0000-0000-0000-00000000e102'::uuid,
        '00000000-0000-0000-0000-00000000e103'::uuid
      )
      and account.currency_code = v_home_currency_code
      and account.status = 'active'
      and public.net_economy_gm_finance_account_is_current(v_identity_link_id, account.id);
    -- No active ALTARA/NOVA account is absence, not a legitimate zero balance.
    if v_altara_account_count = 0 then
      v_altara_total := null;
    elsif v_altara_total > 9000000000000000 then
      raise exception 'ECONOMY_SHEET_FUNDS_RANGE_REVIEW_REQUIRED'
        using errcode = '22003';
    end if;
  else
    v_altara_total := null;
  end if;

  return jsonb_build_object(
    'server_now', timezone('utc', clock_timestamp()),
    'identity', jsonb_build_object(
      'identity_link_id', v_identity_link_id,
      'identity_kind', v_identity_kind,
      'playability', v_identity_playability,
      'subject_kind', v_identity_subject_kind,
      'subject_id', v_identity_subject_id,
      'display_name', coalesce(
        nullif(btrim(v_presentation ->> 'display_name'), ''),
        public.net_economy_identity_display_name(v_identity_link_id)
      ),
      'avatar_ref', nullif(btrim(v_presentation ->> 'avatar_url'), ''),
      'primary_os_id', v_primary_os_id,
      'home_currency', public.net_economy_currency_json(v_home_currency_code)
    ),
    'altara_funds_total', case
      when v_altara_total is null then null else v_altara_total::bigint
    end,
    'accounts', v_accounts
  );
end;
$$;

create or replace function public.fetch_net_economy_gm_finance_directory(
  requested_query text default null,
  requested_limit integer default 40
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := least(greatest(coalesce(requested_limit, 40), 1), 40);
begin
  perform public.assert_net_system_admin();
  if char_length(v_query) > 80 then
    raise exception 'ECONOMY_FINANCE_DIRECTORY_QUERY_INVALID' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'identity_link_id', result.identity_link_id,
      'identity_kind', result.identity_kind,
      'playability', result.playability,
      'subject_kind', result.subject_kind,
      'subject_id', result.subject_id,
      'display_name', result.display_name,
      'avatar_ref', result.avatar_ref,
      'primary_os_id', result.primary_os_id,
      'home_currency', public.net_economy_currency_json(result.home_currency_code),
      'account_count', result.account_count
    ) order by result.display_name, result.identity_link_id)
    from (
      select identity_link.id as identity_link_id,
        identity_link.identity_kind,
        identity_link.playability,
        identity_link.subject_kind,
        identity_link.subject_id,
        coalesce(
          nullif(btrim(presentation.value ->> 'display_name'), ''),
          public.net_economy_identity_display_name(identity_link.id)
        ) as display_name,
        nullif(btrim(presentation.value ->> 'avatar_url'), '') as avatar_ref,
        assignment.primary_os_id,
        currency_assignment.currency_code as home_currency_code,
        (
          select count(*)::integer
          from public.net_economy_accounts as account
          where public.net_economy_gm_finance_account_is_current(
            identity_link.id, account.id
          )
        ) as account_count
      from public.net_identity_links as identity_link
      join public.net_identity_os_assignments as assignment
        on assignment.identity_link_id = identity_link.id
      join public.net_os_families as os_family
        on os_family.id = assignment.primary_os_id
        and os_family.status = 'active'
      left join public.net_economy_identity_currency_assignments as currency_assignment
        on currency_assignment.identity_link_id = identity_link.id
      cross join lateral (
        select public.net_altara_identity_presentation(identity_link.id) as value
      ) as presentation
      where public.net_economy_identity_is_runtime_financial_candidate(identity_link.id)
        and (
          v_query = ''
          or lower(coalesce(
            nullif(btrim(presentation.value ->> 'display_name'), ''),
            public.net_economy_identity_display_name(identity_link.id)
          )) like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
            escape '\'
          or exists (
            select 1
            from public.net_economy_accounts as search_account
            where public.net_economy_gm_finance_account_is_current(
              identity_link.id, search_account.id
            )
              and search_account.payment_identifier like
                '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
                escape '\'
          )
        )
      order by display_name, identity_link.id
      limit v_limit
    ) as result
  ), '[]'::jsonb);
end;
$$;

create or replace function public.fetch_net_economy_gm_finance_identity(
  requested_identity_link_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_system_admin();
  if requested_identity_link_id is null then
    raise exception 'ECONOMY_FINANCE_IDENTITY_REQUIRED' using errcode = '22023';
  end if;
  return public.net_economy_gm_finance_identity_payload(requested_identity_link_id);
end;
$$;

create or replace function public.net_economy_lock_gm_finance_authority(
  requested_identity_link_id uuid,
  requested_account_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_account public.net_economy_accounts%rowtype;
  v_primary_os_id text;
  v_service_id text;
  v_scope_kind text;
  v_required_os_id text;
  v_home_currency_code text;
begin
  select account.* into v_account
  from public.net_economy_accounts as account
  where account.id = requested_account_id
    and account.identity_link_id = requested_identity_link_id
    and account.account_kind <> 'system';
  if not found then
    raise exception 'ECONOMY_FINANCE_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;
  v_service_id := public.net_economy_gm_finance_account_service(v_account.id);
  if v_service_id is null then
    raise exception 'ECONOMY_FINANCE_ACCOUNT_UNSUPPORTED' using errcode = '22023';
  end if;

  perform 1
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id
    and public.net_economy_identity_is_runtime_financial_candidate(identity_link.id)
  for share;
  if not found then
    raise exception 'ECONOMY_FINANCE_IDENTITY_NOT_FOUND' using errcode = '22023';
  end if;

  select assignment.primary_os_id into v_primary_os_id
  from public.net_identity_os_assignments as assignment
  join public.net_os_families as os_family
    on os_family.id = assignment.primary_os_id
    and os_family.status = 'active'
  where assignment.identity_link_id = requested_identity_link_id
  for share of assignment, os_family;
  if not found then
    raise exception 'NET_OS_ASSIGNMENT_REQUIRED' using errcode = '23514';
  end if;

  select scope.scope_kind, scope.required_os_id
  into v_scope_kind, v_required_os_id
  from public.net_os_service_scopes as scope
  where scope.service_id = v_service_id
  for share;
  if not found
    or (v_scope_kind = 'primary-os' and v_required_os_id is distinct from v_primary_os_id)
    or (v_scope_kind = 'global' and v_required_os_id is not null)
  then
    raise exception 'NET_SERVICE_SCOPE_DENIED' using errcode = '42501';
  end if;

  if v_primary_os_id = 'altara' then
    select assignment.currency_code into v_home_currency_code
    from public.net_economy_identity_currency_assignments as assignment
    where assignment.identity_link_id = requested_identity_link_id
    for share;
    if not found
      or v_home_currency_code not in ('FINIT', 'SECTUS')
      or v_account.currency_code is distinct from v_home_currency_code
    then
      raise exception 'ALTARA_BANK_CURRENCY_ASSIGNMENT_REQUIRED'
        using errcode = '23514';
    end if;
  elsif v_primary_os_id <> 'veil' then
    raise exception 'ECONOMY_FINANCE_OS_UNSUPPORTED' using errcode = '42501';
  end if;

  if v_account.account_kind = 'bank' then
    perform 1
    from public.net_economy_institutions as institution
    where institution.id = v_account.institution_id
      and institution.status = 'active'
    for share;
    if not found then
      raise exception 'ECONOMY_FINANCE_INSTITUTION_UNAVAILABLE'
        using errcode = '55000';
    end if;
  end if;

  v_actor := public.assert_net_system_admin();
  if not public.net_identity_link_can_access_service(
    requested_identity_link_id, v_service_id
  ) or not public.net_economy_gm_finance_account_is_current(
    requested_identity_link_id, requested_account_id
  ) then
    raise exception 'ECONOMY_FINANCE_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  return v_actor;
end;
$$;

create or replace function public.adjust_net_economy_gm_finance_account(
  requested_expected_identity_link_id uuid,
  requested_account_id uuid,
  requested_action text,
  requested_amount bigint,
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
  v_actor uuid;
  v_action text := lower(btrim(coalesce(requested_action, '')));
  v_note text := nullif(btrim(coalesce(requested_note, '')), '');
  v_account public.net_economy_accounts%rowtype;
  v_treasury public.net_economy_accounts%rowtype;
  v_existing public.net_economy_transactions%rowtype;
  v_transaction public.net_economy_transactions%rowtype;
  v_vox_state public.net_economy_vox_bank_state%rowtype;
  v_treasury_id uuid;
  v_kind text;
  v_delta bigint;
  v_scope text;
  v_fingerprint text;
begin
  v_actor := public.assert_net_system_admin();
  if requested_expected_identity_link_id is null or requested_account_id is null then
    raise exception 'ECONOMY_FINANCE_ACCOUNT_REQUIRED' using errcode = '22023';
  end if;
  if v_action not in ('credit', 'debit')
    or requested_amount is null
    or requested_amount not between 1 and 1000000000
    or requested_request_key is null
    or (v_note is not null and char_length(v_note) > 200)
  then
    raise exception 'ECONOMY_ADJUSTMENT_INVALID' using errcode = '22023';
  end if;

  select account.* into v_account
  from public.net_economy_accounts as account
  where account.id = requested_account_id
    and account.identity_link_id = requested_expected_identity_link_id
    and account.account_kind <> 'system'
    and public.net_economy_gm_finance_account_is_current(
      requested_expected_identity_link_id, account.id
    );
  if not found then
    raise exception 'ECONOMY_FINANCE_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;
  v_treasury_id := public.net_economy_gm_treasury_account_id(v_account.currency_code);
  if v_treasury_id is null then
    raise exception 'ECONOMY_CURRENCY_INVALID' using errcode = '22023';
  end if;

  -- Match the reviewed personal-finance ordering: lock the exact current
  -- identity/OS/service/currency authority before financial rows, then repeat
  -- the same proof after the account locks below.
  v_actor := public.net_economy_lock_gm_finance_authority(
    requested_expected_identity_link_id, requested_account_id
  );

  perform 1
  from public.net_economy_accounts as account
  where account.id in (requested_account_id, v_treasury_id)
  order by account.id
  for update;
  if not found then
    raise exception 'ECONOMY_FINANCE_ACCOUNT_UNAVAILABLE' using errcode = '55000';
  end if;

  v_actor := public.net_economy_lock_gm_finance_authority(
    requested_expected_identity_link_id, requested_account_id
  );

  select account.* into v_account
  from public.net_economy_accounts as account
  where account.id = requested_account_id
    and account.identity_link_id = requested_expected_identity_link_id
    and account.account_kind <> 'system'
    and account.status = 'active'
    and public.net_economy_gm_finance_account_is_current(
      requested_expected_identity_link_id, account.id
    );
  select account.* into v_treasury
  from public.net_economy_accounts as account
  where account.id = v_treasury_id
    and account.account_kind = 'system'
    and account.currency_code = v_account.currency_code
    and account.status = 'active';
  if v_account.id is null or v_treasury.id is null then
    raise exception 'ECONOMY_FINANCE_ACCOUNT_UNAVAILABLE' using errcode = '55000';
  end if;
  -- VOX's yield clock resets on every balance-changing event for the
  -- account, exactly like a real deposit or withdrawal. This must run for
  -- both directions so a GM credit cannot leave newly added funds anchored
  -- to a stale, already-elapsed period.
  if v_account.institution_id = '00000000-0000-0000-0000-00000000e100'::uuid then
    select state.* into v_vox_state
    from public.net_economy_vox_bank_state as state
    where state.account_id = v_account.id
    for update;
    if not found then
      raise exception 'VOX_BANK_STATE_UNAVAILABLE' using errcode = '55000';
    end if;
  end if;

  v_kind := case v_action when 'credit' then 'gm-credit' else 'gm-debit' end;
  v_delta := case v_action when 'credit' then requested_amount else -requested_amount end;
  v_scope := 'gm:' || v_actor::text;
  v_fingerprint := md5(
    requested_expected_identity_link_id::text || ':' || requested_account_id::text
    || ':' || v_account.currency_code || ':' || v_action || ':'
    || requested_amount::text || ':' || coalesce(v_note, '')
  );

  -- Return the exact-retry result now: after authority/context/account
  -- revalidation and locking above, but before the mutable business
  -- preconditions below that the original successful request itself may
  -- have changed (e.g. balance no longer covering a debit it already paid).
  select transaction_record.* into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;
  if found then
    if v_existing.transaction_kind <> v_kind
      or v_existing.currency_code <> v_account.currency_code
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.net_economy_gm_finance_identity_payload(
      requested_expected_identity_link_id
    );
  end if;

  if v_account.currency_code = 'KARMA'
    and not public.net_economy_identity_can_use_karma(
      requested_expected_identity_link_id
    )
  then
    raise exception 'ECONOMY_KARMA_NOT_AVAILABLE' using errcode = '22023';
  end if;
  if v_action = 'debit'
    and v_account.currency_code <> 'KARMA'
    and v_account.balance_amount < requested_amount
  then
    raise exception 'ECONOMY_INSUFFICIENT_FUNDS' using errcode = '22023';
  end if;
  if v_account.currency_code = 'KARMA'
    and abs((v_account.balance_amount + v_delta)::numeric) > 1000000000
  then
    raise exception 'ECONOMY_KARMA_RANGE_INVALID' using errcode = '22003';
  end if;
  if abs((v_account.balance_amount + v_delta)::numeric) > 9000000000000000
    or abs((v_treasury.balance_amount - v_delta)::numeric) > 9000000000000000
  then
    raise exception 'ECONOMY_BALANCE_RANGE_INVALID' using errcode = '22003';
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
    v_note,
    v_account.currency_code
  )
  on conflict (request_scope, request_key) do nothing
  returning * into v_transaction;

  if v_transaction.id is null then
    select transaction_record.* into v_existing
    from public.net_economy_transactions as transaction_record
    where transaction_record.request_scope = v_scope
      and transaction_record.request_key = requested_request_key;
    if not found
      or v_existing.transaction_kind <> v_kind
      or v_existing.currency_code <> v_account.currency_code
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.net_economy_gm_finance_identity_payload(
      requested_expected_identity_link_id
    );
  end if;

  insert into public.net_economy_transaction_entries (
    transaction_id, account_id, amount, created_at
  ) values
    (v_transaction.id, v_account.id, v_delta, v_transaction.created_at),
    (v_transaction.id, v_treasury.id, -v_delta, v_transaction.created_at);

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount + v_delta
  where account.id = v_account.id;
  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount - v_delta
  where account.id = v_treasury.id;
  if v_vox_state.account_id is not null then
    update public.net_economy_vox_bank_state as state
    set
      yield_anchor_at = v_transaction.created_at,
      yield_principal_amount = v_account.balance_amount + v_delta
    where state.account_id = v_vox_state.account_id;
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
    null,
    null,
    'system',
    case v_action
      when 'credit' then 'economy.finance-control.credit'
      else 'economy.finance-control.debit'
    end,
    'authoritative-gm-system-finance-control',
    'economy-transaction',
    v_transaction.id
  );

  return public.net_economy_gm_finance_identity_payload(
    requested_expected_identity_link_id
  );
end;
$$;

-- Administrative entries are ordinary immutable account activity. Preserve
-- each bank's existing statement shape while making gm-credit/gm-debit visible.
create or replace function public.net_economy_bank_history_page(
  requested_account_id uuid,
  requested_institution_id uuid,
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
        public.net_economy_identity_display_name(other_account.identity_link_id)
          as display_name
      from public.net_economy_transaction_entries as other_entry
      join public.net_economy_accounts as other_account
        on other_account.id = other_entry.account_id
      where transaction_record.transaction_kind = 'bank-transfer'
        and other_entry.transaction_id = entry.transaction_id
        and other_entry.account_id <> requested_account_id
        and other_account.account_kind = 'bank'
        and other_account.institution_id = requested_institution_id
        and other_account.currency_code = 'VG'
      limit 1
    ) as counterparty on true
    cross join settings
    where entry.account_id = requested_account_id
      and transaction_record.currency_code = 'VG'
      and transaction_record.transaction_kind in (
        'bank-deposit', 'bank-withdrawal', 'bank-yield', 'bank-transfer',
        'gm-credit', 'gm-debit'
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
        'bank-transfer', 'bank-fx-debit', 'bank-fx-credit',
        'gm-credit', 'gm-debit'
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

-- ALTARA sheets now aggregate active current-currency customer balances from
-- ALTARA BANK and NOVA BANK. The total remains read-only; institution-specific
-- adjustments belong to Finance Control.
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
  v_nova public.net_economy_accounts%rowtype;
  v_home_currency_code text;
  v_altara_funds_total numeric;
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
    and public.net_economy_identity_is_runtime_financial_candidate(identity_link.id);
  if v_identity_count = 0 then
    return jsonb_build_object(
      'server_now', timezone('utc', clock_timestamp()),
      'primary_os_id', null,
      'home_currency', null,
      'vlt', null,
      'vox_bank', null,
      'shneider_bank', null,
      'altara_bank', null,
      'nova_bank', null,
      'altara_funds_total', null
    );
  end if;
  if v_identity_count > 1 then
    raise exception 'ECONOMY_SHEET_IDENTITY_AMBIGUOUS' using errcode = '23514';
  end if;

  select identity_link.id, assignment.primary_os_id,
    currency_assignment.currency_code
  into v_identity_link_id, v_primary_os_id, v_home_currency_code
  from public.net_identity_links as identity_link
  join public.net_identity_os_assignments as assignment
    on assignment.identity_link_id = identity_link.id
  join public.net_os_families as os_family
    on os_family.id = assignment.primary_os_id
    and os_family.status = 'active'
  left join public.net_economy_identity_currency_assignments as currency_assignment
    on currency_assignment.identity_link_id = identity_link.id
  where identity_link.subject_kind = requested_subject_kind
    and identity_link.subject_id = requested_subject_id
    and public.net_economy_identity_is_runtime_financial_candidate(identity_link.id);
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
  elsif v_primary_os_id = 'altara' then
    if v_home_currency_code not in ('FINIT', 'SECTUS') then
      v_home_currency_code := null;
    else
      if public.net_identity_link_can_access_service(v_identity_link_id, 'altara-bank') then
        select * into v_altara
        from public.net_economy_accounts as account
        where account.identity_link_id = v_identity_link_id
          and account.account_kind = 'bank'
          and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
          and account.currency_code = v_home_currency_code
          and account.status = 'active';
      end if;
      if public.net_identity_link_can_access_service(v_identity_link_id, 'nova-bank') then
        select * into v_nova
        from public.net_economy_accounts as account
        where account.identity_link_id = v_identity_link_id
          and account.account_kind = 'bank'
          and account.institution_id = '00000000-0000-0000-0000-00000000e103'::uuid
          and account.currency_code = v_home_currency_code
          and account.status = 'active';
      end if;
      -- Neither bank installed/open is absence, not a legitimate zero total.
      if v_altara.id is null and v_nova.id is null then
        v_altara_funds_total := null;
      else
        v_altara_funds_total := coalesce(v_altara.balance_amount, 0)::numeric
          + coalesce(v_nova.balance_amount, 0)::numeric;
        if v_altara_funds_total > 9000000000000000 then
          raise exception 'ECONOMY_SHEET_FUNDS_RANGE_REVIEW_REQUIRED'
            using errcode = '22003';
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'server_now', timezone('utc', clock_timestamp()),
    'primary_os_id', v_primary_os_id,
    'home_currency', public.net_economy_currency_json(v_home_currency_code),
    'vlt', case when v_vlt.id is null then null else jsonb_build_object(
      'account_id', v_vlt.id,
      'balance_amount', v_vlt.balance_amount,
      'currency_code', v_vlt.currency_code,
      'updated_at', v_vlt.updated_at
    ) end,
    'vox_bank', case when v_vox.id is null then null else jsonb_build_object(
      'account_id', v_vox.id,
      'balance_amount', v_vox.balance_amount,
      'currency_code', v_vox.currency_code,
      'updated_at', v_vox.updated_at
    ) end,
    'shneider_bank', case when v_shneider.id is null then null else jsonb_build_object(
      'account_id', v_shneider.id,
      'balance_amount', v_shneider.balance_amount,
      'currency_code', v_shneider.currency_code,
      'updated_at', v_shneider.updated_at
    ) end,
    'altara_bank', case when v_altara.id is null then null else jsonb_build_object(
      'account_id', v_altara.id,
      'balance_amount', v_altara.balance_amount,
      'currency_code', v_altara.currency_code,
      'currency', public.net_economy_currency_json(v_altara.currency_code),
      'updated_at', v_altara.updated_at
    ) end,
    'nova_bank', case when v_nova.id is null then null else jsonb_build_object(
      'account_id', v_nova.id,
      'balance_amount', v_nova.balance_amount,
      'currency_code', v_nova.currency_code,
      'currency', public.net_economy_currency_json(v_nova.currency_code),
      'updated_at', v_nova.updated_at
    ) end,
    'altara_funds_total', case
      when v_altara_funds_total is null then null
      else v_altara_funds_total::bigint
    end
  );
end;
$$;

revoke all on function public.assert_net_economy_gm()
  from public, anon, authenticated;
revoke all on function public.net_economy_gm_treasury_account_id(text)
  from public, anon, authenticated;
revoke all on function public.net_economy_gm_finance_account_service(uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_gm_finance_account_is_current(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_gm_finance_identity_payload(uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_lock_gm_finance_authority(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_bank_history_page(uuid,uuid,timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_nova_bank_history_page(uuid,timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_economy_gm_finance_directory(text,integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_economy_gm_finance_identity(uuid)
  from public, anon, authenticated;
revoke all on function public.adjust_net_economy_gm_finance_account(uuid,uuid,text,bigint,text,uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_economy_sheet_account_sources(text,uuid)
  from public, anon, authenticated;

grant execute on function public.fetch_net_economy_gm_finance_directory(text,integer)
  to authenticated;
grant execute on function public.fetch_net_economy_gm_finance_identity(uuid)
  to authenticated;
grant execute on function public.adjust_net_economy_gm_finance_account(uuid,uuid,text,bigint,text,uuid)
  to authenticated;
grant execute on function public.fetch_net_economy_sheet_account_sources(text,uuid)
  to authenticated;

do $$
begin
  if exists (
    select 1
    from information_schema.role_table_grants as grant_record
    where grant_record.table_schema = 'public'
      and grant_record.table_name in (
        'net_economy_accounts',
        'net_economy_transactions',
        'net_economy_transaction_entries'
      )
      and grant_record.grantee in ('anon', 'authenticated')
  ) then
    raise exception 'NET_GM_FINANCE_CONTROL_RAW_TABLE_GRANT_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.net_economy_accounts as account
    where account.id = '00000000-0000-0000-0000-00000000e005'::uuid
      and account.account_kind = 'system'
      and account.currency_code = 'FINIT'
      and account.status = 'active'
      and account.balance_amount = 0
  ) or not exists (
    select 1 from public.net_economy_accounts as account
    where account.id = '00000000-0000-0000-0000-00000000e006'::uuid
      and account.account_kind = 'system'
      and account.currency_code = 'SECTUS'
      and account.status = 'active'
      and account.balance_amount = 0
  ) then
    raise exception 'NET_GM_FINANCE_CONTROL_TREASURY_PROOF_FAILED'
      using errcode = '23514';
  end if;
end;
$$;

comment on function public.fetch_net_economy_gm_finance_directory(text,integer) is
  'Bounded GM-System-only directory of current canonical financial identities. No account is opened or provisioned.';
comment on function public.fetch_net_economy_gm_finance_identity(uuid) is
  'GM-System-only current financial-account projection for one exact canonical identity.';
comment on function public.adjust_net_economy_gm_finance_account(uuid,uuid,text,bigint,text,uuid) is
  'GM-System-only balanced credit/debit of one comparison-bound existing customer account with actor-scoped UUID idempotency.';
comment on function public.fetch_net_economy_sheet_account_sources(text,uuid) is
  'Read-only sheet projection: VEIL preserves VLT/VOX/SHNEIDER semantics; ALTARA exposes active home-currency ALTARA BANK and NOVA BANK accounts plus a guarded aggregate.';

commit;
