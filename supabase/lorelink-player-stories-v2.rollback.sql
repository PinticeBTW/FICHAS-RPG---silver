-- Optional manual rollback of player authoring ONLY. Does not delete any rows,
-- images, history or existing identities; does not change the GM's legacy API.
-- Keep the v2 partition guards installed so legacy APIs cannot expose private stories.
begin;
do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc
    where pronamespace='public'::regnamespace and proname like 'lorelink_%_v2'
  loop execute format('revoke all on function %s from public,anon,authenticated',f.signature); end loop;
end $$;
notify pgrst, 'reload schema';
commit;
-- Re-enable after review: GRANT EXECUTE to authenticated on these same v2 RPCs.
-- Never restore the unpartitioned v1 SQL over v2 or set character_id to NULL.
