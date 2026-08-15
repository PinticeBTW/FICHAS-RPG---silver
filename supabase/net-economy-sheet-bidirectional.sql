-- New Vega economy: true bidirectional character-sheet balance surfaces.
-- Run once after the deployed net-economy-wallet.sql, net-economy-karma.sql,
-- and net-economy-vox-bank.sql migrations.
--
-- A sheet edit is an absolute-balance request against the identity's VLT
-- wallet. Every effective change is a balanced ledger transaction. VOX BANK
-- accounts are deliberately outside this path.

begin;

-- Sheet-origin adjustments need their own immutable history labels. A signed
-- Karma absolute change can span the complete -1bn..+1bn domain, so its two
-- entries may be as large as 2bn. All other transaction kinds retain the
-- deployed 1bn entry ceiling through the deferred ledger validator below.
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
      'sheet-vg-adjustment',
      'sheet-karma-adjustment'
    )
  ) not valid;
alter table public.net_economy_transactions
  validate constraint net_economy_transactions_kind_valid;

alter table public.net_economy_transaction_entries
  drop constraint if exists net_economy_transaction_entries_amount_valid;
alter table public.net_economy_transaction_entries
  add constraint net_economy_transaction_entries_amount_valid check (
    amount <> 0 and abs(amount::numeric) <= 2000000000
  ) not valid;
alter table public.net_economy_transaction_entries
  validate constraint net_economy_transaction_entries_amount_valid;

create or replace function public.net_economy_assert_balanced_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transaction_id uuid := coalesce(new.transaction_id, old.transaction_id);
  v_transaction_currency text;
  v_transaction_kind text;
  v_entry_count integer;
  v_total numeric;
  v_currency_mismatch_count integer;
  v_excessive_entry_count integer;
begin
  select transaction_record.currency_code, transaction_record.transaction_kind
  into v_transaction_currency, v_transaction_kind
  from public.net_economy_transactions as transaction_record
  where transaction_record.id = v_transaction_id;

  if not found then
    return null;
  end if;

  select
    count(*),
    coalesce(sum(entry.amount), 0),
    count(*) filter (where account.currency_code <> v_transaction_currency),
    count(*) filter (
      where abs(entry.amount::numeric) > case
        when v_transaction_kind = 'sheet-karma-adjustment' then 2000000000
        else 1000000000
      end
    )
  into
    v_entry_count,
    v_total,
    v_currency_mismatch_count,
    v_excessive_entry_count
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
  if v_excessive_entry_count <> 0 then
    raise exception 'ECONOMY_ENTRY_AMOUNT_INVALID' using errcode = '23514';
  end if;

  return null;
end;
$$;

-- Match the actual deployed RLS rules instead of trusting client UI state.
create or replace function public.net_economy_current_user_can_edit_sheet_subject(
  requested_subject_kind text,
  requested_subject_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or requested_subject_id is null then
    return false;
  end if;

  case requested_subject_kind
    when 'profile-sheet' then
      return exists (
        select 1
        from public.character_sheet_forms as sheet
        where sheet.profile_id = requested_subject_id
          and (
            public.is_current_user_gm()
            or sheet.profile_id = auth.uid()
          )
      );
    when 'npc-card' then
      return exists (
        select 1
        from public.npc_cards as card
        where card.id = requested_subject_id
          and (
            public.is_current_user_gm()
            or card.owner_profile_id = auth.uid()
            or public.has_sheet_share_access(
              'npc'::public.sheet_share_target_kind,
              card.id
            )
          )
      );
    when 'character' then
      return exists (
        select 1
        from public.characters as character_record
        where character_record.id = requested_subject_id
          and (
            public.is_gm_for_campaign(character_record.campaign_id)
            or (
              character_record.owner_profile_id = auth.uid()
              and character_record.allow_player_stat_edits
            )
          )
      );
    else
      return false;
  end case;
end;
$$;

-- The selector is a read-only sheet surface. Match each deployed sheet SELECT
-- policy without granting any financial-table access to the caller.
create or replace function public.net_economy_current_user_can_view_sheet_subject(
  requested_subject_kind text,
  requested_subject_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or requested_subject_id is null then
    return false;
  end if;

  case requested_subject_kind
    when 'profile-sheet' then
      return exists (
        select 1
        from public.character_sheet_forms as sheet
        where sheet.profile_id = requested_subject_id
          and (
            public.is_current_user_gm()
            or sheet.profile_id = auth.uid()
            or public.has_sheet_share_access(
              'profile'::public.sheet_share_target_kind,
              sheet.profile_id
            )
          )
      );
    when 'npc-card' then
      return exists (
        select 1
        from public.npc_cards as card
        where card.id = requested_subject_id
          and (
            public.is_current_user_gm()
            or card.owner_profile_id = auth.uid()
            or public.has_sheet_share_access(
              'npc'::public.sheet_share_target_kind,
              card.id
            )
          )
      );
    when 'character' then
      return exists (
        select 1
        from public.characters as character_record
        where character_record.id = requested_subject_id
          and (
            public.is_gm_for_campaign(character_record.campaign_id)
            or character_record.owner_profile_id = auth.uid()
          )
      );
    else
      return false;
  end case;
end;
$$;

create or replace function public.net_economy_parse_sheet_cash(
  requested_value text
)
returns bigint
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_raw text := btrim(coalesce(requested_value, ''));
  v_digits text;
  v_amount numeric;
begin
  if v_raw ~ '^[0-9]+$' then
    v_digits := v_raw;
  elsif v_raw ~* '^[0-9]+[[:space:]]*vg$' then
    v_digits := regexp_replace(v_raw, '[[:space:]]*vg$', '', 'i');
  else
    raise exception 'ECONOMY_SHEET_CASH_INVALID' using errcode = '22023';
  end if;

  if char_length(v_digits) > 40 then
    raise exception 'ECONOMY_SHEET_CASH_INVALID' using errcode = '22003';
  end if;
  v_amount := v_digits::numeric;
  if v_amount < 0 or v_amount > 1000000000 then
    raise exception 'ECONOMY_SHEET_CASH_INVALID' using errcode = '22003';
  end if;
  return v_amount::bigint;
end;
$$;

-- Return one semantic state for every historical Karma alias. Blank/missing
-- and '-' mean NO KARMA; compatible signed integers mean an enrolled value.
create or replace function public.net_economy_parse_sheet_karma(
  requested_field_data jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_raw text;
  v_numeric numeric;
  v_amount bigint;
  v_has_numeric boolean := false;
  v_has_no_karma boolean := false;
begin
  foreach v_key in array array['KARMA', 'Karma', 'karma', 'K4rma', 'K4RMA']
  loop
    v_raw := nullif(btrim(coalesce(requested_field_data ->> v_key, '')), '');
    if v_raw is null then
      continue;
    end if;
    if v_raw = '-' then
      v_has_no_karma := true;
      continue;
    end if;
    if v_raw !~ '^[+-]?[0-9]+$' or char_length(v_raw) > 40 then
      raise exception 'ECONOMY_SHEET_KARMA_INVALID' using errcode = '22023';
    end if;

    v_numeric := v_raw::numeric;
    if abs(v_numeric) > 1000000000 then
      raise exception 'ECONOMY_SHEET_KARMA_INVALID' using errcode = '22003';
    end if;
    if v_has_numeric and v_amount is distinct from v_numeric::bigint then
      raise exception 'ECONOMY_SHEET_KARMA_CONFLICT' using errcode = '22023';
    end if;
    v_has_numeric := true;
    v_amount := v_numeric::bigint;
  end loop;

  if v_has_no_karma and v_has_numeric then
    raise exception 'ECONOMY_SHEET_KARMA_CONFLICT' using errcode = '22023';
  end if;
  if v_has_numeric then
    return jsonb_build_object('state', 'numeric', 'amount', v_amount);
  end if;
  return jsonb_build_object('state', 'none');
end;
$$;

-- Apply one requested absolute VLT wallet balance under deterministic locks.
-- Repeating the same absolute value is naturally idempotent: delta zero creates
-- neither ledger nor audit row.
create or replace function public.net_economy_apply_sheet_absolute_balance(
  requested_identity_link_id uuid,
  requested_currency_code text,
  requested_absolute_balance bigint,
  requested_subject_kind text,
  requested_subject_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_currency text := upper(btrim(coalesce(requested_currency_code, '')));
  v_wallet public.net_economy_accounts%rowtype;
  v_system public.net_economy_accounts%rowtype;
  v_system_id uuid;
  v_delta bigint;
  v_transaction public.net_economy_transactions%rowtype;
  v_previous_origin text := current_setting('app.net_economy_origin', true);
  v_action_mode text;
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.net_economy_current_user_can_edit_sheet_subject(
    requested_subject_kind,
    requested_subject_id
  ) then
    raise exception 'ECONOMY_SHEET_EDIT_DENIED' using errcode = '42501';
  end if;
  if v_currency not in ('VG', 'KARMA') then
    raise exception 'ECONOMY_CURRENCY_INVALID' using errcode = '22023';
  end if;
  if requested_absolute_balance is null
    or (v_currency = 'VG' and requested_absolute_balance < 0)
    or abs(requested_absolute_balance::numeric) > 1000000000
  then
    raise exception 'ECONOMY_SHEET_BALANCE_INVALID' using errcode = '22003';
  end if;

  v_system_id := case v_currency
    when 'VG' then '00000000-0000-0000-0000-00000000e001'::uuid
    else '00000000-0000-0000-0000-00000000e002'::uuid
  end;

  select *
  into v_wallet
  from public.net_economy_accounts as account
  where account.identity_link_id = requested_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = v_currency;
  if not found then
    if v_currency = 'KARMA' then
      raise exception 'ECONOMY_KARMA_NOT_AVAILABLE' using errcode = '22023';
    end if;
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;

  perform 1
  from public.net_economy_accounts as account
  where account.id in (v_wallet.id, v_system_id)
  order by account.id
  for update;

  select *
  into v_wallet
  from public.net_economy_accounts as account
  where account.id = v_wallet.id;
  select *
  into v_system
  from public.net_economy_accounts as account
  where account.id = v_system_id
    and account.account_kind = 'system'
    and account.currency_code = v_currency;

  if v_wallet.id is null or v_wallet.status <> 'active' then
    raise exception 'ECONOMY_WALLET_INACTIVE' using errcode = '22023';
  end if;
  if v_system.id is null then
    raise exception 'ECONOMY_SYSTEM_ACCOUNT_MISSING' using errcode = '55000';
  end if;

  v_delta := requested_absolute_balance - v_wallet.balance_amount;
  if v_delta = 0 then
    return null;
  end if;
  if v_currency = 'VG' and requested_absolute_balance < 0 then
    raise exception 'ECONOMY_INSUFFICIENT_FUNDS' using errcode = '22023';
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
    case v_currency
      when 'VG' then 'sheet-vg-adjustment'
      else 'sheet-karma-adjustment'
    end,
    v_actor,
    'sheet:' || v_actor::text,
    gen_random_uuid(),
    md5(
      'sheet-absolute:' || v_wallet.id::text || ':' || v_currency || ':'
      || requested_absolute_balance::text
    ),
    null,
    v_currency
  ) returning * into v_transaction;

  insert into public.net_economy_transaction_entries (
    transaction_id,
    account_id,
    amount,
    created_at
  ) values
    (v_transaction.id, v_wallet.id, v_delta, v_transaction.created_at),
    (v_transaction.id, v_system.id, -v_delta, v_transaction.created_at);

  perform set_config('app.net_economy_origin', 'sheet-adjustment', true);
  begin
    update public.net_economy_accounts as account
    set balance_amount = account.balance_amount + v_delta
    where account.id = v_wallet.id;

    update public.net_economy_accounts as account
    set balance_amount = account.balance_amount - v_delta
    where account.id = v_system.id;
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

  v_action_mode := case
    when public.is_current_user_gm() then 'system'
    else 'owner'
  end;

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
    v_action_mode,
    case v_currency
      when 'VG' then 'economy.sheet.vg-adjust'
      else 'economy.sheet.karma-adjust'
    end,
    'authoritative-sheet-edit-permission',
    'economy-transaction',
    v_transaction.id
  );

  return v_transaction.id;
end;
$$;

-- Direct table writes are never financial authority. This trigger only
-- canonicalizes the sheet from VLT wallets. The bounded patch RPCs below apply
-- intentional balance requests before locking/updating the sheet row, keeping
-- the global lock order wallet -> sheet.
create or replace function public.net_economy_enforce_cash_mirror()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_row jsonb := to_jsonb(new);
  v_subject_id uuid;
  v_identity_link_id uuid;
  v_identity_count integer;
  v_vg_account public.net_economy_accounts%rowtype;
  v_karma_account public.net_economy_accounts%rowtype;
begin
  v_subject_id := case tg_argv[0]
    when 'profile-sheet' then nullif(v_new_row ->> 'profile_id', '')::uuid
    when 'npc-card' then nullif(v_new_row ->> 'id', '')::uuid
    else null
  end;
  if v_subject_id is null then
    return new;
  end if;

  select count(*)
  into v_identity_count
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
  select identity_link.id
  into v_identity_link_id
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = tg_argv[0]
    and identity_link.subject_id = v_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  select * into v_vg_account
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'VG';
  select * into v_karma_account
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'KARMA';
  if v_vg_account.id is null then
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;

  if v_vg_account.id is not null then
    new.field_data := jsonb_set(
      coalesce(new.field_data, '{}'::jsonb),
      '{CASH}',
      to_jsonb(public.net_economy_cash_display(v_vg_account.balance_amount)),
      true
    );
  end if;
  new.field_data := jsonb_set(
    coalesce(new.field_data, '{}'::jsonb)
      - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
    '{KARMA}',
    to_jsonb(case
      when v_karma_account.id is null then '-'
      else public.net_economy_karma_display(v_karma_account.balance_amount)
    end),
    true
  );

  return new;
end;
$$;

-- Interpret only fields intentionally included in one patch. Financial locks
-- are acquired before the caller locks the sheet row. Removed CASH/KARMA keys
-- are not balance requests; the canonical trigger restores their authoritative
-- presentation on the subsequent row update.
create or replace function public.net_economy_apply_sheet_field_requests(
  requested_subject_kind text,
  requested_subject_id uuid,
  requested_field_patch jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_identity_count integer;
  v_karma_account public.net_economy_accounts%rowtype;
  v_karma_semantic jsonb;
  v_requested_karma bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.net_economy_current_user_can_edit_sheet_subject(
    requested_subject_kind,
    requested_subject_id
  ) then
    raise exception 'ECONOMY_SHEET_EDIT_DENIED' using errcode = '42501';
  end if;
  if requested_field_patch is null
    or jsonb_typeof(requested_field_patch) <> 'object'
  then
    raise exception 'ECONOMY_SHEET_PATCH_INVALID' using errcode = '22023';
  end if;

  select count(*)
  into v_identity_count
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = requested_subject_kind
    and identity_link.subject_id = requested_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if v_identity_count = 0 then
    return;
  end if;
  if v_identity_count > 1 then
    raise exception 'ECONOMY_SHEET_IDENTITY_AMBIGUOUS' using errcode = '23514';
  end if;

  select identity_link.id
  into v_identity_link_id
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = requested_subject_kind
    and identity_link.subject_id = requested_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  -- Always acquire VG before Karma when a patch changes both currencies.
  if requested_field_patch ? 'CASH' then
    perform public.net_economy_apply_sheet_absolute_balance(
      v_identity_link_id,
      'VG',
      public.net_economy_parse_sheet_cash(requested_field_patch ->> 'CASH'),
      requested_subject_kind,
      requested_subject_id
    );
  end if;

  if requested_field_patch
    ?| array['KARMA', 'Karma', 'karma', 'K4rma', 'K4RMA']
  then
    v_karma_semantic := public.net_economy_parse_sheet_karma(
      requested_field_patch
    );

    select *
    into v_karma_account
    from public.net_economy_accounts as account
    where account.identity_link_id = v_identity_link_id
      and account.account_kind = 'wallet'
      and account.currency_code = 'KARMA';

    if v_karma_semantic ->> 'state' = 'numeric' then
      v_requested_karma := (v_karma_semantic ->> 'amount')::bigint;

      if v_karma_account.id is null and public.is_current_user_gm() then
        v_karma_account := public.net_economy_ensure_wallet_currency_for_link(
          v_identity_link_id,
          'KARMA'
        );

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
          auth.uid(),
          null,
          null,
          null,
          'system',
          'economy.karma.enable',
          'authoritative-gm-sheet-edit',
          'economy-account',
          v_karma_account.id
        );
      end if;

      -- A non-GM cannot enrol a NO-KARMA identity. The canonical sheet trigger
      -- will restore '-' after the patch row is written.
      if v_karma_account.id is not null then
        perform public.net_economy_apply_sheet_absolute_balance(
          v_identity_link_id,
          'KARMA',
          v_requested_karma,
          requested_subject_kind,
          requested_subject_id
        );
      end if;
    end if;
  end if;
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
  v_previous_origin text := current_setting('app.net_economy_origin', true);
begin
  if new.account_kind <> 'wallet'
    or new.balance_amount is not distinct from old.balance_amount
    or nullif(v_previous_origin, '') = 'sheet-adjustment'
  then
    return new;
  end if;

  select * into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = new.identity_link_id;
  if not found then
    return new;
  end if;

  perform set_config('app.net_economy_origin', 'economy-mirror', true);
  begin
    if new.currency_code = 'VG' then
      v_display := public.net_economy_cash_display(new.balance_amount);
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

create or replace function public.net_economy_enforce_character_karma_mirror()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_identity_count integer;
  v_account public.net_economy_accounts%rowtype;
begin
  select count(*)
  into v_identity_count
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = 'character'
    and identity_link.subject_id = new.character_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if v_identity_count = 0 then
    return new;
  end if;
  if v_identity_count > 1 then
    raise exception 'ECONOMY_SHEET_IDENTITY_AMBIGUOUS' using errcode = '23514';
  end if;
  select identity_link.id
  into v_identity_link_id
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = 'character'
    and identity_link.subject_id = new.character_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  select * into v_account
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'KARMA';

  -- Raw character_stats writes are presentation only. The V2 save RPC applies
  -- an intentional Karma request to the ledger before updating this row.
  if v_account.id is not null then
    new.karma := v_account.balance_amount::integer;
  elsif tg_op = 'UPDATE' then
    new.karma := old.karma;
  else
    new.karma := 0;
  end if;
  return new;
end;
$$;

-- Legacy campaign characters use character_stats rather than JSON sheet data.
-- Keep the same wallet -> sheet lock order and save all stat columns in the
-- same database transaction as the ledgered Karma adjustment.
create or replace function public.save_character_stats_bidirectional_v2(
  p_character_id uuid,
  p_hp_current integer,
  p_hp_max integer,
  p_ram_current integer,
  p_ram_max integer,
  p_karma integer,
  p_cyberpsychosis integer,
  p_humanity integer,
  p_armor integer,
  p_initiative integer,
  p_reflex integer,
  p_tech integer,
  p_cool integer,
  p_body integer,
  p_intelligence integer,
  p_empathy integer,
  p_luck integer
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_identity_count integer;
  v_account public.net_economy_accounts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.net_economy_current_user_can_edit_sheet_subject(
    'character',
    p_character_id
  ) then
    raise exception 'ECONOMY_SHEET_EDIT_DENIED' using errcode = '42501';
  end if;
  if p_karma is null or abs(p_karma::numeric) > 1000000000 then
    raise exception 'ECONOMY_SHEET_KARMA_INVALID' using errcode = '22003';
  end if;

  select count(*)
  into v_identity_count
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = 'character'
    and identity_link.subject_id = p_character_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';
  if v_identity_count > 1 then
    raise exception 'ECONOMY_SHEET_IDENTITY_AMBIGUOUS' using errcode = '23514';
  end if;

  if v_identity_count = 1 then
    select identity_link.id
    into v_identity_link_id
    from public.net_identity_links as identity_link
    where identity_link.subject_kind = 'character'
      and identity_link.subject_id = p_character_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable';

    select *
    into v_account
    from public.net_economy_accounts as account
    where account.identity_link_id = v_identity_link_id
      and account.account_kind = 'wallet'
      and account.currency_code = 'KARMA';

    if v_account.id is null then
      if exists (
        select 1
        from public.character_stats as character_stat
        where character_stat.character_id = p_character_id
      ) then
        v_account := public.net_economy_ensure_character_karma_wallet(
          v_identity_link_id
        );
      else
        v_account := public.net_economy_ensure_wallet_currency_for_link(
          v_identity_link_id,
          'KARMA'
        );
      end if;
    end if;

    perform public.net_economy_apply_sheet_absolute_balance(
      v_identity_link_id,
      'KARMA',
      p_karma::bigint,
      'character',
      p_character_id
    );
  end if;

  -- Wallet/account locks are already held above. This row lock cannot form the
  -- previous sheet -> wallet / wallet -> sheet cycle.
  perform 1
  from public.character_stats as character_stat
  where character_stat.character_id = p_character_id
  for update;

  insert into public.character_stats (
    character_id,
    hp_current,
    hp_max,
    ram_current,
    ram_max,
    karma,
    cyberpsychosis,
    humanity,
    armor,
    initiative,
    reflex,
    tech,
    cool,
    body,
    intelligence,
    empathy,
    luck
  ) values (
    p_character_id,
    p_hp_current,
    p_hp_max,
    p_ram_current,
    p_ram_max,
    p_karma,
    p_cyberpsychosis,
    p_humanity,
    p_armor,
    p_initiative,
    p_reflex,
    p_tech,
    p_cool,
    p_body,
    p_intelligence,
    p_empathy,
    p_luck
  )
  on conflict (character_id) do update
  set
    hp_current = excluded.hp_current,
    hp_max = excluded.hp_max,
    ram_current = excluded.ram_current,
    ram_max = excluded.ram_max,
    karma = excluded.karma,
    cyberpsychosis = excluded.cyberpsychosis,
    humanity = excluded.humanity,
    armor = excluded.armor,
    initiative = excluded.initiative,
    reflex = excluded.reflex,
    tech = excluded.tech,
    cool = excluded.cool,
    body = excluded.body,
    intelligence = excluded.intelligence,
    empathy = excluded.empathy,
    luck = excluded.luck;
end;
$$;

-- Additive canonical NPC patch endpoint. The deployed V1 endpoint remains for
-- old clients; V2 returns the trigger-canonicalized field_data to new clients.
create or replace function public.patch_npc_card_field_data_v2(
  p_npc_id uuid,
  p_field_patch jsonb,
  p_removed_keys text[] default '{}'::text[]
)
returns table (
  id uuid,
  field_data jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next_field_data jsonb;
begin
  if auth.uid() is null
    or not public.net_economy_current_user_can_edit_sheet_subject(
      'npc-card',
      p_npc_id
    )
  then
    raise exception 'ECONOMY_SHEET_EDIT_DENIED' using errcode = '42501';
  end if;

  -- Financial locks first, then the exact sheet row. A failed row update rolls
  -- the ledger mutation back because an RPC call is one PostgreSQL transaction.
  perform public.net_economy_apply_sheet_field_requests(
    'npc-card',
    p_npc_id,
    coalesce(p_field_patch, '{}'::jsonb)
  );

  select
    (coalesce(card.field_data, '{}'::jsonb)
      - coalesce(p_removed_keys, '{}'::text[]))
      || coalesce(p_field_patch, '{}'::jsonb)
  into v_next_field_data
  from public.npc_cards as card
  where card.id = p_npc_id
  for update;
  if not found then
    raise exception 'ECONOMY_SHEET_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  update public.npc_cards as card
  set
    field_data = v_next_field_data,
    updated_at = timezone('utc', now())
  where card.id = p_npc_id
    and card.field_data is distinct from v_next_field_data
  returning card.id, card.field_data, card.updated_at;

  if not found then
    return query
    select card.id, card.field_data, card.updated_at
    from public.npc_cards as card
    where card.id = p_npc_id;
  end if;
end;
$$;

-- Profile sheets previously upserted the entire cached JSON document. A
-- concurrent wallet mutation could therefore make an unrelated sheet save
-- carry a stale CASH value. This additive patch endpoint applies only fields
-- the editor actually changed to the current server row.
create or replace function public.patch_character_sheet_field_data_v2(
  p_profile_id uuid,
  p_field_patch jsonb,
  p_removed_keys text[] default '{}'::text[],
  p_template_key text default 'blank-grey-v3'
)
returns table (
  id uuid,
  profile_id uuid,
  template_key text,
  field_data jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next_field_data jsonb;
begin
  if auth.uid() is null
    or not public.net_economy_current_user_can_edit_sheet_subject(
      'profile-sheet',
      p_profile_id
    )
  then
    raise exception 'ECONOMY_SHEET_EDIT_DENIED' using errcode = '42501';
  end if;

  perform public.net_economy_apply_sheet_field_requests(
    'profile-sheet',
    p_profile_id,
    coalesce(p_field_patch, '{}'::jsonb)
  );

  select
    (coalesce(sheet.field_data, '{}'::jsonb)
      - coalesce(p_removed_keys, '{}'::text[]))
      || coalesce(p_field_patch, '{}'::jsonb)
  into v_next_field_data
  from public.character_sheet_forms as sheet
  where sheet.profile_id = p_profile_id
  for update;
  if not found then
    raise exception 'ECONOMY_SHEET_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  update public.character_sheet_forms as sheet
  set
    template_key = p_template_key,
    field_data = v_next_field_data
  where sheet.profile_id = p_profile_id
    and (
      sheet.template_key is distinct from p_template_key
      or sheet.field_data is distinct from v_next_field_data
    )
  returning
    sheet.id,
    sheet.profile_id,
    sheet.template_key,
    sheet.field_data,
    sheet.updated_at;

  if not found then
    return query
    select
      sheet.id,
      sheet.profile_id,
      sheet.template_key,
      sheet.field_data,
      sheet.updated_at
    from public.character_sheet_forms as sheet
    where sheet.profile_id = p_profile_id;
  end if;
end;
$$;

-- Bounded selector payload for one already-visible sheet identity. It exposes
-- no history, yield configuration, payment identifier, or other identity's
-- balances. Merely reading this function never creates a VOX account.
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

  select count(*)
  into v_identity_count
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = requested_subject_kind
    and identity_link.subject_id = requested_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';
  if v_identity_count = 0 then
    return jsonb_build_object(
      'server_now', timezone('utc', clock_timestamp()),
      'vlt', null,
      'vox_bank', null
    );
  end if;
  if v_identity_count > 1 then
    raise exception 'ECONOMY_SHEET_IDENTITY_AMBIGUOUS' using errcode = '23514';
  end if;

  select identity_link.id
  into v_identity_link_id
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = requested_subject_kind
    and identity_link.subject_id = requested_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  select *
  into v_vlt
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'VG';

  select *
  into v_vox
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'bank'
    and account.institution_id = '00000000-0000-0000-0000-00000000e100'::uuid
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
    ) end
  );
end;
$$;

-- Reconcile any cosmetic divergence created before bidirectional semantics
-- existed. The deployed wallet remains the source of truth at migration time;
-- this writes no ledger entry and changes no VG, Karma, or VOX balance.
do $$
declare
  v_previous_origin text := current_setting('app.net_economy_origin', true);
begin
  perform set_config('app.net_economy_origin', 'economy-mirror', true);

  update public.character_sheet_forms as sheet
  set field_data = jsonb_set(
    jsonb_set(
      coalesce(sheet.field_data, '{}'::jsonb),
      '{CASH}',
      to_jsonb(public.net_economy_cash_display(vg_wallet.balance_amount)),
      true
    ) - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
    '{KARMA}',
    to_jsonb(case
      when karma_wallet.id is null then '-'
      else public.net_economy_karma_display(karma_wallet.balance_amount)
    end),
    true
  )
  from public.net_identity_links as identity_link
  join public.net_economy_accounts as vg_wallet
    on vg_wallet.identity_link_id = identity_link.id
    and vg_wallet.account_kind = 'wallet'
    and vg_wallet.currency_code = 'VG'
  left join public.net_economy_accounts as karma_wallet
    on karma_wallet.identity_link_id = identity_link.id
    and karma_wallet.account_kind = 'wallet'
    and karma_wallet.currency_code = 'KARMA'
  where identity_link.subject_kind = 'profile-sheet'
    and identity_link.subject_id = sheet.profile_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
    and (
      sheet.field_data ->> 'CASH'
        is distinct from public.net_economy_cash_display(vg_wallet.balance_amount)
      or sheet.field_data ->> 'KARMA' is distinct from case
        when karma_wallet.id is null then '-'
        else public.net_economy_karma_display(karma_wallet.balance_amount)
      end
      or sheet.field_data ?| array['Karma', 'karma', 'K4rma', 'K4RMA']
    );

  update public.npc_cards as card
  set field_data = jsonb_set(
    jsonb_set(
      coalesce(card.field_data, '{}'::jsonb),
      '{CASH}',
      to_jsonb(public.net_economy_cash_display(vg_wallet.balance_amount)),
      true
    ) - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
    '{KARMA}',
    to_jsonb(case
      when karma_wallet.id is null then '-'
      else public.net_economy_karma_display(karma_wallet.balance_amount)
    end),
    true
  )
  from public.net_identity_links as identity_link
  join public.net_economy_accounts as vg_wallet
    on vg_wallet.identity_link_id = identity_link.id
    and vg_wallet.account_kind = 'wallet'
    and vg_wallet.currency_code = 'VG'
  left join public.net_economy_accounts as karma_wallet
    on karma_wallet.identity_link_id = identity_link.id
    and karma_wallet.account_kind = 'wallet'
    and karma_wallet.currency_code = 'KARMA'
  where identity_link.subject_kind = 'npc-card'
    and identity_link.subject_id = card.id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
    and (
      card.field_data ->> 'CASH'
        is distinct from public.net_economy_cash_display(vg_wallet.balance_amount)
      or card.field_data ->> 'KARMA' is distinct from case
        when karma_wallet.id is null then '-'
        else public.net_economy_karma_display(karma_wallet.balance_amount)
      end
      or card.field_data ?| array['Karma', 'karma', 'K4rma', 'K4RMA']
    );

  update public.character_stats as character_stat
  set karma = karma_wallet.balance_amount::integer
  from public.net_identity_links as identity_link
  join public.net_economy_accounts as karma_wallet
    on karma_wallet.identity_link_id = identity_link.id
    and karma_wallet.account_kind = 'wallet'
    and karma_wallet.currency_code = 'KARMA'
  where identity_link.subject_kind = 'character'
    and identity_link.subject_id = character_stat.character_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
    and character_stat.karma is distinct from karma_wallet.balance_amount::integer;

  perform set_config(
    'app.net_economy_origin',
    coalesce(v_previous_origin, ''),
    true
  );
exception
  when others then
    perform set_config(
      'app.net_economy_origin',
      coalesce(v_previous_origin, ''),
      true
    );
    raise;
end;
$$;

comment on function public.net_economy_apply_sheet_absolute_balance(uuid, text, bigint, text, uuid) is
  'Internal absolute-balance sheet mutation. Locks one VLT wallet plus its currency clearing account and writes one balanced transaction when delta is nonzero.';
comment on function public.net_economy_apply_sheet_field_requests(text, uuid, jsonb) is
  'Internal patch interpreter. Applies intentional CASH/KARMA requests before any sheet row lock so all economy paths use wallet-to-sheet lock order.';
comment on function public.patch_npc_card_field_data_v2(uuid, jsonb, text[]) is
  'Authorized patch-save endpoint. Applies ledgered financial requests before locking the NPC row and returns canonical field data.';
comment on function public.patch_character_sheet_field_data_v2(uuid, jsonb, text[], text) is
  'Authorized patch-save endpoint applying ledgered financial requests before locking the current profile sheet and returning canonical field data.';
comment on function public.fetch_net_economy_sheet_account_sources(text, uuid) is
  'Bounded read-only VLT/VOX selector projection for one sheet identity already visible to the authenticated caller.';

revoke all on function public.net_economy_assert_balanced_transaction()
  from public, anon, authenticated;
revoke all on function public.net_economy_current_user_can_edit_sheet_subject(text, uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_current_user_can_view_sheet_subject(text, uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_parse_sheet_cash(text)
  from public, anon, authenticated;
revoke all on function public.net_economy_parse_sheet_karma(jsonb)
  from public, anon, authenticated;
revoke all on function public.net_economy_apply_sheet_absolute_balance(uuid, text, bigint, text, uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_apply_sheet_field_requests(text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.net_economy_enforce_cash_mirror()
  from public, anon, authenticated;
revoke all on function public.net_economy_sync_cash_mirror()
  from public, anon, authenticated;
revoke all on function public.net_economy_enforce_character_karma_mirror()
  from public, anon, authenticated;
revoke all on function public.save_character_stats_bidirectional_v2(
  uuid, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer, integer
)
  from public, anon;
grant execute on function public.save_character_stats_bidirectional_v2(
  uuid, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer, integer
)
  to authenticated;
revoke all on function public.patch_npc_card_field_data_v2(uuid, jsonb, text[])
  from public, anon;
grant execute on function public.patch_npc_card_field_data_v2(uuid, jsonb, text[])
  to authenticated;
revoke all on function public.patch_character_sheet_field_data_v2(uuid, jsonb, text[], text)
  from public, anon;
grant execute on function public.patch_character_sheet_field_data_v2(uuid, jsonb, text[], text)
  to authenticated;
revoke all on function public.fetch_net_economy_sheet_account_sources(text, uuid)
  from public, anon;
grant execute on function public.fetch_net_economy_sheet_account_sources(text, uuid)
  to authenticated;

commit;
