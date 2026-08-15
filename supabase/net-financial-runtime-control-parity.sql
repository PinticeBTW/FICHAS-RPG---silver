-- Financial runtime-control parity for VLT, VOX BANK, SHNEIDER BANK, and
-- ALTARA BANK. The authenticated actor remains the ledger initiator/audit
-- actor; every personal product is comparison-bound to the exact effective
-- runtime identity. No balances, entries, transactions, adoption rows, or
-- currency assignments are rewritten by this migration.

begin;

do $$
declare
  v_required regprocedure;
  v_function regprocedure;
  v_definition text;
  v_lock_position integer;
  v_assert_position integer;
  v_post_lock_assert_position integer;
  v_shape_pattern text :=
    'and identity_link\.identity_kind = ''player''[[:space:]]+and identity_link\.playability = ''playable''';
begin
  if to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.assert_net_effective_runtime_identity(uuid,text,boolean)') is null
    or to_regprocedure('public.net_runtime_action_context(uuid)') is null
    or to_regprocedure('public.current_user_is_net_system_admin()') is null
    or to_regprocedure('public.net_economy_ensure_wallet_currency_for_link(uuid,text)') is null
    or to_regprocedure('public.net_economy_identity_history_page(uuid,timestamptz,uuid,integer)') is null
    or to_regprocedure('public.net_economy_wallet_bundle_payload(uuid,timestamptz,uuid,integer)') is null
    or to_regprocedure('public.net_economy_adjust_wallet_currency(uuid,text,text,bigint,text,uuid,boolean)') is null
    or to_regprocedure('public.enable_net_economy_gm_karma_profile(text)') is null
    or to_regprocedure('public.net_economy_transfer_bank_payment(uuid,text,bigint,uuid)') is null
    or to_regprocedure('public.net_economy_lock_altara_bank_authority(uuid,uuid)') is null
    or to_regprocedure('public.net_economy_altara_bank_payload(uuid,timestamptz,uuid,integer)') is null
    or to_regprocedure('public.transfer_net_economy_altara_bank_payment(uuid,text,bigint,uuid,uuid)') is null
    or to_regprocedure('public.net_economy_sync_cash_mirror()') is null
    or to_regprocedure('public.patch_npc_card_field_data_v2(uuid,jsonb,text[])') is null
    or to_regprocedure('public.patch_character_sheet_field_data_v2(uuid,jsonb,text[],text)') is null
    or to_regprocedure('public.save_character_stats_bidirectional_v2(uuid,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)') is null
    or to_regclass('public.net_economy_altara_bank_multicurrency_transitions') is null
    or to_regclass('public.net_economy_altara_bank_adoptions') is null
  then
    raise exception 'FINANCIAL_RUNTIME_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;

  -- The deployed multicurrency opener must be the active ALTARA contract. It
  -- creates the assigned local-currency account and must not invoke legacy VG
  -- adoption. Fail closed instead of adapting an older production state.
  v_required := 'public.net_economy_open_altara_bank_for_link(uuid)'::regprocedure;
  if position('net_economy_identity_currency_assignments' in lower(pg_get_functiondef(v_required::oid))) = 0
    or position('net_economy_altara_bank_adoptions' in lower(pg_get_functiondef(v_required::oid))) > 0
  then
    raise exception 'FINANCIAL_RUNTIME_ALTARA_MULTICURRENCY_REQUIRED'
      using errcode = '55000';
  end if;

  -- The deployed ALTARA authority lock is deliberately identity-shape
  -- neutral. It serializes the exact identities, OS assignments/families,
  -- service scope, institution, sender install, actor profile, and the
  -- authoritative active-identity or GM-persona row. The final context
  -- assertion in each caller decides player versus network-NPC eligibility.
  v_definition := lower(pg_get_functiondef(
    'public.net_economy_lock_altara_bank_authority(uuid,uuid)'::regprocedure::oid
  ));
  if position('net_identity_links' in v_definition) = 0
    or position('net_identity_os_assignments' in v_definition) = 0
    or position('net_os_families' in v_definition) = 0
    or position('net_os_service_scopes' in v_definition) = 0
    or position('net_identity_app_installs' in v_definition) = 0
    or position('net_economy_institutions' in v_definition) = 0
    or position('net_gm_persona_sessions' in v_definition) = 0
    or position('net_active_identities' in v_definition) = 0
    or position('for share' in v_definition) = 0
    or position('identity_kind = ''player''' in v_definition) > 0
    or position('playability = ''playable''' in v_definition) > 0
  then
    raise exception 'FINANCIAL_RUNTIME_ALTARA_AUTHORITY_LOCK_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  for v_function in
    select signature
    from (values
      ('public.net_economy_open_altara_bank_for_link(uuid)'::regprocedure),
      ('public.fetch_net_economy_altara_bank(uuid,timestamptz,uuid,integer)'::regprocedure),
      ('public.search_net_economy_altara_bank_payees(uuid,text,integer)'::regprocedure),
      ('public.quote_net_economy_altara_bank_payment(uuid,text,bigint)'::regprocedure),
      ('public.transfer_net_economy_altara_bank_payment(uuid,text,bigint,uuid,uuid)'::regprocedure)
    ) as reviewed(signature)
  loop
    v_definition := lower(pg_get_functiondef(v_function::oid));
    v_lock_position := position(
      'net_economy_lock_altara_bank_authority' in v_definition
    );
    v_assert_position := position(
      'net_economy_assert_altara_bank_player_context' in v_definition
    );
    v_post_lock_assert_position := case
      when v_lock_position > 0 then position(
        'net_economy_assert_altara_bank_player_context'
        in substring(
          v_definition
          from v_lock_position
            + char_length('net_economy_lock_altara_bank_authority')
        )
      )
      else 0
    end;
    if v_lock_position = 0
      or v_assert_position = 0
      or v_post_lock_assert_position = 0
    then
      raise exception 'FINANCIAL_RUNTIME_ALTARA_CALL_GRAPH_REVIEW_REQUIRED: %',
        v_function using errcode = '55000';
    end if;
  end loop;

  v_definition := lower(pg_get_functiondef(
    'public.open_net_economy_altara_bank(uuid)'::regprocedure::oid
  ));
  v_assert_position := position(
    'net_economy_assert_altara_bank_player_context' in v_definition
  );
  v_lock_position := position(
    'net_economy_open_altara_bank_for_link' in v_definition
  );
  if v_assert_position = 0
    or v_lock_position = 0
    or v_assert_position >= v_lock_position
  then
    raise exception 'FINANCIAL_RUNTIME_ALTARA_OPEN_GRAPH_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  -- Economy-wide administrative revision visibility is limited to the real
  -- GM System workspace. Any TAKE CONTROL, ACT AS, INSPECT, or compromised
  -- persona row makes this helper false, leaving only exact-runtime account
  -- visibility in the revision predicate.
  v_definition := lower(pg_get_functiondef(
    'public.current_user_is_net_system_admin()'::regprocedure::oid
  ));
  if position('net_gm_persona_sessions' in v_definition) = 0
    or position('gm_session.mode <> ''none''' in v_definition) = 0
    or position('not exists' in v_definition) = 0
  then
    raise exception 'FINANCIAL_RUNTIME_SYSTEM_ADMIN_SCOPE_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  -- Prove the existing Karma interpreter/worker/trigger graph before touching
  -- any financial authority. These objects are intentionally not replaced.
  if position(
      'net_economy_apply_sheet_karma_absolute_balance'
      in lower(pg_get_functiondef(
        'public.net_economy_apply_sheet_karma_request(text,uuid,jsonb)'::regprocedure::oid
      ))
    ) = 0
    or position(
      'net_identity_link_can_access_service'
      in lower(pg_get_functiondef(
        'public.net_economy_apply_sheet_karma_request(text,uuid,jsonb)'::regprocedure::oid
      ))
    ) = 0
    or position(
      'net_economy_apply_sheet_karma_absolute_balance_unscoped'
      in lower(pg_get_functiondef(
        'public.net_economy_apply_sheet_karma_absolute_balance(uuid,bigint,text,uuid)'::regprocedure::oid
      ))
    ) = 0
    or position(
      '9f9873b5-89fd-40d5-9682-e20173b10e85'
      in lower(pg_get_functiondef(
        'public.net_economy_apply_sheet_karma_request(text,uuid,jsonb)'::regprocedure::oid
      ))
    ) = 0
    or position(
      'net_economy_apply_sheet_karma_request'
      in lower(pg_get_functiondef(
        'public.patch_npc_card_field_data_v2(uuid,jsonb,text[])'::regprocedure::oid
      ))
    ) = 0
    or position(
      'net_economy_apply_sheet_karma_request'
      in lower(pg_get_functiondef(
        'public.patch_character_sheet_field_data_v2(uuid,jsonb,text[],text)'::regprocedure::oid
      ))
    ) = 0
    or position(
      'net_economy_apply_sheet_karma_absolute_balance'
      in lower(pg_get_functiondef(
        'public.save_character_stats_bidirectional_v2(uuid,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)'::regprocedure::oid
      ))
    ) = 0
    or not exists (
      select 1 from pg_trigger as trigger_row
      where trigger_row.tgrelid = 'public.character_sheet_forms'::regclass
        and trigger_row.tgname = 'character_sheet_forms_enforce_economy_cash'
        and not trigger_row.tgisinternal
        and trigger_row.tgfoid = 'public.net_economy_enforce_cash_mirror()'::regprocedure
        and pg_get_triggerdef(trigger_row.oid) ilike '%before insert or update of field_data%'
    )
    or not exists (
      select 1 from pg_trigger as trigger_row
      where trigger_row.tgrelid = 'public.npc_cards'::regclass
        and trigger_row.tgname = 'npc_cards_enforce_economy_cash'
        and not trigger_row.tgisinternal
        and trigger_row.tgfoid = 'public.net_economy_enforce_cash_mirror()'::regprocedure
        and pg_get_triggerdef(trigger_row.oid) ilike '%before insert or update of field_data%'
    )
    or not exists (
      select 1 from pg_trigger as trigger_row
      where trigger_row.tgrelid = 'public.net_economy_accounts'::regclass
        and trigger_row.tgname = 'net_economy_accounts_sync_cash'
        and not trigger_row.tgisinternal
        and trigger_row.tgfoid = 'public.net_economy_sync_cash_mirror()'::regprocedure
        and pg_get_triggerdef(trigger_row.oid) ilike '%after update of balance_amount%'
    )
    or not exists (
      select 1 from pg_trigger as trigger_row
      where trigger_row.tgrelid = 'public.character_stats'::regclass
        and trigger_row.tgname = 'character_stats_enforce_economy_karma'
        and not trigger_row.tgisinternal
        and pg_get_triggerdef(trigger_row.oid) ilike '%before insert or update of karma%'
    )
    or not exists (
      select 1 from pg_trigger as trigger_row
      where trigger_row.tgrelid = 'public.character_stats'::regclass
        and trigger_row.tgname = 'character_stats_ensure_economy_karma'
        and not trigger_row.tgisinternal
        and pg_get_triggerdef(trigger_row.oid) ilike '%after insert or update of karma%'
    )
  then
    raise exception 'FINANCIAL_RUNTIME_KARMA_SHEET_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  -- Classify every deployed CASH-source shape occurrence before replacing the
  -- reviewed functions explicitly below. The enforcement trigger's two
  -- occurrences feed both CASH and Karma (therefore require a split); the
  -- sync helper's one occurrence is CASH-only; the source RPC's two
  -- occurrences are read-only account-source resolution.
  v_definition := lower(pg_get_functiondef(
    'public.net_economy_enforce_cash_mirror()'::regprocedure::oid
  ));
  if regexp_count(v_definition, v_shape_pattern, 1, 'i') <> 2
    or position('v_cash_account' in v_definition) = 0
    or position('v_karma_account' in v_definition) = 0
    or position('v_adrian_subject_id' in v_definition) = 0
    or position('net_economy_karma_display' in v_definition) = 0
    or position('assignment.primary_os_id' in v_definition) = 0
  then
    raise exception 'FINANCIAL_RUNTIME_CASH_ENFORCER_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  v_definition := lower(pg_get_functiondef(
    'public.net_economy_sync_identity_cash_mirror(uuid)'::regprocedure::oid
  ));
  if regexp_count(v_definition, v_shape_pattern, 1, 'i') <> 1
    or position('assignment.primary_os_id' in v_definition) = 0
    or position('''{cash}''' in v_definition) = 0
    or position('''{karma}''' in v_definition) > 0
    or position('net_economy_apply_sheet_karma' in v_definition) > 0
  then
    raise exception 'FINANCIAL_RUNTIME_CASH_SYNC_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  v_definition := lower(pg_get_functiondef(
    'public.fetch_net_economy_sheet_account_sources(text,uuid)'::regprocedure::oid
  ));
  if regexp_count(v_definition, v_shape_pattern, 1, 'i') <> 2
    or position('''vlt''' in v_definition) = 0
    or position('''vox_bank''' in v_definition) = 0
    or position('''shneider_bank''' in v_definition) = 0
    or position('''altara_bank''' in v_definition) = 0
    or position('net_economy_apply_sheet_karma' in v_definition) > 0
  then
    raise exception 'FINANCIAL_RUNTIME_CASH_SOURCE_RPC_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

-- This predicate is created before the source-preserving function rewrites
-- below so each replacement can resolve it during CREATE OR REPLACE.
create or replace function public.net_economy_identity_is_runtime_financial_candidate(
  requested_identity_link_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.net_identity_links as identity_link
    where identity_link.id = requested_identity_link_id
      and (
        (identity_link.identity_kind = 'player' and identity_link.playability = 'playable')
        or
        (identity_link.identity_kind = 'npc' and identity_link.playability = 'non-playable')
      )
  );
$$;

-- Karma eligibility is intentionally narrower than general runtime finance.
-- A network NPC may own/use a VG wallet, but an accidental historical KARMA
-- row never makes that NPC Karma-enrolled or mutable.
create or replace function public.net_economy_identity_can_use_karma(
  requested_identity_link_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.net_identity_links as identity_link
    where identity_link.id = requested_identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
  );
$$;

-- These are reviewed, explicit replacements of the deployed multicurrency
-- CASH projection functions. The old regexp matched two predicates in the
-- enforcement trigger which also selected the Karma mirror; replacing those
-- predicates globally would have made an accidental NPC Karma row
-- authoritative. CASH now accepts the exact runtime financial identity shape,
-- while Karma remains player/playable-only and Adrian's exact '--' sentinel is
-- preserved.
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
    and public.net_economy_identity_is_runtime_financial_candidate(
      identity_link.id
    );
  if v_identity_count = 0 then
    return new;
  end if;
  if v_identity_count > 1 then
    raise exception 'ECONOMY_SHEET_IDENTITY_AMBIGUOUS' using errcode = '23514';
  end if;

  select identity_link.id, assignment.primary_os_id,
    currency_assignment.currency_code
  into v_identity_link_id, v_primary_os_id, v_home_currency_code
  from public.net_identity_links as identity_link
  left join public.net_identity_os_assignments as assignment
    on assignment.identity_link_id = identity_link.id
  left join public.net_economy_identity_currency_assignments as currency_assignment
    on currency_assignment.identity_link_id = identity_link.id
  where identity_link.subject_kind = tg_argv[0]
    and identity_link.subject_id = v_subject_id
    and public.net_economy_identity_is_runtime_financial_candidate(
      identity_link.id
    );

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

  if public.net_economy_identity_can_use_karma(v_identity_link_id) then
    select * into v_karma_account
    from public.net_economy_accounts as account
    where account.identity_link_id = v_identity_link_id
      and account.account_kind = 'wallet'
      and account.currency_code = 'KARMA';
  end if;

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
    and public.net_economy_identity_is_runtime_financial_candidate(
      identity_link.id
    );
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

-- Defense in depth for the existing account-balance AFTER trigger: even a
-- privileged/manual change to a preserved accidental NPC Karma row must not
-- turn that row into the NPC card's authoritative Karma presentation.
do $$
declare
  v_definition text;
  v_old text := $old$
  if new.account_kind <> 'wallet' or new.currency_code <> 'KARMA' then
    return new;
  end if;

  v_display := public.net_economy_karma_display(new.balance_amount);
$old$;
  v_new text := $new$
  if new.account_kind <> 'wallet' or new.currency_code <> 'KARMA' then
    return new;
  end if;
  if not public.net_economy_identity_can_use_karma(new.identity_link_id) then
    return new;
  end if;

  v_display := public.net_economy_karma_display(new.balance_amount);
$new$;
begin
  v_definition := pg_get_functiondef(
    'public.net_economy_sync_cash_mirror()'::regprocedure::oid
  );
  if position(v_old in v_definition) = 0
    or position(v_old in substr(v_definition, position(v_old in v_definition) + 1)) > 0
  then
    raise exception 'FINANCIAL_RUNTIME_KARMA_MIRROR_SOURCE_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
  execute replace(v_definition, v_old, v_new);
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
    and public.net_economy_identity_is_runtime_financial_candidate(
      identity_link.id
    );
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
    and public.net_economy_identity_is_runtime_financial_candidate(
      identity_link.id
    );
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

-- Exact-identity public VLT boundaries. The old signatures remain internal
-- compatibility workers and lose authenticated execution below.
create or replace function public.fetch_net_economy_wallet(
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
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'vlt', false
  );
  return public.fetch_net_economy_wallet(
    requested_cursor_at, requested_cursor_id, requested_limit
  );
end;
$$;

create or replace function public.fetch_net_economy_wallet_v2(
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
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'vlt', false
  );
  return public.fetch_net_economy_wallet_v2(
    requested_cursor_at, requested_cursor_id, requested_limit
  );
end;
$$;

create or replace function public.search_net_economy_payees(
  requested_expected_identity_link_id uuid,
  requested_query text,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'vlt', false
  );
  return public.search_net_economy_payees(requested_query, requested_limit);
end;
$$;

create or replace function public.transfer_net_economy_wallet(
  requested_expected_identity_link_id uuid,
  requested_payment_identifier text,
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
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'vlt', false
  );
  return public.transfer_net_economy_wallet(
    requested_payment_identifier, requested_amount,
    requested_note, requested_request_key
  );
end;
$$;

create or replace function public.transfer_net_economy_wallet_v2(
  requested_expected_identity_link_id uuid,
  requested_payment_identifier text,
  requested_currency_code text,
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
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'vlt', false
  );
  return public.transfer_net_economy_wallet_v2(
    requested_payment_identifier, requested_currency_code, requested_amount,
    requested_note, requested_request_key
  );
end;
$$;

-- Exact-identity optional-bank boundaries. Installation is part of the
-- personal app authority; receiving into an existing eligible active account
-- remains independent of launcher installation, as in ALTARA BANK.
create or replace function public.fetch_net_economy_vox_bank(
  requested_expected_identity_link_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'vox-bank', true
  );
  return public.fetch_net_economy_vox_bank(
    requested_cursor_at, requested_cursor_id, requested_limit
  );
end;
$$;

create or replace function public.open_net_economy_vox_bank(
  requested_expected_identity_link_id uuid
)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'vox-bank', true
  );
  return public.open_net_economy_vox_bank();
end;
$$;

create or replace function public.claim_net_economy_vox_bank_yield(
  requested_expected_identity_link_id uuid,
  requested_request_key uuid
)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'vox-bank', true
  );
  return public.claim_net_economy_vox_bank_yield(requested_request_key);
end;
$$;

create or replace function public.search_net_economy_vox_bank_payees(
  requested_expected_identity_link_id uuid,
  requested_query text,
  requested_limit integer default 12
)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'vox-bank', true
  );
  return public.search_net_economy_vox_bank_payees(requested_query, requested_limit);
end;
$$;

create or replace function public.transfer_net_economy_vox_bank_payment(
  requested_expected_identity_link_id uuid,
  requested_payment_identifier text,
  requested_amount bigint,
  requested_request_key uuid
)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'vox-bank', true
  );
  return public.transfer_net_economy_vox_bank_payment(
    requested_payment_identifier, requested_amount, requested_request_key
  );
end;
$$;

create or replace function public.transfer_net_economy_vox_bank(
  requested_expected_identity_link_id uuid,
  requested_direction text,
  requested_amount bigint,
  requested_request_key uuid
)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'vox-bank', true
  );
  perform public.assert_net_identity_service_access(
    requested_expected_identity_link_id, 'vlt'
  );
  return public.transfer_net_economy_vox_bank(
    requested_direction, requested_amount, requested_request_key
  );
end;
$$;

create or replace function public.fetch_net_economy_shneider_bank(
  requested_expected_identity_link_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'shneider-bank', true
  );
  return public.fetch_net_economy_shneider_bank(
    requested_cursor_at, requested_cursor_id, requested_limit
  );
end;
$$;

create or replace function public.open_net_economy_shneider_bank(
  requested_expected_identity_link_id uuid
)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'shneider-bank', true
  );
  return public.open_net_economy_shneider_bank();
end;
$$;

create or replace function public.search_net_economy_shneider_bank_payees(
  requested_expected_identity_link_id uuid,
  requested_query text,
  requested_limit integer default 12
)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'shneider-bank', true
  );
  return public.search_net_economy_shneider_bank_payees(requested_query, requested_limit);
end;
$$;

create or replace function public.transfer_net_economy_shneider_bank_payment(
  requested_expected_identity_link_id uuid,
  requested_payment_identifier text,
  requested_amount bigint,
  requested_request_key uuid
)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'shneider-bank', true
  );
  return public.transfer_net_economy_shneider_bank_payment(
    requested_payment_identifier, requested_amount, requested_request_key
  );
end;
$$;

create or replace function public.transfer_net_economy_shneider_bank(
  requested_expected_identity_link_id uuid,
  requested_direction text,
  requested_amount bigint,
  requested_request_key uuid
)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id, 'shneider-bank', true
  );
  perform public.assert_net_identity_service_access(
    requested_expected_identity_link_id, 'vlt'
  );
  return public.transfer_net_economy_shneider_bank(
    requested_direction, requested_amount, requested_request_key
  );
end;
$$;

-- Legacy VLT/independent-bank workers write the correct authenticated actor
-- but predate persona-aware audit fields. Normalize only successful personal
-- GM-runtime rows. Any context/resource mismatch aborts and rolls back the
-- entire ledger mutation; normal-player and explicit GM-admin rows are intact.
create or replace function public.normalize_net_runtime_financial_audit()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.app_role;
  v_identity_link_id uuid;
  v_context record;
begin
  if new.action_mode <> 'owner'
    or new.action_type not in (
      'economy.wallet.transfer',
      'economy.vox-bank.open',
      'economy.vox-bank.deposit',
      'economy.vox-bank.withdraw',
      'economy.vox-bank.yield.claim',
      'economy.shneider-bank.open',
      'economy.shneider-bank.deposit',
      'economy.shneider-bank.withdraw',
      'economy.bank.transfer'
    )
  then
    return new;
  end if;

  select profile.role into v_role
  from public.profiles as profile
  where profile.id = new.authenticated_actor_profile_id;
  if v_role is distinct from 'gm'::public.app_role then return new; end if;

  v_identity_link_id := public.current_net_effective_runtime_identity_link_id();
  if v_identity_link_id is null then
    raise exception 'ECONOMY_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;

  if new.resource_type = 'economy-account' then
    if not exists (
      select 1 from public.net_economy_accounts as account
      where account.id = new.resource_id
        and account.identity_link_id = v_identity_link_id
    ) then
      raise exception 'ECONOMY_AUDIT_RESOURCE_CONTEXT_CHANGED' using errcode = '42501';
    end if;
  elsif new.resource_type = 'economy-transaction' then
    if not exists (
      select 1
      from public.net_economy_transaction_entries as entry
      join public.net_economy_accounts as account on account.id = entry.account_id
      where entry.transaction_id = new.resource_id
        and account.identity_link_id = v_identity_link_id
    ) then
      raise exception 'ECONOMY_AUDIT_RESOURCE_CONTEXT_CHANGED' using errcode = '42501';
    end if;
  else
    raise exception 'ECONOMY_AUDIT_RESOURCE_CONTEXT_CHANGED' using errcode = '42501';
  end if;

  select * into v_context
  from public.net_runtime_action_context(v_identity_link_id);
  if v_context.action_mode is null then
    raise exception 'ECONOMY_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;

  new.action_mode := v_context.action_mode;
  new.authorization_basis := v_context.authorization_basis;
  new.persona_subject_kind := v_context.persona_subject_kind;
  new.persona_subject_id := v_context.persona_subject_id;
  return new;
end;
$$;

drop trigger if exists net_action_audit_normalize_runtime_finance
  on public.net_action_audit;
create trigger net_action_audit_normalize_runtime_finance
before insert on public.net_action_audit
for each row execute procedure public.normalize_net_runtime_financial_audit();

-- One existing Economy Realtime table/channel continues to serve all account
-- kinds. GM System retains administrative visibility; personal visibility is
-- exact runtime identity + current service eligibility, never broad GM role.
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
      public.current_user_is_net_system_admin()
      or exists (
        select 1
        from public.net_economy_accounts as account
        where account.id = requested_account_id
          and account.identity_link_id = public.current_net_effective_runtime_identity_link_id()
          and public.net_economy_identity_is_runtime_financial_candidate(account.identity_link_id)
          and case
            when account.account_kind = 'wallet'
              and (
                account.currency_code = 'VG'
                or (
                  account.currency_code = 'KARMA'
                  and public.net_economy_identity_can_use_karma(
                    account.identity_link_id
                  )
                )
              )
              then public.net_identity_link_can_access_service(
                account.identity_link_id,
                'vlt'
              )
            when account.account_kind = 'bank'
              and account.institution_id = '00000000-0000-0000-0000-00000000e100'::uuid
              then public.net_identity_link_can_access_service(account.identity_link_id, 'vox-bank')
            when account.account_kind = 'bank'
              and account.institution_id = '00000000-0000-0000-0000-00000000e101'::uuid
              then public.net_identity_link_can_access_service(account.identity_link_id, 'shneider-bank')
            when account.account_kind = 'bank'
              and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
              then account.status = 'active'
                and account.currency_code = (
                  select assignment.currency_code
                  from public.net_economy_identity_currency_assignments as assignment
                  where assignment.identity_link_id = account.identity_link_id
                )
                and public.net_identity_link_can_access_service(account.identity_link_id, 'altara-bank')
            else false
          end
      )
    );
$$;

-- Internal/replaced boundaries stay private.
revoke all on function public.net_economy_identity_is_runtime_financial_candidate(uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_identity_can_use_karma(uuid)
  from public, anon, authenticated;
revoke all on function public.assert_net_economy_player_identity()
  from public, anon, authenticated;
revoke all on function public.net_economy_ensure_wallet_currency_for_link(uuid,text)
  from public, anon, authenticated;
revoke all on function public.net_economy_ensure_wallet_for_link(uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_identity_history_page(uuid,timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_wallet_bundle_payload(uuid,timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.net_economy_sync_cash_mirror()
  from public, anon, authenticated;
revoke all on function public.net_economy_search_bank_payees(uuid,text,integer)
  from public, anon, authenticated;
revoke all on function public.assert_net_vlt_payee_access(text)
  from public, anon, authenticated;
revoke all on function public.net_economy_lock_altara_bank_authority(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_assert_altara_bank_player_context(uuid)
  from public, anon, authenticated;
revoke all on function public.net_economy_audit_altara_bank_personal_action(uuid,text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.normalize_net_runtime_financial_audit()
  from public, anon, authenticated;

-- Retire every unbound personal PostgREST signature.
revoke all on function public.fetch_net_economy_wallet(timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_economy_wallet_v2(timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.search_net_economy_payees(text,integer)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_wallet(text,bigint,text,uuid)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_wallet_v2(text,text,bigint,text,uuid)
  from public, anon, authenticated;

revoke all on function public.fetch_net_economy_vox_bank(timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.open_net_economy_vox_bank()
  from public, anon, authenticated;
revoke all on function public.claim_net_economy_vox_bank_yield(uuid)
  from public, anon, authenticated;
revoke all on function public.search_net_economy_vox_bank_payees(text,integer)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_vox_bank_payment(text,bigint,uuid)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_vox_bank(text,bigint,uuid)
  from public, anon, authenticated;

revoke all on function public.fetch_net_economy_shneider_bank(timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.open_net_economy_shneider_bank()
  from public, anon, authenticated;
revoke all on function public.search_net_economy_shneider_bank_payees(text,integer)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_shneider_bank_payment(text,bigint,uuid)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_shneider_bank(text,bigint,uuid)
  from public, anon, authenticated;

-- Only exact-identity personal signatures are callable by the application.
revoke all on function public.fetch_net_economy_wallet(uuid,timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_economy_wallet_v2(uuid,timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.search_net_economy_payees(uuid,text,integer)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_wallet(uuid,text,bigint,text,uuid)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_wallet_v2(uuid,text,text,bigint,text,uuid)
  from public, anon, authenticated;

revoke all on function public.fetch_net_economy_vox_bank(uuid,timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.open_net_economy_vox_bank(uuid)
  from public, anon, authenticated;
revoke all on function public.claim_net_economy_vox_bank_yield(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.search_net_economy_vox_bank_payees(uuid,text,integer)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_vox_bank_payment(uuid,text,bigint,uuid)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_vox_bank(uuid,text,bigint,uuid)
  from public, anon, authenticated;

revoke all on function public.fetch_net_economy_shneider_bank(uuid,timestamptz,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.open_net_economy_shneider_bank(uuid)
  from public, anon, authenticated;
revoke all on function public.search_net_economy_shneider_bank_payees(uuid,text,integer)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_shneider_bank_payment(uuid,text,bigint,uuid)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_shneider_bank(uuid,text,bigint,uuid)
  from public, anon, authenticated;

grant execute on function public.fetch_net_economy_wallet(uuid,timestamptz,uuid,integer)
  to authenticated;
grant execute on function public.fetch_net_economy_wallet_v2(uuid,timestamptz,uuid,integer)
  to authenticated;
grant execute on function public.search_net_economy_payees(uuid,text,integer)
  to authenticated;
grant execute on function public.transfer_net_economy_wallet_v2(uuid,text,text,bigint,text,uuid)
  to authenticated;

grant execute on function public.fetch_net_economy_vox_bank(uuid,timestamptz,uuid,integer)
  to authenticated;
grant execute on function public.open_net_economy_vox_bank(uuid)
  to authenticated;
grant execute on function public.claim_net_economy_vox_bank_yield(uuid,uuid)
  to authenticated;
grant execute on function public.search_net_economy_vox_bank_payees(uuid,text,integer)
  to authenticated;
grant execute on function public.transfer_net_economy_vox_bank_payment(uuid,text,bigint,uuid)
  to authenticated;
grant execute on function public.transfer_net_economy_vox_bank(uuid,text,bigint,uuid)
  to authenticated;

grant execute on function public.fetch_net_economy_shneider_bank(uuid,timestamptz,uuid,integer)
  to authenticated;
grant execute on function public.open_net_economy_shneider_bank(uuid)
  to authenticated;
grant execute on function public.search_net_economy_shneider_bank_payees(uuid,text,integer)
  to authenticated;
grant execute on function public.transfer_net_economy_shneider_bank_payment(uuid,text,bigint,uuid)
  to authenticated;
grant execute on function public.transfer_net_economy_shneider_bank(uuid,text,bigint,uuid)
  to authenticated;

-- Keep the legacy internal name because the deployed ledger workers call it.
-- It is now comparison-only and GM-first through the effective-runtime
-- resolver. Transaction-locking/stale binding is done by every public wrapper.
create or replace function public.assert_net_economy_player_identity()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  v_identity_link_id := public.current_net_effective_runtime_identity_link_id();
  if v_identity_link_id is null
    or not public.net_economy_identity_is_runtime_financial_candidate(v_identity_link_id)
  then
    raise exception 'ECONOMY_ACTIVE_IDENTITY_REQUIRED' using errcode = '42501';
  end if;
  return v_identity_link_id;
end;
$$;

-- VLT is a VEIL system application. Its existing normal-player behavior
-- creates a zero VG wallet on first authoritative use. Extend only that VG
-- behavior to an eligible network NPC; Karma remains player-enrolment-only.
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

  select * into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id;

  if not found
    or not (
      (v_link.identity_kind = 'player' and v_link.playability = 'playable')
      or (
        v_link.identity_kind = 'npc'
        and v_link.playability = 'non-playable'
        and v_currency = 'VG'
      )
    )
  then
    raise exception 'ECONOMY_WALLET_IDENTITY_INVALID' using errcode = '22023';
  end if;

  -- Validate identity/currency eligibility before consulting an existing row.
  -- A historical or accidental NPC KARMA wallet remains stored but can never
  -- turn itself into usable authority merely by existing.
  select * into v_existing
  from public.net_economy_accounts as account
  where account.identity_link_id = requested_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = v_currency;
  if found then return v_existing; end if;

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
        || '-' || v_suffix
        || case when v_attempt > 0 then '-' || v_attempt::text else '' end;
    else
      v_identifier := null;
    end if;

    begin
      insert into public.net_economy_accounts (
        identity_link_id, account_kind, payment_identifier,
        currency_code, status, balance_amount
      ) values (
        v_link.id, 'wallet', v_identifier, v_currency, 'active', 0
      ) returning * into v_saved;

      insert into public.net_economy_wallet_realtime_state (account_id)
      values (v_saved.id)
      on conflict (account_id) do nothing;
      return v_saved;
    exception
      when unique_violation then
        select * into v_existing
        from public.net_economy_accounts as account
        where account.identity_link_id = requested_identity_link_id
          and account.account_kind = 'wallet'
          and account.currency_code = v_currency;
        if found then return v_existing; end if;
        if v_currency <> 'VG' then raise; end if;
        v_attempt := v_attempt + 1;
        if v_attempt > 99 then
          raise exception 'ECONOMY_PAYMENT_IDENTIFIER_UNAVAILABLE' using errcode = '23505';
        end if;
    end;
  end loop;
end;
$$;

create or replace function public.net_economy_ensure_wallet_for_link(
  requested_identity_link_id uuid
)
returns public.net_economy_accounts
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.net_economy_ensure_wallet_currency_for_link(
    requested_identity_link_id,
    'VG'
  );
$$;

-- Personal VLT V2 projection exposes Karma only for a player/playable
-- identity. Historical NPC Karma rows and their entries remain immutable in
-- the ledger but are not part of the NPC's usable wallet bundle.
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
      and (
        account.currency_code = 'VG'
        or (
          account.currency_code = 'KARMA'
          and public.net_economy_identity_can_use_karma(
            requested_identity_link_id
          )
        )
      )
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
        public.net_economy_identity_display_name(
          other_account.identity_link_id
        ) as display_name
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
      or (entry.created_at, entry.transaction_id)
        < (requested_cursor_at, requested_cursor_id)
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
  v_vg := public.net_economy_ensure_wallet_currency_for_link(
    requested_identity_link_id,
    'VG'
  );
  if public.net_economy_identity_can_use_karma(requested_identity_link_id) then
    select * into v_karma
    from public.net_economy_accounts as account
    where account.identity_link_id = requested_identity_link_id
      and account.account_kind = 'wallet'
      and account.currency_code = 'KARMA';
  end if;

  return jsonb_build_object(
    'identity', jsonb_build_object(
      'payment_identifier', v_vg.payment_identifier,
      'display_name', public.net_economy_identity_display_name(
        requested_identity_link_id
      )
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
  perform public.assert_net_identity_service_access(v_identity_link_id, 'vlt');
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
      select account.payment_identifier,
        public.net_economy_identity_display_name(account.identity_link_id) as display_name,
        exists (
          select 1 from public.net_economy_accounts as karma
          where karma.identity_link_id = account.identity_link_id
            and karma.account_kind = 'wallet'
            and karma.currency_code = 'KARMA'
            and karma.status = 'active'
            and public.net_economy_identity_can_use_karma(
              karma.identity_link_id
            )
        ) as karma_available
      from public.net_economy_accounts as account
      join public.net_identity_links as identity_link
        on identity_link.id = account.identity_link_id
      where account.identity_link_id <> v_identity_link_id
        and account.account_kind = 'wallet'
        and account.currency_code = 'VG'
        and account.status = 'active'
        and public.net_economy_identity_is_runtime_financial_candidate(identity_link.id)
        and public.net_identity_link_can_access_service(identity_link.id, 'vlt')
        and (
          account.payment_identifier like '%'
            || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
          or lower(public.net_economy_identity_display_name(identity_link.id))
            like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
        )
      order by display_name, account.payment_identifier
      limit v_limit
    ) as directory
  ), '[]'::jsonb);
end;
$$;

create or replace function public.assert_net_vlt_payee_access(
  requested_payment_identifier text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_target_identity_link_id uuid;
begin
  select account.identity_link_id into v_target_identity_link_id
  from public.net_economy_accounts as account
  where account.payment_identifier = lower(btrim(coalesce(requested_payment_identifier, '')))
    and account.account_kind = 'wallet'
    and account.currency_code = 'VG'
    and account.status = 'active'
    and public.net_economy_identity_is_runtime_financial_candidate(account.identity_link_id);

  if v_target_identity_link_id is null
    or not public.net_identity_link_can_access_service(v_target_identity_link_id, 'vlt')
  then
    raise exception 'ECONOMY_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;
end;
$$;

-- The deployed V2 worker already locks both currency accounts in UUID order.
-- Bind and SHARE-lock the exact recipient identity before those account locks,
-- so an OS reassignment cannot race the wrapper's eligibility check. The
-- transaction may deadlock-abort (and therefore fail closed) under opposite
-- simultaneous payments, but can never commit for a recipient whose identity
-- row changed underneath it.
do $$
declare
  v_definition text;
  v_sender_old text := $sender_old$
  if v_currency not in ('VG', 'KARMA') then
    raise exception 'ECONOMY_CURRENCY_INVALID' using errcode = '22023';
  end if;
$sender_old$;
  v_sender_new text := $sender_new$
  if v_currency not in ('VG', 'KARMA') then
    raise exception 'ECONOMY_CURRENCY_INVALID' using errcode = '22023';
  end if;
  if v_currency = 'KARMA'
    and not public.net_economy_identity_can_use_karma(v_identity_link_id)
  then
    raise exception 'ECONOMY_KARMA_NOT_AVAILABLE' using errcode = '22023';
  end if;
$sender_new$;
  v_target_old text := $target_old$
  select primary_wallet.identity_link_id
  into v_target_identity_link_id
  from public.net_economy_accounts as primary_wallet
  where primary_wallet.payment_identifier = v_identifier
    and primary_wallet.account_kind = 'wallet'
    and primary_wallet.currency_code = 'VG'
    and primary_wallet.status = 'active';
$target_old$;
  v_target_new text := $target_new$
  select primary_wallet.identity_link_id
  into v_target_identity_link_id
  from public.net_economy_accounts as primary_wallet
  join public.net_identity_links as target_identity
    on target_identity.id = primary_wallet.identity_link_id
  where primary_wallet.payment_identifier = v_identifier
    and primary_wallet.account_kind = 'wallet'
    and primary_wallet.currency_code = 'VG'
    and primary_wallet.status = 'active'
    and public.net_economy_identity_is_runtime_financial_candidate(target_identity.id)
    and public.net_identity_link_can_access_service(target_identity.id, 'vlt')
    and (
      v_currency <> 'KARMA'
      or public.net_economy_identity_can_use_karma(target_identity.id)
    )
  for share of target_identity;
$target_new$;
begin
  v_definition := pg_get_functiondef(
    'public.net_economy_transfer_currency(text,text,bigint,text,uuid,boolean)'::regprocedure::oid
  );
  if position(v_sender_old in v_definition) = 0
    or position(
      v_sender_old in substr(
        v_definition,
        position(v_sender_old in v_definition) + 1
      )
    ) > 0
    or position(v_target_old in v_definition) = 0
    or position(
      v_target_old in substr(
        v_definition,
        position(v_target_old in v_definition) + 1
      )
    ) > 0
  then
    raise exception 'FINANCIAL_RUNTIME_VLT_TRANSFER_SOURCE_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_sender_old, v_sender_new);
  v_definition := replace(v_definition, v_target_old, v_target_new);
  execute v_definition;
end;
$$;

-- GM administration cannot make an accidental NPC Karma row mutable or use
-- it as an enrolment shortcut. VG administration is unchanged.
do $$
declare
  v_definition text;
  v_adjust_old text := $adjust_old$
  select * into v_account
  from public.net_economy_accounts as account
  where account.id = requested_account_id
    and account.account_kind <> 'system'
    and account.currency_code = v_currency;
$adjust_old$;
  v_adjust_new text := $adjust_new$
  select * into v_account
  from public.net_economy_accounts as account
  where account.id = requested_account_id
    and account.account_kind <> 'system'
    and account.currency_code = v_currency
    and (
      v_currency <> 'KARMA'
      or public.net_economy_identity_can_use_karma(account.identity_link_id)
    );
$adjust_new$;
  v_enable_old text := $enable_old$
  if not found then
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;

  select *
  into v_account
  from public.net_economy_accounts as account
$enable_old$;
  v_enable_new text := $enable_new$
  if not found then
    raise exception 'ECONOMY_WALLET_NOT_FOUND' using errcode = '22023';
  end if;
  if not public.net_economy_identity_can_use_karma(v_identity_link_id) then
    raise exception 'ECONOMY_KARMA_NOT_AVAILABLE' using errcode = '22023';
  end if;

  select *
  into v_account
  from public.net_economy_accounts as account
$enable_new$;
begin
  v_definition := pg_get_functiondef(
    'public.net_economy_adjust_wallet_currency(uuid,text,text,bigint,text,uuid,boolean)'::regprocedure::oid
  );
  if position(v_adjust_old in v_definition) = 0
    or position(
      v_adjust_old in substr(
        v_definition,
        position(v_adjust_old in v_definition) + 1
      )
    ) > 0
  then
    raise exception 'FINANCIAL_RUNTIME_KARMA_ADJUST_SOURCE_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
  execute replace(v_definition, v_adjust_old, v_adjust_new);

  v_definition := pg_get_functiondef(
    'public.enable_net_economy_gm_karma_profile(text)'::regprocedure::oid
  );
  if position(v_enable_old in v_definition) = 0
    or position(
      v_enable_old in substr(
        v_definition,
        position(v_enable_old in v_definition) + 1
      )
    ) > 0
  then
    raise exception 'FINANCIAL_RUNTIME_KARMA_ENROL_SOURCE_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
  execute replace(v_definition, v_enable_old, v_enable_new);
end;
$$;

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
  v_service_id text;
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := least(greatest(coalesce(requested_limit, 12), 1), 20);
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  v_service_id := case requested_institution_id
    when '00000000-0000-0000-0000-00000000e100'::uuid then 'vox-bank'
    when '00000000-0000-0000-0000-00000000e101'::uuid then 'shneider-bank'
    else null
  end;
  if v_service_id is null then
    raise exception 'ECONOMY_BANK_INSTITUTION_INVALID' using errcode = '22023';
  end if;
  if char_length(v_query) < 2 or char_length(v_query) > 80 then return '[]'::jsonb; end if;
  if left(v_query, 1) = '@' then v_query := substr(v_query, 2); end if;

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
      select public.net_economy_identity_display_name(account.identity_link_id) as display_name,
        account.payment_identifier
      from public.net_economy_accounts as account
      where account.account_kind = 'bank'
        and account.institution_id = requested_institution_id
        and account.currency_code = 'VG'
        and account.status = 'active'
        and account.id <> v_source_account_id
        and public.net_economy_identity_is_runtime_financial_candidate(account.identity_link_id)
        and public.net_identity_link_can_access_service(account.identity_link_id, v_service_id)
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

-- The two payment workers are intentionally preserved in full. Replace only
-- their reviewed recipient-shape predicate, fail closed on source drift, and
-- add the institution's current service eligibility. All ledger/idempotency,
-- account locking, yield-state, and response code remains deployed code.
do $$
declare
  v_definition text;
  v_pattern text :=
    'and identity_link\.identity_kind = ''player''[[:space:]]+and identity_link\.playability = ''playable''';
  v_replacement text;
begin
  v_definition := pg_get_functiondef(
    'public.net_economy_transfer_bank_payment(uuid,text,bigint,uuid)'::regprocedure::oid
  );
  if regexp_count(v_definition, v_pattern, 1, 'i') <> 1 then
    raise exception 'FINANCIAL_RUNTIME_BANK_PAYMENT_SOURCE_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
  v_replacement :=
    'and public.net_economy_identity_is_runtime_financial_candidate(identity_link.id)'
    || E'\n    and public.net_identity_link_can_access_service(identity_link.id, case requested_institution_id'
    || E'\n      when ''00000000-0000-0000-0000-00000000e100''::uuid then ''vox-bank'''
    || E'\n      when ''00000000-0000-0000-0000-00000000e101''::uuid then ''shneider-bank'''
    || E'\n      else ''__invalid__'' end)';
  execute regexp_replace(v_definition, v_pattern, v_replacement, 'gi');
end;
$$;

-- Preserve the deployed account-first authority order and add the
-- multicurrency assignment rows to the common lock boundary. Existing
-- open/quote/payment callers may take the same SHARE lock again; fetch/search
-- now receive the same stable denomination context as mutation paths.
create or replace function public.net_economy_lock_altara_bank_authority(
  requested_sender_identity_link_id uuid,
  requested_recipient_identity_link_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_locked_identity_count integer;
  v_locked_row_count integer;
  v_expected_identity_count integer;
begin
  if v_actor is null then
    raise exception 'ALTARA_BANK_AUTH_REQUIRED' using errcode = '42501';
  end if;

  perform 1
  from public.net_identity_links as identity_link
  where identity_link.id in (
    requested_sender_identity_link_id,
    requested_recipient_identity_link_id
  )
    and public.net_economy_identity_is_runtime_financial_candidate(
      identity_link.id
    )
  order by identity_link.id
  for share;
  get diagnostics v_locked_identity_count = row_count;

  v_expected_identity_count := case
    when requested_recipient_identity_link_id is null
      or requested_recipient_identity_link_id = requested_sender_identity_link_id
    then 1
    else 2
  end;

  if v_locked_identity_count <> v_expected_identity_count then
    raise exception 'ALTARA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;

  perform 1
  from public.net_identity_os_assignments as assignment
  where assignment.identity_link_id in (
    requested_sender_identity_link_id,
    requested_recipient_identity_link_id
  )
    and assignment.primary_os_id = 'altara'
  order by assignment.identity_link_id
  for share;
  get diagnostics v_locked_row_count = row_count;
  if v_locked_row_count <> v_expected_identity_count then
    raise exception 'ALTARA_BANK_OS_CONTEXT_CHANGED' using errcode = '42501';
  end if;

  perform 1
  from public.net_os_families as os_family
  where os_family.id = 'altara'
    and os_family.status = 'active'
  for share;
  if not found then
    raise exception 'ALTARA_BANK_OS_UNAVAILABLE' using errcode = '55000';
  end if;

  perform 1
  from public.net_os_service_scopes as service_scope
  where service_scope.service_id = 'altara-bank'
    and service_scope.scope_kind = 'primary-os'
    and service_scope.required_os_id = 'altara'
  for share;
  if not found then
    raise exception 'ALTARA_BANK_SERVICE_UNAVAILABLE' using errcode = '55000';
  end if;

  perform 1
  from public.net_economy_institutions as institution
  where institution.id = '00000000-0000-0000-0000-00000000e102'::uuid
    and institution.institution_code = 'ALTARA'
    and institution.status = 'active'
  for share;
  if not found then
    raise exception 'ALTARA_BANK_INSTITUTION_UNAVAILABLE' using errcode = '55000';
  end if;

  perform 1
  from public.net_identity_app_installs as install
  where install.identity_link_id = requested_sender_identity_link_id
    and install.app_id = 'altara-bank'
  for share;
  if not found then
    raise exception 'ALTARA_BANK_APP_NOT_INSTALLED' using errcode = '42501';
  end if;

  select profile.role::text
  into v_role
  from public.profiles as profile
  where profile.id = v_actor
  for share;
  if not found then
    raise exception 'ALTARA_BANK_AUTH_REQUIRED' using errcode = '42501';
  end if;

  if v_role = 'gm' then
    perform 1
    from public.net_gm_persona_sessions as gm_session
    join public.net_identity_links as identity_link
      on identity_link.subject_kind = gm_session.subject_kind
      and identity_link.subject_id = gm_session.subject_id
    where gm_session.gm_profile_id = v_actor
      and gm_session.mode = 'take-control'
      and identity_link.id = requested_sender_identity_link_id
    for share of gm_session;
    if not found then
      raise exception 'ALTARA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
    end if;
  elsif v_role = 'player' then
    perform 1
    from public.net_active_identities as active_identity
    where active_identity.profile_id = v_actor
      and active_identity.identity_link_id = requested_sender_identity_link_id
    for share;
    if not found then
      raise exception 'ALTARA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
    end if;
  else
    raise exception 'ALTARA_BANK_PERSONAL_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  perform 1
  from public.net_economy_identity_currency_assignments as assignment
  where assignment.identity_link_id in (
    requested_sender_identity_link_id,
    requested_recipient_identity_link_id
  )
  order by assignment.identity_link_id
  for share;
  get diagnostics v_locked_row_count = row_count;
  if v_locked_row_count <> v_expected_identity_count then
    raise exception 'ALTARA_BANK_CURRENCY_CONTEXT_CHANGED' using errcode = '40001';
  end if;

  if public.current_net_effective_runtime_identity_link_id()
      is distinct from requested_sender_identity_link_id
  then
    raise exception 'ALTARA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;

  if not public.net_identity_link_can_access_service(
    requested_sender_identity_link_id,
    'altara-bank'
  ) then
    raise exception 'ALTARA_BANK_OS_CONTEXT_CHANGED' using errcode = '42501';
  end if;

  if requested_recipient_identity_link_id is not null
    and requested_recipient_identity_link_id
      <> requested_sender_identity_link_id
    and not public.net_identity_link_can_access_service(
      requested_recipient_identity_link_id,
      'altara-bank'
    )
  then
    raise exception 'ALTARA_BANK_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;
end;
$$;

-- ALTARA's stable public name is retained, but its comparison resolver now
-- accepts the exact canonical runtime player or NPC. The existing authority
-- lock serializes OS, service, install, denomination, account, and GM-session
-- changes.
create or replace function public.net_economy_assert_altara_bank_player_context(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ALTARA_BANK_AUTH_REQUIRED' using errcode = '42501';
  end if;
  v_identity_link_id := public.current_net_effective_runtime_identity_link_id();
  if v_identity_link_id is null
    or not public.net_economy_identity_is_runtime_financial_candidate(v_identity_link_id)
  then
    raise exception 'ALTARA_BANK_PERSONAL_IDENTITY_REQUIRED' using errcode = '42501';
  end if;
  if requested_expected_identity_link_id is null
    or requested_expected_identity_link_id <> v_identity_link_id
  then
    raise exception 'ALTARA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;
  perform public.assert_net_identity_service_access(v_identity_link_id, 'altara-bank');
  if not exists (
    select 1 from public.net_identity_app_installs as install
    where install.identity_link_id = v_identity_link_id
      and install.app_id = 'altara-bank'
  ) then
    raise exception 'ALTARA_BANK_APP_NOT_INSTALLED' using errcode = '42501';
  end if;
  return v_identity_link_id;
end;
$$;

create or replace function public.net_economy_audit_altara_bank_personal_action(
  requested_identity_link_id uuid,
  requested_action_type text,
  requested_resource_type text,
  requested_resource_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
  v_link public.net_identity_links%rowtype;
  v_action_mode text;
  v_authorization_basis text;
  v_persona_subject_kind text;
  v_persona_subject_id uuid;
begin
  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_actor;
  select * into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id
    and public.net_economy_identity_is_runtime_financial_candidate(identity_link.id);
  if v_actor is null or v_link.id is null
    or public.current_net_effective_runtime_identity_link_id() is distinct from v_link.id
  then
    raise exception 'ALTARA_BANK_AUDIT_CONTEXT_INVALID' using errcode = '42501';
  end if;

  if v_role = 'gm' then
    select context.action_mode, context.authorization_basis,
      context.persona_subject_kind, context.persona_subject_id
    into v_action_mode, v_authorization_basis,
      v_persona_subject_kind, v_persona_subject_id
    from public.net_runtime_action_context(v_link.id) as context;
    if v_action_mode is null then
      raise exception 'ALTARA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
    end if;
  else
    v_action_mode := 'owner';
    v_authorization_basis := 'controlled-active-identity';
    v_persona_subject_kind := null;
    v_persona_subject_id := null;
  end if;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    v_actor, null, v_persona_subject_kind, v_persona_subject_id,
    v_action_mode, requested_action_type,
    v_authorization_basis, requested_resource_type, requested_resource_id
  );
end;
$$;

-- Widen only reviewed identity-shape predicates in ALTARA personal payload,
-- directory, quote, and payment. Existing service checks, FX revision binding,
-- deterministic locks, homogeneous transactions, clearing accounts, and
-- idempotency remain byte-for-byte deployed logic.
do $$
declare
  v_function regprocedure;
  v_definition text;
  v_pattern text :=
    'and identity_link\.identity_kind = ''player''[[:space:]]+and identity_link\.playability = ''playable''';
  v_expected integer;
begin
  for v_function, v_expected in
    select function_row, expected_count
    from (values
      ('public.net_economy_altara_bank_payload(uuid,timestamptz,uuid,integer)'::regprocedure, 1),
      ('public.search_net_economy_altara_bank_payees(uuid,text,integer)'::regprocedure, 1),
      ('public.quote_net_economy_altara_bank_payment(uuid,text,bigint)'::regprocedure, 2),
      ('public.transfer_net_economy_altara_bank_payment(uuid,text,bigint,uuid,uuid)'::regprocedure, 1),
      ('public.fetch_net_economy_gm_altara_configuration(uuid)'::regprocedure, 1),
      ('public.set_net_economy_gm_identity_currency(uuid,text,text)'::regprocedure, 1),
      ('public.fetch_net_economy_gm_altara_bank_directory(text,integer)'::regprocedure, 1)
    ) as reviewed(function_row, expected_count)
  loop
    v_definition := pg_get_functiondef(v_function::oid);
    if regexp_count(v_definition, v_pattern, 1, 'i') <> v_expected then
      raise exception 'FINANCIAL_RUNTIME_ALTARA_SOURCE_REVIEW_REQUIRED: %', v_function
        using errcode = '55000';
    end if;
    execute regexp_replace(
      v_definition,
      v_pattern,
      'and public.net_economy_identity_is_runtime_financial_candidate(identity_link.id)',
      'gi'
    );
  end loop;
end;
$$;

-- The deployed payment worker has an immutable-idempotency fast path before
-- its mutation locks. Keep that optimization, but linearize the retry read
-- against the same accounts, authority rows, and currency assignments before
-- returning any personal payload. A target switch/uninstall/OS or currency
-- change can therefore never race a successful retry response.
do $$
declare
  v_function constant regprocedure :=
    'public.transfer_net_economy_altara_bank_payment(uuid,text,bigint,uuid,uuid)'::regprocedure;
  v_definition text := pg_get_functiondef(v_function::oid);
  v_anchor text := E'  if found then\n    select * into v_existing_fx';
  v_replacement text := E'  if found then\n'
    || E'    perform 1\n'
    || E'    from public.net_economy_accounts as account\n'
    || E'    where account.id in (v_sender.id, v_recipient.id)\n'
    || E'    order by account.id\n'
    || E'    for share;\n'
    || E'    perform public.net_economy_lock_altara_bank_authority(\n'
    || E'      v_identity_link_id, v_recipient.identity_link_id\n'
    || E'    );\n'
    || E'    perform 1\n'
    || E'    from public.net_economy_identity_currency_assignments as assignment\n'
    || E'    where assignment.identity_link_id in (\n'
    || E'      v_identity_link_id, v_recipient.identity_link_id\n'
    || E'    )\n'
    || E'    order by assignment.identity_link_id\n'
    || E'    for share;\n'
    || E'    perform public.net_economy_assert_altara_bank_player_context(\n'
    || E'      requested_expected_identity_link_id\n'
    || E'    );\n\n'
    || E'    select account.* into v_sender\n'
    || E'    from public.net_economy_accounts as account\n'
    || E'    join public.net_economy_identity_currency_assignments as assignment\n'
    || E'      on assignment.identity_link_id = account.identity_link_id\n'
    || E'      and assignment.currency_code = account.currency_code\n'
    || E'    where account.id = v_sender.id\n'
    || E'      and account.identity_link_id = v_identity_link_id\n'
    || E'      and account.account_kind = ''bank''\n'
    || E'      and account.institution_id = ''00000000-0000-0000-0000-00000000e102''::uuid\n'
    || E'      and account.status = ''active'';\n'
    || E'    select account.* into v_recipient\n'
    || E'    from public.net_economy_accounts as account\n'
    || E'    join public.net_identity_links as identity_link\n'
    || E'      on identity_link.id = account.identity_link_id\n'
    || E'      and public.net_economy_identity_is_runtime_financial_candidate(identity_link.id)\n'
    || E'    join public.net_economy_identity_currency_assignments as assignment\n'
    || E'      on assignment.identity_link_id = account.identity_link_id\n'
    || E'      and assignment.currency_code = account.currency_code\n'
    || E'    where account.id = v_recipient.id\n'
    || E'      and account.payment_identifier = v_identifier\n'
    || E'      and account.account_kind = ''bank''\n'
    || E'      and account.institution_id = ''00000000-0000-0000-0000-00000000e102''::uuid\n'
    || E'      and account.status = ''active''\n'
    || E'      and public.net_identity_link_can_access_service(\n'
    || E'        identity_link.id, ''altara-bank''\n'
    || E'      );\n'
    || E'    if v_sender.id is null then\n'
    || E'      raise exception ''ALTARA_BANK_IDENTITY_CONTEXT_CHANGED'' using errcode = ''42501'';\n'
    || E'    end if;\n'
    || E'    if v_recipient.id is null then\n'
    || E'      raise exception ''ALTARA_BANK_PAYEE_NOT_FOUND'' using errcode = ''22023'';\n'
    || E'    end if;\n\n'
    || E'    select * into v_existing_fx';
begin
  if (char_length(v_definition) - char_length(replace(v_definition, v_anchor, '')))
      / char_length(v_anchor) <> 1
  then
    raise exception 'FINANCIAL_RUNTIME_ALTARA_IDEMPOTENT_PATH_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  execute replace(v_definition, v_anchor, v_replacement);
end;
$$;

do $$
declare
  v_bad_functions text;
  v_function regprocedure;
  v_definition text;
  v_lock_position integer;
  v_assert_position integer;
  v_post_lock_assert_position integer;
  v_second_lock_position integer;
  v_second_post_lock_assert_position integer;
  v_first_post_lock_assert_absolute integer;
  v_first_payload_return_position integer;
  v_tail text;
begin
  select string_agg(reviewed.signature, ', ' order by reviewed.signature)
  into v_bad_functions
  from (
    select p.oid::regprocedure::text as signature
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.oid in (
        'public.fetch_net_economy_wallet(uuid,timestamptz,uuid,integer)'::regprocedure,
        'public.fetch_net_economy_wallet_v2(uuid,timestamptz,uuid,integer)'::regprocedure,
        'public.search_net_economy_payees(uuid,text,integer)'::regprocedure,
        'public.transfer_net_economy_wallet(uuid,text,bigint,text,uuid)'::regprocedure,
        'public.transfer_net_economy_wallet_v2(uuid,text,text,bigint,text,uuid)'::regprocedure,
        'public.fetch_net_economy_vox_bank(uuid,timestamptz,uuid,integer)'::regprocedure,
        'public.open_net_economy_vox_bank(uuid)'::regprocedure,
        'public.claim_net_economy_vox_bank_yield(uuid,uuid)'::regprocedure,
        'public.search_net_economy_vox_bank_payees(uuid,text,integer)'::regprocedure,
        'public.transfer_net_economy_vox_bank_payment(uuid,text,bigint,uuid)'::regprocedure,
        'public.transfer_net_economy_vox_bank(uuid,text,bigint,uuid)'::regprocedure,
        'public.fetch_net_economy_shneider_bank(uuid,timestamptz,uuid,integer)'::regprocedure,
        'public.open_net_economy_shneider_bank(uuid)'::regprocedure,
        'public.search_net_economy_shneider_bank_payees(uuid,text,integer)'::regprocedure,
        'public.transfer_net_economy_shneider_bank_payment(uuid,text,bigint,uuid)'::regprocedure,
        'public.transfer_net_economy_shneider_bank(uuid,text,bigint,uuid)'::regprocedure,
        'public.net_economy_identity_is_runtime_financial_candidate(uuid)'::regprocedure,
        'public.net_economy_identity_can_use_karma(uuid)'::regprocedure,
        'public.assert_net_economy_player_identity()'::regprocedure,
        'public.net_economy_ensure_wallet_currency_for_link(uuid,text)'::regprocedure,
        'public.net_economy_ensure_wallet_for_link(uuid)'::regprocedure,
        'public.net_economy_identity_history_page(uuid,timestamptz,uuid,integer)'::regprocedure,
        'public.net_economy_wallet_bundle_payload(uuid,timestamptz,uuid,integer)'::regprocedure,
        'public.search_net_economy_payees(text,integer)'::regprocedure,
        'public.assert_net_vlt_payee_access(text)'::regprocedure,
        'public.net_economy_adjust_wallet_currency(uuid,text,text,bigint,text,uuid,boolean)'::regprocedure,
        'public.enable_net_economy_gm_karma_profile(text)'::regprocedure,
        'public.net_economy_search_bank_payees(uuid,text,integer)'::regprocedure,
        'public.net_economy_transfer_bank_payment(uuid,text,bigint,uuid)'::regprocedure,
        'public.net_economy_transfer_currency(text,text,bigint,text,uuid,boolean)'::regprocedure,
        'public.net_economy_lock_altara_bank_authority(uuid,uuid)'::regprocedure,
        'public.net_economy_assert_altara_bank_player_context(uuid)'::regprocedure,
        'public.net_economy_audit_altara_bank_personal_action(uuid,text,text,uuid)'::regprocedure,
        'public.net_economy_altara_bank_payload(uuid,timestamptz,uuid,integer)'::regprocedure,
        'public.search_net_economy_altara_bank_payees(uuid,text,integer)'::regprocedure,
        'public.quote_net_economy_altara_bank_payment(uuid,text,bigint)'::regprocedure,
        'public.transfer_net_economy_altara_bank_payment(uuid,text,bigint,uuid,uuid)'::regprocedure,
        'public.fetch_net_economy_gm_altara_configuration(uuid)'::regprocedure,
        'public.set_net_economy_gm_identity_currency(uuid,text,text)'::regprocedure,
        'public.fetch_net_economy_gm_altara_bank_directory(text,integer)'::regprocedure,
        'public.net_economy_enforce_cash_mirror()'::regprocedure,
        'public.net_economy_sync_cash_mirror()'::regprocedure,
        'public.net_economy_sync_identity_cash_mirror(uuid)'::regprocedure,
        'public.fetch_net_economy_sheet_account_sources(text,uuid)'::regprocedure,
        'public.normalize_net_runtime_financial_audit()'::regprocedure,
        'public.current_user_can_read_net_economy_wallet_revision(uuid)'::regprocedure
      )
      and not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=public, pg_temp'])
  ) as reviewed;
  if v_bad_functions is not null then
    raise exception 'FINANCIAL_RUNTIME_SEARCH_PATH_REVIEW_REQUIRED: %', v_bad_functions
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('public.fetch_net_economy_wallet(timestamptz,uuid,integer)'::regprocedure),
      ('public.fetch_net_economy_wallet_v2(timestamptz,uuid,integer)'::regprocedure),
      ('public.search_net_economy_payees(text,integer)'::regprocedure),
      ('public.transfer_net_economy_wallet(text,bigint,text,uuid)'::regprocedure),
      ('public.transfer_net_economy_wallet_v2(text,text,bigint,text,uuid)'::regprocedure),
      ('public.fetch_net_economy_vox_bank(timestamptz,uuid,integer)'::regprocedure),
      ('public.open_net_economy_vox_bank()'::regprocedure),
      ('public.claim_net_economy_vox_bank_yield(uuid)'::regprocedure),
      ('public.search_net_economy_vox_bank_payees(text,integer)'::regprocedure),
      ('public.transfer_net_economy_vox_bank_payment(text,bigint,uuid)'::regprocedure),
      ('public.transfer_net_economy_vox_bank(text,bigint,uuid)'::regprocedure),
      ('public.fetch_net_economy_shneider_bank(timestamptz,uuid,integer)'::regprocedure),
      ('public.open_net_economy_shneider_bank()'::regprocedure),
      ('public.search_net_economy_shneider_bank_payees(text,integer)'::regprocedure),
      ('public.transfer_net_economy_shneider_bank_payment(text,bigint,uuid)'::regprocedure),
      ('public.transfer_net_economy_shneider_bank(text,bigint,uuid)'::regprocedure)
    ) as retired(signature)
    where has_function_privilege('authenticated', retired.signature, 'EXECUTE')
  ) then
    raise exception 'FINANCIAL_RUNTIME_UNBOUND_RPC_STILL_EXECUTABLE'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('public.fetch_net_economy_wallet_v2(uuid,timestamptz,uuid,integer)'::regprocedure),
      ('public.search_net_economy_payees(uuid,text,integer)'::regprocedure),
      ('public.transfer_net_economy_wallet_v2(uuid,text,text,bigint,text,uuid)'::regprocedure),
      ('public.fetch_net_economy_vox_bank(uuid,timestamptz,uuid,integer)'::regprocedure),
      ('public.open_net_economy_vox_bank(uuid)'::regprocedure),
      ('public.claim_net_economy_vox_bank_yield(uuid,uuid)'::regprocedure),
      ('public.search_net_economy_vox_bank_payees(uuid,text,integer)'::regprocedure),
      ('public.transfer_net_economy_vox_bank_payment(uuid,text,bigint,uuid)'::regprocedure),
      ('public.transfer_net_economy_vox_bank(uuid,text,bigint,uuid)'::regprocedure),
      ('public.fetch_net_economy_shneider_bank(uuid,timestamptz,uuid,integer)'::regprocedure),
      ('public.open_net_economy_shneider_bank(uuid)'::regprocedure),
      ('public.search_net_economy_shneider_bank_payees(uuid,text,integer)'::regprocedure),
      ('public.transfer_net_economy_shneider_bank_payment(uuid,text,bigint,uuid)'::regprocedure),
      ('public.transfer_net_economy_shneider_bank(uuid,text,bigint,uuid)'::regprocedure),
      ('public.fetch_net_economy_altara_bank(uuid,timestamptz,uuid,integer)'::regprocedure),
      ('public.open_net_economy_altara_bank(uuid)'::regprocedure),
      ('public.search_net_economy_altara_bank_payees(uuid,text,integer)'::regprocedure),
      ('public.quote_net_economy_altara_bank_payment(uuid,text,bigint)'::regprocedure),
      ('public.transfer_net_economy_altara_bank_payment(uuid,text,bigint,uuid,uuid)'::regprocedure)
    ) as intended(signature)
    where not has_function_privilege('authenticated', intended.signature, 'EXECUTE')
  ) then
    raise exception 'FINANCIAL_RUNTIME_BOUND_RPC_GRANT_REQUIRED'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_trigger as trigger_row
    where trigger_row.tgrelid = 'public.net_action_audit'::regclass
      and trigger_row.tgname = 'net_action_audit_normalize_runtime_finance'
      and not trigger_row.tgisinternal
      and trigger_row.tgfoid = 'public.normalize_net_runtime_financial_audit()'::regprocedure
  ) then
    raise exception 'FINANCIAL_RUNTIME_AUDIT_TRIGGER_REQUIRED' using errcode = '55000';
  end if;

  v_definition := lower(pg_get_functiondef(
    'public.net_economy_ensure_wallet_currency_for_link(uuid,text)'::regprocedure::oid
  ));
  if position('select * into v_link' in v_definition) = 0
    or position('select * into v_existing' in v_definition) = 0
    or position('select * into v_link' in v_definition)
      > position('select * into v_existing' in v_definition)
    or position('and v_currency = ''vg''' in v_definition) = 0
  then
    raise exception 'FINANCIAL_RUNTIME_WALLET_ELIGIBILITY_ORDER_REQUIRED'
      using errcode = '55000';
  end if;

  if position(
      'net_economy_identity_can_use_karma'
      in lower(pg_get_functiondef(
        'public.net_economy_wallet_bundle_payload(uuid,timestamptz,uuid,integer)'::regprocedure::oid
      ))
    ) = 0
    or regexp_count(
      lower(pg_get_functiondef(
        'public.net_economy_transfer_currency(text,text,bigint,text,uuid,boolean)'::regprocedure::oid
      )),
      'net_economy_identity_can_use_karma',
      1,
      'i'
    ) < 2
    or position(
      'net_economy_identity_can_use_karma'
      in lower(pg_get_functiondef(
        'public.net_economy_adjust_wallet_currency(uuid,text,text,bigint,text,uuid,boolean)'::regprocedure::oid
      ))
    ) = 0
    or position(
      'net_economy_identity_can_use_karma'
      in lower(pg_get_functiondef(
        'public.enable_net_economy_gm_karma_profile(text)'::regprocedure::oid
      ))
    ) = 0
    or position(
      'net_economy_identity_can_use_karma'
      in lower(pg_get_functiondef(
        'public.net_economy_sync_cash_mirror()'::regprocedure::oid
      ))
    ) = 0
  then
    raise exception 'FINANCIAL_RUNTIME_NPC_KARMA_BOUNDARY_REQUIRED'
      using errcode = '55000';
  end if;

  v_definition := lower(pg_get_functiondef(
    'public.net_economy_lock_altara_bank_authority(uuid,uuid)'::regprocedure::oid
  ));
  if position('net_economy_identity_currency_assignments' in v_definition) = 0
    or position('order by assignment.identity_link_id' in v_definition) = 0
    or regexp_count(
      v_definition,
      'v_locked_row_count <> v_expected_identity_count',
      1,
      'i'
    ) <> 2
    or position('assignment.primary_os_id = ''altara''' in v_definition) = 0
    or position('os_family.id = ''altara''' in v_definition) = 0
    or position('os_family.status = ''active''' in v_definition) = 0
    or position('service_scope.scope_kind = ''primary-os''' in v_definition) = 0
    or position('service_scope.required_os_id = ''altara''' in v_definition) = 0
    or position('altara_bank_app_not_installed' in v_definition) = 0
    or position('gm_session.mode = ''take-control''' in v_definition) = 0
    or position(
      'identity_link.id = requested_sender_identity_link_id'
      in v_definition
    ) = 0
    or position(
      'active_identity.identity_link_id = requested_sender_identity_link_id'
      in v_definition
    ) = 0
    or position(
      'current_net_effective_runtime_identity_link_id()'
      in v_definition
    ) = 0
    or regexp_count(v_definition, 'net_identity_app_installs', 1, 'i') <> 1
    or position('identity_kind = ''player''' in v_definition) > 0
    or position('playability = ''playable''' in v_definition) > 0
  then
    raise exception 'FINANCIAL_RUNTIME_ALTARA_FINAL_LOCK_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  -- The private opener is reached only through the public stale-bound wrapper.
  -- Inside the worker, the authority lock must precede its context assertion.
  v_definition := lower(pg_get_functiondef(
    'public.net_economy_open_altara_bank_for_link(uuid)'::regprocedure::oid
  ));
  v_lock_position := position(
    'net_economy_lock_altara_bank_authority' in v_definition
  );
  v_post_lock_assert_position := case
    when v_lock_position > 0 then position(
      'net_economy_assert_altara_bank_player_context'
      in substring(
        v_definition
        from v_lock_position
          + char_length('net_economy_lock_altara_bank_authority')
      )
    )
    else 0
  end;
  if regexp_count(
      v_definition,
      'net_economy_lock_altara_bank_authority',
      1,
      'i'
    ) <> 1
    or v_lock_position = 0
    or v_post_lock_assert_position = 0
  then
    raise exception 'FINANCIAL_RUNTIME_ALTARA_OPEN_LINEARIZATION_REQUIRED'
      using errcode = '55000';
  end if;

  v_definition := lower(pg_get_functiondef(
    'public.open_net_economy_altara_bank(uuid)'::regprocedure::oid
  ));
  v_assert_position := position(
    'net_economy_assert_altara_bank_player_context' in v_definition
  );
  v_lock_position := position(
    'net_economy_open_altara_bank_for_link' in v_definition
  );
  if v_assert_position = 0
    or v_lock_position = 0
    or v_assert_position >= v_lock_position
  then
    raise exception 'FINANCIAL_RUNTIME_ALTARA_PUBLIC_OPEN_BINDING_REQUIRED'
      using errcode = '55000';
  end if;

  -- Every non-payment personal read has one initial stale assertion, one
  -- authority lock, and another assertion lexically after that lock.
  for v_function in
    select signature
    from (values
      ('public.fetch_net_economy_altara_bank(uuid,timestamptz,uuid,integer)'::regprocedure),
      ('public.search_net_economy_altara_bank_payees(uuid,text,integer)'::regprocedure),
      ('public.quote_net_economy_altara_bank_payment(uuid,text,bigint)'::regprocedure)
    ) as reviewed(signature)
  loop
    v_definition := lower(pg_get_functiondef(v_function::oid));
    v_assert_position := position(
      'net_economy_assert_altara_bank_player_context' in v_definition
    );
    v_lock_position := position(
      'net_economy_lock_altara_bank_authority' in v_definition
    );
    v_post_lock_assert_position := case
      when v_lock_position > 0 then position(
        'net_economy_assert_altara_bank_player_context'
        in substring(
          v_definition
          from v_lock_position
            + char_length('net_economy_lock_altara_bank_authority')
        )
      )
      else 0
    end;
    if regexp_count(
        v_definition,
        'net_economy_lock_altara_bank_authority',
        1,
        'i'
      ) <> 1
      or regexp_count(
        v_definition,
        'net_economy_assert_altara_bank_player_context',
        1,
        'i'
      ) <> 2
      or v_assert_position = 0
      or v_lock_position = 0
      or v_assert_position >= v_lock_position
      or v_post_lock_assert_position = 0
    then
      raise exception 'FINANCIAL_RUNTIME_ALTARA_READ_LINEARIZATION_REQUIRED: %',
        v_function using errcode = '55000';
    end if;
  end loop;

  -- Payment has two mutually exclusive execution paths. An immutable retry
  -- uses its own SHARE account/authority lock and post-lock assertion before
  -- the first payload return. A new payment later uses the deterministic
  -- UPDATE account lock set, the second authority lock, and its own post-lock
  -- assertion before any ledger write or conflict-loser payload return.
  v_definition := lower(pg_get_functiondef(
    'public.transfer_net_economy_altara_bank_payment(uuid,text,bigint,uuid,uuid)'::regprocedure::oid
  ));
  v_assert_position := position(
    'net_economy_assert_altara_bank_player_context' in v_definition
  );
  v_lock_position := position(
    'net_economy_lock_altara_bank_authority' in v_definition
  );
  v_tail := substring(
    v_definition
    from v_lock_position + char_length('net_economy_lock_altara_bank_authority')
  );
  v_post_lock_assert_position := position(
    'net_economy_assert_altara_bank_player_context' in v_tail
  );
  v_first_post_lock_assert_absolute := case
    when v_post_lock_assert_position > 0 then
      v_lock_position
        + char_length('net_economy_lock_altara_bank_authority')
        - 1
        + v_post_lock_assert_position
    else 0
  end;
  v_second_lock_position := position(
    'net_economy_lock_altara_bank_authority' in v_tail
  );
  if v_second_lock_position > 0 then
    v_second_lock_position := v_lock_position
      + char_length('net_economy_lock_altara_bank_authority')
      - 1
      + v_second_lock_position;
    v_second_post_lock_assert_position := position(
      'net_economy_assert_altara_bank_player_context'
      in substring(
        v_definition
        from v_second_lock_position
          + char_length('net_economy_lock_altara_bank_authority')
      )
    );
  else
    v_second_post_lock_assert_position := 0;
  end if;
  v_first_payload_return_position := position(
    'return public.net_economy_altara_bank_payload' in v_definition
  );
  if regexp_count(
      v_definition,
      'net_economy_lock_altara_bank_authority',
      1,
      'i'
    ) <> 2
    or regexp_count(
      v_definition,
      'net_economy_assert_altara_bank_player_context',
      1,
      'i'
    ) <> 3
    or v_assert_position = 0
    or v_lock_position = 0
    or v_assert_position >= v_lock_position
    or v_post_lock_assert_position = 0
    or v_second_lock_position = 0
    or v_second_post_lock_assert_position = 0
    or v_first_payload_return_position <= v_lock_position
    or v_first_post_lock_assert_absolute >= v_first_payload_return_position
    or v_first_payload_return_position >= v_second_lock_position
  then
    raise exception 'FINANCIAL_RUNTIME_ALTARA_PAYMENT_LINEARIZATION_REQUIRED'
      using errcode = '55000';
  end if;

  v_definition := lower(pg_get_functiondef(
    'public.current_user_can_read_net_economy_wallet_revision(uuid)'::regprocedure::oid
  ));
  if position('current_user_is_net_system_admin' in v_definition) = 0
    or position('current_net_effective_runtime_identity_link_id' in v_definition) = 0
    or position('net_economy_identity_can_use_karma' in v_definition) = 0
    or position('is_current_user_gm' in v_definition) > 0
  then
    raise exception 'FINANCIAL_RUNTIME_REALTIME_SCOPE_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.net_economy_accounts as account
    left join public.net_economy_transaction_entries as entry
      on entry.account_id = account.id
    group by account.id, account.balance_amount
    having account.balance_amount <> coalesce(sum(entry.amount), 0)
  ) then
    raise exception 'FINANCIAL_RUNTIME_LEDGER_RECONCILIATION_REQUIRED'
      using errcode = '23514';
  end if;
end;
$$;

commit;
