-- Retire ALTARA application-account behavior from New Vega.
-- Run after supabase/net-app-accounts.sql.
--
-- Existing rows are retained as disabled historical references so authored
-- PULSE/ECHO/audit records are never broken or silently destroyed.

begin;

update public.net_app_account_policies
set
  account_mode = 'none',
  account_available = false
where app_id = 'altara'
  and (
    account_mode is distinct from 'none'
    or account_available is distinct from false
  );

update public.net_app_accounts
set status = 'disabled'
where app_id = 'altara'
  and status is distinct from 'disabled';

-- This exact organisation account was installed by the original canonical
-- account seed. Retain it for referential history, but remove it from active
-- PULSE discovery and interaction.
update public.net_app_accounts
set status = 'disabled'
where app_id = 'pulse'
  and organisation_id = 'org-altara'
  and handle = 'altara'
  and status is distinct from 'disabled';

commit;
