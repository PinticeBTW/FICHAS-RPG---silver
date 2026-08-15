-- VOX BANK V1: additive vG savings on the deployed shared economy ledger.
-- Run once after net-economy-wallet.sql and net-economy-karma.sql.
-- No wallet, Karma account, existing transaction, or sheet mirror is rewritten.

begin;

create extension if not exists pgcrypto;

-- VOX BANK is an optional VEIL OS application, but it has no fictional social
-- account. Installing the app and opening a financial account remain separate.
insert into public.net_app_account_policies (app_id, account_mode, account_available)
values ('vox-bank', 'none', false)
on conflict (app_id) do update
set
  account_mode = excluded.account_mode,
  account_available = excluded.account_available,
  updated_at = timezone('utc', now());

alter table public.net_identity_app_installs
  drop constraint if exists net_identity_app_installs_app_id_check;
alter table public.net_identity_app_installs
  add constraint net_identity_app_installs_app_id_check
  check (app_id in ('echo', 'pulse', 'nvn', 'vox-bank')) not valid;
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
    or requested_app_id not in ('echo', 'pulse', 'nvn', 'vox-bank')
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

-- The shared account model already carries institution_id but had no canonical
-- institution relation. This compact registry is reusable by later bank apps.
create table if not exists public.net_economy_institutions (
  id uuid primary key,
  institution_code text not null unique,
  display_name text not null,
  owner_name text not null,
  status text not null default 'active',
  yield_rate_basis_points integer not null,
  yield_period interval not null,
  maximum_yield_amount bigint not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_economy_institutions_code_valid check (
    institution_code = upper(btrim(institution_code))
    and char_length(institution_code) between 2 and 24
    and institution_code ~ '^[A-Z0-9-]+$'
  ),
  constraint net_economy_institutions_copy_valid check (
    display_name = btrim(display_name)
    and owner_name = btrim(owner_name)
    and char_length(display_name) between 2 and 80
    and char_length(owner_name) between 2 and 80
  ),
  constraint net_economy_institutions_status_valid
    check (status in ('active', 'disabled')),
  constraint net_economy_institutions_yield_valid check (
    yield_rate_basis_points between 0 and 10000
    and yield_period between interval '1 day' and interval '365 days'
    and maximum_yield_amount between 1 and 1000000000
  )
);

drop trigger if exists net_economy_institutions_set_updated_at
  on public.net_economy_institutions;
create trigger net_economy_institutions_set_updated_at
before update on public.net_economy_institutions
for each row execute procedure public.set_updated_at();

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
  '00000000-0000-0000-0000-00000000e100'::uuid,
  'VOX',
  'VOX BANK',
  'VOX NET',
  'active',
  100,
  interval '7 days',
  1000000000
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.net_economy_institutions as institution
    where institution.id = '00000000-0000-0000-0000-00000000e100'::uuid
      and institution.institution_code = 'VOX'
  ) then
    raise exception 'VOX_BANK_INSTITUTION_CONFIG_CONFLICT' using errcode = '23514';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'net_economy_accounts_institution_fk'
      and conrelid = 'public.net_economy_accounts'::regclass
  ) then
    alter table public.net_economy_accounts
      add constraint net_economy_accounts_institution_fk
      foreign key (institution_id)
      references public.net_economy_institutions (id)
      on delete restrict
      not valid;
  end if;
end;
$$;
alter table public.net_economy_accounts
  validate constraint net_economy_accounts_institution_fk;

-- Institution identity is authoritative data, so enforce the VOX product's
-- vG-only rule even against a future privileged/internal account write.
create or replace function public.net_economy_enforce_vox_bank_currency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.institution_id = '00000000-0000-0000-0000-00000000e100'::uuid
    and (new.account_kind <> 'bank' or new.currency_code <> 'VG')
  then
    raise exception 'VOX_BANK_CURRENCY_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists net_economy_accounts_enforce_vox_bank_currency
  on public.net_economy_accounts;
create trigger net_economy_accounts_enforce_vox_bank_currency
before insert or update
on public.net_economy_accounts
for each row execute procedure public.net_economy_enforce_vox_bank_currency();

create unique index if not exists net_economy_accounts_bank_identity_institution_currency_unique
  on public.net_economy_accounts (identity_link_id, institution_id, currency_code)
  where account_kind = 'bank';

-- Existing transaction rows remain untouched. The new kinds still use the
-- deployed deferred double-entry + single-currency validation.
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
      'bank-yield'
    )
  ) not valid;
alter table public.net_economy_transactions
  validate constraint net_economy_transactions_kind_valid;

create table if not exists public.net_economy_vox_bank_state (
  account_id uuid primary key
    references public.net_economy_accounts (id) on delete restrict,
  yield_anchor_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.net_economy_institutions is
  'Private authoritative institution registry. VOX BANK V1 stores its single configurable yield rate and period here.';
comment on table public.net_economy_vox_bank_state is
  'Private VOX BANK yield eligibility anchor. It contains no player-visible transaction history.';

drop trigger if exists net_economy_vox_bank_state_set_updated_at
  on public.net_economy_vox_bank_state;
create trigger net_economy_vox_bank_state_set_updated_at
before update on public.net_economy_vox_bank_state
for each row execute procedure public.set_updated_at();

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
  with settings as (
    select least(greatest(coalesce(requested_limit, 20), 1), 40) as page_limit
  ), page as (
    select
      entry.transaction_id,
      entry.amount,
      transaction_record.transaction_kind,
      entry.created_at
    from public.net_economy_transaction_entries as entry
    join public.net_economy_transactions as transaction_record
      on transaction_record.id = entry.transaction_id
    cross join settings
    where entry.account_id = requested_account_id
      and transaction_record.currency_code = 'VG'
      and transaction_record.transaction_kind in (
        'bank-deposit', 'bank-withdrawal', 'bank-yield'
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
          'created_at', trimmed.created_at
        ) order by trimmed.created_at desc, trimmed.transaction_id desc
      )
      from trimmed
    ), '[]'::jsonb),
    'has_more', (select count(*) from page) > (select page_limit from settings),
    'next_cursor_at', (
      select trimmed.created_at
      from trimmed
      order by trimmed.created_at asc, trimmed.transaction_id asc
      limit 1
    ),
    'next_cursor_id', (
      select trimmed.transaction_id
      from trimmed
      order by trimmed.created_at asc, trimmed.transaction_id asc
      limit 1
    )
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
  select *
  into v_institution
  from public.net_economy_institutions as institution
  where institution.id = '00000000-0000-0000-0000-00000000e100'::uuid
    and institution.institution_code = 'VOX';
  if not found then
    raise exception 'VOX_BANK_INSTITUTION_UNAVAILABLE' using errcode = '55000';
  end if;

  select *
  into v_wallet
  from public.net_economy_accounts as account
  where account.identity_link_id = requested_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'VG';
  if not found then
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;

  select account.*
  into v_bank
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

  select *
  into v_state
  from public.net_economy_vox_bank_state as state
  where state.account_id = v_bank.id;
  if not found then
    raise exception 'VOX_BANK_STATE_UNAVAILABLE' using errcode = '55000';
  end if;

  v_eligible_at := v_state.yield_anchor_at + v_institution.yield_period;
  v_projected_yield := least(
    floor(
      (v_bank.balance_amount::numeric * v_institution.yield_rate_basis_points::numeric)
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
declare
  v_identity_link_id uuid;
begin
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'ECONOMY_CURSOR_INVALID' using errcode = '22023';
  end if;
  v_identity_link_id := public.assert_net_economy_player_identity();
  return public.net_economy_vox_bank_payload(
    v_identity_link_id,
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
declare
  v_actor uuid := auth.uid();
  v_identity_link_id uuid;
  v_institution public.net_economy_institutions%rowtype;
  v_bank public.net_economy_accounts%rowtype;
  v_created boolean := false;
  v_identifier text;
  v_now timestamptz := timezone('utc', clock_timestamp());
begin
  v_identity_link_id := public.assert_net_economy_player_identity();

  select *
  into v_institution
  from public.net_economy_institutions as institution
  where institution.id = '00000000-0000-0000-0000-00000000e100'::uuid
    and institution.institution_code = 'VOX'
    and institution.status = 'active';
  if not found then
    raise exception 'VOX_BANK_INSTITUTION_UNAVAILABLE' using errcode = '55000';
  end if;

  select *
  into v_bank
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = v_institution.id
    and account.currency_code = 'VG';

  if not found then
    v_identifier := 'vox-' || replace(v_identity_link_id::text, '-', '');
    insert into public.net_economy_accounts (
      identity_link_id,
      account_kind,
      institution_id,
      payment_identifier,
      currency_code,
      status,
      balance_amount
    )
    values (
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
      select *
      into v_bank
      from public.net_economy_accounts as account
      where account.identity_link_id = v_identity_link_id
        and account.account_kind = 'bank'
        and account.institution_id = v_institution.id
        and account.currency_code = 'VG';
      if not found then
        raise exception 'VOX_BANK_ACCOUNT_UNAVAILABLE' using errcode = '55000';
      end if;
    else
      v_created := true;
    end if;
  end if;

  if v_bank.status <> 'active' then
    raise exception 'VOX_BANK_ACCOUNT_INACTIVE' using errcode = '22023';
  end if;

  insert into public.net_economy_vox_bank_state (account_id, yield_anchor_at)
  values (v_bank.id, v_now)
  on conflict (account_id) do nothing;

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
      'economy.vox-bank.open',
      'controlled-active-identity',
      'economy-account',
      v_bank.id
    );
  end if;

  return public.net_economy_vox_bank_payload(v_identity_link_id, null, null, 20);
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

  select *
  into v_wallet
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'VG';
  select *
  into v_bank
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

  select *
  into v_existing
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

  select *
  into v_state
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

  select *
  into v_existing
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

  -- Every principal movement restarts the one-period eligibility window.
  update public.net_economy_vox_bank_state as state
  set yield_anchor_at = v_transaction.created_at
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

  select *
  into v_bank
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

  select *
  into v_existing
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

  select *
  into v_state
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

  select *
  into v_existing
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
      (v_bank.balance_amount::numeric * v_institution.yield_rate_basis_points::numeric)
      / 10000
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
    (
      v_transaction.id,
      v_system.id,
      -v_yield_amount,
      v_transaction.created_at
    ),
    (
      v_transaction.id,
      v_bank.id,
      v_yield_amount,
      v_transaction.created_at
    );

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount - v_yield_amount
  where account.id = v_system.id;
  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount + v_yield_amount
  where account.id = v_bank.id;
  update public.net_economy_vox_bank_state as state
  set yield_anchor_at = v_transaction.created_at
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

alter table public.net_economy_institutions enable row level security;
alter table public.net_economy_vox_bank_state enable row level security;

revoke all on table public.net_economy_institutions from public, anon, authenticated;
revoke all on table public.net_economy_vox_bank_state from public, anon, authenticated;

revoke all on function public.set_net_identity_app_install(uuid, text, boolean)
  from public, anon;
grant execute on function public.set_net_identity_app_install(uuid, text, boolean)
  to authenticated;

revoke all on function public.net_economy_vox_bank_history_page(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_vox_bank_payload(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_enforce_vox_bank_currency()
  from public, anon, authenticated;

revoke all on function public.fetch_net_economy_vox_bank(timestamptz, uuid, integer)
  from public, anon;
revoke all on function public.open_net_economy_vox_bank()
  from public, anon;
revoke all on function public.transfer_net_economy_vox_bank(text, bigint, uuid)
  from public, anon;
revoke all on function public.claim_net_economy_vox_bank_yield(uuid)
  from public, anon;

grant execute on function public.fetch_net_economy_vox_bank(timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.open_net_economy_vox_bank()
  to authenticated;
grant execute on function public.transfer_net_economy_vox_bank(text, bigint, uuid)
  to authenticated;
grant execute on function public.claim_net_economy_vox_bank_yield(uuid)
  to authenticated;

-- Realtime remains the deployed private per-account revision stream. Neither
-- institution configuration nor yield state is published.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_economy_institutions'
  ) then
    alter publication supabase_realtime drop table public.net_economy_institutions;
  end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_economy_vox_bank_state'
  ) then
    alter publication supabase_realtime drop table public.net_economy_vox_bank_state;
  end if;
exception
  when undefined_object then null;
end;
$$;

commit;
