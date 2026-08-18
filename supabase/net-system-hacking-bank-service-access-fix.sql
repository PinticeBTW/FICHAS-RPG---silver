-- Fixes VOX BANK / SHNEIDER BANK "Authentication through VEGA MESH is
-- required." during an active hacking session, even though the compromised
-- Vanessa runtime is the server-confirmed effective target and VLT (which
-- shares the same effective-runtime-identity layer) already works correctly.
--
-- ROOT CAUSE: fetch/open/claim-yield/search/transfer_*_payment/transfer for
-- VOX BANK and SHNEIDER BANK exist as TWO overloads each:
--   1. The client-facing wrapper added by net-financial-runtime-control-
--      parity.sql, taking an explicit requested_expected_identity_link_id
--      first argument. It correctly calls assert_net_effective_runtime_
--      identity(requested_expected_identity_link_id, '<service>', true) --
--      hacking/take-control projection aware, exactly like VLT.
--   2. The pre-existing, no-identity-argument inner function (last replaced
--      by net-multi-os-altara-ecosystem.sql) that the wrapper above still
--      delegates to positionally. THIS inner function independently
--      re-checks access via assert_current_user_net_service_access(...),
--      which resolves identity from auth.uid()'s OWN net_active_identities
--      row -- never consulting net_system_hacking_sessions or GM take-
--      control. During a hack this checks the SOURCE actor (Adrian), not
--      the already-confirmed effective TARGET (Vanessa) the outer wrapper
--      just validated, so it can reject a request the outer assert already
--      approved.
--
-- VLT never hit this: its own inner function resolves identity via
-- assert_net_economy_player_identity(), which net-financial-runtime-
-- control-parity.sql already pointed at current_net_effective_runtime_
-- identity_link_id() -- the same shared, hacking-aware resolver the outer
-- wrapper uses. VOX BANK / SHNEIDER BANK's inner layer was simply never
-- migrated onto that resolver when it predates the parity/hacking work.
--
-- FIX: replace the stale assert_current_user_net_service_access(<service>)
-- call in each of these inner functions with assert_net_identity_service_
-- access(current_net_effective_runtime_identity_link_id(), <service>) --
-- the same OS-service-scope predicate, now evaluated against the effective
-- (hacking/take-control projected) identity instead of the raw authenticated
-- actor. This does not weaken authorization: the outer wrapper already
-- performs a strictly stronger check (same effective identity, plus the
-- install-required check) before ever reaching this inner function; this
-- migration only fixes which identity the inner, independently-reachable
-- overload evaluates. current_user_can_access_net_service/assert_current_
-- user_net_service_access themselves are intentionally left untouched: they
-- are shared with NVN and other unrelated callers and carry an unconditional
-- GM bypass that this fix must not disturb.
--
-- Nothing about auth.uid(), ownership, ledgers, balances, or TAKE CONTROL
-- state changes here -- only which identity these 11 functions' internal
-- OS-service-scope check runs against.

begin;

do $preflight$
begin
  if to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.assert_net_identity_service_access(uuid,text)') is null
    or to_regprocedure('public.fetch_net_economy_vox_bank(timestamptz,uuid,integer)') is null
    or to_regprocedure('public.fetch_net_economy_vox_bank_unscoped(timestamptz,uuid,integer)') is null
    or to_regprocedure('public.open_net_economy_vox_bank()') is null
    or to_regprocedure('public.open_net_economy_vox_bank_unscoped()') is null
    or to_regprocedure('public.claim_net_economy_vox_bank_yield(uuid)') is null
    or to_regprocedure('public.claim_net_economy_vox_bank_yield_unscoped(uuid)') is null
    or to_regprocedure('public.search_net_economy_vox_bank_payees(text,integer)') is null
    or to_regprocedure('public.search_net_economy_vox_bank_payees_unscoped(text,integer)') is null
    or to_regprocedure('public.transfer_net_economy_vox_bank_payment(text,bigint,uuid)') is null
    or to_regprocedure('public.transfer_net_economy_vox_bank_payment_unscoped(text,bigint,uuid)') is null
    or to_regprocedure('public.transfer_net_economy_vox_bank(text,bigint,uuid)') is null
    or to_regprocedure('public.transfer_net_economy_vox_bank_unscoped(text,bigint,uuid)') is null
    or to_regprocedure('public.fetch_net_economy_shneider_bank(timestamptz,uuid,integer)') is null
    or to_regprocedure('public.fetch_net_economy_shneider_bank_unscoped(timestamptz,uuid,integer)') is null
    or to_regprocedure('public.open_net_economy_shneider_bank()') is null
    or to_regprocedure('public.open_net_economy_shneider_bank_unscoped()') is null
    or to_regprocedure('public.search_net_economy_shneider_bank_payees(text,integer)') is null
    or to_regprocedure('public.search_net_economy_shneider_bank_payees_unscoped(text,integer)') is null
    or to_regprocedure('public.transfer_net_economy_shneider_bank_payment(text,bigint,uuid)') is null
    or to_regprocedure('public.transfer_net_economy_shneider_bank_payment_unscoped(text,bigint,uuid)') is null
    or to_regprocedure('public.transfer_net_economy_shneider_bank(text,bigint,uuid)') is null
    or to_regprocedure('public.transfer_net_economy_shneider_bank_unscoped(text,bigint,uuid)') is null
  then
    raise exception 'NET_SYSTEM_HACKING_BANK_SERVICE_ACCESS_FIX_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;
end;
$preflight$;

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
begin
  perform public.assert_net_identity_service_access(
    public.current_net_effective_runtime_identity_link_id(), 'vox-bank'
  );
  return public.fetch_net_economy_vox_bank_unscoped(
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
begin
  perform public.assert_net_identity_service_access(
    public.current_net_effective_runtime_identity_link_id(), 'vox-bank'
  );
  return public.open_net_economy_vox_bank_unscoped();
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
begin
  perform public.assert_net_identity_service_access(
    public.current_net_effective_runtime_identity_link_id(), 'vox-bank'
  );
  return public.claim_net_economy_vox_bank_yield_unscoped(
    requested_request_key
  );
end;
$$;

create or replace function public.search_net_economy_vox_bank_payees(
  requested_query text,
  requested_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_identity_service_access(
    public.current_net_effective_runtime_identity_link_id(), 'vox-bank'
  );
  return public.search_net_economy_vox_bank_payees_unscoped(
    requested_query,
    requested_limit
  );
end;
$$;

create or replace function public.transfer_net_economy_vox_bank_payment(
  requested_payment_identifier text,
  requested_amount bigint,
  requested_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_identity_service_access(
    public.current_net_effective_runtime_identity_link_id(), 'vox-bank'
  );
  return public.transfer_net_economy_vox_bank_payment_unscoped(
    requested_payment_identifier,
    requested_amount,
    requested_request_key
  );
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
begin
  perform public.assert_net_identity_service_access(
    public.current_net_effective_runtime_identity_link_id(), 'vox-bank'
  );
  perform public.assert_net_identity_service_access(
    public.current_net_effective_runtime_identity_link_id(), 'vlt'
  );
  return public.transfer_net_economy_vox_bank_unscoped(
    requested_direction,
    requested_amount,
    requested_request_key
  );
end;
$$;

create or replace function public.fetch_net_economy_shneider_bank(
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
  perform public.assert_net_identity_service_access(
    public.current_net_effective_runtime_identity_link_id(), 'shneider-bank'
  );
  return public.fetch_net_economy_shneider_bank_unscoped(
    requested_cursor_at,
    requested_cursor_id,
    requested_limit
  );
end;
$$;

create or replace function public.open_net_economy_shneider_bank()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_identity_service_access(
    public.current_net_effective_runtime_identity_link_id(), 'shneider-bank'
  );
  return public.open_net_economy_shneider_bank_unscoped();
end;
$$;

create or replace function public.search_net_economy_shneider_bank_payees(
  requested_query text,
  requested_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_identity_service_access(
    public.current_net_effective_runtime_identity_link_id(), 'shneider-bank'
  );
  return public.search_net_economy_shneider_bank_payees_unscoped(
    requested_query,
    requested_limit
  );
end;
$$;

create or replace function public.transfer_net_economy_shneider_bank_payment(
  requested_payment_identifier text,
  requested_amount bigint,
  requested_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_identity_service_access(
    public.current_net_effective_runtime_identity_link_id(), 'shneider-bank'
  );
  return public.transfer_net_economy_shneider_bank_payment_unscoped(
    requested_payment_identifier,
    requested_amount,
    requested_request_key
  );
end;
$$;

create or replace function public.transfer_net_economy_shneider_bank(
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
begin
  perform public.assert_net_identity_service_access(
    public.current_net_effective_runtime_identity_link_id(), 'shneider-bank'
  );
  perform public.assert_net_identity_service_access(
    public.current_net_effective_runtime_identity_link_id(), 'vlt'
  );
  return public.transfer_net_economy_shneider_bank_unscoped(
    requested_direction,
    requested_amount,
    requested_request_key
  );
end;
$$;

commit;
