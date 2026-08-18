-- Extends the existing canonical HOME CURRENCY assignment path (Persona
-- Control -> fetch_net_economy_gm_altara_configuration / set_net_economy_
-- gm_identity_currency -> public.net_economy_identity_currency_assignments)
-- to NPC identities, exactly like it already works for players. No second
-- NPC-only currency model is introduced -- the same table, the same two
-- RPCs, the same audit trail now simply accept a wider identity shape.
--
-- ROOT CAUSE: both RPCs independently required
--   identity_link.identity_kind = 'player' and identity_link.playability = 'playable'
-- and raised ECONOMY_CURRENCY_IDENTITY_INVALID for anything else, including
-- a legitimate GM-controlled NPC identity (identity_kind = 'npc',
-- playability = 'non-playable'). Confirmed via direct inspection: the
-- underlying table (net_economy_identity_currency_assignments) has no such
-- restriction itself -- identity_link_id is a plain FK to
-- net_identity_links(id) -- and net_economy_sync_identity_cash_mirror (the
-- function this RPC already calls afterward, redefined by
-- net-financial-runtime-control-parity.sql) already accepts NPCs via
-- net_economy_identity_is_runtime_financial_candidate(). The restriction
-- was isolated to these two RPCs' own identity-eligibility gates, which
-- predate that shared "player OR non-playable NPC" predicate.
--
-- FIX: both RPCs now use exactly that already-established, already-audited
-- predicate -- net_economy_identity_is_runtime_financial_candidate(),
-- defined in net-financial-runtime-control-parity.sql as
--   (identity_kind = 'player' and playability = 'playable')
--   or (identity_kind = 'npc' and playability = 'non-playable')
-- -- the narrowest shared authority layer, reused rather than re-derived.
-- fetch_net_economy_gm_altara_configuration calls it directly (a stable,
-- lock-free read). set_net_economy_gm_identity_currency inlines the
-- identical OR-condition rather than calling the helper directly, because
-- this call site needs to keep its existing `for share` row lock on the
-- identity_link row for the surrounding transaction's consistency
-- guarantees -- the helper itself takes no lock. Every other check in both
-- functions -- GM-only authority via assert_net_economy_gm[_read](), the
-- mandatory 1-200 character audit reason, the "never relabel an existing
-- non-zero/history-bearing account's balance on currency change" review
-- gate, the currency-must-be-active/zero-decimal/non-KARMA validation, and
-- the audit-trail inserts -- is unchanged, in its original order, with its
-- original error code.
--
-- Both fetch_net_economy_gm_altara_configuration and set_net_economy_gm_
-- identity_currency already receive a plain identity_link_id with no
-- player-specific parameter naming, so no signature changes and no
-- frontend changes beyond removing the player-only render gate in
-- NetGmPersonaSettings.tsx (already done) are required.

begin;

do $preflight$
begin
  if to_regprocedure('public.assert_net_economy_gm_read()') is null
    or to_regprocedure('public.assert_net_economy_gm()') is null
    or to_regprocedure('public.net_economy_identity_is_runtime_financial_candidate(uuid)') is null
    or to_regprocedure('public.net_economy_currency_json(text)') is null
    or to_regprocedure('public.net_economy_sync_identity_cash_mirror(uuid)') is null
    or to_regprocedure('public.fetch_net_economy_gm_altara_configuration(uuid)') is null
    or to_regprocedure('public.set_net_economy_gm_identity_currency(uuid,text,text)') is null
    or to_regclass('public.net_economy_identity_currency_assignments') is null
    or to_regclass('public.net_economy_identity_currency_assignment_audit') is null
    or to_regclass('public.net_economy_currencies') is null
    or to_regclass('public.net_economy_fx_rates') is null
    or to_regclass('public.net_economy_accounts') is null
    or to_regclass('public.net_economy_altara_bank_multicurrency_transitions') is null
    or to_regclass('public.net_economy_transaction_entries') is null
    or to_regclass('public.net_action_audit') is null
  then
    raise exception 'NET_ECONOMY_NPC_CURRENCY_PARITY_DEPENDENCY_REQUIRED. This migration requires net-economy-altara-bank-multicurrency.sql, net-financial-runtime-control-parity.sql, net-economy-unified-gm-finance-control.sql, and net-economy-gm-readonly-fetch-fix.sql to be deployed first.'
      using errcode = '55000';
  end if;
end;
$preflight$;

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
  perform public.assert_net_economy_gm_read();
  if requested_identity_link_id is not null then
    if not public.net_economy_identity_is_runtime_financial_candidate(requested_identity_link_id) then
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
    and (
      (identity_link.identity_kind = 'player' and identity_link.playability = 'playable')
      or (identity_link.identity_kind = 'npc' and identity_link.playability = 'non-playable')
    )
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

revoke all on function public.fetch_net_economy_gm_altara_configuration(uuid)
  from public, anon, authenticated;
revoke all on function public.set_net_economy_gm_identity_currency(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.fetch_net_economy_gm_altara_configuration(uuid)
  to authenticated;
grant execute on function public.set_net_economy_gm_identity_currency(uuid, text, text)
  to authenticated;

commit;
