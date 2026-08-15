-- New Vega economy: restore Karma-only bidirectional character-sheet sync.
-- Run once after the deployed net-economy-sheet-readonly.sql migration.
--
-- CASH and VOX BANK remain read-only sheet displays. The general sheet
-- financial helpers installed by the read-only migration remain fail-closed.

begin;

-- Apply one absolute Karma reputation request. This helper has no currency
-- argument and can never reach the VG wallet or VG clearing account.
create or replace function public.net_economy_apply_sheet_karma_absolute_balance(
  requested_identity_link_id uuid,
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
  v_wallet public.net_economy_accounts%rowtype;
  v_system public.net_economy_accounts%rowtype;
  v_system_id constant uuid := '00000000-0000-0000-0000-00000000e002'::uuid;
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
  if requested_identity_link_id is null
    or requested_absolute_balance is null
    or abs(requested_absolute_balance::numeric) > 1000000000
  then
    raise exception 'ECONOMY_SHEET_KARMA_INVALID' using errcode = '22003';
  end if;

  select *
  into v_wallet
  from public.net_economy_accounts as account
  where account.identity_link_id = requested_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'KARMA';
  if not found then
    raise exception 'ECONOMY_KARMA_NOT_AVAILABLE' using errcode = '22023';
  end if;

  -- Every sheet-origin Karma mutation follows the same global account lock
  -- order as payments and GM adjustments. The authoritative balance is reread
  -- only after both rows are locked.
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
    and account.currency_code = 'KARMA';

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

  insert into public.net_economy_transactions (
    transaction_kind,
    initiated_by_profile_id,
    request_scope,
    request_key,
    request_fingerprint,
    note,
    currency_code
  ) values (
    'sheet-karma-adjustment',
    v_actor,
    'sheet:' || v_actor::text,
    gen_random_uuid(),
    md5(
      'sheet-karma-absolute:' || v_wallet.id::text || ':'
      || requested_absolute_balance::text
    ),
    null,
    'KARMA'
  ) returning * into v_transaction;

  insert into public.net_economy_transaction_entries (
    transaction_id,
    account_id,
    amount,
    created_at
  ) values
    (v_transaction.id, v_wallet.id, v_delta, v_transaction.created_at),
    (v_transaction.id, v_system.id, -v_delta, v_transaction.created_at);

  -- Suppress the account trigger's intermediate sheet write. The bounded V2
  -- save RPC writes the canonical sheet row later in this same transaction,
  -- after the wallet locks, preserving wallet -> sheet lock direction.
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
    'economy.sheet.karma-adjust',
    'authoritative-sheet-edit-permission',
    'economy-transaction',
    v_transaction.id
  );

  return v_transaction.id;
end;
$$;

-- Interpret only an intentional Karma patch. An existing Karma wallet is
-- required; neither an owner nor a GM can enroll a NO-KARMA identity through
-- a sheet save. The approved Economy Control enrollment remains authoritative.
create or replace function public.net_economy_apply_sheet_karma_request(
  requested_subject_kind text,
  requested_subject_id uuid,
  requested_field_patch jsonb
)
returns text
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

  v_karma_semantic := public.net_economy_parse_sheet_karma(
    requested_field_patch
  );

  select count(*)
  into v_identity_count
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = requested_subject_kind
    and identity_link.subject_id = requested_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if v_identity_count = 0 then
    return '-';
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
  into v_karma_account
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'KARMA';

  if v_karma_account.id is null then
    return '-';
  end if;

  if v_karma_semantic ->> 'state' = 'numeric' then
    v_requested_karma := (v_karma_semantic ->> 'amount')::bigint;
    perform public.net_economy_apply_sheet_karma_absolute_balance(
      v_identity_link_id,
      v_requested_karma,
      requested_subject_kind,
      requested_subject_id
    );
  end if;

  select *
  into v_karma_account
  from public.net_economy_accounts as account
  where account.id = v_karma_account.id;

  return public.net_economy_karma_display(v_karma_account.balance_amount);
end;
$$;

-- V2 profile/NPC patch endpoints remain the only sheet RPCs allowed to
-- interpret Karma. CASH and every raw Karma alias are removed before the row
-- merge; a canonical KARMA value is inserted only after the Karma helper has
-- completed its wallet-first transaction work.
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
  v_has_karma_request boolean;
  v_canonical_karma text;
  v_safe_patch jsonb;
  v_safe_removed_keys text[];
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
  if p_field_patch is null or jsonb_typeof(p_field_patch) <> 'object' then
    raise exception 'ECONOMY_SHEET_PATCH_INVALID' using errcode = '22023';
  end if;

  v_has_karma_request := p_field_patch
    ?| array['KARMA', 'Karma', 'karma', 'K4rma', 'K4RMA'];
  if v_has_karma_request then
    v_canonical_karma := public.net_economy_apply_sheet_karma_request(
      'npc-card',
      p_npc_id,
      p_field_patch
    );
  end if;

  v_safe_patch := p_field_patch
    - 'CASH' - 'KARMA' - 'Karma' - 'karma' - 'K4rma' - 'K4RMA';
  if v_has_karma_request then
    v_safe_patch := jsonb_set(
      v_safe_patch,
      '{KARMA}',
      to_jsonb(v_canonical_karma),
      true
    );
  end if;

  select coalesce(array_agg(key_name order by ordinal), '{}'::text[])
  into v_safe_removed_keys
  from unnest(coalesce(p_removed_keys, '{}'::text[]))
    with ordinality as removed(key_name, ordinal)
  where key_name <> all (
    array['CASH', 'KARMA', 'Karma', 'karma', 'K4rma', 'K4RMA']::text[]
  );

  select
    (coalesce(card.field_data, '{}'::jsonb) - v_safe_removed_keys)
      || v_safe_patch
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
  v_has_karma_request boolean;
  v_canonical_karma text;
  v_safe_patch jsonb;
  v_safe_removed_keys text[];
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
  if p_field_patch is null or jsonb_typeof(p_field_patch) <> 'object' then
    raise exception 'ECONOMY_SHEET_PATCH_INVALID' using errcode = '22023';
  end if;

  v_has_karma_request := p_field_patch
    ?| array['KARMA', 'Karma', 'karma', 'K4rma', 'K4RMA'];
  if v_has_karma_request then
    v_canonical_karma := public.net_economy_apply_sheet_karma_request(
      'profile-sheet',
      p_profile_id,
      p_field_patch
    );
  end if;

  v_safe_patch := p_field_patch
    - 'CASH' - 'KARMA' - 'Karma' - 'karma' - 'K4rma' - 'K4RMA';
  if v_has_karma_request then
    v_safe_patch := jsonb_set(
      v_safe_patch,
      '{KARMA}',
      to_jsonb(v_canonical_karma),
      true
    );
  end if;

  select coalesce(array_agg(key_name order by ordinal), '{}'::text[])
  into v_safe_removed_keys
  from unnest(coalesce(p_removed_keys, '{}'::text[]))
    with ordinality as removed(key_name, ordinal)
  where key_name <> all (
    array['CASH', 'KARMA', 'Karma', 'karma', 'K4rma', 'K4RMA']::text[]
  );

  select
    (coalesce(sheet.field_data, '{}'::jsonb) - v_safe_removed_keys)
      || v_safe_patch
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

-- Legacy campaign-character saves regain Karma requests only. The wallet and
-- Karma clearing account are locked before character_stats is upserted; the
-- existing BEFORE trigger still canonicalizes the physical mirror column.
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
  v_karma_account public.net_economy_accounts%rowtype;
  v_mirror_karma integer;
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
    into v_karma_account
    from public.net_economy_accounts as account
    where account.identity_link_id = v_identity_link_id
      and account.account_kind = 'wallet'
      and account.currency_code = 'KARMA';

    if v_karma_account.id is not null then
      perform public.net_economy_apply_sheet_karma_absolute_balance(
        v_identity_link_id,
        p_karma::bigint,
        'character',
        p_character_id
      );

      select account.balance_amount::integer
      into v_mirror_karma
      from public.net_economy_accounts as account
      where account.id = v_karma_account.id;
    end if;
  end if;

  if v_mirror_karma is null then
    select character_stat.karma
    into v_mirror_karma
    from public.character_stats as character_stat
    where character_stat.character_id = p_character_id;
  end if;
  v_mirror_karma := coalesce(v_mirror_karma, 0);

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
    v_mirror_karma,
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

comment on function public.net_economy_apply_sheet_karma_absolute_balance(uuid, bigint, text, uuid) is
  'Internal Karma-only absolute sheet adjustment. Locks the Karma wallet and Karma clearing account before writing one balanced transaction.';
comment on function public.net_economy_apply_sheet_karma_request(text, uuid, jsonb) is
  'Internal Karma-only sheet request interpreter. Existing enrollment is required; CASH is outside this path.';
comment on function public.patch_npc_card_field_data_v2(uuid, jsonb, text[]) is
  'Authorized NPC patch endpoint. CASH remains read-only; enrolled Karma requests are ledgered before the NPC row lock.';
comment on function public.patch_character_sheet_field_data_v2(uuid, jsonb, text[], text) is
  'Authorized profile-sheet patch endpoint. CASH remains read-only; enrolled Karma requests are ledgered before the sheet row lock.';
comment on function public.save_character_stats_bidirectional_v2(
  uuid, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer, integer
) is
  'Authorized legacy-character save. Enrolled Karma is ledgered wallet-first; other stats retain their existing save behavior.';

revoke all on function public.net_economy_apply_sheet_karma_absolute_balance(uuid, bigint, text, uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_apply_sheet_karma_request(text, uuid, jsonb)
  from public, anon, authenticated;

revoke all on function public.patch_npc_card_field_data_v2(uuid, jsonb, text[])
  from public, anon;
grant execute on function public.patch_npc_card_field_data_v2(uuid, jsonb, text[])
  to authenticated;
revoke all on function public.patch_character_sheet_field_data_v2(uuid, jsonb, text[], text)
  from public, anon;
grant execute on function public.patch_character_sheet_field_data_v2(uuid, jsonb, text[], text)
  to authenticated;
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

commit;
