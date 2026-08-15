-- New Vega Network VLT multi-currency expansion: VG + KARMA.
-- Run once after the deployed net-economy-wallet.sql migration.
--
-- This migration is deliberately fail-closed. Legacy KARMA is stored in
-- profile/NPC sheet field_data and, for the older campaign-character model, in
-- character_stats.karma. Blank values and the legacy "-" sentinel mean the
-- identity is not enrolled; matching signed whole integers (including zero)
-- mean it is enrolled. Textual, semantically conflicting, decimal, malformed,
-- or oversized values abort the entire transaction before schema/data changes.

begin;

-- Validate every playable identity's legacy Karma before changing anything.
do $$
declare
  v_invalid_link_id uuid;
  v_invalid_values text;
begin
  with legacy_values as (
    select identity_link.id as identity_link_id, candidate.value
    from public.net_identity_links as identity_link
    join public.character_sheet_forms as sheet
      on identity_link.subject_kind = 'profile-sheet'
      and sheet.profile_id = identity_link.subject_id
    cross join lateral unnest(array[
      sheet.field_data ->> 'KARMA',
      sheet.field_data ->> 'Karma',
      sheet.field_data ->> 'karma',
      sheet.field_data ->> 'K4rma',
      sheet.field_data ->> 'K4RMA'
    ]) as candidate(value)
    where identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'

    union all

    select identity_link.id, candidate.value
    from public.net_identity_links as identity_link
    join public.npc_cards as card
      on identity_link.subject_kind = 'npc-card'
      and card.id = identity_link.subject_id
    cross join lateral unnest(array[
      card.field_data ->> 'KARMA',
      card.field_data ->> 'Karma',
      card.field_data ->> 'karma',
      card.field_data ->> 'K4rma',
      card.field_data ->> 'K4RMA'
    ]) as candidate(value)
    where identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'

    union all

    select identity_link.id, character_stat.karma::text
    from public.net_identity_links as identity_link
    join public.character_stats as character_stat
      on identity_link.subject_kind = 'character'
      and character_stat.character_id = identity_link.subject_id
    where identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
  ), parsed_values as (
    select
      legacy.identity_link_id,
      nullif(btrim(coalesce(legacy.value, '')), '') as raw_value,
      case
        when nullif(btrim(coalesce(legacy.value, '')), '') is null then null
        when btrim(legacy.value) ~ '^[+-]?[0-9]+$'
          and char_length(btrim(legacy.value)) <= 40
        then case
          when abs(btrim(legacy.value)::numeric) <= 1000000000
          then btrim(legacy.value)::bigint
          else null
        end
        else null
      end as parsed_value
    from legacy_values as legacy
  ), summarized as (
    select
      parsed.identity_link_id,
      count(distinct parsed.parsed_value) filter (
        where parsed.parsed_value is not null
      ) as distinct_value_count,
      string_agg(distinct parsed.raw_value, ', ' order by parsed.raw_value) filter (
        where parsed.raw_value is not null
      ) as values_seen,
      coalesce(bool_or(parsed.raw_value = '-'), false) as has_no_karma,
      coalesce(bool_or(parsed.parsed_value is not null), false) as has_numeric_karma,
      bool_or(
        parsed.raw_value is not null
        and parsed.raw_value <> '-'
        and parsed.parsed_value is null
      ) as has_invalid_value
    from parsed_values as parsed
    group by parsed.identity_link_id
  )
  select summarized.identity_link_id, summarized.values_seen
  into v_invalid_link_id, v_invalid_values
  from summarized
  where summarized.distinct_value_count > 1
    or summarized.has_invalid_value
    or (summarized.has_no_karma and summarized.has_numeric_karma)
  order by summarized.identity_link_id
  limit 1;

  if found then
    raise exception 'ECONOMY_LEGACY_KARMA_REVIEW_REQUIRED: identity %, values %',
      v_invalid_link_id,
      coalesce(v_invalid_values, '<blank>')
      using errcode = '22023';
  end if;
end;
$$;

-- Generalize accounts to one civic wallet per identity and currency. Existing
-- VG rows and public payment identifiers are preserved byte-for-byte. KARMA
-- wallets intentionally have no second public identifier.
drop index if exists public.net_economy_accounts_wallet_identity_unique;

alter table public.net_economy_accounts
  drop constraint if exists net_economy_accounts_currency_valid;
alter table public.net_economy_accounts
  add constraint net_economy_accounts_currency_valid
  check (currency_code in ('VG', 'KARMA')) not valid;
alter table public.net_economy_accounts
  validate constraint net_economy_accounts_currency_valid;

alter table public.net_economy_accounts
  drop constraint if exists net_economy_accounts_owner_shape;
alter table public.net_economy_accounts
  add constraint net_economy_accounts_owner_shape check (
    (account_kind = 'wallet'
      and identity_link_id is not null
      and institution_id is null
      and (
        (currency_code = 'VG' and payment_identifier is not null)
        or (currency_code <> 'VG' and payment_identifier is null)
      ))
    or (account_kind = 'bank'
      and identity_link_id is not null
      and institution_id is not null
      and payment_identifier is not null)
    or (account_kind = 'system'
      and identity_link_id is null
      and institution_id is null
      and payment_identifier is null)
  ) not valid;
alter table public.net_economy_accounts
  validate constraint net_economy_accounts_owner_shape;

-- Existing VG/bank balances retain the deployed non-negative invariant.
-- Only a KARMA civic wallet may carry a signed legacy value, bounded to the
-- same one-billion-unit magnitude accepted by opening/mutation requests.
alter table public.net_economy_accounts
  drop constraint if exists net_economy_accounts_balance_valid;
alter table public.net_economy_accounts
  add constraint net_economy_accounts_balance_valid check (
    abs(balance_amount::numeric) <= 9000000000000000
    and (
      account_kind = 'system'
      or (
        account_kind = 'wallet'
        and currency_code = 'KARMA'
        and abs(balance_amount::numeric) <= 1000000000
      )
      or (
        not (account_kind = 'wallet' and currency_code = 'KARMA')
        and balance_amount >= 0
      )
    )
  ) not valid;
alter table public.net_economy_accounts
  validate constraint net_economy_accounts_balance_valid;

create unique index if not exists net_economy_accounts_wallet_identity_currency_unique
  on public.net_economy_accounts (identity_link_id, currency_code)
  where account_kind = 'wallet';

-- Stamp the currency on every transaction without rewriting any amount,
-- timestamp, request key, fingerprint, or existing VG entry.
alter table public.net_economy_transactions
  add column if not exists currency_code text;
update public.net_economy_transactions
set currency_code = 'VG'
where currency_code is null;
alter table public.net_economy_transactions
  alter column currency_code set default 'VG';
alter table public.net_economy_transactions
  alter column currency_code set not null;
alter table public.net_economy_transactions
  drop constraint if exists net_economy_transactions_currency_valid;
alter table public.net_economy_transactions
  add constraint net_economy_transactions_currency_valid
  check (currency_code in ('VG', 'KARMA')) not valid;
alter table public.net_economy_transactions
  validate constraint net_economy_transactions_currency_valid;

comment on column public.net_economy_transactions.currency_code is
  'Authoritative currency for the entire double-entry transaction. Every participating account must match it.';
comment on column public.net_economy_accounts.balance_amount is
  'Cached whole-unit balance maintained atomically with ledger entries. VG and bank balances remain non-negative; KARMA civic wallets may preserve bounded signed legacy values.';

-- The existing deferred ledger trigger now proves amount balance AND currency
-- homogeneity. It remains DEFERRABLE INITIALLY DEFERRED.
create or replace function public.net_economy_assert_balanced_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transaction_id uuid := coalesce(new.transaction_id, old.transaction_id);
  v_transaction_currency text;
  v_entry_count integer;
  v_total numeric;
  v_currency_mismatch_count integer;
begin
  select transaction_record.currency_code
  into v_transaction_currency
  from public.net_economy_transactions as transaction_record
  where transaction_record.id = v_transaction_id;

  if not found then
    return null;
  end if;

  select
    count(*),
    coalesce(sum(entry.amount), 0),
    count(*) filter (where account.currency_code <> v_transaction_currency)
  into v_entry_count, v_total, v_currency_mismatch_count
  from public.net_economy_transaction_entries as entry
  join public.net_economy_accounts as account
    on account.id = entry.account_id
  where entry.transaction_id = v_transaction_id;

  if v_entry_count < 2 or v_total <> 0 then
    raise exception 'ECONOMY_LEDGER_UNBALANCED' using errcode = '23514';
  end if;
  if v_currency_mismatch_count <> 0 then
    raise exception 'ECONOMY_LEDGER_CURRENCY_MISMATCH' using errcode = '23514';
  end if;

  return null;
end;
$$;

-- Prove all deployed VG history satisfies the strengthened invariant before
-- creating any Karma data.
do $$
declare
  v_invalid_transaction_id uuid;
begin
  select transaction_record.id
  into v_invalid_transaction_id
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
  limit 1;

  if found then
    raise exception 'ECONOMY_LEDGER_CURRENCY_MISMATCH: transaction %',
      v_invalid_transaction_id
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.net_economy_ensure_wallet_currency_for_link(
  requested_identity_link_id uuid,
  requested_currency_code text
)
returns public.net_economy_accounts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_currency text := upper(btrim(coalesce(requested_currency_code, '')));
  v_link public.net_identity_links%rowtype;
  v_existing public.net_economy_accounts%rowtype;
  v_saved public.net_economy_accounts%rowtype;
  v_seed text;
  v_suffix text := left(replace(requested_identity_link_id::text, '-', ''), 8);
  v_identifier text;
  v_attempt integer := 0;
begin
  if v_currency not in ('VG', 'KARMA') then
    raise exception 'ECONOMY_CURRENCY_INVALID' using errcode = '22023';
  end if;

  select *
  into v_existing
  from public.net_economy_accounts as account
  where account.identity_link_id = requested_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = v_currency;

  if found then
    return v_existing;
  end if;

  select *
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id;

  if not found
    or v_link.identity_kind <> 'player'
    or v_link.playability <> 'playable'
  then
    raise exception 'ECONOMY_WALLET_IDENTITY_INVALID' using errcode = '22023';
  end if;

  if v_currency = 'VG' then
    v_seed := coalesce(
      public.normalize_net_app_handle(public.net_identity_account_handle_seed(v_link.id)),
      'citizen'
    );
  end if;

  loop
    if v_currency = 'VG' then
      v_identifier := 'vlt-'
        || left(v_seed, greatest(1, 27 - char_length(v_suffix) - case when v_attempt > 0 then 4 else 1 end))
        || '-'
        || v_suffix
        || case when v_attempt > 0 then '-' || v_attempt::text else '' end;
    else
      v_identifier := null;
    end if;

    begin
      insert into public.net_economy_accounts (
        identity_link_id,
        account_kind,
        payment_identifier,
        currency_code,
        status,
        balance_amount
      )
      values (
        v_link.id,
        'wallet',
        v_identifier,
        v_currency,
        'active',
        0
      )
      returning * into v_saved;

      insert into public.net_economy_wallet_realtime_state (account_id)
      values (v_saved.id)
      on conflict (account_id) do nothing;

      return v_saved;
    exception
      when unique_violation then
        select *
        into v_existing
        from public.net_economy_accounts as account
        where account.identity_link_id = requested_identity_link_id
          and account.account_kind = 'wallet'
          and account.currency_code = v_currency;

        if found then
          return v_existing;
        end if;

        if v_currency <> 'VG' then
          raise;
        end if;
        v_attempt := v_attempt + 1;
        if v_attempt > 99 then
          raise exception 'ECONOMY_PAYMENT_IDENTIFIER_UNAVAILABLE' using errcode = '23505';
        end if;
    end;
  end loop;
end;
$$;

-- Deployed VG-only callers keep their original helper contract.
create or replace function public.net_economy_ensure_wallet_for_link(
  requested_identity_link_id uuid
)
returns public.net_economy_accounts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return public.net_economy_ensure_wallet_currency_for_link(
    requested_identity_link_id,
    'VG'
  );
end;
$$;

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
values (
  '00000000-0000-0000-0000-00000000e002'::uuid,
  null,
  'system',
  null,
  null,
  'KARMA',
  'active',
  0
)
on conflict (id) do nothing;

create or replace function public.net_economy_legacy_karma_amount(
  requested_identity_link_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.net_identity_links%rowtype;
  v_field_data jsonb;
  v_key text;
  v_value text;
begin
  select *
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id;

  if not found then
    return null;
  end if;

  case v_link.subject_kind
    when 'profile-sheet' then
      select sheet.field_data
      into v_field_data
      from public.character_sheet_forms as sheet
      where sheet.profile_id = v_link.subject_id;
    when 'npc-card' then
      select card.field_data
      into v_field_data
      from public.npc_cards as card
      where card.id = v_link.subject_id;
    when 'character' then
      select character_stat.karma::text
      into v_value
      from public.character_stats as character_stat
      where character_stat.character_id = v_link.subject_id;
      return nullif(btrim(v_value), '')::bigint;
    else
      return null;
  end case;

  foreach v_key in array array['KARMA', 'Karma', 'karma', 'K4rma', 'K4RMA']
  loop
    v_value := nullif(btrim(coalesce(v_field_data ->> v_key, '')), '');
    if v_value is null or v_value = '-' then
      continue;
    end if;
    return v_value::bigint;
  end loop;

  -- NULL is deliberately distinct from numeric zero: NULL means NO KARMA.
  return null;
end;
$$;

-- The legacy campaign-character model has a physically non-null numeric Karma
-- stat, so a playable character identity is necessarily Karma-enrolled. This
-- helper is idempotent and covers both lifecycle orders: stats-before-link and
-- link-before-stats. Profile-sheet and npc-card identities never call it.
create or replace function public.net_economy_ensure_character_karma_wallet(
  requested_identity_link_id uuid
)
returns public.net_economy_accounts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.net_identity_links%rowtype;
  v_account public.net_economy_accounts%rowtype;
  v_amount bigint;
  v_transaction_id uuid;
  v_transaction_at timestamptz;
begin
  select *
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id
    and identity_link.subject_kind = 'character'
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if not found then
    return null;
  end if;

  select character_stat.karma::bigint
  into v_amount
  from public.character_stats as character_stat
  where character_stat.character_id = v_link.subject_id;

  if not found then
    return null;
  end if;
  if abs(v_amount::numeric) > 1000000000 then
    raise exception 'ECONOMY_KARMA_RANGE_INVALID' using errcode = '22003';
  end if;

  select *
  into v_account
  from public.net_economy_accounts as account
  where account.identity_link_id = v_link.id
    and account.account_kind = 'wallet'
    and account.currency_code = 'KARMA';

  if found then
    return v_account;
  end if;

  v_account := public.net_economy_ensure_wallet_currency_for_link(v_link.id, 'KARMA');
  if v_amount = 0 then
    return v_account;
  end if;

  perform 1
  from public.net_economy_accounts as account
  where account.id in (
    v_account.id,
    '00000000-0000-0000-0000-00000000e002'::uuid
  )
  order by account.id
  for update;

  if exists (
    select 1
    from public.net_economy_transaction_entries as entry
    where entry.account_id = v_account.id
  ) then
    select * into v_account
    from public.net_economy_accounts as account
    where account.id = v_account.id;
    return v_account;
  end if;

  insert into public.net_economy_transactions (
    transaction_kind,
    initiated_by_profile_id,
    request_scope,
    request_key,
    request_fingerprint,
    note,
    currency_code
  )
  values (
    'opening-balance',
    null,
    'opening-balance-karma',
    v_account.id,
    md5('opening-balance-karma:' || v_account.id::text || ':' || v_amount::text),
    null,
    'KARMA'
  )
  on conflict (request_scope, request_key) do nothing
  returning id, created_at into v_transaction_id, v_transaction_at;

  if v_transaction_id is null then
    select * into v_account
    from public.net_economy_accounts as account
    where account.id = v_account.id;
    return v_account;
  end if;

  insert into public.net_economy_transaction_entries (
    transaction_id,
    account_id,
    amount,
    created_at
  )
  values
    (
      v_transaction_id,
      '00000000-0000-0000-0000-00000000e002'::uuid,
      -v_amount,
      v_transaction_at
    ),
    (v_transaction_id, v_account.id, v_amount, v_transaction_at);

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount - v_amount
  where account.id = '00000000-0000-0000-0000-00000000e002'::uuid;

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount + v_amount
  where account.id = v_account.id
  returning * into v_account;

  return v_account;
end;
$$;

create or replace function public.net_economy_ensure_identity_wallet()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.identity_kind = 'player' and new.playability = 'playable' then
    perform public.net_economy_ensure_wallet_currency_for_link(new.id, 'VG');
    if new.subject_kind = 'character' then
      perform public.net_economy_ensure_character_karma_wallet(new.id);
    end if;
  end if;
  return new;
end;
$$;

do $$
declare
  v_link record;
  v_karma_amount bigint;
begin
  for v_link in
    select identity_link.id
    from public.net_identity_links as identity_link
    where identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
    order by identity_link.id
  loop
    perform public.net_economy_ensure_wallet_currency_for_link(v_link.id, 'VG');
    v_karma_amount := public.net_economy_legacy_karma_amount(v_link.id);
    if v_karma_amount is not null then
      perform public.net_economy_ensure_wallet_currency_for_link(v_link.id, 'KARMA');
    end if;
  end loop;
end;
$$;

-- Install the multi-currency sheet mirror before any Karma balance changes.
-- The deployed VG-only trigger function assumes one wallet row per identity;
-- once Karma rows exist, leaving it active would be an unsafe row-shape query.
create or replace function public.net_economy_karma_display(requested_amount bigint)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when requested_amount > 0 then '+' || requested_amount::text
    else requested_amount::text
  end;
$$;

create or replace function public.net_economy_enforce_cash_mirror()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_row jsonb;
  v_subject_id uuid;
  v_has_identity boolean;
  v_vg_balance bigint;
  v_karma_balance bigint;
begin
  v_new_row := to_jsonb(new);
  v_subject_id := case tg_argv[0]
    when 'profile-sheet' then nullif(v_new_row ->> 'profile_id', '')::uuid
    when 'npc-card' then nullif(v_new_row ->> 'id', '')::uuid
    else null
  end;

  if v_subject_id is null then
    return new;
  end if;

  select
    count(identity_link.id) > 0,
    max(account.balance_amount) filter (where account.currency_code = 'VG'),
    max(account.balance_amount) filter (where account.currency_code = 'KARMA')
  into v_has_identity, v_vg_balance, v_karma_balance
  from public.net_identity_links as identity_link
  left join public.net_economy_accounts as account
    on account.identity_link_id = identity_link.id
    and account.account_kind = 'wallet'
  where identity_link.subject_kind = tg_argv[0]
    and identity_link.subject_id = v_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if v_vg_balance is not null then
    new.field_data := jsonb_set(
      coalesce(new.field_data, '{}'::jsonb),
      '{CASH}',
      to_jsonb(public.net_economy_cash_display(v_vg_balance)),
      true
    );
  end if;
  if v_has_identity then
    new.field_data := jsonb_set(
      coalesce(new.field_data, '{}'::jsonb)
        - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
      '{KARMA}',
      to_jsonb(case
        when v_karma_balance is null then '-'
        else public.net_economy_karma_display(v_karma_balance)
      end),
      true
    );
  end if;
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
  v_display text;
begin
  if new.account_kind <> 'wallet'
    or new.balance_amount is not distinct from old.balance_amount
  then
    return new;
  end if;

  select *
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = new.identity_link_id;
  if not found then
    return new;
  end if;

  if new.currency_code = 'VG' then
    v_display := public.net_economy_cash_display(new.balance_amount);
    if v_link.subject_kind = 'profile-sheet' then
      update public.character_sheet_forms as sheet
      set field_data = jsonb_set(coalesce(sheet.field_data, '{}'::jsonb), '{CASH}', to_jsonb(v_display), true)
      where sheet.profile_id = v_link.subject_id
        and sheet.field_data ->> 'CASH' is distinct from v_display;
    elsif v_link.subject_kind = 'npc-card' then
      update public.npc_cards as card
      set field_data = jsonb_set(coalesce(card.field_data, '{}'::jsonb), '{CASH}', to_jsonb(v_display), true)
      where card.id = v_link.subject_id
        and card.field_data ->> 'CASH' is distinct from v_display;
    end if;
  elsif new.currency_code = 'KARMA' then
    v_display := public.net_economy_karma_display(new.balance_amount);
    if v_link.subject_kind = 'profile-sheet' then
      update public.character_sheet_forms as sheet
      set field_data = jsonb_set(
        coalesce(sheet.field_data, '{}'::jsonb)
          - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
        '{KARMA}', to_jsonb(v_display), true
      )
      where sheet.profile_id = v_link.subject_id
        and sheet.field_data ->> 'KARMA' is distinct from v_display;
    elsif v_link.subject_kind = 'npc-card' then
      update public.npc_cards as card
      set field_data = jsonb_set(
        coalesce(card.field_data, '{}'::jsonb)
          - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
        '{KARMA}', to_jsonb(v_display), true
      )
      where card.id = v_link.subject_id
        and card.field_data ->> 'KARMA' is distinct from v_display;
    elsif v_link.subject_kind = 'character' then
      update public.character_stats as character_stat
      set karma = new.balance_amount::integer
      where character_stat.character_id = v_link.subject_id
        and character_stat.karma is distinct from new.balance_amount::integer;
    end if;
  end if;
  return new;
end;
$$;

-- Preserve every accepted legacy amount through a balanced opening transaction
-- against a distinct Karma clearing account. VG rows are not touched.
do $$
declare
  v_record record;
  v_amount bigint;
  v_transaction_id uuid;
  v_transaction_at timestamptz;
begin
  for v_record in
    select account.id as account_id, account.identity_link_id
    from public.net_economy_accounts as account
    where account.account_kind = 'wallet'
      and account.currency_code = 'KARMA'
      and not exists (
        select 1
        from public.net_economy_transaction_entries as entry
        where entry.account_id = account.id
      )
    order by account.id
  loop
    v_amount := public.net_economy_legacy_karma_amount(v_record.identity_link_id);

    if v_amount is null or v_amount = 0 then
      continue;
    end if;

    insert into public.net_economy_transactions (
      transaction_kind,
      initiated_by_profile_id,
      request_scope,
      request_key,
      request_fingerprint,
      note,
      currency_code
    )
    values (
      'opening-balance',
      null,
      'opening-balance-karma',
      v_record.account_id,
      md5('opening-balance-karma:' || v_record.account_id::text || ':' || v_amount::text),
      null,
      'KARMA'
    )
    on conflict (request_scope, request_key) do nothing
    returning id, created_at into v_transaction_id, v_transaction_at;

    if v_transaction_id is null then
      continue;
    end if;

    insert into public.net_economy_transaction_entries (
      transaction_id,
      account_id,
      amount,
      created_at
    )
    values
      (
        v_transaction_id,
        '00000000-0000-0000-0000-00000000e002'::uuid,
        -v_amount,
        v_transaction_at
      ),
      (v_transaction_id, v_record.account_id, v_amount, v_transaction_at);

    update public.net_economy_accounts as account
    set balance_amount = account.balance_amount - v_amount
    where account.id = '00000000-0000-0000-0000-00000000e002'::uuid;

    update public.net_economy_accounts as account
    set balance_amount = account.balance_amount + v_amount
    where account.id = v_record.account_id;
  end loop;
end;
$$;

-- Flush and validate all opening-entry events before any later DDL. This does
-- not change the constraint trigger's INITIALLY DEFERRED default for future
-- independent transactions.
set constraints net_economy_entries_balance_check immediate;

create or replace function public.net_economy_enforce_character_karma_mirror()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_balance bigint;
begin
  select identity_link.id, account.balance_amount
  into v_identity_link_id, v_balance
  from public.net_identity_links as identity_link
  left join public.net_economy_accounts as account
    on account.identity_link_id = identity_link.id
    and account.account_kind = 'wallet'
    and account.currency_code = 'KARMA'
  where identity_link.subject_kind = 'character'
    and identity_link.subject_id = new.character_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if v_identity_link_id is null then
    return new;
  end if;

  if v_balance is not null then
    new.karma := v_balance::integer;
    return new;
  end if;

  -- A legacy character is necessarily Karma-enrolled, but an owner may still
  -- be allowed to insert character_stats through the older sheet RLS. Only an
  -- authoritative GM may choose a non-zero initial reputation in that path;
  -- an ordinary client starts neutral and the AFTER trigger enrols that zero
  -- transactionally. On UPDATE, preserve the prior stored value so a
  -- missing-account repair can never adopt a spoofed new value.
  if tg_op = 'INSERT'
    and auth.uid() is not null
    and not public.is_current_user_gm()
  then
    new.karma := 0;
  elsif tg_op = 'UPDATE' then
    new.karma := old.karma;
  end if;
  return new;
end;
$$;

drop trigger if exists character_stats_enforce_economy_karma on public.character_stats;
create trigger character_stats_enforce_economy_karma
before insert or update of karma on public.character_stats
for each row execute procedure public.net_economy_enforce_character_karma_mirror();

create or replace function public.net_economy_ensure_character_karma_from_stats()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  select identity_link.id
  into v_identity_link_id
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = 'character'
    and identity_link.subject_id = new.character_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if found then
    perform public.net_economy_ensure_character_karma_wallet(v_identity_link_id);
  end if;
  return new;
end;
$$;

drop trigger if exists character_stats_ensure_economy_karma on public.character_stats;
create trigger character_stats_ensure_economy_karma
after insert or update of karma on public.character_stats
for each row execute procedure public.net_economy_ensure_character_karma_from_stats();

-- Normalize only the now-authoritative Karma presentation. CASH and all VG
-- balances/history remain untouched.
update public.character_sheet_forms as sheet
set field_data = jsonb_set(
  coalesce(sheet.field_data, '{}'::jsonb)
    - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
  '{KARMA}',
  to_jsonb(public.net_economy_karma_display(account.balance_amount)),
  true
)
from public.net_identity_links as identity_link
join public.net_economy_accounts as account
  on account.identity_link_id = identity_link.id
  and account.account_kind = 'wallet'
  and account.currency_code = 'KARMA'
where identity_link.subject_kind = 'profile-sheet'
  and identity_link.subject_id = sheet.profile_id
  and (
    sheet.field_data ->> 'KARMA'
      is distinct from public.net_economy_karma_display(account.balance_amount)
    or sheet.field_data ?| array['Karma', 'karma', 'K4rma', 'K4RMA']
  );

update public.npc_cards as card
set field_data = jsonb_set(
  coalesce(card.field_data, '{}'::jsonb)
    - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
  '{KARMA}',
  to_jsonb(public.net_economy_karma_display(account.balance_amount)),
  true
)
from public.net_identity_links as identity_link
join public.net_economy_accounts as account
  on account.identity_link_id = identity_link.id
  and account.account_kind = 'wallet'
  and account.currency_code = 'KARMA'
where identity_link.subject_kind = 'npc-card'
  and identity_link.subject_id = card.id
  and (
    card.field_data ->> 'KARMA'
      is distinct from public.net_economy_karma_display(account.balance_amount)
    or card.field_data ?| array['Karma', 'karma', 'K4rma', 'K4RMA']
  );

-- A playable sheet identity without a Karma account is explicitly outside the
-- reputation system. Canonicalize the presentation to "-" without enrolling it.
update public.character_sheet_forms as sheet
set field_data = jsonb_set(
  coalesce(sheet.field_data, '{}'::jsonb)
    - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
  '{KARMA}',
  to_jsonb('-'::text),
  true
)
from public.net_identity_links as identity_link
where identity_link.subject_kind = 'profile-sheet'
  and identity_link.subject_id = sheet.profile_id
  and identity_link.identity_kind = 'player'
  and identity_link.playability = 'playable'
  and not exists (
    select 1
    from public.net_economy_accounts as account
    where account.identity_link_id = identity_link.id
      and account.account_kind = 'wallet'
      and account.currency_code = 'KARMA'
  )
  and (
    sheet.field_data ->> 'KARMA' is distinct from '-'
    or sheet.field_data ?| array['Karma', 'karma', 'K4rma', 'K4RMA']
  );

update public.npc_cards as card
set field_data = jsonb_set(
  coalesce(card.field_data, '{}'::jsonb)
    - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
  '{KARMA}',
  to_jsonb('-'::text),
  true
)
from public.net_identity_links as identity_link
where identity_link.subject_kind = 'npc-card'
  and identity_link.subject_id = card.id
  and identity_link.identity_kind = 'player'
  and identity_link.playability = 'playable'
  and not exists (
    select 1
    from public.net_economy_accounts as account
    where account.identity_link_id = identity_link.id
      and account.account_kind = 'wallet'
      and account.currency_code = 'KARMA'
  )
  and (
    card.field_data ->> 'KARMA' is distinct from '-'
    or card.field_data ?| array['Karma', 'karma', 'K4rma', 'K4RMA']
  );

update public.character_stats as character_stat
set karma = account.balance_amount::integer
from public.net_identity_links as identity_link
join public.net_economy_accounts as account
  on account.identity_link_id = identity_link.id
  and account.account_kind = 'wallet'
  and account.currency_code = 'KARMA'
where identity_link.subject_kind = 'character'
  and identity_link.subject_id = character_stat.character_id
  and character_stat.karma is distinct from account.balance_amount::integer;

-- Keep legacy single-account history/RPC consumers safely VG-only while adding
-- a currency label to each compact activity row.
create or replace function public.net_economy_history_page(
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
      transaction_record.currency_code,
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
        public_account.payment_identifier,
        public.net_economy_identity_display_name(other_account.identity_link_id) as display_name
      from public.net_economy_transaction_entries as other_entry
      join public.net_economy_accounts as other_account
        on other_account.id = other_entry.account_id
      left join public.net_economy_accounts as public_account
        on public_account.identity_link_id = other_account.identity_link_id
        and public_account.account_kind = 'wallet'
        and public_account.currency_code = 'VG'
      where other_entry.transaction_id = entry.transaction_id
        and other_entry.account_id <> requested_account_id
        and other_account.account_kind <> 'system'
      limit 1
    ) as counterparty on true
    cross join settings
    where entry.account_id = requested_account_id
      and (
        requested_cursor_at is null
        or (entry.created_at, entry.transaction_id) < (requested_cursor_at, requested_cursor_id)
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
          'currency_code', trimmed.currency_code,
          'direction', case when trimmed.amount > 0 then 'incoming' else 'outgoing' end,
          'transaction_kind', trimmed.transaction_kind,
          'counterparty_display_name', trimmed.counterparty_display_name,
          'counterparty_payment_identifier', trimmed.counterparty_payment_identifier,
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
      counterparty.display_name as counterparty_display_name
    from public.net_economy_transaction_entries as entry
    join owned_accounts on owned_accounts.id = entry.account_id
    join public.net_economy_transactions as transaction_record
      on transaction_record.id = entry.transaction_id
    left join lateral (
      select
        public_account.payment_identifier,
        public.net_economy_identity_display_name(other_account.identity_link_id) as display_name
      from public.net_economy_transaction_entries as other_entry
      join public.net_economy_accounts as other_account
        on other_account.id = other_entry.account_id
      left join public.net_economy_accounts as public_account
        on public_account.identity_link_id = other_account.identity_link_id
        and public_account.account_kind = 'wallet'
        and public_account.currency_code = 'VG'
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

create or replace function public.net_economy_wallet_bundle_payload(
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
  v_vg public.net_economy_accounts%rowtype;
  v_karma public.net_economy_accounts%rowtype;
begin
  v_vg := public.net_economy_ensure_wallet_currency_for_link(requested_identity_link_id, 'VG');
  select *
  into v_karma
  from public.net_economy_accounts as account
  where account.identity_link_id = requested_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'KARMA';

  return jsonb_build_object(
    'identity', jsonb_build_object(
      'payment_identifier', v_vg.payment_identifier,
      'display_name', public.net_economy_identity_display_name(requested_identity_link_id)
    ),
    'balances', jsonb_build_array(
      jsonb_build_object(
        'account_id', v_vg.id,
        'balance_amount', v_vg.balance_amount,
        'currency_code', v_vg.currency_code,
        'status', v_vg.status,
        'updated_at', v_vg.updated_at
      )
    ) || case when v_karma.id is null then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object(
        'account_id', v_karma.id,
        'balance_amount', v_karma.balance_amount,
        'currency_code', v_karma.currency_code,
        'status', v_karma.status,
        'updated_at', v_karma.updated_at
      )
    ) end,
    'activity', public.net_economy_identity_history_page(
      requested_identity_link_id,
      requested_cursor_at,
      requested_cursor_id,
      requested_limit
    )
  );
end;
$$;

create or replace function public.fetch_net_economy_wallet_v2(
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
  return public.net_economy_wallet_bundle_payload(
    v_identity_link_id,
    requested_cursor_at,
    requested_cursor_id,
    requested_limit
  );
end;
$$;

-- The original payee RPC remains signature-compatible and now explicitly uses
-- only the identity's primary VG wallet identifier.
create or replace function public.search_net_economy_payees(
  requested_query text,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 20);
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  if char_length(v_query) < 2 or char_length(v_query) > 60 then
    raise exception 'ECONOMY_PAYEE_QUERY_INVALID' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'payment_identifier', directory.payment_identifier,
        'display_name', directory.display_name,
        'karma_available', directory.karma_available
      ) order by directory.display_name, directory.payment_identifier
    )
    from (
      select
        account.payment_identifier,
        public.net_economy_identity_display_name(account.identity_link_id) as display_name,
        exists (
          select 1
          from public.net_economy_accounts as karma
          where karma.identity_link_id = account.identity_link_id
            and karma.account_kind = 'wallet'
            and karma.currency_code = 'KARMA'
            and karma.status = 'active'
        ) as karma_available
      from public.net_economy_accounts as account
      join public.net_identity_links as identity_link
        on identity_link.id = account.identity_link_id
      where account.identity_link_id <> v_identity_link_id
        and account.account_kind = 'wallet'
        and account.currency_code = 'VG'
        and account.status = 'active'
        and identity_link.identity_kind = 'player'
        and identity_link.playability = 'playable'
        and (
          account.payment_identifier like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
          or lower(public.net_economy_identity_display_name(account.identity_link_id))
            like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
        )
      order by display_name, account.payment_identifier
      limit v_limit
    ) as directory
  ), '[]'::jsonb);
end;
$$;

create or replace function public.net_economy_transfer_currency(
  requested_payment_identifier text,
  requested_currency_code text,
  requested_amount bigint,
  requested_note text,
  requested_request_key uuid,
  requested_legacy_fingerprint boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_identity_link_id uuid;
  v_target_identity_link_id uuid;
  v_currency text := upper(btrim(coalesce(requested_currency_code, '')));
  v_source public.net_economy_accounts%rowtype;
  v_target public.net_economy_accounts%rowtype;
  v_existing public.net_economy_transactions%rowtype;
  v_transaction public.net_economy_transactions%rowtype;
  v_identifier text := lower(btrim(coalesce(requested_payment_identifier, '')));
  v_note text := nullif(btrim(coalesce(requested_note, '')), '');
  v_scope text;
  v_fingerprint text;
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  if v_currency not in ('VG', 'KARMA') then
    raise exception 'ECONOMY_CURRENCY_INVALID' using errcode = '22023';
  end if;
  if requested_request_key is null then
    raise exception 'ECONOMY_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;
  if requested_amount is null or requested_amount < 1 or requested_amount > 1000000000 then
    raise exception 'ECONOMY_AMOUNT_INVALID' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 120 then
    raise exception 'ECONOMY_NOTE_TOO_LONG' using errcode = '22001';
  end if;

  if v_currency = 'VG' then
    v_source := public.net_economy_ensure_wallet_currency_for_link(v_identity_link_id, 'VG');
  else
    select *
    into v_source
    from public.net_economy_accounts as account
    where account.identity_link_id = v_identity_link_id
      and account.account_kind = 'wallet'
      and account.currency_code = 'KARMA';
    if not found then
      raise exception 'ECONOMY_KARMA_NOT_AVAILABLE' using errcode = '22023';
    end if;
  end if;
  v_scope := 'player:' || v_actor::text;
  v_fingerprint := case
    when requested_legacy_fingerprint then md5(
      v_source.id::text || ':' || v_identifier || ':' || requested_amount::text || ':' || coalesce(v_note, '')
    )
    else md5(
      v_source.id::text || ':' || v_currency || ':' || v_identifier || ':' || requested_amount::text || ':' || coalesce(v_note, '')
    )
  end;

  select *
  into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;
  if found then
    if v_existing.transaction_kind <> 'transfer'
      or v_existing.request_fingerprint <> v_fingerprint
      or v_existing.currency_code <> v_currency
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  select primary_wallet.identity_link_id
  into v_target_identity_link_id
  from public.net_economy_accounts as primary_wallet
  where primary_wallet.payment_identifier = v_identifier
    and primary_wallet.account_kind = 'wallet'
    and primary_wallet.currency_code = 'VG'
    and primary_wallet.status = 'active';
  if not found then
    raise exception 'ECONOMY_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;
  if v_target_identity_link_id = v_identity_link_id then
    raise exception 'ECONOMY_SELF_TRANSFER_INVALID' using errcode = '22023';
  end if;

  if v_currency = 'VG' then
    v_target := public.net_economy_ensure_wallet_currency_for_link(v_target_identity_link_id, 'VG');
  else
    select *
    into v_target
    from public.net_economy_accounts as account
    where account.identity_link_id = v_target_identity_link_id
      and account.account_kind = 'wallet'
      and account.currency_code = 'KARMA';
    if not found then
      raise exception 'ECONOMY_KARMA_NOT_AVAILABLE' using errcode = '22023';
    end if;
  end if;

  perform 1
  from public.net_economy_accounts as account
  where account.id in (v_source.id, v_target.id)
  order by account.id
  for update;

  select * into v_source
  from public.net_economy_accounts as account
  where account.id = v_source.id;
  select * into v_target
  from public.net_economy_accounts as account
  where account.id = v_target.id;

  select *
  into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;
  if found then
    if v_existing.transaction_kind <> 'transfer'
      or v_existing.request_fingerprint <> v_fingerprint
      or v_existing.currency_code <> v_currency
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  if v_source.status <> 'active' or v_source.balance_amount < requested_amount then
    raise exception 'ECONOMY_INSUFFICIENT_FUNDS' using errcode = '22023';
  end if;
  if v_target.status <> 'active' then
    raise exception 'ECONOMY_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;
  if v_currency = 'KARMA'
    and v_target.balance_amount + requested_amount > 1000000000
  then
    raise exception 'ECONOMY_KARMA_RANGE_INVALID' using errcode = '22003';
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
    'transfer', v_actor, v_scope, requested_request_key,
    v_fingerprint, v_note, v_currency
  ) returning * into v_transaction;

  insert into public.net_economy_transaction_entries (
    transaction_id, account_id, amount, created_at
  ) values
    (v_transaction.id, v_source.id, -requested_amount, v_transaction.created_at),
    (v_transaction.id, v_target.id, requested_amount, v_transaction.created_at);

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount - requested_amount
  where account.id = v_source.id;
  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount + requested_amount
  where account.id = v_target.id;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    v_actor, null, null, null, 'owner', 'economy.wallet.transfer',
    'controlled-active-identity', 'economy-transaction', v_transaction.id
  );

  return v_transaction.id;
end;
$$;

-- Preserve the deployed VG-only mutation signature and fingerprint contract.
create or replace function public.transfer_net_economy_wallet(
  requested_payment_identifier text,
  requested_amount bigint,
  requested_note text,
  requested_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  perform public.net_economy_transfer_currency(
    requested_payment_identifier, 'VG', requested_amount,
    requested_note, requested_request_key, true
  );
  return public.net_economy_wallet_payload(v_identity_link_id, null, null, 20);
end;
$$;

create or replace function public.transfer_net_economy_wallet_v2(
  requested_payment_identifier text,
  requested_currency_code text,
  requested_amount bigint,
  requested_note text,
  requested_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  perform public.net_economy_transfer_currency(
    requested_payment_identifier, requested_currency_code, requested_amount,
    requested_note, requested_request_key, false
  );
  return public.net_economy_wallet_bundle_payload(v_identity_link_id, null, null, 20);
end;
$$;

-- Legacy GM directory stays one VG row per identity for old clients.
create or replace function public.fetch_net_economy_gm_wallet_directory(
  requested_query text default null,
  requested_limit integer default 50
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := least(greatest(coalesce(requested_limit, 50), 1), 100);
begin
  perform public.assert_net_economy_gm();
  if char_length(v_query) > 60 then
    raise exception 'ECONOMY_DIRECTORY_QUERY_INVALID' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'account_id', directory.id,
        'payment_identifier', directory.payment_identifier,
        'display_name', directory.display_name,
        'account_kind', directory.account_kind,
        'status', directory.status,
        'balance_amount', directory.balance_amount,
        'currency_code', directory.currency_code,
        'updated_at', directory.updated_at
      ) order by directory.display_name, directory.payment_identifier
    )
    from (
      select
        account.id, account.payment_identifier,
        public.net_economy_identity_display_name(account.identity_link_id) as display_name,
        account.account_kind, account.status, account.balance_amount,
        account.currency_code, account.updated_at
      from public.net_economy_accounts as account
      where account.account_kind = 'wallet'
        and account.currency_code = 'VG'
        and (
          v_query = ''
          or account.payment_identifier like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
          or lower(public.net_economy_identity_display_name(account.identity_link_id))
            like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
        )
      order by display_name, account.payment_identifier
      limit v_limit
    ) as directory
  ), '[]'::jsonb);
end;
$$;

create or replace function public.fetch_net_economy_gm_wallet_directory_v2(
  requested_query text default null,
  requested_limit integer default 50
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := least(greatest(coalesce(requested_limit, 50), 1), 100);
begin
  perform public.assert_net_economy_gm();
  if char_length(v_query) > 60 then
    raise exception 'ECONOMY_DIRECTORY_QUERY_INVALID' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'payment_identifier', directory.payment_identifier,
        'display_name', directory.display_name,
        'vg_balance_amount', directory.vg_balance_amount,
        'karma_balance_amount', directory.karma_balance_amount,
        'updated_at', directory.updated_at
      ) order by directory.display_name, directory.payment_identifier
    )
    from (
      select
        vg.payment_identifier,
        public.net_economy_identity_display_name(vg.identity_link_id) as display_name,
        vg.balance_amount as vg_balance_amount,
        karma.balance_amount as karma_balance_amount,
        greatest(vg.updated_at, coalesce(karma.updated_at, vg.updated_at)) as updated_at
      from public.net_economy_accounts as vg
      left join public.net_economy_accounts as karma
        on karma.identity_link_id = vg.identity_link_id
        and karma.account_kind = 'wallet'
        and karma.currency_code = 'KARMA'
      where vg.account_kind = 'wallet'
        and vg.currency_code = 'VG'
        and (
          v_query = ''
          or vg.payment_identifier like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
          or lower(public.net_economy_identity_display_name(vg.identity_link_id))
            like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
        )
      order by display_name, vg.payment_identifier
      limit v_limit
    ) as directory
  ), '[]'::jsonb);
end;
$$;

create or replace function public.fetch_net_economy_gm_wallet_v2(
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
  v_identifier text := lower(btrim(coalesce(requested_payment_identifier, '')));
begin
  perform public.assert_net_economy_gm();
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'ECONOMY_CURSOR_INVALID' using errcode = '22023';
  end if;

  select account.identity_link_id
  into v_identity_link_id
  from public.net_economy_accounts as account
  where account.payment_identifier = v_identifier
    and account.account_kind = 'wallet'
    and account.currency_code = 'VG';
  if not found then
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;

  return public.net_economy_wallet_bundle_payload(
    v_identity_link_id, requested_cursor_at, requested_cursor_id, requested_limit
  );
end;
$$;

create or replace function public.net_economy_adjust_wallet_currency(
  requested_account_id uuid,
  requested_currency_code text,
  requested_action text,
  requested_amount bigint,
  requested_reason text,
  requested_request_key uuid,
  requested_legacy_fingerprint boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_currency text := upper(btrim(coalesce(requested_currency_code, '')));
  v_account public.net_economy_accounts%rowtype;
  v_system public.net_economy_accounts%rowtype;
  v_existing public.net_economy_transactions%rowtype;
  v_transaction public.net_economy_transactions%rowtype;
  v_action text := lower(btrim(coalesce(requested_action, '')));
  v_reason text := btrim(coalesce(requested_reason, ''));
  v_kind text;
  v_scope text;
  v_fingerprint text;
  v_wallet_delta bigint;
  v_system_id uuid;
begin
  v_actor := public.assert_net_economy_gm();
  if v_currency not in ('VG', 'KARMA') then
    raise exception 'ECONOMY_CURRENCY_INVALID' using errcode = '22023';
  end if;
  if requested_request_key is null then
    raise exception 'ECONOMY_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;
  if v_action not in ('credit', 'debit') then
    raise exception 'ECONOMY_ADJUSTMENT_INVALID' using errcode = '22023';
  end if;
  if requested_amount is null or requested_amount < 1 or requested_amount > 1000000000 then
    raise exception 'ECONOMY_AMOUNT_INVALID' using errcode = '22023';
  end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 200 then
    raise exception 'ECONOMY_REASON_INVALID' using errcode = '22023';
  end if;

  v_kind := case v_action when 'credit' then 'gm-credit' else 'gm-debit' end;
  v_wallet_delta := case v_action when 'credit' then requested_amount else -requested_amount end;
  v_scope := 'gm:' || v_actor::text;
  v_system_id := case v_currency
    when 'VG' then '00000000-0000-0000-0000-00000000e001'::uuid
    else '00000000-0000-0000-0000-00000000e002'::uuid
  end;
  v_fingerprint := case
    when requested_legacy_fingerprint then md5(
      requested_account_id::text || ':' || v_action || ':' || requested_amount::text || ':' || v_reason
    )
    else md5(
      requested_account_id::text || ':' || v_currency || ':' || v_action || ':' || requested_amount::text || ':' || v_reason
    )
  end;

  select * into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;
  if found then
    if v_existing.transaction_kind <> v_kind
      or v_existing.request_fingerprint <> v_fingerprint
      or v_existing.currency_code <> v_currency
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  perform 1
  from public.net_economy_accounts as account
  where account.id in (requested_account_id, v_system_id)
  order by account.id
  for update;

  select * into v_account
  from public.net_economy_accounts as account
  where account.id = requested_account_id
    and account.account_kind <> 'system'
    and account.currency_code = v_currency;
  select * into v_system
  from public.net_economy_accounts as account
  where account.id = v_system_id
    and account.account_kind = 'system'
    and account.currency_code = v_currency;

  if v_account.id is null then
    if v_currency = 'KARMA' then
      raise exception 'ECONOMY_KARMA_NOT_AVAILABLE' using errcode = '22023';
    end if;
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;
  if v_system.id is null then
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;
  if v_account.status <> 'active' then
    raise exception 'ECONOMY_WALLET_INACTIVE' using errcode = '22023';
  end if;
  if v_currency = 'VG'
    and v_action = 'debit'
    and v_account.balance_amount < requested_amount
  then
    raise exception 'ECONOMY_INSUFFICIENT_FUNDS' using errcode = '22023';
  end if;
  if v_currency = 'KARMA'
    and abs((v_account.balance_amount + v_wallet_delta)::numeric) > 1000000000
  then
    raise exception 'ECONOMY_KARMA_RANGE_INVALID' using errcode = '22003';
  end if;

  select * into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;
  if found then
    if v_existing.transaction_kind <> v_kind
      or v_existing.request_fingerprint <> v_fingerprint
      or v_existing.currency_code <> v_currency
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  insert into public.net_economy_transactions (
    transaction_kind, initiated_by_profile_id, request_scope, request_key,
    request_fingerprint, note, currency_code
  ) values (
    v_kind, v_actor, v_scope, requested_request_key,
    v_fingerprint, v_reason, v_currency
  ) returning * into v_transaction;

  insert into public.net_economy_transaction_entries (
    transaction_id, account_id, amount, created_at
  ) values
    (v_transaction.id, v_account.id, v_wallet_delta, v_transaction.created_at),
    (v_transaction.id, v_system.id, -v_wallet_delta, v_transaction.created_at);

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount + v_wallet_delta
  where account.id = v_account.id;
  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount - v_wallet_delta
  where account.id = v_system.id;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    v_actor, null, null, null, 'system',
    case v_action when 'credit' then 'economy.wallet.credit' else 'economy.wallet.debit' end,
    'authoritative-gm-economy-control', 'economy-transaction', v_transaction.id
  );

  return v_transaction.id;
end;
$$;

-- Old GM mutation remains VG-only and keeps its existing idempotency hash.
create or replace function public.adjust_net_economy_gm_wallet(
  requested_account_id uuid,
  requested_action text,
  requested_amount bigint,
  requested_reason text,
  requested_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.net_economy_adjust_wallet_currency(
    requested_account_id, 'VG', requested_action, requested_amount,
    requested_reason, requested_request_key, true
  );
  return public.fetch_net_economy_gm_wallet(requested_account_id, null, null, 20);
end;
$$;

create or replace function public.adjust_net_economy_gm_wallet_v2(
  requested_payment_identifier text,
  requested_currency_code text,
  requested_action text,
  requested_amount bigint,
  requested_reason text,
  requested_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identifier text := lower(btrim(coalesce(requested_payment_identifier, '')));
  v_currency text := upper(btrim(coalesce(requested_currency_code, '')));
  v_identity_link_id uuid;
  v_account_id uuid;
begin
  perform public.assert_net_economy_gm();
  if v_currency not in ('VG', 'KARMA') then
    raise exception 'ECONOMY_CURRENCY_INVALID' using errcode = '22023';
  end if;

  select primary_wallet.identity_link_id
  into v_identity_link_id
  from public.net_economy_accounts as primary_wallet
  where primary_wallet.payment_identifier = v_identifier
    and primary_wallet.account_kind = 'wallet'
    and primary_wallet.currency_code = 'VG';
  if not found then
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;

  select account.id
  into v_account_id
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = v_currency;
  if not found then
    if v_currency = 'KARMA' then
      raise exception 'ECONOMY_KARMA_NOT_AVAILABLE' using errcode = '22023';
    end if;
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;

  perform public.net_economy_adjust_wallet_currency(
    v_account_id, v_currency, requested_action, requested_amount,
    requested_reason, requested_request_key, false
  );
  return public.net_economy_wallet_bundle_payload(v_identity_link_id, null, null, 20);
end;
$$;

-- Enrolment is an explicit authoritative social-system action. It creates a
-- zero Karma profile without a synthetic ledger entry and never touches VG.
create or replace function public.enable_net_economy_gm_karma_profile(
  requested_payment_identifier text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_identifier text := lower(btrim(coalesce(requested_payment_identifier, '')));
  v_identity_link_id uuid;
  v_link public.net_identity_links%rowtype;
  v_account public.net_economy_accounts%rowtype;
begin
  v_actor := public.assert_net_economy_gm();

  select primary_wallet.identity_link_id
  into v_identity_link_id
  from public.net_economy_accounts as primary_wallet
  where primary_wallet.payment_identifier = v_identifier
    and primary_wallet.account_kind = 'wallet'
    and primary_wallet.currency_code = 'VG'
  for update;
  if not found then
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;

  select *
  into v_account
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'KARMA';

  if v_account.id is not null then
    return public.net_economy_wallet_bundle_payload(v_identity_link_id, null, null, 20);
  end if;

  v_account := public.net_economy_ensure_wallet_currency_for_link(v_identity_link_id, 'KARMA');

  select *
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = v_identity_link_id;

  if v_link.subject_kind = 'profile-sheet' then
    update public.character_sheet_forms as sheet
    set field_data = jsonb_set(
      coalesce(sheet.field_data, '{}'::jsonb)
        - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
      '{KARMA}', to_jsonb('0'::text), true
    )
    where sheet.profile_id = v_link.subject_id;
  elsif v_link.subject_kind = 'npc-card' then
    update public.npc_cards as card
    set field_data = jsonb_set(
      coalesce(card.field_data, '{}'::jsonb)
        - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
      '{KARMA}', to_jsonb('0'::text), true
    )
    where card.id = v_link.subject_id;
  elsif v_link.subject_kind = 'character' then
    update public.character_stats as character_stat
    set karma = 0
    where character_stat.character_id = v_link.subject_id;
  end if;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    v_actor, null, null, null, 'system', 'economy.karma.enable',
    'authoritative-gm-economy-control', 'economy-account', v_account.id
  );

  return public.net_economy_wallet_bundle_payload(v_identity_link_id, null, null, 20);
end;
$$;

-- Direct financial tables remain closed. Realtime continues through the same
-- per-account revision table/publication and no transaction metadata is sent.
revoke all on table public.net_economy_accounts from public, anon, authenticated;
revoke all on table public.net_economy_transactions from public, anon, authenticated;
revoke all on table public.net_economy_transaction_entries from public, anon, authenticated;

revoke all on function public.net_economy_ensure_wallet_currency_for_link(uuid, text) from public, anon, authenticated;
revoke all on function public.net_economy_ensure_character_karma_wallet(uuid) from public, anon, authenticated;
revoke all on function public.net_economy_ensure_identity_wallet() from public, anon, authenticated;
revoke all on function public.net_economy_legacy_karma_amount(uuid) from public, anon, authenticated;
revoke all on function public.net_economy_karma_display(bigint) from public, anon, authenticated;
revoke all on function public.net_economy_enforce_cash_mirror() from public, anon, authenticated;
revoke all on function public.net_economy_sync_cash_mirror() from public, anon, authenticated;
revoke all on function public.net_economy_enforce_character_karma_mirror() from public, anon, authenticated;
revoke all on function public.net_economy_ensure_character_karma_from_stats() from public, anon, authenticated;
revoke all on function public.net_economy_identity_history_page(uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.net_economy_wallet_bundle_payload(uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.net_economy_transfer_currency(text, text, bigint, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.net_economy_adjust_wallet_currency(uuid, text, text, bigint, text, uuid, boolean) from public, anon, authenticated;

revoke all on function public.fetch_net_economy_wallet_v2(timestamptz, uuid, integer) from public, anon;
revoke all on function public.transfer_net_economy_wallet_v2(text, text, bigint, text, uuid) from public, anon;
revoke all on function public.fetch_net_economy_gm_wallet_directory_v2(text, integer) from public, anon;
revoke all on function public.fetch_net_economy_gm_wallet_v2(text, timestamptz, uuid, integer) from public, anon;
revoke all on function public.adjust_net_economy_gm_wallet_v2(text, text, text, bigint, text, uuid) from public, anon;
revoke all on function public.enable_net_economy_gm_karma_profile(text) from public, anon;

grant execute on function public.fetch_net_economy_wallet_v2(timestamptz, uuid, integer) to authenticated;
grant execute on function public.transfer_net_economy_wallet_v2(text, text, bigint, text, uuid) to authenticated;
grant execute on function public.fetch_net_economy_gm_wallet_directory_v2(text, integer) to authenticated;
grant execute on function public.fetch_net_economy_gm_wallet_v2(text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.adjust_net_economy_gm_wallet_v2(text, text, text, bigint, text, uuid) to authenticated;
grant execute on function public.enable_net_economy_gm_karma_profile(text) to authenticated;

commit;
