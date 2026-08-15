-- New Vega economy: character-sheet economy displays are read-only mirrors.
-- Run once after the deployed net-economy-sheet-bidirectional.sql migration.
--
-- This forward migration preserves historical sheet adjustment transactions,
-- but removes every authenticated sheet-save path that can create a new one.
-- VLT/VOX/economy RPCs remain the only balance mutation authority.

begin;

-- Keep the deployed signatures for compatibility, but fail closed if an old
-- or handcrafted client tries to call either internal financial helper.
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
begin
  raise exception 'ECONOMY_SHEET_MUTATION_DISABLED' using errcode = '0A000';
end;
$$;

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
begin
  raise exception 'ECONOMY_SHEET_MUTATION_DISABLED' using errcode = '0A000';
end;
$$;

-- Raw profile-sheet and NPC writes are presentation writes only. This is the
-- canonical server boundary: submitted CASH/Karma values are always replaced
-- by VLT wallet state, including '-' for an identity without a Karma profile.
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

  new.field_data := jsonb_set(
    coalesce(new.field_data, '{}'::jsonb),
    '{CASH}',
    to_jsonb(public.net_economy_cash_display(v_vg_account.balance_amount)),
    true
  );
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

-- Legacy character_stats Karma remains an economy mirror. The physical
-- column cannot represent NO KARMA, and playable legacy character identities
-- are enrolled by the already-deployed lifecycle helper. A raw write can
-- never choose a different reputation balance.
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

-- Preserve the public V2 save signatures, permissions, and canonical return
-- shapes. Economy keys are discarded from both patch and removal sets before
-- the sheet row is locked. The BEFORE trigger then writes authoritative
-- mirror values, so unrelated saves cannot replay stale local balances.
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

  v_safe_patch := p_field_patch
    - 'CASH' - 'KARMA' - 'Karma' - 'karma' - 'K4rma' - 'K4RMA';
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

  v_safe_patch := p_field_patch
    - 'CASH' - 'KARMA' - 'Karma' - 'karma' - 'K4rma' - 'K4RMA';
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

-- The legacy character save remains available for non-economy stats. Its
-- p_karma parameter is retained only for RPC compatibility and is ignored;
-- the BEFORE trigger supplies the authoritative wallet mirror.
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

  select account.balance_amount::integer
  into v_mirror_karma
  from public.net_identity_links as identity_link
  join public.net_economy_accounts as account
    on account.identity_link_id = identity_link.id
    and account.account_kind = 'wallet'
    and account.currency_code = 'KARMA'
  where identity_link.subject_kind = 'character'
    and identity_link.subject_id = p_character_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

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

-- Canonicalize any pre-existing visual divergence without ledger, audit, or
-- account writes. This intentionally makes the deployed VLT values win over a
-- stale sheet value such as 350vG when the wallet is 320vG.
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
  'Decommissioned compatibility stub. Character-sheet economy values are read-only and this function always rejects.';
comment on function public.net_economy_apply_sheet_field_requests(text, uuid, jsonb) is
  'Decommissioned compatibility stub. Sheet patches never create economy transactions.';
comment on function public.patch_npc_card_field_data_v2(uuid, jsonb, text[]) is
  'Authorized non-financial NPC patch endpoint. Discards economy keys and returns trigger-canonicalized field data.';
comment on function public.patch_character_sheet_field_data_v2(uuid, jsonb, text[], text) is
  'Authorized non-financial profile-sheet patch endpoint. Discards economy keys and returns trigger-canonicalized field data.';
comment on function public.save_character_stats_bidirectional_v2(
  uuid, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer, integer
) is
  'Compatibility save endpoint for non-economy character stats. Its Karma input is ignored and the authoritative wallet mirror wins.';

revoke all on function public.net_economy_apply_sheet_absolute_balance(uuid, text, bigint, text, uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_apply_sheet_field_requests(text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.net_economy_enforce_cash_mirror()
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

commit;
