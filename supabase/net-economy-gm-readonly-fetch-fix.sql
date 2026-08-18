-- Fixes "cannot execute SELECT FOR SHARE in a read-only transaction" on GM
-- Home Currency administration (and the same latent bug in the GM ALTARA
-- BANK directory fetch). PostgREST executes RPC calls to `stable` functions
-- inside a READ ONLY transaction. fetch_net_economy_gm_altara_configuration
-- and fetch_net_economy_gm_altara_bank_directory are both declared `stable`,
-- but both call public.assert_net_economy_gm(), which delegates to
-- public.assert_net_system_admin() (net-nonfinancial-runtime-control-parity.sql)
-- — a `volatile` helper that takes `for share` row locks (and bootstraps a
-- persona-session row via INSERT) because it is also used by mutation RPCs
-- that legitimately need that locking. Locking/write statements are illegal
-- inside a read-only transaction regardless of the *called* function's own
-- volatility, so every GM-authority read path built on that helper inherits
-- the failure.
--
-- assert_net_system_admin() / assert_net_economy_gm() are shared by many
-- mutation RPCs across economy, ALTARA MUSIC, and VOX AUDIO and must keep
-- their locking semantics for those callers, so they are not modified here.
-- Instead this adds read-only-safe siblings that make the identical
-- authority decision (GM role + persona-session mode = 'none', so TAKE
-- CONTROL / ACT AS / a compromised session still do not gain admin
-- authority) via plain SELECTs, with no row locks and no session-bootstrap
-- write, and repoints the two affected `stable` fetch functions at them.
-- Both fetch functions are re-created with `create or replace function`
-- against their existing signatures, so existing grants are preserved
-- unchanged.

create or replace function public.assert_net_system_admin_read()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
  v_mode text;
begin
  if v_actor is null then
    raise exception 'NET_SYSTEM_GM_REQUIRED' using errcode = '42501';
  end if;

  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_actor;

  if not found or v_role <> 'gm' then
    raise exception 'NET_SYSTEM_GM_REQUIRED' using errcode = '42501';
  end if;

  -- A first-use GM has no session row yet; that is equivalent to 'none'
  -- mode here, same as the bootstrap insert in assert_net_system_admin()
  -- guarantees for the locking/write-capable path.
  select gm_session.mode into v_mode
  from public.net_gm_persona_sessions as gm_session
  where gm_session.gm_profile_id = v_actor;

  if coalesce(v_mode, 'none') <> 'none' then
    raise exception 'NET_SYSTEM_GM_CONTEXT_REQUIRED' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

comment on function public.assert_net_system_admin_read() is
  'Read-only-safe GM System assertion for `stable` fetch RPCs: same authority decision as assert_net_system_admin() (GM role + persona mode = none), no row locks, no session-bootstrap write. Never use from a mutation RPC.';

revoke all on function public.assert_net_system_admin_read()
  from public, anon, authenticated;

create or replace function public.assert_net_economy_gm_read()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return public.assert_net_system_admin_read();
end;
$$;

comment on function public.assert_net_economy_gm_read() is
  'Read-only-safe canonical GM economy assertion for `stable` fetch RPCs. TAKE CONTROL, ACT AS, INSPECT, and compromised-session are not administrative adjustment authority, same as assert_net_economy_gm(). Never use from a mutation RPC.';

revoke all on function public.assert_net_economy_gm_read()
  from public, anon, authenticated;

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
    perform 1 from public.net_identity_links as identity_link
    where identity_link.id = requested_identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable';
    if not found then
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

create or replace function public.fetch_net_economy_gm_altara_bank_directory(
  requested_query text default null,
  requested_limit integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := least(greatest(coalesce(requested_limit, 40), 1), 60);
begin
  perform public.assert_net_economy_gm_read();
  if char_length(v_query) > 80 then
    raise exception 'ECONOMY_DIRECTORY_QUERY_INVALID' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'account_id', directory.account_id,
      'identity_link_id', directory.identity_link_id,
      'display_name', directory.display_name,
      'payment_identifier', directory.payment_identifier,
      'balance_amount', directory.balance_amount,
      'currency', public.net_economy_currency_json(directory.currency_code),
      'status', directory.status,
      'service_available', directory.service_available,
      'opened_at', directory.opened_at,
      'updated_at', directory.updated_at
    ) order by directory.display_name, directory.payment_identifier)
    from (
      select account.id as account_id, account.identity_link_id,
        public.net_economy_identity_display_name(account.identity_link_id) as display_name,
        account.payment_identifier, account.balance_amount, account.currency_code,
        account.status,
        public.net_identity_link_can_access_service(account.identity_link_id, 'altara-bank')
          as service_available,
        account.created_at as opened_at, account.updated_at
      from public.net_economy_accounts as account
      join public.net_identity_links as identity_link
        on identity_link.id = account.identity_link_id
        and identity_link.identity_kind = 'player'
        and identity_link.playability = 'playable'
      join public.net_economy_identity_currency_assignments as assignment
        on assignment.identity_link_id = account.identity_link_id
        and assignment.currency_code = account.currency_code
      where account.account_kind = 'bank'
        and account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
        and account.status = 'active'
        and not exists (
          select 1
          from public.net_economy_altara_bank_multicurrency_transitions as transition
          where transition.legacy_vg_bank_account_id = account.id
        )
        and (
          v_query = ''
          or account.payment_identifier like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
          or lower(public.net_economy_identity_display_name(account.identity_link_id))
            like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
        )
      order by display_name, account.payment_identifier limit v_limit
    ) as directory
  ), '[]'::jsonb);
end;
$$;
