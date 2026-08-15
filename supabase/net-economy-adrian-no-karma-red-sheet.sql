-- New Vega economy: Adrian ALTARA's no-Karma sheet remains visually red.
--
-- Run once after net-economy-sheet-karma-bidirectional.sql. This is a narrow
-- presentation exception for npc_cards.id 9f9873b5-89fd-40d5-9682-e20173b10e85:
-- '--' still means no Karma profile and never creates or changes a wallet.

begin;

-- Raw profile-sheet/NPC writes remain presentation-only. Every enrolled Karma
-- identity is canonicalized from its wallet; every non-enrolled identity is
-- canonicalized to '-', except the one stable Adrian NPC subject below.
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

-- The approved V2 sheet save still interprets numeric Karma only for an
-- existing wallet. Adrian's exact visual '--' token is mapped to the existing
-- no-profile parser state and can never be mistaken for numeric -2.
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
  v_adrian_subject_id constant uuid :=
    '9f9873b5-89fd-40d5-9682-e20173b10e85'::uuid;
  v_identity_link_id uuid;
  v_identity_count integer;
  v_karma_account public.net_economy_accounts%rowtype;
  v_parser_field_patch jsonb;
  v_karma_semantic jsonb;
  v_requested_karma bigint;
  v_key text;
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

  -- Keep the shared Karma parser unchanged. For this exact subject only, map
  -- the visual '--' sentinel to the parser's existing no-profile '-' semantic
  -- in a temporary copy. Other identities still reject '--' as malformed.
  v_parser_field_patch := requested_field_patch;
  if requested_subject_kind = 'npc-card'
    and requested_subject_id = v_adrian_subject_id
  then
    foreach v_key in array array['KARMA', 'Karma', 'karma', 'K4rma', 'K4RMA']
    loop
      if btrim(coalesce(v_parser_field_patch ->> v_key, '')) = '--' then
        v_parser_field_patch := jsonb_set(
          v_parser_field_patch,
          array[v_key],
          to_jsonb('-'::text),
          true
        );
      end if;
    end loop;
  end if;

  v_karma_semantic := public.net_economy_parse_sheet_karma(
    v_parser_field_patch
  );

  select count(*)
  into v_identity_count
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = requested_subject_kind
    and identity_link.subject_id = requested_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if v_identity_count = 0 then
    return case
      when requested_subject_kind = 'npc-card'
        and requested_subject_id = v_adrian_subject_id
      then '--'
      else '-'
    end;
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
    return case
      when requested_subject_kind = 'npc-card'
        and requested_subject_id = v_adrian_subject_id
      then '--'
      else '-'
    end;
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

-- Normalize only Adrian's current sheet presentation. The NOT EXISTS guard is
-- the authority boundary: if a Karma wallet ever exists, its numeric balance
-- remains canonical and this exception does nothing.
update public.npc_cards as card
set field_data = jsonb_set(
  coalesce(card.field_data, '{}'::jsonb)
    - 'Karma' - 'karma' - 'K4rma' - 'K4RMA',
  '{KARMA}',
  to_jsonb('--'::text),
  true
)
where card.id = '9f9873b5-89fd-40d5-9682-e20173b10e85'::uuid
  and exists (
    select 1
    from public.net_identity_links as identity_link
    where identity_link.subject_kind = 'npc-card'
      and identity_link.subject_id = card.id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
  )
  and not exists (
    select 1
    from public.net_identity_links as identity_link
    join public.net_economy_accounts as account
      on account.identity_link_id = identity_link.id
      and account.account_kind = 'wallet'
      and account.currency_code = 'KARMA'
    where identity_link.subject_kind = 'npc-card'
      and identity_link.subject_id = card.id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
  )
  and (
    card.field_data ->> 'KARMA' is distinct from '--'
    or card.field_data ?| array['Karma', 'karma', 'K4rma', 'K4RMA']
  );

comment on function public.net_economy_enforce_cash_mirror() is
  'Canonical VLT CASH/Karma sheet mirror. Adrian NPC 9f9873b5-89fd-40d5-9682-e20173b10e85 uses -- only while no Karma wallet exists.';
comment on function public.net_economy_apply_sheet_karma_request(text, uuid, jsonb) is
  'Internal Karma-only sheet request interpreter. Existing enrollment is required; Adrian uses -- as a no-profile red-sheet presentation sentinel.';

revoke all on function public.net_economy_enforce_cash_mirror()
  from public, anon, authenticated;
revoke all on function public.net_economy_apply_sheet_karma_request(text, uuid, jsonb)
  from public, anon, authenticated;

commit;
