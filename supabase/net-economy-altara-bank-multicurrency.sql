begin;

-- ALTARA BANK multi-city / multi-currency correction.
--
-- The deployed ALTARA BANK V1 incorrectly treated New Vega VG as ALTARA's
-- currency and offered a one-time VLT adoption. This forward-only migration
-- keeps that history immutable, reverses only the proven adopted principal
-- through a balanced VG compensation, retires every legacy e102/VG account,
-- and introduces explicit home currencies plus manual, integer-ratio FX. No VG
-- is ever relabelled, copied, converted, or used to open a local-currency bank.

do $$
begin
  if to_regclass('public.net_economy_accounts') is null
    or to_regclass('public.net_economy_transactions') is null
    or to_regclass('public.net_economy_transaction_entries') is null
    or to_regclass('public.net_economy_wallet_realtime_state') is null
    or to_regclass('public.net_economy_altara_bank_adoptions') is null
    or to_regprocedure('public.net_economy_assert_balanced_transaction()') is null
    or to_regprocedure('public.net_economy_assert_altara_bank_player_context(uuid)') is null
    or to_regprocedure('public.net_economy_lock_altara_bank_authority(uuid,uuid)') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.net_altara_identity_presentation(uuid)') is null
    or to_regprocedure(
      'public.net_altara_messenger_avatar_ref_contains_object(uuid,text,text)'
    ) is null
    or to_regclass(
      'public.net_economy_accounts_bank_identity_institution_currency_unique'
    ) is null
    or not exists (
      select 1
      from pg_index as index_record
      where index_record.indexrelid =
        to_regclass(
          'public.net_economy_accounts_bank_identity_institution_currency_unique'
        )
        and index_record.indisunique
        and index_record.indnkeyatts = 3
        and pg_get_indexdef(index_record.indexrelid, 1, true) = 'identity_link_id'
        and pg_get_indexdef(index_record.indexrelid, 2, true) = 'institution_id'
        and pg_get_indexdef(index_record.indexrelid, 3, true) = 'currency_code'
        and index_record.indpred is not null
        and lower(regexp_replace(
          replace(
            pg_get_expr(index_record.indpred, index_record.indrelid),
            '::text',
            ''
          ),
          '[()[:space:]]',
          '',
          'g'
        )) = 'account_kind=''bank'''
    )
  then
    raise exception 'ALTARA_MULTICURRENCY_DEPENDENCY_REVIEW_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.net_economy_institutions as institution
    where institution.id = '00000000-0000-0000-0000-00000000e102'::uuid
      and institution.institution_code = 'ALTARA'
      and institution.display_name = 'ALTARA BANK'
      and institution.owner_name = 'ALTARA'
      and institution.status = 'active'
  ) then
    raise exception 'ALTARA_MULTICURRENCY_INSTITUTION_REVIEW_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.net_economy_accounts as account
    where account.id = '00000000-0000-0000-0000-00000000e001'::uuid
      and account.account_kind = 'system'
      and account.currency_code = 'VG'
      and account.status = 'active'
  ) or not exists (
    select 1
    from public.net_economy_accounts as account
    where account.id = '00000000-0000-0000-0000-00000000e002'::uuid
      and account.account_kind = 'system'
      and account.currency_code = 'KARMA'
      and account.status = 'active'
  ) then
    raise exception 'ALTARA_MULTICURRENCY_EXISTING_CLEARING_REVIEW_REQUIRED' using errcode = '55000';
  end if;

  if to_regclass('public.net_economy_currencies') is not null
    or to_regclass('public.net_economy_identity_currency_assignments') is not null
    or to_regclass('public.net_economy_identity_currency_assignment_audit') is not null
    or to_regclass('public.net_economy_fx_rates') is not null
    or to_regclass('public.net_economy_fx_rate_audit') is not null
    or to_regclass('public.net_economy_altara_bank_fx_operations') is not null
    or exists (
    select 1
    from public.net_economy_accounts as account
    where account.currency_code in ('FINIT', 'SECTUS')
  ) or exists (
    select 1
    from public.net_economy_transactions as transaction_record
    where transaction_record.currency_code in ('FINIT', 'SECTUS')
  ) then
    raise exception 'ALTARA_MULTICURRENCY_PREEXISTING_STATE_REVIEW_REQUIRED' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.net_economy_accounts as account
    where account.id in (
      '00000000-0000-0000-0000-00000000e003'::uuid,
      '00000000-0000-0000-0000-00000000e004'::uuid
    )
  ) then
    raise exception 'ALTARA_MULTICURRENCY_CLEARING_ID_COLLISION_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  -- The deployed opening helper must still be the VG-adoption implementation
  -- this migration was written to compensate. A different live definition is
  -- an accounting review, never an invitation to guess.
  if position(
    'altara-bank-adoption'
    in lower(pg_get_functiondef(
      'public.net_economy_open_altara_bank_for_link(uuid)'::regprocedure::oid
    ))
  ) = 0 or position(
    'historical vlt adoption'
    in lower(pg_get_functiondef(
      'public.net_economy_open_altara_bank_for_link(uuid)'::regprocedure::oid
    ))
  ) = 0 then
    raise exception 'ALTARA_MULTICURRENCY_DEPLOYED_OPEN_CONTRACT_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

create table public.net_economy_currencies (
  currency_code text primary key,
  display_name text not null,
  singular_label text not null,
  plural_label text not null,
  decimals smallint not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_economy_currencies_code_valid check (
    currency_code = upper(btrim(currency_code))
    and currency_code ~ '^[A-Z][A-Z0-9_]{1,15}$'
  ),
  constraint net_economy_currencies_labels_valid check (
    display_name = btrim(display_name)
    and singular_label = btrim(singular_label)
    and plural_label = btrim(plural_label)
    and char_length(display_name) between 1 and 60
    and char_length(singular_label) between 1 and 30
    and char_length(plural_label) between 1 and 30
  ),
  constraint net_economy_currencies_decimals_valid check (decimals = 0),
  constraint net_economy_currencies_status_valid check (status in ('active', 'inactive'))
);

insert into public.net_economy_currencies (
  currency_code, display_name, singular_label, plural_label
) values
  ('VG', 'New Vega VG', 'vG', 'vG'),
  ('FINIT', 'Cité de L''Infini Finit', 'Finit', 'Finits'),
  ('SECTUS', 'Era City Sectus', 'Sectus', 'Sectus');

create table public.net_economy_identity_currency_assignments (
  identity_link_id uuid primary key
    references public.net_identity_links (id) on delete restrict,
  currency_code text not null
    references public.net_economy_currencies (currency_code) on delete restrict,
  assignment_basis text not null,
  assigned_by_profile_id uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_economy_identity_currency_assignment_basis_valid check (
    assignment_basis in ('reviewed-production-seed', 'gm-explicit')
  ),
  constraint net_economy_identity_currency_assignment_actor_valid check (
    (assignment_basis = 'reviewed-production-seed' and assigned_by_profile_id is null)
    or (assignment_basis = 'gm-explicit' and assigned_by_profile_id is not null)
  )
);

create table public.net_economy_identity_currency_assignment_audit (
  id uuid primary key default gen_random_uuid(),
  identity_link_id uuid not null
    references public.net_identity_links (id) on delete restrict,
  previous_currency_code text
    references public.net_economy_currencies (currency_code) on delete restrict,
  assigned_currency_code text
    references public.net_economy_currencies (currency_code) on delete restrict,
  reason text not null,
  assigned_by_profile_id uuid not null
    references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  constraint net_economy_identity_currency_audit_change_valid check (
    previous_currency_code is distinct from assigned_currency_code
  ),
  constraint net_economy_identity_currency_audit_reason_valid check (
    reason = btrim(reason) and char_length(reason) between 1 and 200
  )
);

create index net_economy_identity_currency_audit_identity_created_idx
  on public.net_economy_identity_currency_assignment_audit (
    identity_link_id, created_at desc, id desc
  );

do $$
begin
  if not exists (
    select 1 from public.net_identity_links as identity_link
    where identity_link.id = '8e7ebd04-f106-4db8-877b-bb83919406e0'::uuid
      and identity_link.subject_kind = 'npc-card'
      and identity_link.subject_id = '9f9873b5-89fd-40d5-9682-e20173b10e85'::uuid
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
  ) or not exists (
    select 1 from public.net_identity_links as identity_link
    where identity_link.id = '93497f00-fdd8-4153-a1db-be811f88ef64'::uuid
      and identity_link.subject_kind = 'profile-sheet'
      and identity_link.subject_id = 'ffa69533-8497-4734-8bba-ef8ccef59f21'::uuid
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
  ) then
    raise exception 'ALTARA_MULTICURRENCY_REVIEWED_IDENTITY_MAP_REQUIRED'
      using errcode = '23514';
  end if;
end;
$$;

insert into public.net_economy_identity_currency_assignments (
  identity_link_id, currency_code, assignment_basis, assigned_by_profile_id
) values
  (
    '8e7ebd04-f106-4db8-877b-bb83919406e0'::uuid,
    'FINIT',
    'reviewed-production-seed',
    null
  ),
  (
    '93497f00-fdd8-4153-a1db-be811f88ef64'::uuid,
    'SECTUS',
    'reviewed-production-seed',
    null
  );

create or replace function public.net_economy_currency_display(
  requested_currency_code text,
  requested_amount bigint
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_currency public.net_economy_currencies%rowtype;
begin
  select * into v_currency
  from public.net_economy_currencies as currency
  where currency.currency_code = upper(btrim(coalesce(requested_currency_code, '')))
    and currency.status = 'active';
  if not found then
    raise exception 'ECONOMY_CURRENCY_REQUIRED' using errcode = '22023';
  end if;
  return coalesce(requested_amount, 0)::text || ' ' || case
    when coalesce(requested_amount, 0) = 1 then v_currency.singular_label
    else v_currency.plural_label
  end;
end;
$$;

-- Preserve the deployed Karma write path before replacing only CASH source
-- selection. Numeric sheet requests are interpreted by the bounded save RPCs
-- before these BEFORE triggers canonicalize presentation; ALTARA remains
-- service-denied and Adrian keeps the exact '--' sentinel.
do $$
declare
  v_npc_patch regprocedure :=
    to_regprocedure('public.patch_npc_card_field_data_v2(uuid,jsonb,text[])');
  v_profile_patch regprocedure :=
    to_regprocedure('public.patch_character_sheet_field_data_v2(uuid,jsonb,text[],text)');
  v_karma_request regprocedure :=
    to_regprocedure('public.net_economy_apply_sheet_karma_request(text,uuid,jsonb)');
  v_karma_absolute regprocedure := to_regprocedure(
    'public.net_economy_apply_sheet_karma_absolute_balance(uuid,bigint,text,uuid)'
  );
  v_legacy_save regprocedure := to_regprocedure(
    'public.save_character_stats_bidirectional_v2(uuid,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)'
  );
begin
  if v_npc_patch is null
    or v_profile_patch is null
    or v_legacy_save is null
    or v_karma_request is null
    or v_karma_absolute is null
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
    raise exception 'ALTARA_MULTICURRENCY_KARMA_PATH_REVIEW_REQUIRED'
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
    raise exception 'ALTARA_MULTICURRENCY_SHEET_TRIGGER_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

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
  v_home_currency_code text;
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

  select identity_link.id, assignment.primary_os_id, currency_assignment.currency_code
  into v_identity_link_id, v_primary_os_id, v_home_currency_code
  from public.net_identity_links as identity_link
  left join public.net_identity_os_assignments as assignment
    on assignment.identity_link_id = identity_link.id
  left join public.net_economy_identity_currency_assignments as currency_assignment
    on currency_assignment.identity_link_id = identity_link.id
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
    if v_cash_account.id is not null then
      v_cash_display := public.net_economy_cash_display(
        v_cash_account.balance_amount
      );
    end if;
  elsif v_primary_os_id = 'altara' and v_home_currency_code is not null then
    select * into v_cash_account
    from public.net_economy_accounts as account
    where account.identity_link_id = v_identity_link_id
      and account.account_kind = 'bank'
      and account.institution_id =
        '00000000-0000-0000-0000-00000000e102'::uuid
      and account.currency_code = v_home_currency_code
      and account.status = 'active';
    if v_cash_account.id is not null then
      v_cash_display := public.net_economy_currency_display(
        v_cash_account.currency_code,
        v_cash_account.balance_amount
      );
    end if;
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
        and new.institution_id =
          '00000000-0000-0000-0000-00000000e102'::uuid
      )
    then
      perform public.net_economy_sync_identity_cash_mirror(v_link.id);
    end if;
    return new;
  end if;

  if new.currency_code in ('FINIT', 'SECTUS') then
    if v_primary_os_id = 'altara'
      and new.account_kind = 'bank'
      and new.institution_id =
        '00000000-0000-0000-0000-00000000e102'::uuid
    then
      perform public.net_economy_sync_identity_cash_mirror(v_link.id);
    end if;
    return new;
  end if;

  -- Exact deployed Karma mirror behavior below is intentionally unchanged.
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
      perform set_config(
        'app.net_economy_origin',
        coalesce(v_previous_origin, ''),
        true
      );
      raise;
  end;
  perform set_config(
    'app.net_economy_origin',
    coalesce(v_previous_origin, ''),
    true
  );
  return new;
end;
$$;

-- Freeze every ledger and authority relation that can change the correction
-- population or its balances. The transaction remains atomic and no client can
-- observe an intermediate legacy-VG/local-currency state.
lock table public.net_economy_accounts in share row exclusive mode;
lock table public.net_economy_transactions in share row exclusive mode;
lock table public.net_economy_transaction_entries in share row exclusive mode;
lock table public.net_economy_altara_bank_adoptions in share row exclusive mode;
lock table public.net_economy_wallet_realtime_state in share row exclusive mode;
lock table public.net_identity_links in share mode;
lock table public.net_identity_os_assignments in share mode;
lock table public.net_os_families in share mode;
lock table public.net_identity_app_installs in share mode;
lock table public.net_economy_currencies in share row exclusive mode;
lock table public.net_economy_identity_currency_assignments in share row exclusive mode;

-- Closed bank accounts are immutable history, not live denomination slots.
-- The deployed partial index covers every row with account_kind = 'bank', so
-- it still prevents a later legitimate active account in the same currency
-- after retiring legacy e102/VG. The deployed VOX, SHNEIDER, and legacy ALTARA
-- openers use targetless ON CONFLICT DO NOTHING; they do not rely on column-list
-- inference and continue to treat this one-active index as a conflict arbiter.
-- Preserve the established key while narrowing it to the canonical active slot.
drop index public.net_economy_accounts_bank_identity_institution_currency_unique;
create unique index net_economy_accounts_bank_identity_institution_currency_unique
  on public.net_economy_accounts (identity_link_id, institution_id, currency_code)
  where account_kind = 'bank' and status = 'active';

-- FINIT and SECTUS are true ledger currencies. Existing VG and KARMA rows are
-- validated in place without changing any amount, key, or timestamp.
alter table public.net_economy_accounts
  drop constraint if exists net_economy_accounts_currency_valid;
alter table public.net_economy_accounts
  add constraint net_economy_accounts_currency_valid
  check (currency_code in ('VG', 'KARMA', 'FINIT', 'SECTUS')) not valid;
alter table public.net_economy_accounts
  validate constraint net_economy_accounts_currency_valid;

alter table public.net_economy_transactions
  drop constraint if exists net_economy_transactions_currency_valid;
alter table public.net_economy_transactions
  add constraint net_economy_transactions_currency_valid
  check (currency_code in ('VG', 'KARMA', 'FINIT', 'SECTUS')) not valid;
alter table public.net_economy_transactions
  validate constraint net_economy_transactions_currency_valid;

alter table public.net_economy_transactions
  drop constraint if exists net_economy_transactions_kind_valid;
alter table public.net_economy_transactions
  add constraint net_economy_transactions_kind_valid check (
    transaction_kind in (
      'opening-balance',
      'transfer',
      'gm-credit',
      'gm-debit',
      'bank-deposit',
      'bank-withdrawal',
      'bank-yield',
      'bank-transfer',
      'bank-fx-debit',
      'bank-fx-credit',
      'bank-adoption-correction',
      'sheet-vg-adjustment',
      'sheet-karma-adjustment'
    )
  ) not valid;
alter table public.net_economy_transactions
  validate constraint net_economy_transactions_kind_valid;

alter table public.net_economy_transactions
  drop constraint if exists net_economy_transactions_actor_valid;
alter table public.net_economy_transactions
  add constraint net_economy_transactions_actor_valid check (
    (
      transaction_kind in ('opening-balance', 'bank-adoption-correction')
      and initiated_by_profile_id is null
    ) or (
      transaction_kind not in ('opening-balance', 'bank-adoption-correction')
      and initiated_by_profile_id is not null
    )
  ) not valid;
alter table public.net_economy_transactions
  validate constraint net_economy_transactions_actor_valid;

-- VOX and SHNEIDER remain strictly VG. ALTARA accepts any active catalog city
-- currency except KARMA; the reviewed legacy e102/VG accounts are closed below.
create or replace function public.net_economy_enforce_independent_bank_currency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.institution_id in (
    '00000000-0000-0000-0000-00000000e100'::uuid,
    '00000000-0000-0000-0000-00000000e101'::uuid
  ) and (new.account_kind <> 'bank' or new.currency_code <> 'VG') then
    raise exception 'ECONOMY_BANK_CURRENCY_INVALID' using errcode = '23514';
  end if;

  if new.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid then
    if new.account_kind <> 'bank'
      or new.currency_code = 'KARMA'
      or not exists (
        select 1
        from public.net_economy_currencies as currency
        where currency.currency_code = new.currency_code
          and currency.status = 'active'
          and currency.decimals = 0
      )
    then
      raise exception 'ALTARA_BANK_CURRENCY_INVALID' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create index if not exists net_economy_accounts_altara_currency_directory_idx
  on public.net_economy_accounts (
    institution_id, status, currency_code, payment_identifier
  ) where account_kind = 'bank';

-- Local currencies have dedicated clearing accounts. e001 remains VG and e002
-- remains KARMA; neither KARMA nor another currency is mixed into these rows.
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
    '00000000-0000-0000-0000-00000000e003'::uuid,
    null, 'system', null, null, 'FINIT', 'active', 0
  ),
  (
    '00000000-0000-0000-0000-00000000e004'::uuid,
    null, 'system', null, null, 'SECTUS', 'active', 0
  );

create table public.net_economy_fx_rates (
  currency_a text not null
    references public.net_economy_currencies (currency_code) on delete restrict,
  currency_b text not null
    references public.net_economy_currencies (currency_code) on delete restrict,
  units_a bigint not null,
  units_b bigint not null,
  revision uuid not null default gen_random_uuid(),
  active boolean not null default true,
  reason text not null,
  updated_by_profile_id uuid not null
    references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (currency_a, currency_b),
  unique (revision),
  constraint net_economy_fx_rates_pair_valid check (
    currency_a < currency_b and currency_a <> 'KARMA' and currency_b <> 'KARMA'
  ),
  constraint net_economy_fx_rates_units_valid check (
    units_a between 1 and 1000000000
    and units_b between 1 and 1000000000
  ),
  constraint net_economy_fx_rates_reason_valid check (
    reason = btrim(reason) and char_length(reason) between 1 and 200
  )
);

create table public.net_economy_fx_rate_audit (
  revision uuid primary key,
  currency_a text not null
    references public.net_economy_currencies (currency_code) on delete restrict,
  currency_b text not null
    references public.net_economy_currencies (currency_code) on delete restrict,
  units_a bigint not null,
  units_b bigint not null,
  active boolean not null,
  reason text not null,
  updated_by_profile_id uuid not null
    references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  constraint net_economy_fx_rate_audit_pair_valid check (
    currency_a < currency_b and currency_a <> 'KARMA' and currency_b <> 'KARMA'
  ),
  constraint net_economy_fx_rate_audit_units_valid check (
    units_a between 1 and 1000000000
    and units_b between 1 and 1000000000
  ),
  constraint net_economy_fx_rate_audit_reason_valid check (
    reason = btrim(reason) and char_length(reason) between 1 and 200
  )
);

create index net_economy_fx_rate_audit_pair_created_idx
  on public.net_economy_fx_rate_audit (
    currency_a, currency_b, created_at desc, revision desc
  );

create table public.net_economy_altara_bank_fx_operations (
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
  constraint net_economy_altara_fx_currency_valid check (
    source_currency_code <> target_currency_code
    and source_currency_code <> 'KARMA'
    and target_currency_code <> 'KARMA'
  ),
  constraint net_economy_altara_fx_amount_valid check (
    source_amount between 1 and 1000000000
    and target_amount between 1 and 1000000000
  ),
  constraint net_economy_altara_fx_rate_units_valid check (
    source_units between 1 and 1000000000
    and target_units between 1 and 1000000000
  ),
  constraint net_economy_altara_fx_request_valid check (
    request_scope = btrim(request_scope)
    and char_length(request_scope) between 1 and 100
    and request_fingerprint ~ '^[0-9a-f]{32}$'
  )
);

create table public.net_economy_altara_bank_multicurrency_transitions (
  identity_link_id uuid primary key
    references public.net_identity_links (id) on delete restrict,
  legacy_vg_bank_account_id uuid not null unique
    references public.net_economy_accounts (id) on delete restrict,
  new_bank_account_id uuid unique
    references public.net_economy_accounts (id) on delete restrict,
  new_currency_code text
    references public.net_economy_currencies (currency_code) on delete restrict,
  adoption_transaction_id uuid unique
    references public.net_economy_transactions (id) on delete restrict,
  correction_transaction_id uuid unique
    references public.net_economy_transactions (id) on delete restrict,
  corrected_vg_amount bigint not null default 0,
  transitioned_at timestamptz not null default timezone('utc', now()),
  constraint net_economy_altara_multicurrency_transition_amount_valid check (
    corrected_vg_amount between 0 and 1000000000
  ),
  constraint net_economy_altara_multicurrency_transition_correction_valid check (
    (corrected_vg_amount = 0 and correction_transaction_id is null)
    or (corrected_vg_amount > 0 and correction_transaction_id is not null)
  ),
  constraint net_economy_altara_multicurrency_transition_account_valid check (
    (new_bank_account_id is null and new_currency_code is null)
    or (new_bank_account_id is not null and new_currency_code is not null)
  )
);

comment on table public.net_economy_altara_bank_multicurrency_transitions is
  'Private one-time map from explicitly opened legacy e102/VG accounts to optional zero-opening-balance e102 home-currency accounts, including immutable VG adoption compensation.';

-- Prove the entire correction population before the first compensating entry.
do $$
declare
  v_bad_id uuid;
begin
  if exists (
    select 1
    from public.net_economy_transactions as transaction_record
    where transaction_record.request_scope = 'altara-bank-vg-adoption-correction'
      or transaction_record.transaction_kind = 'bank-adoption-correction'
  ) then
    raise exception 'ALTARA_MULTICURRENCY_CORRECTION_ALREADY_EXISTS' using errcode = '23514';
  end if;

  -- Production-reviewed live tuples: Adrian completed the exact 177 VG
  -- adoption and Ayin explicitly opened an untouched zero-VG legacy account.
  -- Stable identity IDs, never names or CITY, anchor this financial gate.
  if not exists (
    select 1
    from public.net_economy_altara_bank_adoptions as adoption
    join public.net_economy_accounts as source
      on source.id = adoption.source_wallet_account_id
    join public.net_economy_accounts as destination
      on destination.id = adoption.destination_bank_account_id
    where adoption.identity_link_id =
      '8e7ebd04-f106-4db8-877b-bb83919406e0'::uuid
      and adoption.eligible_amount = 177
      and adoption.adopted_at is not null
      and source.identity_link_id = adoption.identity_link_id
      and source.account_kind = 'wallet'
      and source.currency_code = 'VG'
      and source.status = 'active'
      and source.balance_amount = 0
      and destination.identity_link_id = adoption.identity_link_id
      and destination.account_kind = 'bank'
      and destination.institution_id =
        '00000000-0000-0000-0000-00000000e102'::uuid
      and destination.currency_code = 'VG'
      and destination.status = 'active'
      and destination.balance_amount = 177
  ) then
    raise exception 'ALTARA_MULTICURRENCY_ADRIAN_LIVE_STATE_REVIEW_REQUIRED'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.net_economy_accounts as account
    where account.identity_link_id =
      '93497f00-fdd8-4153-a1db-be811f88ef64'::uuid
      and account.account_kind = 'bank'
      and account.institution_id =
        '00000000-0000-0000-0000-00000000e102'::uuid
      and account.currency_code = 'VG'
      and account.status = 'active'
      and account.balance_amount = 0
  ) then
    raise exception 'ALTARA_MULTICURRENCY_AYIN_LIVE_STATE_REVIEW_REQUIRED'
      using errcode = '23514';
  end if;

  select account.id
  into v_bad_id
  from public.net_economy_accounts as account
  left join public.net_identity_links as identity_link
    on identity_link.id = account.identity_link_id
  where account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and account.currency_code = 'VG'
    and (
      account.account_kind <> 'bank'
      or account.status <> 'active'
      or identity_link.id is null
      or identity_link.identity_kind <> 'player'
      or identity_link.playability <> 'playable'
    )
  order by account.id
  limit 1;
  if v_bad_id is not null then
    raise exception 'ALTARA_MULTICURRENCY_LEGACY_ACCOUNT_REVIEW_REQUIRED: %', v_bad_id
      using errcode = '23514';
  end if;

  select account.id
  into v_bad_id
  from public.net_economy_accounts as account
  left join public.net_economy_transaction_entries as entry
    on entry.account_id = account.id
  where account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and account.account_kind = 'bank'
    and account.currency_code = 'VG'
  group by account.id, account.balance_amount
  having coalesce(sum(entry.amount), 0) <> account.balance_amount
  order by account.id
  limit 1;
  if v_bad_id is not null then
    raise exception 'ALTARA_MULTICURRENCY_LEGACY_LEDGER_RECONCILIATION_REQUIRED: %', v_bad_id
      using errcode = '23514';
  end if;

  select legacy.id
  into v_bad_id
  from public.net_economy_accounts as legacy
  left join public.net_economy_altara_bank_adoptions as adoption
    on adoption.identity_link_id = legacy.identity_link_id
    and adoption.destination_bank_account_id = legacy.id
    and adoption.adopted_at is not null
  where legacy.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and legacy.account_kind = 'bank'
    and legacy.currency_code = 'VG'
    and (
      legacy.balance_amount <> coalesce(adoption.eligible_amount, 0)
      or (
        select count(*) = case when coalesce(adoption.eligible_amount, 0) > 0 then 1 else 0 end
          and count(*) filter (
            where entry.transaction_id = adoption.adoption_transaction_id
              and entry.amount = adoption.eligible_amount
          ) = case when coalesce(adoption.eligible_amount, 0) > 0 then 1 else 0 end
        from public.net_economy_transaction_entries as entry
        where entry.account_id = legacy.id
      ) is not true
    )
  order by legacy.id
  limit 1;
  if v_bad_id is not null then
    raise exception 'ALTARA_MULTICURRENCY_LEGACY_ACTIVITY_REVIEW_REQUIRED: %', v_bad_id
      using errcode = '23514';
  end if;

  select adoption.identity_link_id
  into v_bad_id
  from public.net_economy_altara_bank_adoptions as adoption
  left join public.net_economy_accounts as source
    on source.id = adoption.source_wallet_account_id
  left join public.net_economy_accounts as destination
    on destination.id = adoption.destination_bank_account_id
  left join public.net_economy_transactions as transaction_record
    on transaction_record.id = adoption.adoption_transaction_id
  where adoption.adopted_at is not null
    and (
      source.id is null
      or source.identity_link_id <> adoption.identity_link_id
      or source.account_kind <> 'wallet'
      or source.currency_code <> 'VG'
      or source.status <> 'active'
      or destination.id is null
      or destination.identity_link_id <> adoption.identity_link_id
      or destination.account_kind <> 'bank'
      or destination.institution_id <>
        '00000000-0000-0000-0000-00000000e102'::uuid
      or destination.currency_code <> 'VG'
      or destination.status <> 'active'
      or (
        adoption.eligible_amount = 0
        and adoption.adoption_transaction_id is not null
      )
      or (
        adoption.eligible_amount > 0
        and (
          transaction_record.id is null
          or transaction_record.transaction_kind <> 'bank-deposit'
          or transaction_record.currency_code <> 'VG'
          or transaction_record.request_scope <> 'altara-bank-adoption'
          or transaction_record.request_key <> adoption.identity_link_id
          or transaction_record.request_fingerprint <> md5(
            adoption.identity_link_id::text || ':'
            || adoption.source_wallet_account_id::text || ':'
            || adoption.destination_bank_account_id::text || ':'
            || adoption.eligible_amount::text
          )
          or transaction_record.note <> 'Historical VLT adoption'
        )
      )
    )
  order by adoption.identity_link_id
  limit 1;
  if v_bad_id is not null then
    raise exception 'ALTARA_MULTICURRENCY_ADOPTION_HEADER_REVIEW_REQUIRED: %', v_bad_id
      using errcode = '23514';
  end if;

  select adoption.identity_link_id
  into v_bad_id
  from public.net_economy_altara_bank_adoptions as adoption
  where adoption.adopted_at is not null
    and adoption.eligible_amount > 0
    and (
      select count(*) = 2
        and count(*) filter (
          where entry.account_id = adoption.source_wallet_account_id
            and entry.amount = -adoption.eligible_amount
        ) = 1
        and count(*) filter (
          where entry.account_id = adoption.destination_bank_account_id
            and entry.amount = adoption.eligible_amount
        ) = 1
      from public.net_economy_transaction_entries as entry
      where entry.transaction_id = adoption.adoption_transaction_id
    ) is not true
  order by adoption.identity_link_id
  limit 1;
  if v_bad_id is not null then
    raise exception 'ALTARA_MULTICURRENCY_ADOPTION_ENTRY_REVIEW_REQUIRED: %', v_bad_id
      using errcode = '23514';
  end if;

  select source.id
  into v_bad_id
  from public.net_economy_altara_bank_adoptions as adoption
  join public.net_economy_accounts as source
    on source.id = adoption.source_wallet_account_id
  left join public.net_economy_transaction_entries as entry
    on entry.account_id = source.id
  where adoption.adopted_at is not null
    and adoption.eligible_amount > 0
  group by source.id, source.balance_amount
  having coalesce(sum(entry.amount), 0) <> source.balance_amount
  order by source.id
  limit 1;
  if v_bad_id is not null then
    raise exception 'ALTARA_MULTICURRENCY_SOURCE_LEDGER_RECONCILIATION_REQUIRED: %', v_bad_id
      using errcode = '23514';
  end if;

  select adoption.identity_link_id
  into v_bad_id
  from public.net_economy_altara_bank_adoptions as adoption
  join public.net_economy_accounts as destination
    on destination.id = adoption.destination_bank_account_id
  where adoption.adopted_at is not null
    and destination.balance_amount <> adoption.eligible_amount
  order by adoption.identity_link_id
  limit 1;
  if v_bad_id is not null then
    raise exception 'ALTARA_MULTICURRENCY_CORRECTION_FUNDS_REVIEW_REQUIRED: %', v_bad_id
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.net_economy_transactions as transaction_record
    where transaction_record.request_scope = 'altara-bank-adoption'
      and not exists (
        select 1
        from public.net_economy_altara_bank_adoptions as adoption
        where adoption.adoption_transaction_id = transaction_record.id
      )
  ) then
    raise exception 'ALTARA_MULTICURRENCY_UNMAPPED_ADOPTION_REVIEW_REQUIRED' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.net_economy_currency_json(
  requested_currency_code text
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when currency.currency_code is null then null else jsonb_build_object(
    'currency_code', currency.currency_code,
    'display_name', currency.display_name,
    'singular_label', currency.singular_label,
    'plural_label', currency.plural_label,
    'decimals', currency.decimals,
    'status', currency.status
  ) end
  from (select upper(btrim(coalesce(requested_currency_code, ''))) as code) as input
  left join public.net_economy_currencies as currency
    on currency.currency_code = input.code;
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
    left join public.net_economy_altara_bank_fx_operations as fx_operation
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
          '00000000-0000-0000-0000-00000000e102'::uuid
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
      select jsonb_agg(
        jsonb_build_object(
          'transaction_id', trimmed.transaction_id,
          'amount', trimmed.amount,
          'transaction_kind', trimmed.transaction_kind,
          'currency_code', trimmed.currency_code,
          'counterparty_payment_identifier',
            trimmed.counterparty_payment_identifier,
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
  v_assignment public.net_economy_identity_currency_assignments%rowtype;
  v_bank public.net_economy_accounts%rowtype;
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

  select * into v_assignment
  from public.net_economy_identity_currency_assignments as assignment
  where assignment.identity_link_id = v_link.id;

  if v_assignment.currency_code is not null then
    select * into v_bank
    from public.net_economy_accounts as account
    where account.identity_link_id = v_link.id
      and account.account_kind = 'bank'
      and account.institution_id = v_institution.id
      and account.currency_code = v_assignment.currency_code
      and account.status = 'active'
      and not exists (
        select 1
        from public.net_economy_altara_bank_multicurrency_transitions as transition
        where transition.legacy_vg_bank_account_id = account.id
      );
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

-- CASH is a presentation mirror selected solely by authoritative OS and home
-- currency assignments. It never moves, converts, or relabels money.
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
  v_home_currency_code text;
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

  select assignment.primary_os_id, currency_assignment.currency_code
  into v_primary_os_id, v_home_currency_code
  from public.net_identity_os_assignments as assignment
  left join public.net_economy_identity_currency_assignments as currency_assignment
    on currency_assignment.identity_link_id = assignment.identity_link_id
  where assignment.identity_link_id = v_link.id;

  if v_primary_os_id = 'veil' then
    select * into v_account
    from public.net_economy_accounts as account
    where account.identity_link_id = v_link.id
      and account.account_kind = 'wallet'
      and account.currency_code = 'VG';
    if v_account.id is not null then
      v_display := public.net_economy_cash_display(v_account.balance_amount);
    end if;
  elsif v_primary_os_id = 'altara' and v_home_currency_code is not null then
    select * into v_account
    from public.net_economy_accounts as account
    where account.identity_link_id = v_link.id
      and account.account_kind = 'bank'
      and account.institution_id =
        '00000000-0000-0000-0000-00000000e102'::uuid
      and account.currency_code = v_home_currency_code
      and account.status = 'active';
    if v_account.id is not null then
      v_display := public.net_economy_currency_display(
        v_account.currency_code,
        v_account.balance_amount
      );
    end if;
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
      perform set_config(
        'app.net_economy_origin',
        coalesce(v_previous_origin, ''),
        true
      );
      raise;
  end;
  perform set_config(
    'app.net_economy_origin',
    coalesce(v_previous_origin, ''),
    true
  );
end;
$$;

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
  v_institution public.net_economy_institutions%rowtype;
  v_assignment public.net_economy_identity_currency_assignments%rowtype;
  v_bank public.net_economy_accounts%rowtype;
  v_created boolean := false;
  v_identifier text;
  v_attempt integer := 0;
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

  select assignment.* into v_assignment
  from public.net_economy_identity_currency_assignments as assignment
  join public.net_economy_currencies as currency
    on currency.currency_code = assignment.currency_code
    and currency.status = 'active'
    and currency.decimals = 0
  where assignment.identity_link_id = requested_identity_link_id;
  if not found then
    raise exception 'ALTARA_BANK_CURRENCY_REQUIRED' using errcode = '23514';
  end if;

  select * into v_bank
  from public.net_economy_accounts as account
  where account.identity_link_id = requested_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = v_institution.id
    and account.currency_code = v_assignment.currency_code
    and not exists (
      select 1
      from public.net_economy_altara_bank_multicurrency_transitions as transition
      where transition.legacy_vg_bank_account_id = account.id
    );

  if found then
    perform 1 from public.net_economy_accounts as account
    where account.id = v_bank.id
    for update;
  end if;

  -- Existing account first, then actor/OS/app authority, then denomination.
  -- When no account exists the identity lock is the stable first key. This
  -- matches currency-assignment mutation order and avoids an assignment ↔
  -- identity deadlock during concurrent first-open/reassignment attempts.
  perform public.net_economy_lock_altara_bank_authority(
    requested_identity_link_id,
    null
  );
  perform 1 from public.net_economy_identity_currency_assignments as assignment
  where assignment.identity_link_id = requested_identity_link_id
    and assignment.currency_code = v_assignment.currency_code
  for share;
  if not found then
    raise exception 'ALTARA_BANK_CURRENCY_CONTEXT_CHANGED' using errcode = '40001';
  end if;
  perform public.net_economy_assert_altara_bank_player_context(
    requested_identity_link_id
  );

  if v_bank.id is not null and v_bank.status <> 'active' then
    if v_bank.balance_amount <> 0 or exists (
      select 1 from public.net_economy_transaction_entries as entry
      where entry.account_id = v_bank.id
    ) then
      raise exception 'ALTARA_BANK_ACCOUNT_INACTIVE' using errcode = '22023';
    end if;
    update public.net_economy_accounts as account
    set status = 'active'
    where account.id = v_bank.id
    returning * into v_bank;
  elsif v_bank.id is null then
    loop
      v_identifier := 'altara-' || left(
        replace(gen_random_uuid()::text, '-', ''),
        20
      );
      begin
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
          v_assignment.currency_code,
          'active',
          0
        )
        returning * into v_bank;
        v_created := true;
        exit;
      exception
        when unique_violation then
          select * into v_bank
          from public.net_economy_accounts as account
          where account.identity_link_id = requested_identity_link_id
            and account.account_kind = 'bank'
            and account.institution_id = v_institution.id
            and account.currency_code = v_assignment.currency_code
            and not exists (
              select 1
              from public.net_economy_altara_bank_multicurrency_transitions as transition
              where transition.legacy_vg_bank_account_id = account.id
            );
          if found then
            exit;
          end if;
          v_attempt := v_attempt + 1;
          if v_attempt > 99 then
            raise exception 'ALTARA_MULTICURRENCY_PAYMENT_IDENTIFIER_UNAVAILABLE'
              using errcode = '23505';
          end if;
      end;
    end loop;
  end if;

  if v_bank.status <> 'active' then
    raise exception 'ALTARA_BANK_ACCOUNT_INACTIVE' using errcode = '22023';
  end if;

  perform 1
  from public.net_economy_accounts as account
  where account.id = v_bank.id
  for update;
  perform public.net_economy_assert_altara_bank_player_context(
    requested_identity_link_id
  );

  select * into v_bank
  from public.net_economy_accounts as account
  where account.id = v_bank.id
    and account.identity_link_id = requested_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = v_institution.id
    and account.currency_code = v_assignment.currency_code
    and account.status = 'active';
  if not found then
    raise exception 'ALTARA_BANK_ACCOUNT_UNAVAILABLE' using errcode = '55000';
  end if;

  insert into public.net_economy_wallet_realtime_state (account_id)
  values (v_bank.id)
  on conflict (account_id) do nothing;

  if v_created then
    perform public.net_economy_audit_altara_bank_personal_action(
      requested_identity_link_id,
      'economy.altara-bank.open',
      'economy-account',
      v_bank.id
    );
  end if;

  perform public.net_economy_sync_identity_cash_mirror(
    requested_identity_link_id
  );
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
  perform public.net_economy_lock_altara_bank_authority(v_identity_link_id, null);
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
  v_source_currency_code text;
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := least(greatest(coalesce(requested_limit, 12), 1), 20);
begin
  v_identity_link_id := public.net_economy_assert_altara_bank_player_context(
    requested_expected_identity_link_id
  );
  perform public.net_economy_lock_altara_bank_authority(v_identity_link_id, null);
  perform public.net_economy_assert_altara_bank_player_context(
    requested_expected_identity_link_id
  );

  if char_length(v_query) < 2 or char_length(v_query) > 80 then
    return '[]'::jsonb;
  end if;
  if left(v_query, 1) = '@' then
    v_query := substr(v_query, 2);
  end if;

  select account.id, account.currency_code
  into v_source_account_id, v_source_currency_code
  from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and account.status = 'active';
  if not found then
    raise exception 'ALTARA_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'display_name', directory.display_name,
        'payment_identifier', directory.payment_identifier,
        'currency', public.net_economy_currency_json(directory.currency_code),
        'avatar_ref', directory.avatar_ref
      ) order by directory.display_name, directory.payment_identifier
    )
    from (
      select
        public.net_economy_identity_display_name(account.identity_link_id) as display_name,
        account.payment_identifier,
        account.currency_code,
        public.net_altara_identity_presentation(account.identity_link_id) ->> 'avatar_url'
          as avatar_ref
      from public.net_economy_accounts as account
      join public.net_identity_links as identity_link
        on identity_link.id = account.identity_link_id
        and identity_link.identity_kind = 'player'
        and identity_link.playability = 'playable'
      join public.net_economy_identity_currency_assignments as assignment
        on assignment.identity_link_id = identity_link.id
        and assignment.currency_code = account.currency_code
      join public.net_economy_currencies as currency
        on currency.currency_code = account.currency_code
        and currency.status = 'active'
      where account.account_kind = 'bank'
        and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
        and account.status = 'active'
        and account.id <> v_source_account_id
        and public.net_identity_link_can_access_service(identity_link.id, 'altara-bank')
        and (
          lower(public.net_economy_identity_display_name(identity_link.id))
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

create or replace function public.quote_net_economy_altara_bank_payment(
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
  v_source_units bigint;
  v_target_units bigint;
  v_target_amount bigint;
begin
  v_identity_link_id := public.net_economy_assert_altara_bank_player_context(
    requested_expected_identity_link_id
  );
  if left(v_identifier, 1) = '@' then v_identifier := substr(v_identifier, 2); end if;
  if v_identifier = '' or char_length(v_identifier) > 40 then
    raise exception 'ALTARA_BANK_PAYEE_REQUIRED' using errcode = '22023';
  end if;
  if requested_source_amount is null
    or requested_source_amount < 1
    or requested_source_amount > 1000000000
  then
    raise exception 'ECONOMY_AMOUNT_INVALID' using errcode = '22023';
  end if;

  select account.* into v_sender
  from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and account.status = 'active';
  select account.* into v_recipient
  from public.net_economy_accounts as account
  join public.net_identity_links as identity_link
    on identity_link.id = account.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.payment_identifier = v_identifier
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and account.status = 'active'
    and public.net_identity_link_can_access_service(identity_link.id, 'altara-bank');
  if v_sender.id is null then
    raise exception 'ALTARA_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;
  if v_recipient.id is null then
    raise exception 'ALTARA_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;
  if v_sender.id = v_recipient.id then
    raise exception 'ECONOMY_SELF_TRANSFER_INVALID' using errcode = '22023';
  end if;

  perform 1 from public.net_economy_accounts as account
  where account.id in (v_sender.id, v_recipient.id)
  order by account.id for share;
  perform public.net_economy_lock_altara_bank_authority(
    v_identity_link_id, v_recipient.identity_link_id
  );
  perform 1 from public.net_economy_identity_currency_assignments as assignment
  where assignment.identity_link_id in (
    v_identity_link_id, v_recipient.identity_link_id
  ) order by assignment.identity_link_id for share;
  perform public.net_economy_assert_altara_bank_player_context(
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
  join public.net_identity_links as identity_link
    on identity_link.id = account.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.id = v_recipient.id
    and account.payment_identifier = v_identifier
    and account.status = 'active'
    and public.net_identity_link_can_access_service(identity_link.id, 'altara-bank');
  if v_sender.id is null then
    raise exception 'ALTARA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;
  if v_recipient.id is null then
    raise exception 'ALTARA_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;

  if v_sender.currency_code = v_recipient.currency_code then
    v_source_units := 1;
    v_target_units := 1;
    v_target_amount := requested_source_amount;
  else
    select * into v_rate
    from public.net_economy_fx_rates as rate
    where rate.currency_a = least(v_sender.currency_code, v_recipient.currency_code)
      and rate.currency_b = greatest(v_sender.currency_code, v_recipient.currency_code)
      and rate.active
    for share;
    if not found then
      raise exception 'ALTARA_BANK_FX_RATE_UNAVAILABLE' using errcode = '22023';
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
      raise exception 'ALTARA_BANK_FX_AMOUNT_TOO_SMALL' using errcode = '22023';
    end if;
    if v_target_amount > 1000000000 then
      raise exception 'ECONOMY_AMOUNT_INVALID' using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object(
    'server_now', timezone('utc', clock_timestamp()),
    'recipient', jsonb_build_object(
      'display_name', public.net_economy_identity_display_name(v_recipient.identity_link_id),
      'payment_identifier', v_recipient.payment_identifier,
      'currency', public.net_economy_currency_json(v_recipient.currency_code),
      'avatar_ref', public.net_altara_identity_presentation(v_recipient.identity_link_id) ->> 'avatar_url'
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

create or replace function public.net_economy_altara_clearing_account_id(
  requested_currency_code text
)
returns uuid
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select case upper(btrim(coalesce(requested_currency_code, '')))
    when 'VG' then '00000000-0000-0000-0000-00000000e001'::uuid
    when 'FINIT' then '00000000-0000-0000-0000-00000000e003'::uuid
    when 'SECTUS' then '00000000-0000-0000-0000-00000000e004'::uuid
    else null
  end;
$$;

create or replace function public.transfer_net_economy_altara_bank_payment(
  requested_expected_identity_link_id uuid,
  requested_payment_identifier text,
  requested_source_amount bigint,
  requested_rate_revision uuid,
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
  v_rate public.net_economy_fx_rates%rowtype;
  v_existing public.net_economy_transactions%rowtype;
  v_source_transaction public.net_economy_transactions%rowtype;
  v_target_transaction public.net_economy_transactions%rowtype;
  v_existing_fx public.net_economy_altara_bank_fx_operations%rowtype;
  v_source_clearing public.net_economy_accounts%rowtype;
  v_target_clearing public.net_economy_accounts%rowtype;
  v_source_units bigint;
  v_target_units bigint;
  v_target_amount bigint;
  v_scope text;
  v_target_scope text;
  v_fingerprint text;
begin
  v_identity_link_id := public.net_economy_assert_altara_bank_player_context(
    requested_expected_identity_link_id
  );
  if left(v_identifier, 1) = '@' then v_identifier := substr(v_identifier, 2); end if;
  if v_identifier = '' or char_length(v_identifier) > 40 then
    raise exception 'ALTARA_BANK_PAYEE_REQUIRED' using errcode = '22023';
  end if;
  if requested_source_amount is null
    or requested_source_amount < 1
    or requested_source_amount > 1000000000
  then
    raise exception 'ECONOMY_AMOUNT_INVALID' using errcode = '22023';
  end if;
  if requested_request_key is null then
    raise exception 'ECONOMY_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;

  select account.* into v_sender
  from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and account.status = 'active';
  select account.* into v_recipient
  from public.net_economy_accounts as account
  where account.payment_identifier = v_identifier
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid;
  if v_sender.id is null then
    raise exception 'ALTARA_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;
  if v_recipient.id is null then
    raise exception 'ALTARA_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;
  if v_sender.id = v_recipient.id then
    raise exception 'ECONOMY_SELF_TRANSFER_INVALID' using errcode = '22023';
  end if;

  v_scope := 'bank-pay:' || v_actor::text;
  v_target_scope := 'altara-bank-fx-target:' || v_actor::text;
  select * into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;
  if found then
    select * into v_existing_fx
    from public.net_economy_altara_bank_fx_operations as operation
    where operation.source_transaction_id = v_existing.id;
    if v_existing.transaction_kind = 'bank-transfer' then
      v_fingerprint := md5(
        v_identity_link_id::text || ':'
        || '00000000-0000-0000-0000-00000000e102'::uuid::text || ':'
        || v_sender.id::text || ':' || v_recipient.id::text || ':'
        || v_sender.currency_code || ':' || v_recipient.currency_code || ':'
        || requested_source_amount::text || ':' || requested_source_amount::text || ':same'
      );
      if v_sender.currency_code <> v_recipient.currency_code
        or requested_rate_revision is not null
        or v_existing.request_fingerprint <> v_fingerprint
      then
        raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
      end if;
    elsif v_existing.transaction_kind = 'bank-fx-debit' then
      if v_existing_fx.id is null
        or v_existing_fx.sender_account_id <> v_sender.id
        or v_existing_fx.recipient_account_id <> v_recipient.id
        or v_existing_fx.source_amount <> requested_source_amount
        or v_existing_fx.rate_revision <> requested_rate_revision
        or v_existing.request_fingerprint <> v_existing_fx.request_fingerprint
      then
        raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
      end if;
    else
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.net_economy_altara_bank_payload(v_identity_link_id, null, null, 20);
  end if;

  if v_sender.currency_code <> v_recipient.currency_code then
    select * into v_source_clearing from public.net_economy_accounts as account
    where account.id = public.net_economy_altara_clearing_account_id(v_sender.currency_code);
    select * into v_target_clearing from public.net_economy_accounts as account
    where account.id = public.net_economy_altara_clearing_account_id(v_recipient.currency_code);
    if v_source_clearing.id is null or v_target_clearing.id is null then
      raise exception 'ALTARA_BANK_FX_CLEARING_UNAVAILABLE' using errcode = '55000';
    end if;
  end if;

  perform 1 from public.net_economy_accounts as account
  where account.id in (
    v_sender.id,
    v_recipient.id,
    v_source_clearing.id,
    v_target_clearing.id
  )
  order by account.id for update;
  perform public.net_economy_lock_altara_bank_authority(
    v_identity_link_id, v_recipient.identity_link_id
  );
  perform 1 from public.net_economy_identity_currency_assignments as assignment
  where assignment.identity_link_id in (
    v_identity_link_id, v_recipient.identity_link_id
  ) order by assignment.identity_link_id for share;
  perform public.net_economy_assert_altara_bank_player_context(
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
  join public.net_identity_links as identity_link
    on identity_link.id = account.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.id = v_recipient.id
    and account.payment_identifier = v_identifier
    and account.status = 'active'
    and public.net_identity_link_can_access_service(identity_link.id, 'altara-bank');
  if v_sender.id is null then
    raise exception 'ALTARA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;
  if v_recipient.id is null then
    raise exception 'ALTARA_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;
  if v_sender.balance_amount < requested_source_amount then
    raise exception 'ECONOMY_BANK_INSUFFICIENT_FUNDS' using errcode = '22023';
  end if;

  if v_sender.currency_code = v_recipient.currency_code then
    if requested_rate_revision is not null then
      raise exception 'ALTARA_BANK_FX_RATE_CHANGED' using errcode = '40001';
    end if;
    v_target_amount := requested_source_amount;
    v_fingerprint := md5(
      v_identity_link_id::text || ':'
      || '00000000-0000-0000-0000-00000000e102'::uuid::text || ':'
      || v_sender.id::text || ':' || v_recipient.id::text || ':'
      || v_sender.currency_code || ':' || v_recipient.currency_code || ':'
      || requested_source_amount::text || ':' || v_target_amount::text || ':same'
    );
    insert into public.net_economy_transactions (
      transaction_kind, initiated_by_profile_id, request_scope, request_key,
      request_fingerprint, note, currency_code
    ) values (
      'bank-transfer', v_actor, v_scope, requested_request_key,
      v_fingerprint, null, v_sender.currency_code
    ) on conflict (request_scope, request_key) do nothing
    returning * into v_source_transaction;
    if v_source_transaction.id is null then
      select * into v_existing
      from public.net_economy_transactions as transaction_record
      where transaction_record.request_scope = v_scope
        and transaction_record.request_key = requested_request_key;
      if not found
        or v_existing.transaction_kind <> 'bank-transfer'
        or v_existing.currency_code <> v_sender.currency_code
        or v_existing.request_fingerprint <> v_fingerprint
      then
        raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
      end if;
      return public.net_economy_altara_bank_payload(v_identity_link_id, null, null, 20);
    end if;
    insert into public.net_economy_transaction_entries (
      transaction_id, account_id, amount, created_at
    ) values
      (v_source_transaction.id, v_sender.id, -requested_source_amount, v_source_transaction.created_at),
      (v_source_transaction.id, v_recipient.id, requested_source_amount, v_source_transaction.created_at);
    update public.net_economy_accounts set balance_amount = balance_amount - requested_source_amount
      where id = v_sender.id;
    update public.net_economy_accounts set balance_amount = balance_amount + requested_source_amount
      where id = v_recipient.id;
  else
    select * into v_rate
    from public.net_economy_fx_rates as rate
    where rate.currency_a = least(v_sender.currency_code, v_recipient.currency_code)
      and rate.currency_b = greatest(v_sender.currency_code, v_recipient.currency_code)
      and rate.active
    for share;
    if not found then
      raise exception 'ALTARA_BANK_FX_RATE_UNAVAILABLE' using errcode = '22023';
    end if;
    if requested_rate_revision is null or requested_rate_revision <> v_rate.revision then
      raise exception 'ALTARA_BANK_FX_RATE_CHANGED' using errcode = '40001';
    end if;
    if v_sender.currency_code = v_rate.currency_a then
      v_source_units := v_rate.units_a; v_target_units := v_rate.units_b;
    else
      v_source_units := v_rate.units_b; v_target_units := v_rate.units_a;
    end if;
    v_target_amount := (requested_source_amount * v_target_units) / v_source_units;
    if v_target_amount < 1 then
      raise exception 'ALTARA_BANK_FX_AMOUNT_TOO_SMALL' using errcode = '22023';
    end if;
    if v_target_amount > 1000000000 then
      raise exception 'ECONOMY_AMOUNT_INVALID' using errcode = '22023';
    end if;
    v_fingerprint := md5(
      v_identity_link_id::text || ':'
      || '00000000-0000-0000-0000-00000000e102'::uuid::text || ':'
      || v_sender.id::text || ':' || v_recipient.id::text || ':'
      || v_sender.currency_code || ':' || v_recipient.currency_code || ':'
      || requested_source_amount::text || ':' || v_target_amount::text || ':'
      || v_rate.revision::text || ':' || v_source_units::text || ':' || v_target_units::text
    );
    select * into v_source_clearing from public.net_economy_accounts as account
    where account.id = v_source_clearing.id and account.account_kind = 'system'
      and account.currency_code = v_sender.currency_code and account.status = 'active';
    select * into v_target_clearing from public.net_economy_accounts as account
    where account.id = v_target_clearing.id and account.account_kind = 'system'
      and account.currency_code = v_recipient.currency_code and account.status = 'active';
    if v_source_clearing.id is null or v_target_clearing.id is null then
      raise exception 'ALTARA_BANK_FX_CLEARING_UNAVAILABLE' using errcode = '55000';
    end if;
    insert into public.net_economy_transactions (
      transaction_kind, initiated_by_profile_id, request_scope, request_key,
      request_fingerprint, note, currency_code
    ) values (
      'bank-fx-debit', v_actor, v_scope, requested_request_key,
      v_fingerprint, null, v_sender.currency_code
    ) on conflict (request_scope, request_key) do nothing
    returning * into v_source_transaction;
    if v_source_transaction.id is null then
      select * into v_existing
      from public.net_economy_transactions as transaction_record
      where transaction_record.request_scope = v_scope
        and transaction_record.request_key = requested_request_key;
      select * into v_existing_fx
      from public.net_economy_altara_bank_fx_operations as operation
      where operation.request_scope = v_scope
        and operation.request_key = requested_request_key;
      if v_existing.id is null
        or v_existing_fx.id is null
        or v_existing.transaction_kind <> 'bank-fx-debit'
        or v_existing.currency_code <> v_sender.currency_code
        or v_existing.request_fingerprint <> v_fingerprint
        or v_existing_fx.request_fingerprint <> v_fingerprint
      then
        raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
      end if;
      return public.net_economy_altara_bank_payload(v_identity_link_id, null, null, 20);
    end if;
    insert into public.net_economy_transactions (
      transaction_kind, initiated_by_profile_id, request_scope, request_key,
      request_fingerprint, note, currency_code
    ) values (
      'bank-fx-credit', v_actor, v_target_scope, requested_request_key,
      v_fingerprint, null, v_recipient.currency_code
    ) returning * into v_target_transaction;
    insert into public.net_economy_transaction_entries (
      transaction_id, account_id, amount, created_at
    ) values
      (v_source_transaction.id, v_sender.id, -requested_source_amount, v_source_transaction.created_at),
      (v_source_transaction.id, v_source_clearing.id, requested_source_amount, v_source_transaction.created_at),
      (v_target_transaction.id, v_target_clearing.id, -v_target_amount, v_target_transaction.created_at),
      (v_target_transaction.id, v_recipient.id, v_target_amount, v_target_transaction.created_at);
    update public.net_economy_accounts set balance_amount = balance_amount - requested_source_amount
      where id = v_sender.id;
    update public.net_economy_accounts set balance_amount = balance_amount + requested_source_amount
      where id = v_source_clearing.id;
    update public.net_economy_accounts set balance_amount = balance_amount - v_target_amount
      where id = v_target_clearing.id;
    update public.net_economy_accounts set balance_amount = balance_amount + v_target_amount
      where id = v_recipient.id;
    insert into public.net_economy_altara_bank_fx_operations (
      sender_identity_link_id, recipient_identity_link_id,
      sender_account_id, recipient_account_id,
      source_currency_code, target_currency_code,
      source_amount, target_amount, source_units, target_units, rate_revision,
      source_transaction_id, target_transaction_id,
      request_scope, request_key, request_fingerprint
    ) values (
      v_identity_link_id, v_recipient.identity_link_id,
      v_sender.id, v_recipient.id,
      v_sender.currency_code, v_recipient.currency_code,
      requested_source_amount, v_target_amount, v_source_units, v_target_units,
      v_rate.revision, v_source_transaction.id, v_target_transaction.id,
      v_scope, requested_request_key, v_fingerprint
    );
  end if;

  perform public.net_economy_audit_altara_bank_personal_action(
    v_identity_link_id,
    'economy.altara-bank.transfer',
    'economy-transaction',
    v_source_transaction.id
  );
  return public.net_economy_altara_bank_payload(v_identity_link_id, null, null, 20);
end;
$$;

-- Reverse only proven adopted VG principal, retire each explicitly opened
-- legacy e102/VG account, then create a zero-balance account only when that
-- identity has an explicit reviewed home currency. No amount crosses currency.
do $$
declare
  v_legacy public.net_economy_accounts%rowtype;
  v_adoption public.net_economy_altara_bank_adoptions%rowtype;
  v_source public.net_economy_accounts%rowtype;
  v_new_bank public.net_economy_accounts%rowtype;
  v_assignment public.net_economy_identity_currency_assignments%rowtype;
  v_correction public.net_economy_transactions%rowtype;
  v_identifier text;
  v_fingerprint text;
  v_attempt integer;
begin
  for v_legacy in
    select account.*
    from public.net_economy_accounts as account
    where account.account_kind = 'bank'
      and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
      and account.currency_code = 'VG'
    order by account.id
    for update
  loop
    v_adoption := null;
    v_source := null;
    v_new_bank := null;
    select * into v_adoption
    from public.net_economy_altara_bank_adoptions as adoption
    where adoption.identity_link_id = v_legacy.identity_link_id;

    v_correction := null;
    if v_adoption.adopted_at is not null and v_adoption.eligible_amount > 0 then
      select * into v_source
      from public.net_economy_accounts as account
      where account.id = v_adoption.source_wallet_account_id
      for update;

      v_fingerprint := md5(
        v_adoption.adoption_transaction_id::text || ':'
        || v_source.id::text || ':' || v_legacy.id::text || ':'
        || v_adoption.eligible_amount::text
      );

      insert into public.net_economy_transactions (
        transaction_kind,
        initiated_by_profile_id,
        request_scope,
        request_key,
        request_fingerprint,
        note,
        currency_code
      ) values (
        'bank-adoption-correction',
        null,
        'altara-bank-vg-adoption-correction',
        v_legacy.identity_link_id,
        v_fingerprint,
        'Restore New Vega VG principal from legacy ALTARA adoption',
        'VG'
      )
      returning * into v_correction;

      insert into public.net_economy_transaction_entries (
        transaction_id,
        account_id,
        amount,
        created_at
      ) values
        (
          v_correction.id,
          v_legacy.id,
          -v_adoption.eligible_amount,
          v_correction.created_at
        ),
        (
          v_correction.id,
          v_source.id,
          v_adoption.eligible_amount,
          v_correction.created_at
        );

      update public.net_economy_accounts as account
      set
        balance_amount = account.balance_amount - v_adoption.eligible_amount,
        status = 'closed'
      where account.id = v_legacy.id;

      update public.net_economy_accounts as account
      set balance_amount = account.balance_amount + v_adoption.eligible_amount
      where account.id = v_source.id;
    else
      update public.net_economy_accounts as account
      set status = 'closed'
      where account.id = v_legacy.id;
    end if;

    select * into v_assignment
    from public.net_economy_identity_currency_assignments as assignment
    where assignment.identity_link_id = v_legacy.identity_link_id;

    if v_assignment.currency_code is not null then
      v_attempt := 0;
      loop
        v_identifier := 'altara-' || left(
          replace(gen_random_uuid()::text, '-', ''),
          20
        );
        begin
          insert into public.net_economy_accounts (
            identity_link_id,
            account_kind,
            institution_id,
            payment_identifier,
            currency_code,
            status,
            balance_amount
          ) values (
            v_legacy.identity_link_id,
            'bank',
            '00000000-0000-0000-0000-00000000e102'::uuid,
            v_identifier,
            v_assignment.currency_code,
            'active',
            0
          )
          returning * into v_new_bank;
          exit;
        exception
          when unique_violation then
            v_attempt := v_attempt + 1;
            if v_attempt > 99 then
              raise exception 'ALTARA_MULTICURRENCY_PAYMENT_IDENTIFIER_UNAVAILABLE'
                using errcode = '23505';
            end if;
        end;
      end loop;

      insert into public.net_economy_wallet_realtime_state (account_id)
      values (v_new_bank.id)
      on conflict (account_id) do nothing;
    end if;

    insert into public.net_economy_altara_bank_multicurrency_transitions (
      identity_link_id,
      legacy_vg_bank_account_id,
      new_bank_account_id,
      new_currency_code,
      adoption_transaction_id,
      correction_transaction_id,
      corrected_vg_amount
    ) values (
      v_legacy.identity_link_id,
      v_legacy.id,
      v_new_bank.id,
      v_assignment.currency_code,
      v_adoption.adoption_transaction_id,
      v_correction.id,
      case
        when v_correction.id is null then 0
        else v_adoption.eligible_amount
      end
    );
  end loop;
end;
$$;

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
  v_home_currency_code text;
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

  select identity_link.id, assignment.primary_os_id,
    currency_assignment.currency_code
  into v_identity_link_id, v_primary_os_id, v_home_currency_code
  from public.net_identity_links as identity_link
  join public.net_identity_os_assignments as assignment
    on assignment.identity_link_id = identity_link.id
  left join public.net_economy_identity_currency_assignments as currency_assignment
    on currency_assignment.identity_link_id = identity_link.id
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
    if public.net_identity_link_can_access_service(
      v_identity_link_id,
      'vox-bank'
    ) then
      select * into v_vox
      from public.net_economy_accounts as account
      where account.identity_link_id = v_identity_link_id
        and account.account_kind = 'bank'
        and account.institution_id =
          '00000000-0000-0000-0000-00000000e100'::uuid
        and account.currency_code = 'VG';
    end if;
    if public.net_identity_link_can_access_service(
      v_identity_link_id,
      'shneider-bank'
    ) then
      select * into v_shneider
      from public.net_economy_accounts as account
      where account.identity_link_id = v_identity_link_id
        and account.account_kind = 'bank'
        and account.institution_id =
          '00000000-0000-0000-0000-00000000e101'::uuid
        and account.currency_code = 'VG';
    end if;
  elsif v_primary_os_id = 'altara'
    and public.net_identity_link_can_access_service(
      v_identity_link_id,
      'altara-bank'
    )
  then
    select * into v_altara
    from public.net_economy_accounts as account
    where account.identity_link_id = v_identity_link_id
      and account.account_kind = 'bank'
      and account.institution_id =
        '00000000-0000-0000-0000-00000000e102'::uuid
      and account.currency_code = v_home_currency_code
      and account.status = 'active';
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
    ) end
  );
end;
$$;

-- Private avatar authorization for the bounded active payee directory. It repeats
-- the personal bank actor boundary as a boolean and then reuses the deployed
-- descriptor parser, which accepts only the current identity avatar's exact
-- display/thumbnail object path.
create or replace function public.current_user_can_read_net_altara_bank_avatar(
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
  v_role text;
  v_identity_link_id uuid;
begin
  if v_actor is null then
    return false;
  end if;

  select profile.role::text
  into v_role
  from public.profiles as profile
  where profile.id = v_actor;
  if not found then
    return false;
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
      and public.current_user_controls_playable_net_identity_link(
        identity_link.id
      );
  end if;

  if v_identity_link_id is null
    or not public.net_identity_link_can_access_service(
      v_identity_link_id,
      'altara-bank'
    )
    or not exists (
      select 1
      from public.net_identity_app_installs as install
      where install.identity_link_id = v_identity_link_id
        and install.app_id = 'altara-bank'
    )
    or not exists (
      select 1
      from public.net_economy_accounts as source_account
      where source_account.identity_link_id = v_identity_link_id
        and source_account.account_kind = 'bank'
        and source_account.institution_id =
          '00000000-0000-0000-0000-00000000e102'::uuid
        and source_account.status = 'active'
        and source_account.currency_code = (
          select assignment.currency_code
          from public.net_economy_identity_currency_assignments as assignment
          where assignment.identity_link_id = v_identity_link_id
        )
    )
  then
    return false;
  end if;

  return exists (
    select 1
    from public.net_economy_accounts as payee_account
    join public.net_identity_links as payee_identity
      on payee_identity.id = payee_account.identity_link_id
      and payee_identity.identity_kind = 'player'
      and payee_identity.playability = 'playable'
    where payee_account.account_kind = 'bank'
      and payee_account.institution_id =
        '00000000-0000-0000-0000-00000000e102'::uuid
      and payee_account.status = 'active'
      and payee_account.currency_code = (
        select assignment.currency_code
        from public.net_economy_identity_currency_assignments as assignment
        where assignment.identity_link_id = payee_identity.id
      )
      and public.net_identity_link_can_access_service(
        payee_identity.id,
        'altara-bank'
      )
      and public.net_altara_messenger_avatar_ref_contains_object(
        payee_identity.id,
        public.net_altara_identity_presentation(payee_identity.id) ->> 'avatar_url',
        requested_object_name
      )
  );
exception
  when others then
    return false;
end;
$$;

drop policy if exists net_altara_bank_avatar_select on storage.objects;
create policy net_altara_bank_avatar_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'rpg-media'
  and public.current_user_can_read_net_altara_bank_avatar(name)
);

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
              and account.institution_id =
                '00000000-0000-0000-0000-00000000e100'::uuid
              and account.currency_code = 'VG'
              and public.net_identity_link_can_access_service(
                account.identity_link_id,
                'vox-bank'
              )
            )
            or (
              account.account_kind = 'bank'
              and account.institution_id =
                '00000000-0000-0000-0000-00000000e101'::uuid
              and account.currency_code = 'VG'
              and public.net_identity_link_can_access_service(
                account.identity_link_id,
                'shneider-bank'
              )
            )
            or (
              account.account_kind = 'bank'
              and account.institution_id =
                '00000000-0000-0000-0000-00000000e102'::uuid
              and account.status = 'active'
              and account.currency_code = (
                select assignment.currency_code
                from public.net_economy_identity_currency_assignments as assignment
                where assignment.identity_link_id = account.identity_link_id
              )
              and public.net_identity_link_can_access_service(
                account.identity_link_id,
                'altara-bank'
              )
            )
          )
      )
    );
$$;

-- Reconcile presentation after the balanced correction and local-currency provisioning.
-- This calls the same OS-aware mirror used by later assignment/account changes.
do $$
declare
  v_identity_link_id uuid;
begin
  for v_identity_link_id in
    select identity_link.id
    from public.net_identity_links as identity_link
    where identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
    order by identity_link.id
  loop
    perform public.net_economy_sync_identity_cash_mirror(v_identity_link_id);
  end loop;
end;
$$;

-- Final conservation and transition proof. Correction transactions are VG,
-- balanced, and exactly oppose each adoption; each newly provisioned account
-- begins at zero in the identity's explicit assigned currency.
do $$
declare
  v_bad_id uuid;
begin
  select transition.identity_link_id
  into v_bad_id
  from public.net_economy_altara_bank_multicurrency_transitions as transition
  join public.net_economy_accounts as legacy
    on legacy.id = transition.legacy_vg_bank_account_id
  left join public.net_economy_accounts as new_bank
    on new_bank.id = transition.new_bank_account_id
  left join public.net_economy_identity_currency_assignments as currency_assignment
    on currency_assignment.identity_link_id = transition.identity_link_id
  left join public.net_economy_altara_bank_adoptions as adoption
    on adoption.identity_link_id = transition.identity_link_id
  left join public.net_economy_transactions as correction
    on correction.id = transition.correction_transaction_id
  where transition.adoption_transaction_id is distinct from
      adoption.adoption_transaction_id
    or legacy.identity_link_id <> transition.identity_link_id
    or legacy.account_kind <> 'bank'
    or legacy.institution_id <>
      '00000000-0000-0000-0000-00000000e102'::uuid
    or legacy.currency_code <> 'VG'
    or legacy.status <> 'closed'
    or legacy.balance_amount <> 0
    or transition.new_currency_code is distinct from currency_assignment.currency_code
    or (
      transition.new_bank_account_id is not null
      and (
        new_bank.identity_link_id <> transition.identity_link_id
        or new_bank.account_kind <> 'bank'
        or new_bank.institution_id <>
          '00000000-0000-0000-0000-00000000e102'::uuid
        or new_bank.currency_code <> transition.new_currency_code
        or new_bank.status <> 'active'
        or new_bank.balance_amount <> 0
        or exists (
          select 1
          from public.net_economy_transaction_entries as entry
          where entry.account_id = new_bank.id
        )
      )
    )
    or (
      transition.corrected_vg_amount > 0
      and (
        correction.id is null
        or correction.transaction_kind <> 'bank-adoption-correction'
        or correction.currency_code <> 'VG'
        or correction.request_scope <> 'altara-bank-vg-adoption-correction'
        or correction.request_key <> transition.identity_link_id
        or correction.request_fingerprint <> md5(
          transition.adoption_transaction_id::text || ':'
          || adoption.source_wallet_account_id::text || ':'
          || transition.legacy_vg_bank_account_id::text || ':'
          || transition.corrected_vg_amount::text
        )
        or correction.note <>
          'Restore New Vega VG principal from legacy ALTARA adoption'
        or (
          select count(*) = 2
            and count(*) filter (
              where entry.account_id = transition.legacy_vg_bank_account_id
                and entry.amount = -transition.corrected_vg_amount
            ) = 1
            and count(*) filter (
              where entry.account_id = adoption.source_wallet_account_id
                and entry.amount = transition.corrected_vg_amount
            ) = 1
            and coalesce(sum(entry.amount), 0) = 0
          from public.net_economy_transaction_entries as entry
          where entry.transaction_id = correction.id
        ) is not true
      )
    )
  order by transition.identity_link_id
  limit 1;
  if v_bad_id is not null then
    raise exception 'ALTARA_MULTICURRENCY_FINAL_TRANSITION_REVIEW_REQUIRED: %', v_bad_id
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.net_economy_accounts as legacy
    where legacy.institution_id =
      '00000000-0000-0000-0000-00000000e102'::uuid
      and legacy.currency_code = 'VG'
      and not exists (
        select 1
        from public.net_economy_altara_bank_multicurrency_transitions as transition
        where transition.legacy_vg_bank_account_id = legacy.id
      )
  ) then
    raise exception 'ALTARA_MULTICURRENCY_UNMAPPED_LEGACY_ACCOUNT_REVIEW_REQUIRED'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.net_economy_accounts as account
    left join public.net_economy_transaction_entries as entry
      on entry.account_id = account.id
    where account.currency_code in ('VG', 'FINIT', 'SECTUS')
    group by account.id, account.balance_amount
    having coalesce(sum(entry.amount), 0) <> account.balance_amount
  ) then
    raise exception 'ALTARA_MULTICURRENCY_FINAL_LEDGER_RECONCILIATION_REQUIRED'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.net_economy_transactions as transaction_record
    left join public.net_economy_transaction_entries as entry
      on entry.transaction_id = transaction_record.id
    left join public.net_economy_accounts as account
      on account.id = entry.account_id
    group by transaction_record.id, transaction_record.currency_code
    having count(entry.id) < 2
      or coalesce(sum(entry.amount), 0) <> 0
      or count(*) filter (
        where entry.id is not null
          and account.currency_code <> transaction_record.currency_code
      ) <> 0
  ) then
    raise exception 'ALTARA_MULTICURRENCY_FINAL_TRANSACTION_INVARIANT_REQUIRED'
      using errcode = '23514';
  end if;
end;
$$;

alter table public.net_economy_altara_bank_multicurrency_transitions
  enable row level security;
alter table public.net_economy_currencies enable row level security;
alter table public.net_economy_identity_currency_assignments enable row level security;
alter table public.net_economy_identity_currency_assignment_audit
  enable row level security;
alter table public.net_economy_fx_rates enable row level security;
alter table public.net_economy_fx_rate_audit enable row level security;
alter table public.net_economy_altara_bank_fx_operations enable row level security;
revoke all on table public.net_economy_altara_bank_multicurrency_transitions
  from public, anon, authenticated;
revoke all on table public.net_economy_currencies
  from public, anon, authenticated;
revoke all on table public.net_economy_identity_currency_assignments
  from public, anon, authenticated;
revoke all on table public.net_economy_identity_currency_assignment_audit
  from public, anon, authenticated;
revoke all on table public.net_economy_fx_rates
  from public, anon, authenticated;
revoke all on table public.net_economy_fx_rate_audit
  from public, anon, authenticated;
revoke all on table public.net_economy_altara_bank_fx_operations
  from public, anon, authenticated;
revoke all on table public.net_economy_altara_bank_adoptions
  from public, anon, authenticated;
revoke all on table public.net_economy_accounts
  from public, anon, authenticated;
revoke all on table public.net_economy_transactions
  from public, anon, authenticated;
revoke all on table public.net_economy_transaction_entries
  from public, anon, authenticated;

-- Remove the deployed VG-only overloads after their replacements exist. This
-- prevents stale clients from bypassing quote revision validation or rendering
-- the retired single-currency display helper.
drop function if exists public.transfer_net_economy_altara_bank_payment(uuid,text,bigint,uuid);
drop function if exists public.net_economy_currency_display(bigint);

-- Raw ledger/transition tables remain absent from Realtime. The deployed
-- per-account revision table is the only Economy publication used by clients.
do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in (
        'net_economy_accounts',
        'net_economy_transactions',
        'net_economy_transaction_entries',
        'net_economy_altara_bank_adoptions',
        'net_economy_altara_bank_multicurrency_transitions',
        'net_economy_currencies',
        'net_economy_identity_currency_assignments',
        'net_economy_identity_currency_assignment_audit',
        'net_economy_fx_rates',
        'net_economy_fx_rate_audit',
        'net_economy_altara_bank_fx_operations'
      )
  ) then
    raise exception 'ALTARA_MULTICURRENCY_RAW_REALTIME_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function public.net_economy_gcd(
  requested_a bigint,
  requested_b bigint
)
returns bigint
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_a bigint := abs(requested_a);
  v_b bigint := abs(requested_b);
  v_remainder bigint;
begin
  while v_b <> 0 loop
    v_remainder := v_a % v_b;
    v_a := v_b;
    v_b := v_remainder;
  end loop;
  return greatest(v_a, 1);
end;
$$;

create or replace function public.fetch_net_economy_gm_altara_configuration(
  requested_identity_link_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.net_economy_identity_currency_assignments%rowtype;
begin
  perform public.assert_net_economy_gm();
  if requested_identity_link_id is not null then
    perform 1 from public.net_identity_links as identity_link
    where identity_link.id = requested_identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable';
    if not found then
      raise exception 'ECONOMY_CURRENCY_IDENTITY_INVALID' using errcode = '22023';
    end if;
    select * into v_assignment
    from public.net_economy_identity_currency_assignments as assignment
    where assignment.identity_link_id = requested_identity_link_id;
  end if;
  return jsonb_build_object(
    'server_now', timezone('utc', clock_timestamp()),
    'currencies', coalesce((
      select jsonb_agg(public.net_economy_currency_json(currency.currency_code)
        order by currency.currency_code)
      from public.net_economy_currencies as currency
    ), '[]'::jsonb),
    'fx_rates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency_a', rate.currency_a,
        'currency_b', rate.currency_b,
        'units_a', rate.units_a,
        'units_b', rate.units_b,
        'revision', rate.revision,
        'active', rate.active,
        'reason', rate.reason,
        'updated_at', rate.updated_at
      ) order by rate.currency_a, rate.currency_b)
      from public.net_economy_fx_rates as rate
    ), '[]'::jsonb),
    'identity_link_id', requested_identity_link_id,
    'identity_currency', public.net_economy_currency_json(v_assignment.currency_code),
    'assignment_basis', v_assignment.assignment_basis,
    'assignment_updated_at', v_assignment.updated_at
  );
end;
$$;

create or replace function public.set_net_economy_gm_identity_currency(
  requested_identity_link_id uuid,
  requested_currency_code text,
  requested_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.assert_net_economy_gm();
  v_code text := nullif(upper(btrim(coalesce(requested_currency_code, ''))), '');
  v_reason text := btrim(coalesce(requested_reason, ''));
  v_existing public.net_economy_identity_currency_assignments%rowtype;
  v_old_account public.net_economy_accounts%rowtype;
  v_expected_old_currency_code text;
  v_audit_id uuid;
begin
  if requested_identity_link_id is null
    or char_length(v_reason) < 1 or char_length(v_reason) > 200
  then
    raise exception 'ECONOMY_CURRENCY_ASSIGNMENT_INVALID' using errcode = '22023';
  end if;
  if v_code is not null and not exists (
    select 1 from public.net_economy_currencies as currency
    where currency.currency_code = v_code and currency.status = 'active'
      and currency.decimals = 0 and currency.currency_code <> 'KARMA'
  ) then
    raise exception 'ECONOMY_CURRENCY_REQUIRED' using errcode = '22023';
  end if;
  select * into v_existing
  from public.net_economy_identity_currency_assignments as assignment
  where assignment.identity_link_id = requested_identity_link_id;
  v_expected_old_currency_code := v_existing.currency_code;
  if v_existing.currency_code is not distinct from v_code then
    return public.fetch_net_economy_gm_altara_configuration(requested_identity_link_id);
  end if;
  if v_existing.currency_code is not null then
    select * into v_old_account
    from public.net_economy_accounts as account
    where account.identity_link_id = requested_identity_link_id
      and account.account_kind = 'bank'
      and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
      and account.currency_code = v_existing.currency_code
      and not exists (
        select 1
        from public.net_economy_altara_bank_multicurrency_transitions as transition
        where transition.legacy_vg_bank_account_id = account.id
      );
    if v_old_account.id is not null then
      perform 1 from public.net_economy_accounts as account
      where account.id = v_old_account.id for update;
    end if;
  end if;

  perform 1 from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  for share;
  if not found then
    raise exception 'ECONOMY_CURRENCY_IDENTITY_INVALID' using errcode = '22023';
  end if;
  perform 1 from public.profiles as profile
  where profile.id = v_actor for share;
  v_actor := public.assert_net_economy_gm();
  select * into v_existing
  from public.net_economy_identity_currency_assignments as assignment
  where assignment.identity_link_id = requested_identity_link_id
  for update;
  if v_existing.currency_code is distinct from v_expected_old_currency_code then
    raise exception 'ALTARA_BANK_CURRENCY_CONTEXT_CHANGED' using errcode = '40001';
  end if;

  if v_old_account.id is not null then
    select * into v_old_account
    from public.net_economy_accounts as account
    where account.id = v_old_account.id;
      if v_old_account.balance_amount <> 0 or exists (
        select 1 from public.net_economy_transaction_entries as entry
        where entry.account_id = v_old_account.id
      ) then
        raise exception 'ALTARA_BANK_CURRENCY_CHANGE_REVIEW_REQUIRED' using errcode = '23514';
      end if;
    update public.net_economy_accounts set status = 'closed'
    where id = v_old_account.id and status <> 'closed';
  end if;
  if v_code is null then
    delete from public.net_economy_identity_currency_assignments
    where identity_link_id = requested_identity_link_id;
  else
    insert into public.net_economy_identity_currency_assignments (
      identity_link_id, currency_code, assignment_basis,
      assigned_by_profile_id, updated_at
    ) values (
      requested_identity_link_id, v_code, 'gm-explicit', v_actor,
      timezone('utc', clock_timestamp())
    ) on conflict (identity_link_id) do update set
      currency_code = excluded.currency_code,
      assignment_basis = excluded.assignment_basis,
      assigned_by_profile_id = excluded.assigned_by_profile_id,
      updated_at = excluded.updated_at;
  end if;
  insert into public.net_economy_identity_currency_assignment_audit (
    identity_link_id, previous_currency_code, assigned_currency_code,
    reason, assigned_by_profile_id
  ) values (
    requested_identity_link_id, v_expected_old_currency_code, v_code,
    v_reason, v_actor
  ) returning id into v_audit_id;
  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    v_actor, null, null, null, 'system', 'economy.currency.assign',
    'authoritative-gm-economy-control', 'economy-currency-assignment', v_audit_id
  );
  perform public.net_economy_sync_identity_cash_mirror(requested_identity_link_id);
  return public.fetch_net_economy_gm_altara_configuration(requested_identity_link_id);
end;
$$;

create or replace function public.set_net_economy_gm_fx_rate(
  requested_currency_a text,
  requested_currency_b text,
  requested_units_a bigint,
  requested_units_b bigint,
  requested_active boolean,
  requested_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.assert_net_economy_gm();
  v_input_a text := upper(btrim(coalesce(requested_currency_a, '')));
  v_input_b text := upper(btrim(coalesce(requested_currency_b, '')));
  v_currency_a text;
  v_currency_b text;
  v_units_a bigint;
  v_units_b bigint;
  v_divisor bigint;
  v_reason text := btrim(coalesce(requested_reason, ''));
  v_revision uuid := gen_random_uuid();
begin
  if v_input_a = v_input_b or v_input_a = 'KARMA' or v_input_b = 'KARMA'
    or requested_units_a is null or requested_units_b is null
    or requested_active is null
    or requested_units_a not between 1 and 1000000000
    or requested_units_b not between 1 and 1000000000
    or char_length(v_reason) < 1 or char_length(v_reason) > 200
  then
    raise exception 'ALTARA_BANK_FX_RATE_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.net_economy_currencies as currency
    where currency.currency_code in (v_input_a, v_input_b)
      and currency.status = 'active'
    having count(*) = 2
  ) then
    raise exception 'ECONOMY_CURRENCY_REQUIRED' using errcode = '22023';
  end if;
  perform 1 from public.profiles as profile where profile.id = v_actor for share;
  v_actor := public.assert_net_economy_gm();
  if v_input_a < v_input_b then
    v_currency_a := v_input_a; v_currency_b := v_input_b;
    v_units_a := requested_units_a; v_units_b := requested_units_b;
  else
    v_currency_a := v_input_b; v_currency_b := v_input_a;
    v_units_a := requested_units_b; v_units_b := requested_units_a;
  end if;
  v_divisor := public.net_economy_gcd(v_units_a, v_units_b);
  v_units_a := v_units_a / v_divisor;
  v_units_b := v_units_b / v_divisor;
  insert into public.net_economy_fx_rate_audit (
    revision, currency_a, currency_b, units_a, units_b, active, reason,
    updated_by_profile_id
  ) values (
    v_revision, v_currency_a, v_currency_b, v_units_a, v_units_b,
    requested_active, v_reason, v_actor
  );
  insert into public.net_economy_fx_rates (
    currency_a, currency_b, units_a, units_b, revision, active, reason,
    updated_by_profile_id, updated_at
  ) values (
    v_currency_a, v_currency_b, v_units_a, v_units_b, v_revision,
    requested_active, v_reason, v_actor,
    timezone('utc', clock_timestamp())
  ) on conflict (currency_a, currency_b) do update set
    units_a = excluded.units_a,
    units_b = excluded.units_b,
    revision = excluded.revision,
    active = excluded.active,
    reason = excluded.reason,
    updated_by_profile_id = excluded.updated_by_profile_id,
    updated_at = excluded.updated_at;
  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    v_actor, null, null, null, 'system', 'economy.fx-rate.set',
    'authoritative-gm-economy-control', 'economy-fx-rate', v_revision
  );
  return public.fetch_net_economy_gm_altara_configuration(null);
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
    select jsonb_agg(jsonb_build_object(
      'account_id', directory.account_id,
      'identity_link_id', directory.identity_link_id,
      'display_name', directory.display_name,
      'payment_identifier', directory.payment_identifier,
      'balance_amount', directory.balance_amount,
      'currency', public.net_economy_currency_json(directory.currency_code),
      'status', directory.status,
      'service_available', directory.service_available,
      'opened_at', directory.opened_at,
      'updated_at', directory.updated_at
    ) order by directory.display_name, directory.payment_identifier)
    from (
      select account.id as account_id, account.identity_link_id,
        public.net_economy_identity_display_name(account.identity_link_id) as display_name,
        account.payment_identifier, account.balance_amount, account.currency_code,
        account.status,
        public.net_identity_link_can_access_service(account.identity_link_id, 'altara-bank')
          as service_available,
        account.created_at as opened_at, account.updated_at
      from public.net_economy_accounts as account
      join public.net_identity_links as identity_link
        on identity_link.id = account.identity_link_id
        and identity_link.identity_kind = 'player'
        and identity_link.playability = 'playable'
      join public.net_economy_identity_currency_assignments as assignment
        on assignment.identity_link_id = account.identity_link_id
        and assignment.currency_code = account.currency_code
      where account.account_kind = 'bank'
        and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
        and account.status = 'active'
        and not exists (
          select 1
          from public.net_economy_altara_bank_multicurrency_transitions as transition
          where transition.legacy_vg_bank_account_id = account.id
        )
        and (
          v_query = ''
          or account.payment_identifier like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
          or lower(public.net_economy_identity_display_name(account.identity_link_id))
            like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
        )
      order by display_name, account.payment_identifier limit v_limit
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
  v_identity_link_id uuid;
begin
  perform public.assert_net_economy_gm();
  select account.identity_link_id into v_identity_link_id
  from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.payment_identifier = lower(btrim(coalesce(requested_payment_identifier, '')))
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and account.status = 'active'
    and not exists (
      select 1
      from public.net_economy_altara_bank_multicurrency_transitions as transition
      where transition.legacy_vg_bank_account_id = account.id
    );
  if not found then raise exception 'ALTARA_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023'; end if;
  return public.net_economy_altara_bank_payload(
    v_identity_link_id, requested_cursor_at, requested_cursor_id, requested_limit
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
  v_actor uuid := public.assert_net_economy_gm();
  v_identifier text := lower(btrim(coalesce(requested_payment_identifier, '')));
  v_action text := lower(btrim(coalesce(requested_action, '')));
  v_reason text := btrim(coalesce(requested_reason, ''));
  v_account public.net_economy_accounts%rowtype;
  v_system public.net_economy_accounts%rowtype;
  v_existing public.net_economy_transactions%rowtype;
  v_transaction public.net_economy_transactions%rowtype;
  v_kind text;
  v_delta bigint;
  v_scope text := 'gm:' || v_actor::text;
  v_fingerprint text;
begin
  if v_action not in ('credit', 'debit')
    or requested_amount is null or requested_amount not between 1 and 1000000000
    or char_length(v_reason) < 1 or char_length(v_reason) > 200
    or requested_request_key is null
  then raise exception 'ECONOMY_ADJUSTMENT_INVALID' using errcode = '22023'; end if;
  select account.* into v_account
  from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.payment_identifier = v_identifier
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
    and not exists (
      select 1
      from public.net_economy_altara_bank_multicurrency_transitions as transition
      where transition.legacy_vg_bank_account_id = account.id
    );
  if not found then raise exception 'ALTARA_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023'; end if;
  v_kind := case v_action when 'credit' then 'gm-credit' else 'gm-debit' end;
  v_delta := case v_action when 'credit' then requested_amount else -requested_amount end;
  v_fingerprint := md5(v_account.id::text || ':' || v_account.currency_code || ':'
    || v_action || ':' || requested_amount::text || ':' || v_reason);
  select * into v_existing from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;
  if found then
    if v_existing.transaction_kind <> v_kind
      or v_existing.currency_code <> v_account.currency_code
      or v_existing.request_fingerprint <> v_fingerprint
    then raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023'; end if;
    return public.fetch_net_economy_gm_altara_bank(v_identifier, null, null, 20);
  end if;
  select * into v_system from public.net_economy_accounts as account
  where account.id = public.net_economy_altara_clearing_account_id(v_account.currency_code);
  perform 1 from public.net_economy_accounts as account
  where account.id in (v_account.id, v_system.id) order by account.id for update;
  perform 1 from public.net_identity_links as identity_link
  where identity_link.id = v_account.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  for share;
  perform 1 from public.net_economy_identity_currency_assignments as assignment
  where assignment.identity_link_id = v_account.identity_link_id
    and assignment.currency_code = v_account.currency_code
  for share;
  perform 1 from public.profiles as profile where profile.id = v_actor for share;
  v_actor := public.assert_net_economy_gm();
  select account.* into v_account from public.net_economy_accounts as account
  join public.net_economy_identity_currency_assignments as assignment
    on assignment.identity_link_id = account.identity_link_id
    and assignment.currency_code = account.currency_code
  where account.id = v_account.id and account.status = 'active';
  select * into v_system from public.net_economy_accounts as account
  where account.id = v_system.id and account.account_kind = 'system'
    and account.currency_code = v_account.currency_code and account.status = 'active';
  if v_account.id is null or v_system.id is null then
    raise exception 'ALTARA_BANK_ACCOUNT_UNAVAILABLE' using errcode = '55000';
  end if;
  if v_action = 'debit' and v_account.balance_amount < requested_amount then
    raise exception 'ECONOMY_BANK_INSUFFICIENT_FUNDS' using errcode = '22023';
  end if;
  insert into public.net_economy_transactions (
    transaction_kind, initiated_by_profile_id, request_scope, request_key,
    request_fingerprint, note, currency_code
  ) values (
    v_kind, v_actor, v_scope, requested_request_key, v_fingerprint,
    v_reason, v_account.currency_code
  ) on conflict (request_scope, request_key) do nothing returning * into v_transaction;
  if v_transaction.id is null then
    select * into v_existing
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
    return public.fetch_net_economy_gm_altara_bank(
      v_identifier, null, null, 20
    );
  end if;
  insert into public.net_economy_transaction_entries (
    transaction_id, account_id, amount, created_at
  ) values
    (v_transaction.id, v_account.id, v_delta, v_transaction.created_at),
    (v_transaction.id, v_system.id, -v_delta, v_transaction.created_at);
  update public.net_economy_accounts set balance_amount = balance_amount + v_delta
    where id = v_account.id;
  update public.net_economy_accounts set balance_amount = balance_amount - v_delta
    where id = v_system.id;
  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    v_actor, null, null, null, 'system',
    case v_action when 'credit' then 'economy.altara-bank.credit'
      else 'economy.altara-bank.debit' end,
    'authoritative-gm-economy-control', 'economy-transaction', v_transaction.id
  );
  return public.fetch_net_economy_gm_altara_bank(v_identifier, null, null, 20);
end;
$$;

-- Raw helpers stay internal; clients receive only bounded, actor-derived RPCs.
revoke all on function public.net_economy_enforce_independent_bank_currency()
  from public, anon, authenticated;
revoke all on function public.net_economy_currency_display(text,bigint)
  from public, anon, authenticated;
revoke all on function public.net_economy_currency_json(text)
  from public, anon, authenticated;
revoke all on function public.net_economy_altara_bank_history_page(uuid,timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_altara_bank_payload(uuid,timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_sync_identity_cash_mirror(uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_open_altara_bank_for_link(uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_altara_clearing_account_id(text)
  from public, anon, authenticated;
revoke all on function public.net_economy_gcd(bigint,bigint)
  from public, anon, authenticated;
revoke all on function public.net_economy_enforce_cash_mirror()
  from public, anon, authenticated;
revoke all on function public.net_economy_sync_cash_mirror()
  from public, anon, authenticated;

revoke all on function public.fetch_net_economy_altara_bank(uuid,timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.open_net_economy_altara_bank(uuid)
  from public, anon, authenticated;
revoke all on function public.search_net_economy_altara_bank_payees(uuid,text,integer)
  from public, anon, authenticated;
revoke all on function public.quote_net_economy_altara_bank_payment(uuid,text,bigint)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_altara_bank_payment(uuid,text,bigint,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_economy_gm_altara_configuration(uuid)
  from public, anon, authenticated;
revoke all on function public.set_net_economy_gm_identity_currency(uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.set_net_economy_gm_fx_rate(text,text,bigint,bigint,boolean,text)
  from public, anon, authenticated;
revoke all on function public.fetch_net_economy_gm_altara_bank_directory(text,integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_economy_gm_altara_bank(text,timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.adjust_net_economy_gm_altara_bank(text,text,bigint,text,uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_economy_sheet_account_sources(text,uuid)
  from public, anon, authenticated;
revoke all on function public.current_user_can_read_net_altara_bank_avatar(text)
  from public, anon, authenticated;
revoke all on function public.current_user_can_read_net_economy_wallet_revision(uuid)
  from public, anon, authenticated;

grant execute on function public.fetch_net_economy_altara_bank(uuid,timestamptz,uuid,integer)
  to authenticated;
grant execute on function public.open_net_economy_altara_bank(uuid)
  to authenticated;
grant execute on function public.search_net_economy_altara_bank_payees(uuid,text,integer)
  to authenticated;
grant execute on function public.quote_net_economy_altara_bank_payment(uuid,text,bigint)
  to authenticated;
grant execute on function public.transfer_net_economy_altara_bank_payment(uuid,text,bigint,uuid,uuid)
  to authenticated;
grant execute on function public.fetch_net_economy_gm_altara_configuration(uuid)
  to authenticated;
grant execute on function public.set_net_economy_gm_identity_currency(uuid,text,text)
  to authenticated;
grant execute on function public.set_net_economy_gm_fx_rate(text,text,bigint,bigint,boolean,text)
  to authenticated;
grant execute on function public.fetch_net_economy_gm_altara_bank_directory(text,integer)
  to authenticated;
grant execute on function public.fetch_net_economy_gm_altara_bank(text,timestamptz,uuid,integer)
  to authenticated;
grant execute on function public.adjust_net_economy_gm_altara_bank(text,text,bigint,text,uuid)
  to authenticated;
grant execute on function public.fetch_net_economy_sheet_account_sources(text,uuid)
  to authenticated;
grant execute on function public.current_user_can_read_net_altara_bank_avatar(text)
  to authenticated;
grant execute on function public.current_user_can_read_net_economy_wallet_revision(uuid)
  to authenticated;

comment on function public.transfer_net_economy_altara_bank_payment(uuid,text,bigint,uuid,uuid) is
  'Server-quoted same- or cross-currency ALTARA BANK payment with actor-wide idempotency, deterministic locks, and homogeneous balanced transactions.';
comment on function public.current_user_can_read_net_altara_bank_avatar(text) is
  'Authorizes only current private avatar variants belonging to bounded active ALTARA BANK payees.';

commit;
