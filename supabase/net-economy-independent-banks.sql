-- Independent bank payments + SHNEIDER BANK V1.
-- Run once after the deployed VLT/Karma, VOX BANK, and sheet economy migrations.
-- This is additive: existing accounts, balances, yield anchors, identifiers, and
-- immutable ledger history are never recreated or recalculated.

begin;

create extension if not exists pgcrypto;

-- SHNEIDER BANK is an optional VEIL OS application. Installing the app and
-- opening a financial account remain two separate, explicit actions.
insert into public.net_app_account_policies (app_id, account_mode, account_available)
values ('shneider-bank', 'none', false)
on conflict (app_id) do update
set
  account_mode = excluded.account_mode,
  account_available = excluded.account_available,
  updated_at = timezone('utc', now());

alter table public.net_identity_app_installs
  drop constraint if exists net_identity_app_installs_app_id_check;
alter table public.net_identity_app_installs
  add constraint net_identity_app_installs_app_id_check
  check (app_id in ('echo', 'pulse', 'nvn', 'vox-bank', 'shneider-bank')) not valid;
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
    or not public.current_user_controls_playable_net_identity_link(requested_identity_link_id)
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;

  if requested_app_id is null
    or requested_app_id not in ('echo', 'pulse', 'nvn', 'vox-bank', 'shneider-bank')
  then
    raise exception 'This application is not an installable optional NET module.'
      using errcode = '22023';
  end if;

  if requested_installed is null then
    raise exception 'Installation state is required.' using errcode = '22023';
  end if;

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

-- The institution registry already owns VOX. SHNEIDER uses the same bank-ready
-- account model and the same VG ledger; its zero yield values are structural
-- placeholders only and do not create a yield product.
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
  '00000000-0000-0000-0000-00000000e101'::uuid,
  'SHNEIDER',
  'SHNEIDER BANK',
  'SHNEIDER',
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
    where institution.id = '00000000-0000-0000-0000-00000000e101'::uuid
      and institution.institution_code = 'SHNEIDER'
      and institution.display_name = 'SHNEIDER BANK'
      and institution.owner_name = 'SHNEIDER'
      and institution.yield_rate_basis_points = 0
  ) then
    raise exception 'SHNEIDER_BANK_INSTITUTION_CONFIG_CONFLICT' using errcode = '23514';
  end if;
end;
$$;

-- VOX Yield now tracks the balance that actually completed the current
-- eligibility period. Existing anchors are intentionally left untouched. A
-- nullable-first backfill makes an accidental migration rerun preserve any
-- principal already advanced by live banking activity.
-- Lock accounts before state, matching every VOX mutation, so no invocation of
-- the deployed pre-principal functions can straddle this one-time backfill.
lock table public.net_economy_accounts in share row exclusive mode;
lock table public.net_economy_vox_bank_state in access exclusive mode;

alter table public.net_economy_vox_bank_state
  add column if not exists yield_principal_amount bigint;

update public.net_economy_vox_bank_state as state
set yield_principal_amount = account.balance_amount
from public.net_economy_accounts as account
where account.id = state.account_id
  and state.yield_principal_amount is null;

alter table public.net_economy_vox_bank_state
  alter column yield_principal_amount set default 0,
  alter column yield_principal_amount set not null;

alter table public.net_economy_vox_bank_state
  drop constraint if exists net_economy_vox_bank_state_yield_principal_valid;
alter table public.net_economy_vox_bank_state
  add constraint net_economy_vox_bank_state_yield_principal_valid check (
    yield_principal_amount between 0 and 9000000000000000
  ) not valid;
alter table public.net_economy_vox_bank_state
  validate constraint net_economy_vox_bank_state_yield_principal_valid;

comment on column public.net_economy_vox_bank_state.yield_principal_amount is
  'VOX balance eligible for the current yield period; incoming direct payments join only after the next successful claim or principal reset.';

-- A compact authoritative benefit registry. It is deliberately not a player
-- promotions API: only internal checkout code may call the pricing helper.
create table if not exists public.net_economy_institution_benefits (
  institution_id uuid not null
    references public.net_economy_institutions (id) on delete restrict,
  merchant_category text not null,
  discount_basis_points integer not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (institution_id, merchant_category),
  constraint net_economy_institution_benefits_category_valid check (
    merchant_category in ('hospital', 'clinic', 'pharmacy')
  ),
  constraint net_economy_institution_benefits_discount_valid check (
    discount_basis_points between 0 and 10000
  )
);

drop trigger if exists net_economy_institution_benefits_set_updated_at
  on public.net_economy_institution_benefits;
create trigger net_economy_institution_benefits_set_updated_at
before update on public.net_economy_institution_benefits
for each row execute procedure public.set_updated_at();

insert into public.net_economy_institution_benefits (
  institution_id,
  merchant_category,
  discount_basis_points,
  active
)
values
  ('00000000-0000-0000-0000-00000000e101'::uuid, 'hospital', 1000, true),
  ('00000000-0000-0000-0000-00000000e101'::uuid, 'clinic', 1000, true),
  ('00000000-0000-0000-0000-00000000e101'::uuid, 'pharmacy', 500, true)
on conflict (institution_id, merchant_category) do update
set
  discount_basis_points = excluded.discount_basis_points,
  active = excluded.active,
  updated_at = timezone('utc', now());

-- Internal future-checkout contract. It only computes a bounded price; it does
-- not write an account, transaction, or entry and it is never granted to a
-- normal client. A future authoritative merchant checkout may call it inside
-- its own locked ledger transaction.
create or replace function public.net_economy_institution_checkout_price(
  requested_institution_id uuid,
  requested_merchant_category text,
  requested_gross_amount bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_category text := lower(btrim(coalesce(requested_merchant_category, '')));
  v_basis_points integer := 0;
  v_discount bigint;
begin
  if requested_institution_id is null
    or v_category not in ('hospital', 'clinic', 'pharmacy')
    or requested_gross_amount is null
    or requested_gross_amount < 1
    or requested_gross_amount > 1000000000
  then
    raise exception 'ECONOMY_CHECKOUT_PRICE_INVALID' using errcode = '22023';
  end if;

  select benefit.discount_basis_points
  into v_basis_points
  from public.net_economy_institution_benefits as benefit
  join public.net_economy_institutions as institution
    on institution.id = benefit.institution_id
  where benefit.institution_id = requested_institution_id
    and benefit.merchant_category = v_category
    and benefit.active
    and institution.status = 'active';

  v_basis_points := coalesce(v_basis_points, 0);
  v_discount := floor(
    (requested_gross_amount::numeric * v_basis_points::numeric) / 10000
  )::bigint;

  return jsonb_build_object(
    'currency_code', 'VG',
    'merchant_category', v_category,
    'gross_amount', requested_gross_amount,
    'discount_basis_points', v_basis_points,
    'discount_amount', v_discount,
    'final_amount', requested_gross_amount - v_discount
  );
end;
$$;

-- Both supported bank products are VG-only even for future privileged writes.
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
  return new;
end;
$$;

drop trigger if exists net_economy_accounts_enforce_independent_bank_currency
  on public.net_economy_accounts;
create trigger net_economy_accounts_enforce_independent_bank_currency
before insert or update on public.net_economy_accounts
for each row execute procedure public.net_economy_enforce_independent_bank_currency();

create index if not exists net_economy_accounts_bank_payment_directory_idx
  on public.net_economy_accounts (institution_id, status, payment_identifier)
  where account_kind = 'bank' and currency_code = 'VG';

-- Preserve every deployed history kind while adding a generic same-bank
-- person-to-person transfer. The deployed deferred balance/currency trigger is
-- unchanged and continues to validate all entries at transaction commit.
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
      'sheet-vg-adjustment',
      'sheet-karma-adjustment'
    )
  ) not valid;
alter table public.net_economy_transactions
  validate constraint net_economy_transactions_kind_valid;

-- VLT's combined wallet statement identifies the bank on the other side of a
-- deposit/withdrawal without exposing that bank account or any private balance.
-- Existing wallet and Karma counterparty projection remains unchanged.
create or replace function public.net_economy_identity_history_page(
  requested_identity_link_id uuid,
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
  ), owned_accounts as (
    select account.id
    from public.net_economy_accounts as account
    where account.identity_link_id = requested_identity_link_id
      and account.account_kind = 'wallet'
      and account.currency_code in ('VG', 'KARMA')
  ), page as (
    select
      entry.transaction_id,
      entry.amount,
      transaction_record.currency_code,
      transaction_record.transaction_kind,
      transaction_record.note,
      entry.created_at,
      counterparty.payment_identifier as counterparty_payment_identifier,
      counterparty.display_name as counterparty_display_name,
      counterparty.institution_code as counterparty_institution_code,
      counterparty.institution_name as counterparty_institution_name
    from public.net_economy_transaction_entries as entry
    join owned_accounts on owned_accounts.id = entry.account_id
    join public.net_economy_transactions as transaction_record
      on transaction_record.id = entry.transaction_id
    left join lateral (
      select
        public_account.payment_identifier,
        public.net_economy_identity_display_name(other_account.identity_link_id) as display_name,
        institution.institution_code,
        institution.display_name as institution_name
      from public.net_economy_transaction_entries as other_entry
      join public.net_economy_accounts as other_account
        on other_account.id = other_entry.account_id
      left join public.net_economy_accounts as public_account
        on public_account.identity_link_id = other_account.identity_link_id
        and public_account.account_kind = 'wallet'
        and public_account.currency_code = 'VG'
      left join public.net_economy_institutions as institution
        on institution.id = other_account.institution_id
      where other_entry.transaction_id = entry.transaction_id
        and other_entry.account_id <> entry.account_id
        and other_account.account_kind <> 'system'
      limit 1
    ) as counterparty on true
    cross join settings
    where requested_cursor_at is null
      or (entry.created_at, entry.transaction_id) < (requested_cursor_at, requested_cursor_id)
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
          'currency_code', trimmed.currency_code,
          'direction', case when trimmed.amount > 0 then 'incoming' else 'outgoing' end,
          'transaction_kind', trimmed.transaction_kind,
          'counterparty_display_name', trimmed.counterparty_display_name,
          'counterparty_payment_identifier', trimmed.counterparty_payment_identifier,
          'counterparty_institution_code', trimmed.counterparty_institution_code,
          'counterparty_institution_name', trimmed.counterparty_institution_name,
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

-- Shared bounded bank statement. Only bank-transfer exposes a same-bank public
-- counterparty identity; VLT/system counterparties remain implementation detail.
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
        public.net_economy_identity_display_name(other_account.identity_link_id) as display_name
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
        'bank-deposit', 'bank-withdrawal', 'bank-yield', 'bank-transfer'
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

-- Preserve the public VOX RPC while extending its bounded statement and adding
-- its institution-specific payment identity.
create or replace function public.net_economy_vox_bank_history_page(
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
  select public.net_economy_bank_history_page(
    requested_account_id,
    '00000000-0000-0000-0000-00000000e100'::uuid,
    requested_cursor_at,
    requested_cursor_id,
    requested_limit
  );
$$;

create or replace function public.net_economy_vox_bank_payload(
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
  v_now timestamptz := timezone('utc', clock_timestamp());
  v_wallet public.net_economy_accounts%rowtype;
  v_bank public.net_economy_accounts%rowtype;
  v_institution public.net_economy_institutions%rowtype;
  v_state public.net_economy_vox_bank_state%rowtype;
  v_eligible_at timestamptz;
  v_projected_yield bigint;
  v_empty_activity jsonb := jsonb_build_object(
    'items', '[]'::jsonb,
    'has_more', false,
    'next_cursor_at', null,
    'next_cursor_id', null
  );
begin
  select * into v_institution
  from public.net_economy_institutions as institution
  where institution.id = '00000000-0000-0000-0000-00000000e100'::uuid
    and institution.institution_code = 'VOX';
  if not found then
    raise exception 'VOX_BANK_INSTITUTION_UNAVAILABLE' using errcode = '55000';
  end if;

  select * into v_wallet
  from public.net_economy_accounts as account
  where account.identity_link_id = requested_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'VG';
  if not found then
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;

  select * into v_bank
  from public.net_economy_accounts as account
  where account.identity_link_id = requested_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = v_institution.id
    and account.currency_code = 'VG';

  if v_bank.id is null then
    return jsonb_build_object(
      'server_now', v_now,
      'identity', jsonb_build_object(
        'display_name', public.net_economy_identity_display_name(requested_identity_link_id)
      ),
      'wallet', jsonb_build_object(
        'account_id', v_wallet.id,
        'balance_amount', v_wallet.balance_amount,
        'updated_at', v_wallet.updated_at
      ),
      'bank', null,
      'yield', null,
      'activity', v_empty_activity
    );
  end if;

  select * into v_state
  from public.net_economy_vox_bank_state as state
  where state.account_id = v_bank.id;
  if not found then
    raise exception 'VOX_BANK_STATE_UNAVAILABLE' using errcode = '55000';
  end if;

  v_eligible_at := v_state.yield_anchor_at + v_institution.yield_period;
  v_projected_yield := least(
    floor(
      (v_state.yield_principal_amount::numeric * v_institution.yield_rate_basis_points::numeric)
      / 10000
    ),
    v_institution.maximum_yield_amount::numeric
  )::bigint;

  return jsonb_build_object(
    'server_now', v_now,
    'identity', jsonb_build_object(
      'display_name', public.net_economy_identity_display_name(requested_identity_link_id)
    ),
    'wallet', jsonb_build_object(
      'account_id', v_wallet.id,
      'balance_amount', v_wallet.balance_amount,
      'updated_at', v_wallet.updated_at
    ),
    'bank', jsonb_build_object(
      'account_id', v_bank.id,
      'payment_identifier', v_bank.payment_identifier,
      'balance_amount', v_bank.balance_amount,
      'currency_code', v_bank.currency_code,
      'status', v_bank.status,
      'opened_at', v_bank.created_at,
      'updated_at', v_bank.updated_at
    ),
    'yield', jsonb_build_object(
      'rate_basis_points', v_institution.yield_rate_basis_points,
      'period_seconds', extract(epoch from v_institution.yield_period)::bigint,
      'anchor_at', v_state.yield_anchor_at,
      'eligible_at', v_eligible_at,
      'projected_amount', v_projected_yield,
      'ready', v_projected_yield > 0 and v_now >= v_eligible_at
    ),
    'activity', public.net_economy_vox_bank_history_page(
      v_bank.id,
      requested_cursor_at,
      requested_cursor_id,
      requested_limit
    )
  );
end;
$$;

-- VLT/VOX principal moves continue to restart eligibility. The resulting VOX
-- balance becomes the complete eligible principal for the new period.
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
declare
  v_actor uuid := auth.uid();
  v_identity_link_id uuid;
  v_direction text := lower(btrim(coalesce(requested_direction, '')));
  v_wallet public.net_economy_accounts%rowtype;
  v_bank public.net_economy_accounts%rowtype;
  v_state public.net_economy_vox_bank_state%rowtype;
  v_existing public.net_economy_transactions%rowtype;
  v_transaction public.net_economy_transactions%rowtype;
  v_scope text;
  v_fingerprint text;
  v_kind text;
  v_resulting_bank_balance bigint;
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  if v_direction not in ('deposit', 'withdraw') then
    raise exception 'VOX_BANK_DIRECTION_INVALID' using errcode = '22023';
  end if;
  if requested_amount is null or requested_amount < 1 or requested_amount > 1000000000 then
    raise exception 'ECONOMY_AMOUNT_INVALID' using errcode = '22023';
  end if;
  if requested_request_key is null then
    raise exception 'ECONOMY_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;

  select * into v_wallet
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'VG';
  select * into v_bank
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e100'::uuid
    and account.currency_code = 'VG';
  if v_wallet.id is null then
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;
  if v_bank.id is null then
    raise exception 'VOX_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;

  v_kind := case v_direction
    when 'deposit' then 'bank-deposit'
    else 'bank-withdrawal'
  end;
  v_scope := 'vox-bank:' || v_actor::text;
  v_fingerprint := md5(
    v_identity_link_id::text || ':' || v_direction || ':'
    || requested_amount::text || ':' || v_wallet.id::text || ':' || v_bank.id::text
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
    return public.net_economy_vox_bank_payload(v_identity_link_id, null, null, 20);
  end if;

  perform 1
  from public.net_economy_accounts as account
  where account.id in (v_wallet.id, v_bank.id)
  order by account.id
  for update;

  select * into v_state
  from public.net_economy_vox_bank_state as state
  where state.account_id = v_bank.id
  for update;
  if not found then
    raise exception 'VOX_BANK_STATE_UNAVAILABLE' using errcode = '55000';
  end if;

  select * into v_wallet
  from public.net_economy_accounts as account
  where account.id = v_wallet.id;
  select * into v_bank
  from public.net_economy_accounts as account
  where account.id = v_bank.id;

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
    return public.net_economy_vox_bank_payload(v_identity_link_id, null, null, 20);
  end if;

  if v_wallet.status <> 'active' then
    raise exception 'ECONOMY_WALLET_INACTIVE' using errcode = '22023';
  end if;
  if v_bank.status <> 'active' then
    raise exception 'VOX_BANK_ACCOUNT_INACTIVE' using errcode = '22023';
  end if;
  if v_direction = 'deposit' and v_wallet.balance_amount < requested_amount then
    raise exception 'ECONOMY_INSUFFICIENT_FUNDS' using errcode = '22023';
  end if;
  if v_direction = 'withdraw' and v_bank.balance_amount < requested_amount then
    raise exception 'VOX_BANK_INSUFFICIENT_FUNDS' using errcode = '22023';
  end if;

  v_resulting_bank_balance := v_bank.balance_amount
    + case when v_direction = 'deposit' then requested_amount else -requested_amount end;

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
    null,
    'VG'
  ) returning * into v_transaction;

  insert into public.net_economy_transaction_entries (
    transaction_id,
    account_id,
    amount,
    created_at
  ) values
    (
      v_transaction.id,
      v_wallet.id,
      case when v_direction = 'deposit' then -requested_amount else requested_amount end,
      v_transaction.created_at
    ),
    (
      v_transaction.id,
      v_bank.id,
      case when v_direction = 'deposit' then requested_amount else -requested_amount end,
      v_transaction.created_at
    );

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount
    + case when v_direction = 'deposit' then -requested_amount else requested_amount end
  where account.id = v_wallet.id;
  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount
    + case when v_direction = 'deposit' then requested_amount else -requested_amount end
  where account.id = v_bank.id;

  update public.net_economy_vox_bank_state as state
  set
    yield_anchor_at = v_transaction.created_at,
    yield_principal_amount = v_resulting_bank_balance
  where state.account_id = v_bank.id;

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
    'owner',
    case v_direction
      when 'deposit' then 'economy.vox-bank.deposit'
      else 'economy.vox-bank.withdraw'
    end,
    'controlled-active-identity',
    'economy-transaction',
    v_transaction.id
  );

  return public.net_economy_vox_bank_payload(v_identity_link_id, null, null, 20);
end;
$$;

-- A successful claim pays only the principal that was eligible for the period.
-- Its next period begins from the complete resulting balance, including prior
-- incoming payments and the newly ledgered yield.
create or replace function public.claim_net_economy_vox_bank_yield(
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
  v_bank public.net_economy_accounts%rowtype;
  v_system public.net_economy_accounts%rowtype;
  v_state public.net_economy_vox_bank_state%rowtype;
  v_institution public.net_economy_institutions%rowtype;
  v_existing public.net_economy_transactions%rowtype;
  v_transaction public.net_economy_transactions%rowtype;
  v_scope text;
  v_fingerprint text;
  v_now timestamptz;
  v_yield_amount bigint;
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  if requested_request_key is null then
    raise exception 'ECONOMY_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;

  select * into v_bank
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e100'::uuid
    and account.currency_code = 'VG';
  if not found then
    raise exception 'VOX_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;

  v_scope := 'vox-bank:' || v_actor::text;
  v_fingerprint := md5(v_identity_link_id::text || ':yield:' || v_bank.id::text);

  select * into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;
  if found then
    if v_existing.transaction_kind <> 'bank-yield'
      or v_existing.currency_code <> 'VG'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.net_economy_vox_bank_payload(v_identity_link_id, null, null, 20);
  end if;

  perform 1
  from public.net_economy_accounts as account
  where account.id in (
    v_bank.id,
    '00000000-0000-0000-0000-00000000e001'::uuid
  )
  order by account.id
  for update;

  select * into v_state
  from public.net_economy_vox_bank_state as state
  where state.account_id = v_bank.id
  for update;
  if not found then
    raise exception 'VOX_BANK_STATE_UNAVAILABLE' using errcode = '55000';
  end if;

  select * into v_bank
  from public.net_economy_accounts as account
  where account.id = v_bank.id;
  select * into v_system
  from public.net_economy_accounts as account
  where account.id = '00000000-0000-0000-0000-00000000e001'::uuid
    and account.account_kind = 'system'
    and account.currency_code = 'VG';
  select * into v_institution
  from public.net_economy_institutions as institution
  where institution.id = '00000000-0000-0000-0000-00000000e100'::uuid
    and institution.institution_code = 'VOX'
    and institution.status = 'active';
  if v_system.id is null or v_institution.id is null then
    raise exception 'VOX_BANK_INSTITUTION_UNAVAILABLE' using errcode = '55000';
  end if;

  select * into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;
  if found then
    if v_existing.transaction_kind <> 'bank-yield'
      or v_existing.currency_code <> 'VG'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.net_economy_vox_bank_payload(v_identity_link_id, null, null, 20);
  end if;

  if v_bank.status <> 'active' then
    raise exception 'VOX_BANK_ACCOUNT_INACTIVE' using errcode = '22023';
  end if;
  v_now := timezone('utc', clock_timestamp());
  if v_now < v_state.yield_anchor_at + v_institution.yield_period then
    raise exception 'VOX_BANK_YIELD_NOT_READY' using errcode = '22023';
  end if;

  v_yield_amount := least(
    floor(
      (v_state.yield_principal_amount::numeric
        * v_institution.yield_rate_basis_points::numeric) / 10000
    ),
    v_institution.maximum_yield_amount::numeric
  )::bigint;
  if v_yield_amount < 1 then
    raise exception 'VOX_BANK_YIELD_NOT_AVAILABLE' using errcode = '22023';
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
    'bank-yield',
    v_actor,
    v_scope,
    requested_request_key,
    v_fingerprint,
    null,
    'VG'
  ) returning * into v_transaction;

  insert into public.net_economy_transaction_entries (
    transaction_id,
    account_id,
    amount,
    created_at
  ) values
    (v_transaction.id, v_system.id, -v_yield_amount, v_transaction.created_at),
    (v_transaction.id, v_bank.id, v_yield_amount, v_transaction.created_at);

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount - v_yield_amount
  where account.id = v_system.id;
  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount + v_yield_amount
  where account.id = v_bank.id;
  update public.net_economy_vox_bank_state as state
  set
    yield_anchor_at = v_transaction.created_at,
    yield_principal_amount = v_bank.balance_amount + v_yield_amount
  where state.account_id = v_bank.id;

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
    'owner',
    'economy.vox-bank.yield.claim',
    'controlled-active-identity',
    'economy-transaction',
    v_transaction.id
  );

  return public.net_economy_vox_bank_payload(v_identity_link_id, null, null, 20);
end;
$$;

-- SHNEIDER's compact app payload includes its own account, the VLT source used
-- only for explicit deposit/withdraw, public benefits, and bounded activity.
create or replace function public.net_economy_shneider_bank_payload(
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
  v_now timestamptz := timezone('utc', clock_timestamp());
  v_wallet public.net_economy_accounts%rowtype;
  v_bank public.net_economy_accounts%rowtype;
  v_institution public.net_economy_institutions%rowtype;
  v_empty_activity jsonb := jsonb_build_object(
    'items', '[]'::jsonb,
    'has_more', false,
    'next_cursor_at', null,
    'next_cursor_id', null
  );
  v_benefits jsonb;
begin
  select * into v_institution
  from public.net_economy_institutions as institution
  where institution.id = '00000000-0000-0000-0000-00000000e101'::uuid
    and institution.institution_code = 'SHNEIDER';
  if not found then
    raise exception 'SHNEIDER_BANK_INSTITUTION_UNAVAILABLE' using errcode = '55000';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'merchant_category', benefit.merchant_category,
      'discount_basis_points', benefit.discount_basis_points
    ) order by case benefit.merchant_category
      when 'hospital' then 1
      when 'clinic' then 2
      else 3
    end
  ), '[]'::jsonb)
  into v_benefits
  from public.net_economy_institution_benefits as benefit
  where benefit.institution_id = v_institution.id
    and benefit.active;

  select * into v_wallet
  from public.net_economy_accounts as account
  where account.identity_link_id = requested_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'VG';
  if not found then
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;

  select * into v_bank
  from public.net_economy_accounts as account
  where account.identity_link_id = requested_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = v_institution.id
    and account.currency_code = 'VG';

  return jsonb_build_object(
    'server_now', v_now,
    'identity', jsonb_build_object(
      'display_name', public.net_economy_identity_display_name(requested_identity_link_id)
    ),
    'institution', jsonb_build_object(
      'institution_code', v_institution.institution_code,
      'display_name', v_institution.display_name,
      'owner_name', v_institution.owner_name
    ),
    'wallet', jsonb_build_object(
      'account_id', v_wallet.id,
      'balance_amount', v_wallet.balance_amount,
      'updated_at', v_wallet.updated_at
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
    'benefits', v_benefits,
    'activity', case when v_bank.id is null then v_empty_activity else
      public.net_economy_bank_history_page(
        v_bank.id,
        v_institution.id,
        requested_cursor_at,
        requested_cursor_id,
        requested_limit
      )
    end
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
declare
  v_identity_link_id uuid;
begin
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'ECONOMY_CURSOR_INVALID' using errcode = '22023';
  end if;
  v_identity_link_id := public.assert_net_economy_player_identity();
  return public.net_economy_shneider_bank_payload(
    v_identity_link_id,
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
declare
  v_actor uuid := auth.uid();
  v_identity_link_id uuid;
  v_institution public.net_economy_institutions%rowtype;
  v_bank public.net_economy_accounts%rowtype;
  v_created boolean := false;
  v_identifier text;
begin
  v_identity_link_id := public.assert_net_economy_player_identity();

  select * into v_institution
  from public.net_economy_institutions as institution
  where institution.id = '00000000-0000-0000-0000-00000000e101'::uuid
    and institution.institution_code = 'SHNEIDER'
    and institution.status = 'active';
  if not found then
    raise exception 'SHNEIDER_BANK_INSTITUTION_UNAVAILABLE' using errcode = '55000';
  end if;

  select * into v_bank
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = v_institution.id
    and account.currency_code = 'VG';

  if not found then
    -- 31 UUID hex characters keep the public identifier within the deployed
    -- 40-character bound while retaining 124 deterministic identity bits.
    v_identifier := 'shneider-' || left(replace(v_identity_link_id::text, '-', ''), 31);
    insert into public.net_economy_accounts (
      identity_link_id,
      account_kind,
      institution_id,
      payment_identifier,
      currency_code,
      status,
      balance_amount
    ) values (
      v_identity_link_id,
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
      where account.identity_link_id = v_identity_link_id
        and account.account_kind = 'bank'
        and account.institution_id = v_institution.id
        and account.currency_code = 'VG';
      if not found then
        raise exception 'SHNEIDER_BANK_ACCOUNT_UNAVAILABLE' using errcode = '55000';
      end if;
    else
      v_created := true;
    end if;
  end if;

  if v_bank.status <> 'active' then
    raise exception 'SHNEIDER_BANK_ACCOUNT_INACTIVE' using errcode = '22023';
  end if;

  insert into public.net_economy_wallet_realtime_state (account_id)
  values (v_bank.id)
  on conflict (account_id) do nothing;

  if v_created then
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
      'owner',
      'economy.shneider-bank.open',
      'controlled-active-identity',
      'economy-account',
      v_bank.id
    );
  end if;

  return public.net_economy_shneider_bank_payload(v_identity_link_id, null, null, 20);
end;
$$;

-- Same-institution public directory. The caller must already own an active
-- account at that institution; only display name and public bank identifier are
-- returned, never balance, account UUID, profile UUID, or email.
create or replace function public.net_economy_search_bank_payees(
  requested_institution_id uuid,
  requested_query text,
  requested_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_source_account_id uuid;
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := least(greatest(coalesce(requested_limit, 12), 1), 20);
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  if requested_institution_id not in (
    '00000000-0000-0000-0000-00000000e100'::uuid,
    '00000000-0000-0000-0000-00000000e101'::uuid
  ) then
    raise exception 'ECONOMY_BANK_INSTITUTION_INVALID' using errcode = '22023';
  end if;
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
    and account.institution_id = requested_institution_id
    and account.currency_code = 'VG'
    and account.status = 'active';
  if not found then
    raise exception 'ECONOMY_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
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
      where account.account_kind = 'bank'
        and account.institution_id = requested_institution_id
        and account.currency_code = 'VG'
        and account.status = 'active'
        and identity_link.identity_kind = 'player'
        and identity_link.playability = 'playable'
        and account.id <> v_source_account_id
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

create or replace function public.search_net_economy_vox_bank_payees(
  requested_query text,
  requested_limit integer default 12
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.net_economy_search_bank_payees(
    '00000000-0000-0000-0000-00000000e100'::uuid,
    requested_query,
    requested_limit
  );
$$;

create or replace function public.search_net_economy_shneider_bank_payees(
  requested_query text,
  requested_limit integer default 12
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.net_economy_search_bank_payees(
    '00000000-0000-0000-0000-00000000e101'::uuid,
    requested_query,
    requested_limit
  );
$$;

-- Shared direct-payment core. It resolves the authenticated active identity,
-- restricts the recipient to the same institution, locks both accounts by UUID,
-- rechecks balances after the lock, and records one balanced VG transaction.
create or replace function public.net_economy_transfer_bank_payment(
  requested_institution_id uuid,
  requested_payment_identifier text,
  requested_amount bigint,
  requested_request_key uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_identity_link_id uuid;
  v_identifier text := lower(btrim(coalesce(requested_payment_identifier, '')));
  v_institution public.net_economy_institutions%rowtype;
  v_sender public.net_economy_accounts%rowtype;
  v_recipient public.net_economy_accounts%rowtype;
  v_existing public.net_economy_transactions%rowtype;
  v_transaction public.net_economy_transactions%rowtype;
  v_scope text;
  v_fingerprint text;
  v_vox_state_count integer;
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  if requested_institution_id not in (
    '00000000-0000-0000-0000-00000000e100'::uuid,
    '00000000-0000-0000-0000-00000000e101'::uuid
  ) then
    raise exception 'ECONOMY_BANK_INSTITUTION_INVALID' using errcode = '22023';
  end if;
  if left(v_identifier, 1) = '@' then
    v_identifier := substr(v_identifier, 2);
  end if;
  if v_identifier = '' then
    raise exception 'ECONOMY_BANK_PAYEE_REQUIRED' using errcode = '22023';
  end if;
  if requested_amount is null or requested_amount < 1 or requested_amount > 1000000000 then
    raise exception 'ECONOMY_AMOUNT_INVALID' using errcode = '22023';
  end if;
  if requested_request_key is null then
    raise exception 'ECONOMY_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;

  select * into v_institution
  from public.net_economy_institutions as institution
  where institution.id = requested_institution_id
    and institution.status = 'active';
  if not found then
    raise exception 'ECONOMY_BANK_INSTITUTION_UNAVAILABLE' using errcode = '55000';
  end if;

  select * into v_sender
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = v_institution.id
    and account.currency_code = 'VG';
  if not found then
    raise exception 'ECONOMY_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;

  select account.* into v_recipient
  from public.net_economy_accounts as account
  join public.net_identity_links as identity_link
    on identity_link.id = account.identity_link_id
  where account.account_kind = 'bank'
    and account.institution_id = v_institution.id
    and account.currency_code = 'VG'
    and account.status = 'active'
    and account.payment_identifier = v_identifier
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  for share of identity_link;
  if not found then
    raise exception 'ECONOMY_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;
  if v_recipient.id = v_sender.id then
    raise exception 'ECONOMY_SELF_TRANSFER_INVALID' using errcode = '22023';
  end if;

  v_scope := 'bank-pay:' || v_actor::text;
  v_fingerprint := md5(
    v_identity_link_id::text || ':' || v_institution.id::text || ':'
    || v_sender.id::text || ':' || v_recipient.id::text || ':' || requested_amount::text
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
    return v_existing.id;
  end if;

  perform 1
  from public.net_economy_accounts as account
  where account.id in (v_sender.id, v_recipient.id)
  order by account.id
  for update;

  -- Both VOX state rows are locked after their account rows. Only the sender's
  -- period will be restarted; the recipient state remains unchanged.
  if v_institution.id = '00000000-0000-0000-0000-00000000e100'::uuid then
    perform 1
    from public.net_economy_vox_bank_state as state
    where state.account_id in (v_sender.id, v_recipient.id)
    order by state.account_id
    for update;
    get diagnostics v_vox_state_count = row_count;
    if v_vox_state_count <> 2 then
      raise exception 'VOX_BANK_STATE_UNAVAILABLE' using errcode = '55000';
    end if;
  end if;

  select * into v_sender
  from public.net_economy_accounts as account
  where account.id = v_sender.id;
  select * into v_recipient
  from public.net_economy_accounts as account
  where account.id = v_recipient.id;

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
    return v_existing.id;
  end if;

  if v_sender.status <> 'active' or v_recipient.status <> 'active' then
    raise exception 'ECONOMY_BANK_ACCOUNT_INACTIVE' using errcode = '22023';
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

  -- VOX and SHNEIDER account locks are disjoint, so two concurrent calls may
  -- reach this insert together. The actor-wide scope makes the unique contract
  -- authoritative across institutions; convert the losing insert into the same
  -- stable exact-retry/conflict result as the pre-lock checks.
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
    return v_existing.id;
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

  if v_institution.id = '00000000-0000-0000-0000-00000000e100'::uuid then
    update public.net_economy_vox_bank_state as state
    set
      yield_anchor_at = v_transaction.created_at,
      yield_principal_amount = v_sender.balance_amount - requested_amount
    where state.account_id = v_sender.id;
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
    'owner',
    'economy.bank.transfer',
    'controlled-active-identity',
    'economy-transaction',
    v_transaction.id
  );

  return v_transaction.id;
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
declare
  v_identity_link_id uuid;
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  perform public.net_economy_transfer_bank_payment(
    '00000000-0000-0000-0000-00000000e100'::uuid,
    requested_payment_identifier,
    requested_amount,
    requested_request_key
  );
  return public.net_economy_vox_bank_payload(v_identity_link_id, null, null, 20);
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
declare
  v_identity_link_id uuid;
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  perform public.net_economy_transfer_bank_payment(
    '00000000-0000-0000-0000-00000000e101'::uuid,
    requested_payment_identifier,
    requested_amount,
    requested_request_key
  );
  return public.net_economy_shneider_bank_payload(v_identity_link_id, null, null, 20);
end;
$$;

-- Shared VLT<->bank movement for SHNEIDER. It is intentionally not the public
-- same-bank Pay rail, and it never touches another identity or Karma account.
create or replace function public.net_economy_transfer_own_bank(
  requested_institution_id uuid,
  requested_direction text,
  requested_amount bigint,
  requested_request_key uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_identity_link_id uuid;
  v_direction text := lower(btrim(coalesce(requested_direction, '')));
  v_institution public.net_economy_institutions%rowtype;
  v_wallet public.net_economy_accounts%rowtype;
  v_bank public.net_economy_accounts%rowtype;
  v_existing public.net_economy_transactions%rowtype;
  v_transaction public.net_economy_transactions%rowtype;
  v_scope text;
  v_fingerprint text;
  v_kind text;
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  if requested_institution_id <> '00000000-0000-0000-0000-00000000e101'::uuid then
    raise exception 'ECONOMY_BANK_INSTITUTION_INVALID' using errcode = '22023';
  end if;
  if v_direction not in ('deposit', 'withdraw') then
    raise exception 'ECONOMY_BANK_DIRECTION_INVALID' using errcode = '22023';
  end if;
  if requested_amount is null or requested_amount < 1 or requested_amount > 1000000000 then
    raise exception 'ECONOMY_AMOUNT_INVALID' using errcode = '22023';
  end if;
  if requested_request_key is null then
    raise exception 'ECONOMY_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;

  select * into v_institution
  from public.net_economy_institutions as institution
  where institution.id = requested_institution_id
    and institution.status = 'active';
  if not found then
    raise exception 'ECONOMY_BANK_INSTITUTION_UNAVAILABLE' using errcode = '55000';
  end if;

  select * into v_wallet
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'VG';
  select * into v_bank
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = v_institution.id
    and account.currency_code = 'VG';
  if v_wallet.id is null then
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;
  if v_bank.id is null then
    raise exception 'ECONOMY_BANK_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;

  v_kind := case v_direction when 'deposit' then 'bank-deposit' else 'bank-withdrawal' end;
  v_scope := 'bank-move:' || lower(v_institution.institution_code) || ':' || v_actor::text;
  v_fingerprint := md5(
    v_identity_link_id::text || ':' || v_institution.id::text || ':' || v_direction || ':'
    || requested_amount::text || ':' || v_wallet.id::text || ':' || v_bank.id::text
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
    return v_existing.id;
  end if;

  perform 1
  from public.net_economy_accounts as account
  where account.id in (v_wallet.id, v_bank.id)
  order by account.id
  for update;

  select * into v_wallet from public.net_economy_accounts as account where account.id = v_wallet.id;
  select * into v_bank from public.net_economy_accounts as account where account.id = v_bank.id;

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
    return v_existing.id;
  end if;

  if v_wallet.status <> 'active' or v_bank.status <> 'active' then
    raise exception 'ECONOMY_BANK_ACCOUNT_INACTIVE' using errcode = '22023';
  end if;
  if v_direction = 'deposit' and v_wallet.balance_amount < requested_amount then
    raise exception 'ECONOMY_INSUFFICIENT_FUNDS' using errcode = '22023';
  end if;
  if v_direction = 'withdraw' and v_bank.balance_amount < requested_amount then
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
    null,
    'VG'
  ) returning * into v_transaction;

  insert into public.net_economy_transaction_entries (
    transaction_id,
    account_id,
    amount,
    created_at
  ) values
    (
      v_transaction.id,
      v_wallet.id,
      case when v_direction = 'deposit' then -requested_amount else requested_amount end,
      v_transaction.created_at
    ),
    (
      v_transaction.id,
      v_bank.id,
      case when v_direction = 'deposit' then requested_amount else -requested_amount end,
      v_transaction.created_at
    );

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount
    + case when v_direction = 'deposit' then -requested_amount else requested_amount end
  where account.id = v_wallet.id;
  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount
    + case when v_direction = 'deposit' then requested_amount else -requested_amount end
  where account.id = v_bank.id;

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
    'owner',
    case v_direction
      when 'deposit' then 'economy.shneider-bank.deposit'
      else 'economy.shneider-bank.withdraw'
    end,
    'controlled-active-identity',
    'economy-transaction',
    v_transaction.id
  );

  return v_transaction.id;
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
declare
  v_identity_link_id uuid;
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  perform public.net_economy_transfer_own_bank(
    '00000000-0000-0000-0000-00000000e101'::uuid,
    requested_direction,
    requested_amount,
    requested_request_key
  );
  return public.net_economy_shneider_bank_payload(v_identity_link_id, null, null, 20);
end;
$$;

-- Extend the existing bounded sheet selector. Merely viewing SHNEIDER never
-- opens an account, moves money, or exposes a payment identifier.
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
      'vlt', null,
      'vox_bank', null,
      'shneider_bank', null
    );
  end if;
  if v_identity_count > 1 then
    raise exception 'ECONOMY_SHEET_IDENTITY_AMBIGUOUS' using errcode = '23514';
  end if;

  select identity_link.id into v_identity_link_id
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = requested_subject_kind
    and identity_link.subject_id = requested_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  select * into v_vlt
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'VG';
  select * into v_vox
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e100'::uuid
    and account.currency_code = 'VG';
  select * into v_shneider
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e101'::uuid
    and account.currency_code = 'VG';

  return jsonb_build_object(
    'server_now', timezone('utc', clock_timestamp()),
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

alter table public.net_economy_institution_benefits enable row level security;
revoke all on table public.net_economy_institution_benefits
  from public, anon, authenticated;

revoke all on function public.net_economy_institution_checkout_price(uuid, text, bigint)
  from public, anon, authenticated;
revoke all on function public.net_economy_enforce_independent_bank_currency()
  from public, anon, authenticated;
revoke all on function public.net_economy_identity_history_page(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_bank_history_page(uuid, uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_vox_bank_history_page(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_vox_bank_payload(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_shneider_bank_payload(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_search_bank_payees(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_transfer_bank_payment(uuid, text, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_transfer_own_bank(uuid, text, bigint, uuid)
  from public, anon, authenticated;

revoke all on function public.set_net_identity_app_install(uuid, text, boolean)
  from public, anon;
grant execute on function public.set_net_identity_app_install(uuid, text, boolean)
  to authenticated;

revoke all on function public.fetch_net_economy_shneider_bank(timestamptz, uuid, integer)
  from public, anon;
revoke all on function public.open_net_economy_shneider_bank()
  from public, anon;
revoke all on function public.transfer_net_economy_shneider_bank(text, bigint, uuid)
  from public, anon;
revoke all on function public.search_net_economy_shneider_bank_payees(text, integer)
  from public, anon;
revoke all on function public.transfer_net_economy_shneider_bank_payment(text, bigint, uuid)
  from public, anon;
revoke all on function public.search_net_economy_vox_bank_payees(text, integer)
  from public, anon;
revoke all on function public.transfer_net_economy_vox_bank_payment(text, bigint, uuid)
  from public, anon;
revoke all on function public.transfer_net_economy_vox_bank(text, bigint, uuid)
  from public, anon;
revoke all on function public.claim_net_economy_vox_bank_yield(uuid)
  from public, anon;

grant execute on function public.fetch_net_economy_shneider_bank(timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.open_net_economy_shneider_bank()
  to authenticated;
grant execute on function public.transfer_net_economy_shneider_bank(text, bigint, uuid)
  to authenticated;
grant execute on function public.search_net_economy_shneider_bank_payees(text, integer)
  to authenticated;
grant execute on function public.transfer_net_economy_shneider_bank_payment(text, bigint, uuid)
  to authenticated;
grant execute on function public.search_net_economy_vox_bank_payees(text, integer)
  to authenticated;
grant execute on function public.transfer_net_economy_vox_bank_payment(text, bigint, uuid)
  to authenticated;
grant execute on function public.transfer_net_economy_vox_bank(text, bigint, uuid)
  to authenticated;
grant execute on function public.claim_net_economy_vox_bank_yield(uuid)
  to authenticated;

-- The sheet RPC already has an authenticated grant; replacing its body keeps
-- the existing signature and privilege contract.
revoke all on function public.fetch_net_economy_sheet_account_sources(text, uuid)
  from public, anon;
grant execute on function public.fetch_net_economy_sheet_account_sources(text, uuid)
  to authenticated;

comment on table public.net_economy_institution_benefits is
  'Private authoritative merchant-category benefit configuration. No client can invoke discounts or mutate balances through this table.';
comment on function public.net_economy_transfer_bank_payment(uuid, text, bigint, uuid) is
  'Internal same-institution bank payment core with deterministic locks, playable-recipient enforcement, post-lock funds checks, and actor-wide cross-bank idempotency.';
comment on function public.net_economy_institution_checkout_price(uuid, text, bigint) is
  'Internal pure pricing contract for a future authoritative merchant checkout; it cannot create money or ledger entries.';

-- Realtime remains exactly the deployed private per-account revision stream.
-- No institution, benefit, transaction, entry, or bank state table is published.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_economy_institution_benefits'
  ) then
    alter publication supabase_realtime
      drop table public.net_economy_institution_benefits;
  end if;
exception
  when undefined_object then null;
end;
$$;

commit;
