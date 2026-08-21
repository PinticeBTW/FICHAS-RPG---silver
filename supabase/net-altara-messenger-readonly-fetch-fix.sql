-- ALTARA Messenger: restore write-capable execution for read RPCs whose
-- shared runtime-context assertion intentionally acquires row locks.
--
-- net-nonfinancial-runtime-control-parity.sql changed both functions below
-- to VOLATILE when net_altara_assert_messenger_context(uuid) began
-- delegating to assert_net_effective_runtime_identity(...). That assertion
-- validates the mounted SOURCE/TARGET identity and takes FOR SHARE locks so
-- mutations can safely reuse the same authority choke point.
--
-- net-app-identity-presentation.sql later recreated these read RPCs as
-- STABLE while adding app-local presentation. PostgREST therefore executes
-- them in a read-only transaction, and opening a conversation fails with:
--
--   cannot execute SELECT FOR SHARE in a read-only transaction
--
-- Only the volatility metadata is restored here. Function bodies,
-- signatures, grants, membership checks, message behavior, RLS, Realtime,
-- and runtime identity authority remain unchanged.

alter function public.search_net_altara_messenger_recipients(
  uuid,
  text,
  integer
)
volatile;

alter function public.fetch_net_altara_message_page(
  uuid,
  uuid,
  timestamptz,
  uuid,
  integer
)
volatile;

comment on function public.search_net_altara_messenger_recipients(
  uuid,
  text,
  integer
) is
  'Bounded ALTARA Messenger recipient search. VOLATILE because its shared runtime-context assertion intentionally takes row locks; the function remains logically read-only.';

comment on function public.fetch_net_altara_message_page(
  uuid,
  uuid,
  timestamptz,
  uuid,
  integer
) is
  'Bounded ALTARA Messenger conversation page. VOLATILE because its shared runtime-context assertion intentionally takes row locks; the function remains logically read-only.';

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc as procedure_record
    where procedure_record.oid in (
      'public.search_net_altara_messenger_recipients(uuid,text,integer)'::regprocedure::oid,
      'public.fetch_net_altara_message_page(uuid,uuid,timestamptz,uuid,integer)'::regprocedure::oid
    )
      and procedure_record.provolatile <> 'v'
  ) then
    raise exception 'NET_ALTARA_MESSENGER_FETCH_VOLATILITY_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;
