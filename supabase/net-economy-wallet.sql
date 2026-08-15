-- New Vega shared economy core and VLT civic wallet.
-- Run after net-identity-selection.sql, net-universal-profiles.sql,
-- net-app-accounts.sql, and net-pulse-content.sql.
--
-- Existing sheet CASH values are migrated only when they are empty or an
-- unambiguous non-negative whole-vG amount. An unexpected production value
-- aborts this entire transaction before any change is committed.

begin;

create extension if not exists pgcrypto;

-- VLT uses the shared economy account, not a fictional per-app social account.
insert into public.net_app_account_policies (app_id, account_mode, account_available)
values ('vlt', 'none', false)
on conflict (app_id) do update
set
  account_mode = excluded.account_mode,
  account_available = excluded.account_available,
  updated_at = timezone('utc', now());

create table if not exists public.net_economy_accounts (
  id uuid primary key default gen_random_uuid(),
  identity_link_id uuid references public.net_identity_links (id) on delete restrict,
  account_kind text not null,
  institution_id uuid,
  payment_identifier text unique,
  currency_code text not null default 'VG',
  status text not null default 'active',
  balance_amount bigint not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_economy_accounts_kind_valid
    check (account_kind in ('wallet', 'bank', 'system')),
  constraint net_economy_accounts_currency_valid
    check (currency_code = 'VG'),
  constraint net_economy_accounts_status_valid
    check (status in ('active', 'closed')),
  constraint net_economy_accounts_balance_valid
    check (
      abs(balance_amount::numeric) <= 9000000000000000
      and (account_kind = 'system' or balance_amount >= 0)
    ),
  constraint net_economy_accounts_owner_shape check (
    (account_kind = 'wallet'
      and identity_link_id is not null
      and institution_id is null
      and payment_identifier is not null)
    or (account_kind = 'bank'
      and identity_link_id is not null
      and institution_id is not null
      and payment_identifier is not null)
    or (account_kind = 'system'
      and identity_link_id is null
      and institution_id is null
      and payment_identifier is null)
  ),
  constraint net_economy_accounts_payment_identifier_valid check (
    payment_identifier is null
    or (
      payment_identifier = lower(btrim(payment_identifier))
      and char_length(payment_identifier) between 3 and 40
      and payment_identifier ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'
    )
  )
);

create unique index if not exists net_economy_accounts_wallet_identity_unique
  on public.net_economy_accounts (identity_link_id)
  where account_kind = 'wallet';

create index if not exists net_economy_accounts_directory_idx
  on public.net_economy_accounts (account_kind, status, payment_identifier)
  where account_kind <> 'system';

create table if not exists public.net_economy_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_kind text not null,
  initiated_by_profile_id uuid references public.profiles (id) on delete restrict,
  request_scope text not null,
  request_key uuid not null,
  request_fingerprint text not null,
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint net_economy_transactions_kind_valid check (
    transaction_kind in ('opening-balance', 'transfer', 'gm-credit', 'gm-debit')
  ),
  constraint net_economy_transactions_request_scope_valid check (
    request_scope = btrim(request_scope)
    and char_length(request_scope) between 1 and 80
  ),
  constraint net_economy_transactions_fingerprint_valid check (
    request_fingerprint ~ '^[a-f0-9]{32}$'
  ),
  constraint net_economy_transactions_note_valid check (
    note is null
    or (note = btrim(note) and char_length(note) between 1 and 200)
  ),
  constraint net_economy_transactions_actor_valid check (
    (transaction_kind = 'opening-balance' and initiated_by_profile_id is null)
    or (transaction_kind <> 'opening-balance' and initiated_by_profile_id is not null)
  ),
  unique (request_scope, request_key)
);

create index if not exists net_economy_transactions_created_idx
  on public.net_economy_transactions (created_at desc, id desc);

create table if not exists public.net_economy_transaction_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.net_economy_transactions (id) on delete restrict,
  account_id uuid not null references public.net_economy_accounts (id) on delete restrict,
  amount bigint not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint net_economy_transaction_entries_amount_valid check (
    amount <> 0 and abs(amount::numeric) <= 1000000000
  ),
  unique (transaction_id, account_id)
);

create index if not exists net_economy_entries_account_history_idx
  on public.net_economy_transaction_entries (account_id, created_at desc, transaction_id desc);

create table if not exists public.net_economy_wallet_realtime_state (
  account_id uuid primary key references public.net_economy_accounts (id) on delete cascade,
  revision bigint not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_economy_wallet_realtime_revision_valid check (revision >= 0)
);

comment on table public.net_economy_accounts is
  'Shared New Vega financial accounts. VLT exposes wallet rows; future banks must reuse this account and ledger core.';
comment on column public.net_economy_accounts.balance_amount is
  'Cached whole-vG balance maintained in the same locked transaction as balanced ledger entries.';
comment on table public.net_economy_transactions is
  'Immutable economy transaction headers with actor-scoped idempotency keys.';
comment on table public.net_economy_transaction_entries is
  'Immutable signed double-entry amounts. Every transaction must balance to zero.';
comment on table public.net_economy_wallet_realtime_state is
  'Private per-wallet invalidation only; transaction metadata is never broadcast.';

drop trigger if exists net_economy_accounts_set_updated_at on public.net_economy_accounts;
create trigger net_economy_accounts_set_updated_at
before update on public.net_economy_accounts
for each row execute procedure public.set_updated_at();

create or replace function public.net_economy_assert_balanced_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transaction_id uuid := coalesce(new.transaction_id, old.transaction_id);
  v_entry_count integer;
  v_total numeric;
begin
  if not exists (
    select 1
    from public.net_economy_transactions as transaction_record
    where transaction_record.id = v_transaction_id
  ) then
    return null;
  end if;

  select count(*), coalesce(sum(entry.amount), 0)
  into v_entry_count, v_total
  from public.net_economy_transaction_entries as entry
  where entry.transaction_id = v_transaction_id;

  if v_entry_count < 2 or v_total <> 0 then
    raise exception 'ECONOMY_LEDGER_UNBALANCED' using errcode = '23514';
  end if;

  return null;
end;
$$;

drop trigger if exists net_economy_entries_balance_check
  on public.net_economy_transaction_entries;
create constraint trigger net_economy_entries_balance_check
after insert or update or delete on public.net_economy_transaction_entries
deferrable initially deferred
for each row execute procedure public.net_economy_assert_balanced_transaction();

create or replace function public.net_economy_identity_display_name(
  requested_identity_link_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.net_identity_links%rowtype;
  v_name text;
begin
  select *
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id;

  if not found then
    return 'New Vega citizen';
  end if;

  select nullif(btrim(universal_profile.display_name_override), '')
  into v_name
  from public.net_universal_profiles as universal_profile
  where universal_profile.identity_link_id = v_link.id;

  if v_name is not null then
    return v_name;
  end if;

  case v_link.subject_kind
    when 'profile-sheet' then
      select coalesce(
        nullif(btrim(sheet.field_data ->> 'NOME'), ''),
        nullif(btrim(profile.display_name), ''),
        nullif(btrim(profile.handle), '')
      )
      into v_name
      from public.profiles as profile
      left join public.character_sheet_forms as sheet
        on sheet.profile_id = profile.id
      where profile.id = v_link.subject_id;

    when 'npc-card' then
      select coalesce(
        nullif(btrim(card.field_data ->> 'NOME'), ''),
        nullif(btrim(card.display_name), '')
      )
      into v_name
      from public.npc_cards as card
      where card.id = v_link.subject_id;

    when 'character' then
      select coalesce(
        nullif(btrim(character.alias), ''),
        nullif(btrim(character.name), '')
      )
      into v_name
      from public.characters as character
      where character.id = v_link.subject_id;
  end case;

  return coalesce(v_name, 'New Vega citizen');
end;
$$;

create or replace function public.net_economy_ensure_wallet_for_link(
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
  v_existing public.net_economy_accounts%rowtype;
  v_saved public.net_economy_accounts%rowtype;
  v_seed text;
  v_suffix text := left(replace(requested_identity_link_id::text, '-', ''), 8);
  v_identifier text;
  v_attempt integer := 0;
begin
  select *
  into v_existing
  from public.net_economy_accounts as account
  where account.identity_link_id = requested_identity_link_id
    and account.account_kind = 'wallet';

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

  v_seed := coalesce(
    public.normalize_net_app_handle(public.net_identity_account_handle_seed(v_link.id)),
    'citizen'
  );

  loop
    v_identifier := 'vlt-'
      || left(v_seed, greatest(1, 27 - char_length(v_suffix) - case when v_attempt > 0 then 4 else 1 end))
      || '-'
      || v_suffix
      || case when v_attempt > 0 then '-' || v_attempt::text else '' end;

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
        'VG',
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
          and account.account_kind = 'wallet';

        if found then
          return v_existing;
        end if;

        v_attempt := v_attempt + 1;
        if v_attempt > 99 then
          raise exception 'ECONOMY_PAYMENT_IDENTIFIER_UNAVAILABLE' using errcode = '23505';
        end if;
    end;
  end loop;
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
    perform public.net_economy_ensure_wallet_for_link(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists net_identity_links_ensure_economy_wallet
  on public.net_identity_links;
create trigger net_identity_links_ensure_economy_wallet
after insert or update of identity_kind, playability on public.net_identity_links
for each row execute procedure public.net_economy_ensure_identity_wallet();

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
  '00000000-0000-0000-0000-00000000e001'::uuid,
  null,
  'system',
  null,
  null,
  'VG',
  'active',
  0
)
on conflict (id) do nothing;

-- Abort before backfill if an owned playable sheet contains a cash value that
-- cannot be losslessly interpreted as a whole non-negative vG amount.
do $$
declare
  v_invalid_link_id uuid;
  v_invalid_value text;
begin
  select source.identity_link_id, source.cash_text
  into v_invalid_link_id, v_invalid_value
  from (
    select
      identity_link.id as identity_link_id,
      coalesce(sheet.field_data ->> 'CASH', '') as cash_text
    from public.net_identity_links as identity_link
    join public.character_sheet_forms as sheet
      on identity_link.subject_kind = 'profile-sheet'
      and sheet.profile_id = identity_link.subject_id
    where identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'

    union all

    select
      identity_link.id as identity_link_id,
      coalesce(card.field_data ->> 'CASH', '') as cash_text
    from public.net_identity_links as identity_link
    join public.npc_cards as card
      on identity_link.subject_kind = 'npc-card'
      and card.id = identity_link.subject_id
    where identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
  ) as source
  cross join lateral (
    select nullif(regexp_replace(source.cash_text, '[^0-9]', '', 'g'), '') as digits
  ) as normalized
  where btrim(source.cash_text) <> ''
    and (
      source.cash_text !~* '^[[:space:]]*[0-9]+[[:space:]]*(vg)?[[:space:]]*$'
      or normalized.digits is null
      or char_length(normalized.digits) > 10
      or coalesce(normalized.digits::numeric > 1000000000, true)
    )
  limit 1;

  if found then
    raise exception 'ECONOMY_LEGACY_CASH_REVIEW_REQUIRED: identity %, value %',
      v_invalid_link_id,
      v_invalid_value
      using errcode = '22023';
  end if;
end;
$$;

do $$
declare
  v_link record;
begin
  for v_link in
    select identity_link.id
    from public.net_identity_links as identity_link
    where identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
    order by identity_link.id
  loop
    perform public.net_economy_ensure_wallet_for_link(v_link.id);
  end loop;
end;
$$;

do $$
declare
  v_record record;
  v_amount bigint;
  v_transaction_id uuid;
  v_transaction_at timestamptz;
begin
  for v_record in
    select
      account.id as account_id,
      identity_link.id as identity_link_id,
      source.cash_text
    from public.net_economy_accounts as account
    join public.net_identity_links as identity_link
      on identity_link.id = account.identity_link_id
    join lateral (
      select case identity_link.subject_kind
        when 'profile-sheet' then coalesce((
          select sheet.field_data ->> 'CASH'
          from public.character_sheet_forms as sheet
          where sheet.profile_id = identity_link.subject_id
        ), '')
        when 'npc-card' then coalesce((
          select card.field_data ->> 'CASH'
          from public.npc_cards as card
          where card.id = identity_link.subject_id
        ), '')
        else ''
      end as cash_text
    ) as source on true
    where account.account_kind = 'wallet'
      and not exists (
        select 1
        from public.net_economy_transaction_entries as entry
        where entry.account_id = account.id
      )
    order by account.id
  loop
    v_amount := coalesce(
      nullif(regexp_replace(v_record.cash_text, '[^0-9]', '', 'g'), '')::bigint,
      0
    );

    if v_amount <= 0 then
      continue;
    end if;

    insert into public.net_economy_transactions (
      transaction_kind,
      initiated_by_profile_id,
      request_scope,
      request_key,
      request_fingerprint,
      note
    )
    values (
      'opening-balance',
      null,
      'opening-balance',
      v_record.account_id,
      md5('opening-balance:' || v_record.account_id::text || ':' || v_amount::text),
      null
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
        '00000000-0000-0000-0000-00000000e001'::uuid,
        -v_amount,
        v_transaction_at
      ),
      (v_transaction_id, v_record.account_id, v_amount, v_transaction_at);

    update public.net_economy_accounts as account
    set balance_amount = account.balance_amount - v_amount
    where account.id = '00000000-0000-0000-0000-00000000e001'::uuid;

    update public.net_economy_accounts as account
    set balance_amount = account.balance_amount + v_amount
    where account.id = v_record.account_id;
  end loop;
end;
$$;

-- Opening-balance inserts queue the ledger constraint trigger because it is
-- intentionally INITIALLY DEFERRED. Validate and clear those events before
-- later ALTER TABLE statements touch the entries relation. This mode change
-- applies only to the current migration transaction; future transactions keep
-- the trigger's declared INITIALLY DEFERRED default.
set constraints net_economy_entries_balance_check immediate;

create or replace function public.net_economy_cash_display(requested_amount bigint)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select requested_amount::text || 'vG';
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
  v_balance bigint;
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

  select account.balance_amount
  into v_balance
  from public.net_identity_links as identity_link
  join public.net_economy_accounts as account
    on account.identity_link_id = identity_link.id
    and account.account_kind = 'wallet'
  where identity_link.subject_kind = tg_argv[0]
    and identity_link.subject_id = v_subject_id;

  if found then
    new.field_data := jsonb_set(
      coalesce(new.field_data, '{}'::jsonb),
      '{CASH}',
      to_jsonb(public.net_economy_cash_display(v_balance)),
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists character_sheet_forms_enforce_economy_cash
  on public.character_sheet_forms;
create trigger character_sheet_forms_enforce_economy_cash
before insert or update of field_data on public.character_sheet_forms
for each row execute procedure public.net_economy_enforce_cash_mirror('profile-sheet');

drop trigger if exists npc_cards_enforce_economy_cash on public.npc_cards;
create trigger npc_cards_enforce_economy_cash
before insert or update of field_data on public.npc_cards
for each row execute procedure public.net_economy_enforce_cash_mirror('npc-card');

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

  return new;
end;
$$;

drop trigger if exists net_economy_accounts_sync_cash on public.net_economy_accounts;
create trigger net_economy_accounts_sync_cash
after update of balance_amount on public.net_economy_accounts
for each row execute procedure public.net_economy_sync_cash_mirror();

-- Normalize legacy sheet presentation to the migrated authoritative balance.
update public.character_sheet_forms as sheet
set field_data = jsonb_set(
  coalesce(sheet.field_data, '{}'::jsonb),
  '{CASH}',
  to_jsonb(public.net_economy_cash_display(account.balance_amount)),
  true
)
from public.net_identity_links as identity_link
join public.net_economy_accounts as account
  on account.identity_link_id = identity_link.id
  and account.account_kind = 'wallet'
where identity_link.subject_kind = 'profile-sheet'
  and identity_link.subject_id = sheet.profile_id
  and sheet.field_data ->> 'CASH'
    is distinct from public.net_economy_cash_display(account.balance_amount);

update public.npc_cards as card
set field_data = jsonb_set(
  coalesce(card.field_data, '{}'::jsonb),
  '{CASH}',
  to_jsonb(public.net_economy_cash_display(account.balance_amount)),
  true
)
from public.net_identity_links as identity_link
join public.net_economy_accounts as account
  on account.identity_link_id = identity_link.id
  and account.account_kind = 'wallet'
where identity_link.subject_kind = 'npc-card'
  and identity_link.subject_id = card.id
  and card.field_data ->> 'CASH'
    is distinct from public.net_economy_cash_display(account.balance_amount);

create or replace function public.net_economy_signal_wallet_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.account_kind = 'system'
    or new.balance_amount is not distinct from old.balance_amount
  then
    return new;
  end if;

  insert into public.net_economy_wallet_realtime_state (
    account_id,
    revision,
    updated_at
  )
  values (
    new.id,
    1,
    timezone('utc', clock_timestamp())
  )
  on conflict (account_id) do update
  set
    revision = public.net_economy_wallet_realtime_state.revision + 1,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

drop trigger if exists net_economy_accounts_signal_wallet_change
  on public.net_economy_accounts;
create trigger net_economy_accounts_signal_wallet_change
after update of balance_amount on public.net_economy_accounts
for each row execute procedure public.net_economy_signal_wallet_change();

insert into public.net_economy_wallet_realtime_state (account_id)
select account.id
from public.net_economy_accounts as account
where account.account_kind <> 'system'
on conflict (account_id) do nothing;

create or replace function public.assert_net_economy_player_identity()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_identity_link_id uuid;
begin
  if v_actor is null then
    raise exception 'ECONOMY_AUTH_REQUIRED' using errcode = '42501';
  end if;

  select active_identity.identity_link_id
  into v_identity_link_id
  from public.net_active_identities as active_identity
  where active_identity.profile_id = v_actor;

  if v_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(v_identity_link_id)
  then
    raise exception 'ECONOMY_ACTIVE_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  return v_identity_link_id;
end;
$$;

create or replace function public.assert_net_economy_gm()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_current_user_gm() then
    raise exception 'ECONOMY_GM_REQUIRED' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

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
          and public.current_user_controls_playable_net_identity_link(account.identity_link_id)
      )
    );
$$;

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
  ),
  page as (
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
      where other_entry.transaction_id = entry.transaction_id
        and other_entry.account_id <> requested_account_id
        and other_account.account_kind <> 'system'
      limit 1
    ) as counterparty on true
    cross join settings
    where entry.account_id = requested_account_id
      and (
        requested_cursor_at is null
        or (entry.created_at, entry.transaction_id)
          < (requested_cursor_at, requested_cursor_id)
      )
    order by entry.created_at desc, entry.transaction_id desc
    limit (select page_limit + 1 from settings)
  ),
  trimmed as (
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
          'counterparty_display_name', trimmed.counterparty_display_name,
          'counterparty_payment_identifier', trimmed.counterparty_payment_identifier,
          'note', trimmed.note,
          'created_at', trimmed.created_at
        )
        order by trimmed.created_at desc, trimmed.transaction_id desc
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

create or replace function public.net_economy_wallet_payload(
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
  v_account public.net_economy_accounts%rowtype;
begin
  v_account := public.net_economy_ensure_wallet_for_link(requested_identity_link_id);

  return jsonb_build_object(
    'wallet', jsonb_build_object(
      'account_id', v_account.id,
      'payment_identifier', v_account.payment_identifier,
      'display_name', public.net_economy_identity_display_name(v_account.identity_link_id),
      'balance_amount', v_account.balance_amount,
      'currency_code', v_account.currency_code,
      'status', v_account.status,
      'updated_at', v_account.updated_at
    ),
    'activity', public.net_economy_history_page(
      v_account.id,
      requested_cursor_at,
      requested_cursor_id,
      requested_limit
    )
  );
end;
$$;

create or replace function public.fetch_net_economy_wallet(
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
  return public.net_economy_wallet_payload(
    v_identity_link_id,
    requested_cursor_at,
    requested_cursor_id,
    requested_limit
  );
end;
$$;

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
  v_account_id uuid;
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 20);
begin
  v_identity_link_id := public.assert_net_economy_player_identity();

  if char_length(v_query) < 2 or char_length(v_query) > 60 then
    raise exception 'ECONOMY_PAYEE_QUERY_INVALID' using errcode = '22023';
  end if;

  select account.id
  into v_account_id
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'wallet';

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'payment_identifier', directory.payment_identifier,
        'display_name', directory.display_name
      )
      order by directory.display_name, directory.payment_identifier
    )
    from (
      select
        account.payment_identifier,
        public.net_economy_identity_display_name(account.identity_link_id) as display_name
      from public.net_economy_accounts as account
      join public.net_identity_links as identity_link
        on identity_link.id = account.identity_link_id
      where account.id <> v_account_id
        and account.account_kind = 'wallet'
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
  v_actor uuid := auth.uid();
  v_identity_link_id uuid;
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

  if requested_request_key is null then
    raise exception 'ECONOMY_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;
  if requested_amount is null or requested_amount < 1 or requested_amount > 1000000000 then
    raise exception 'ECONOMY_AMOUNT_INVALID' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 120 then
    raise exception 'ECONOMY_NOTE_TOO_LONG' using errcode = '22001';
  end if;

  v_source := public.net_economy_ensure_wallet_for_link(v_identity_link_id);
  v_scope := 'player:' || v_actor::text;
  v_fingerprint := md5(
    v_source.id::text || ':' || v_identifier || ':' || requested_amount::text || ':' || coalesce(v_note, '')
  );

  select *
  into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;

  if found then
    if v_existing.transaction_kind <> 'transfer'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.net_economy_wallet_payload(v_identity_link_id, null, null, 20);
  end if;

  select *
  into v_target
  from public.net_economy_accounts as account
  where account.payment_identifier = v_identifier
    and account.account_kind = 'wallet'
    and account.status = 'active';

  if not found then
    raise exception 'ECONOMY_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;
  if v_target.id = v_source.id then
    raise exception 'ECONOMY_SELF_TRANSFER_INVALID' using errcode = '22023';
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
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.net_economy_wallet_payload(v_identity_link_id, null, null, 20);
  end if;

  if v_source.status <> 'active' or v_source.balance_amount < requested_amount then
    raise exception 'ECONOMY_INSUFFICIENT_FUNDS' using errcode = '22023';
  end if;
  if v_target.status <> 'active' then
    raise exception 'ECONOMY_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;

  insert into public.net_economy_transactions (
    transaction_kind,
    initiated_by_profile_id,
    request_scope,
    request_key,
    request_fingerprint,
    note
  )
  values (
    'transfer',
    v_actor,
    v_scope,
    requested_request_key,
    v_fingerprint,
    v_note
  )
  returning * into v_transaction;

  insert into public.net_economy_transaction_entries (
    transaction_id,
    account_id,
    amount,
    created_at
  )
  values
    (v_transaction.id, v_source.id, -requested_amount, v_transaction.created_at),
    (v_transaction.id, v_target.id, requested_amount, v_transaction.created_at);

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount - requested_amount
  where account.id = v_source.id;

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount + requested_amount
  where account.id = v_target.id;

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
  )
  values (
    v_actor,
    null,
    null,
    null,
    'owner',
    'economy.wallet.transfer',
    'controlled-active-identity',
    'economy-transaction',
    v_transaction.id
  );

  return public.net_economy_wallet_payload(v_identity_link_id, null, null, 20);
end;
$$;

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
      )
      order by directory.display_name, directory.payment_identifier
    )
    from (
      select
        account.id,
        account.payment_identifier,
        public.net_economy_identity_display_name(account.identity_link_id) as display_name,
        account.account_kind,
        account.status,
        account.balance_amount,
        account.currency_code,
        account.updated_at
      from public.net_economy_accounts as account
      where account.account_kind <> 'system'
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

create or replace function public.fetch_net_economy_gm_wallet(
  requested_account_id uuid,
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
  v_account public.net_economy_accounts%rowtype;
begin
  perform public.assert_net_economy_gm();

  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'ECONOMY_CURSOR_INVALID' using errcode = '22023';
  end if;

  select *
  into v_account
  from public.net_economy_accounts as account
  where account.id = requested_account_id
    and account.account_kind <> 'system';

  if not found then
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'wallet', jsonb_build_object(
      'account_id', v_account.id,
      'payment_identifier', v_account.payment_identifier,
      'display_name', public.net_economy_identity_display_name(v_account.identity_link_id),
      'balance_amount', v_account.balance_amount,
      'currency_code', v_account.currency_code,
      'status', v_account.status,
      'updated_at', v_account.updated_at
    ),
    'activity', public.net_economy_history_page(
      v_account.id,
      requested_cursor_at,
      requested_cursor_id,
      requested_limit
    )
  );
end;
$$;

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
declare
  v_actor uuid;
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
begin
  v_actor := public.assert_net_economy_gm();

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
  v_fingerprint := md5(
    requested_account_id::text || ':' || v_action || ':' || requested_amount::text || ':' || v_reason
  );

  select *
  into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;

  if found then
    if v_existing.transaction_kind <> v_kind
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.fetch_net_economy_gm_wallet(requested_account_id, null, null, 20);
  end if;

  perform 1
  from public.net_economy_accounts as account
  where account.id in (
    requested_account_id,
    '00000000-0000-0000-0000-00000000e001'::uuid
  )
  order by account.id
  for update;

  select * into v_account
  from public.net_economy_accounts as account
  where account.id = requested_account_id
    and account.account_kind <> 'system';
  select * into v_system
  from public.net_economy_accounts as account
  where account.id = '00000000-0000-0000-0000-00000000e001'::uuid;

  if v_account.id is null then
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;
  if v_account.status <> 'active' then
    raise exception 'ECONOMY_WALLET_INACTIVE' using errcode = '22023';
  end if;
  if v_action = 'debit' and v_account.balance_amount < requested_amount then
    raise exception 'ECONOMY_INSUFFICIENT_FUNDS' using errcode = '22023';
  end if;

  select *
  into v_existing
  from public.net_economy_transactions as transaction_record
  where transaction_record.request_scope = v_scope
    and transaction_record.request_key = requested_request_key;

  if found then
    if v_existing.transaction_kind <> v_kind
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'ECONOMY_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return public.fetch_net_economy_gm_wallet(requested_account_id, null, null, 20);
  end if;

  insert into public.net_economy_transactions (
    transaction_kind,
    initiated_by_profile_id,
    request_scope,
    request_key,
    request_fingerprint,
    note
  )
  values (
    v_kind,
    v_actor,
    v_scope,
    requested_request_key,
    v_fingerprint,
    v_reason
  )
  returning * into v_transaction;

  insert into public.net_economy_transaction_entries (
    transaction_id,
    account_id,
    amount,
    created_at
  )
  values
    (v_transaction.id, v_account.id, v_wallet_delta, v_transaction.created_at),
    (v_transaction.id, v_system.id, -v_wallet_delta, v_transaction.created_at);

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount + v_wallet_delta
  where account.id = v_account.id;

  update public.net_economy_accounts as account
  set balance_amount = account.balance_amount - v_wallet_delta
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
  )
  values (
    v_actor,
    null,
    null,
    null,
    'system',
    case v_action
      when 'credit' then 'economy.wallet.credit'
      else 'economy.wallet.debit'
    end,
    'authoritative-gm-economy-control',
    'economy-transaction',
    v_transaction.id
  );

  return public.fetch_net_economy_gm_wallet(requested_account_id, null, null, 20);
end;
$$;

alter table public.net_economy_accounts enable row level security;
alter table public.net_economy_transactions enable row level security;
alter table public.net_economy_transaction_entries enable row level security;
alter table public.net_economy_wallet_realtime_state enable row level security;

drop policy if exists net_economy_wallet_realtime_select_controlled
  on public.net_economy_wallet_realtime_state;
create policy net_economy_wallet_realtime_select_controlled
on public.net_economy_wallet_realtime_state
for select
to authenticated
using (
  public.current_user_can_read_net_economy_wallet_revision(account_id)
);

revoke all on table public.net_economy_accounts from public, anon, authenticated;
revoke all on table public.net_economy_transactions from public, anon, authenticated;
revoke all on table public.net_economy_transaction_entries from public, anon, authenticated;
revoke all on table public.net_economy_wallet_realtime_state from public, anon, authenticated;
grant select on table public.net_economy_wallet_realtime_state to authenticated;

revoke all on function public.net_economy_assert_balanced_transaction() from public, anon, authenticated;
revoke all on function public.net_economy_identity_display_name(uuid) from public, anon, authenticated;
revoke all on function public.net_economy_ensure_wallet_for_link(uuid) from public, anon, authenticated;
revoke all on function public.net_economy_ensure_identity_wallet() from public, anon, authenticated;
revoke all on function public.net_economy_cash_display(bigint) from public, anon, authenticated;
revoke all on function public.net_economy_enforce_cash_mirror() from public, anon, authenticated;
revoke all on function public.net_economy_sync_cash_mirror() from public, anon, authenticated;
revoke all on function public.net_economy_signal_wallet_change() from public, anon, authenticated;
revoke all on function public.assert_net_economy_player_identity() from public, anon, authenticated;
revoke all on function public.assert_net_economy_gm() from public, anon, authenticated;
revoke all on function public.current_user_can_read_net_economy_wallet_revision(uuid) from public, anon;
revoke all on function public.net_economy_history_page(uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.net_economy_wallet_payload(uuid, timestamptz, uuid, integer) from public, anon, authenticated;

revoke all on function public.fetch_net_economy_wallet(timestamptz, uuid, integer) from public, anon;
revoke all on function public.search_net_economy_payees(text, integer) from public, anon;
revoke all on function public.transfer_net_economy_wallet(text, bigint, text, uuid) from public, anon;
revoke all on function public.fetch_net_economy_gm_wallet_directory(text, integer) from public, anon;
revoke all on function public.fetch_net_economy_gm_wallet(uuid, timestamptz, uuid, integer) from public, anon;
revoke all on function public.adjust_net_economy_gm_wallet(uuid, text, bigint, text, uuid) from public, anon;

grant execute on function public.fetch_net_economy_wallet(timestamptz, uuid, integer) to authenticated;
grant execute on function public.search_net_economy_payees(text, integer) to authenticated;
grant execute on function public.transfer_net_economy_wallet(text, bigint, text, uuid) to authenticated;
grant execute on function public.fetch_net_economy_gm_wallet_directory(text, integer) to authenticated;
grant execute on function public.fetch_net_economy_gm_wallet(uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.adjust_net_economy_gm_wallet(uuid, text, bigint, text, uuid) to authenticated;
grant execute on function public.current_user_can_read_net_economy_wallet_revision(uuid) to authenticated;

alter table public.net_economy_wallet_realtime_state replica identity full;

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_economy_accounts'
  ) then
    alter publication supabase_realtime drop table public.net_economy_accounts;
  end if;
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_economy_transactions'
  ) then
    alter publication supabase_realtime drop table public.net_economy_transactions;
  end if;
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_economy_transaction_entries'
  ) then
    alter publication supabase_realtime drop table public.net_economy_transaction_entries;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_economy_wallet_realtime_state'
  ) then
    alter publication supabase_realtime add table public.net_economy_wallet_realtime_state;
  end if;
exception
  when duplicate_object then null;
end;
$$;

commit;
