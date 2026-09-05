-- Disable ONLY the História API, preserving all authored content and revisions.
-- Run only with explicit database authorization. This file has NOT been applied.
-- Keep restrictive Storage policies: removing them could expose existing portraits
-- through older broad policies. They do not affect any other media namespace.
begin;
do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc
    where pronamespace='public'::regnamespace and proname like 'lorelink_%_v1'
      and proname<>'lorelink_media_allowed_v1'
  loop execute format('revoke all on function %s from public,anon,authenticated',f.signature); end loop;
end $$;
commit;
-- Application rollback: use the hash-checked backup restore script accompanying
-- the delivery. Do not drop the tables, delete bucket objects or undo older SQL.
-- To re-enable after review, grant EXECUTE on the same Lorelink RPCs to
-- authenticated again. Retain table revocations, RLS, and restrictive media guards.
