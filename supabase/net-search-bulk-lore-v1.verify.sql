-- SELECT-only verification for the VEIL Search bulk lore migration.
-- Every row should return PASS after applying:
-- supabase/migrations/20260825182248_net_search_bulk_lore_v1.sql

select
  'document, chunk, and audit tables use RLS' as check_name,
  case when (
    select count(*)
    from pg_class
    where oid in (
      'public.net_search_knowledge_documents'::regclass,
      'public.net_search_knowledge_chunks'::regclass,
      'public.net_search_knowledge_document_audit'::regclass
    )
      and relrowsecurity
  ) = 3 then 'PASS' else 'FAIL' end as result;

select
  'no browser table grants or RLS policies' as check_name,
  case when not exists (
    select 1
    from pg_class as relation
    cross join lateral aclexplode(
      coalesce(relation.relacl, acldefault('r', relation.relowner))
    ) as acl
    where relation.oid in (
        'public.net_search_knowledge_documents'::regclass,
        'public.net_search_knowledge_chunks'::regclass,
        'public.net_search_knowledge_document_audit'::regclass
      )
      and acl.grantee in (0, to_regrole('anon'), to_regrole('authenticated'))
  ) and not exists (
    select 1
    from pg_policy
    where polrelid in (
      'public.net_search_knowledge_documents'::regclass,
      'public.net_search_knowledge_chunks'::regclass,
      'public.net_search_knowledge_document_audit'::regclass
    )
  ) then 'PASS' else 'FAIL' end as result;

select
  'chunks cascade with their document' as check_name,
  case when exists (
    select 1
    from pg_constraint
    where conrelid = 'public.net_search_knowledge_chunks'::regclass
      and confrelid = 'public.net_search_knowledge_documents'::regclass
      and contype = 'f'
      and confdeltype = 'c'
  ) then 'PASS' else 'FAIL' end as result;

select
  'chunk full-text GIN index installed' as check_name,
  case when exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'net_search_knowledge_chunks'
      and indexname = 'net_search_chunk_search_document_idx'
      and indexdef ilike '%using gin%'
  ) then 'PASS' else 'FAIL' end as result;

with expected(signature) as (
  values
    ('public.preview_net_search_gm_lore_import_v1(text,text)'),
    ('public.fetch_net_search_gm_document_v1(uuid)'),
    ('public.save_net_search_gm_document_v1(uuid,text,text,text,timestamp with time zone,timestamp with time zone,text)'),
    ('public.delete_net_search_gm_document_v1(uuid)'),
    ('public.search_net_knowledge_v2(text,integer)'),
    ('public.fetch_net_search_home_v2(integer)'),
    ('public.fetch_net_search_source_v2(uuid,text)'),
    ('public.fetch_net_search_gm_directory_v2(text,text,text,text,integer)'),
    ('public.retrieve_net_search_context_v1(text,integer)')
)
select
  'browser RPCs installed' as check_name,
  case when bool_and(to_regprocedure(signature) is not null)
    then 'PASS' else 'FAIL' end as result
from expected;

with expected(signature) as (
  values
    ('public.preview_net_search_gm_lore_import_v1(text,text)'),
    ('public.fetch_net_search_gm_document_v1(uuid)'),
    ('public.save_net_search_gm_document_v1(uuid,text,text,text,timestamp with time zone,timestamp with time zone,text)'),
    ('public.delete_net_search_gm_document_v1(uuid)'),
    ('public.search_net_knowledge_v2(text,integer)'),
    ('public.fetch_net_search_home_v2(integer)'),
    ('public.fetch_net_search_source_v2(uuid,text)'),
    ('public.fetch_net_search_gm_directory_v2(text,text,text,text,integer)'),
    ('public.retrieve_net_search_context_v1(text,integer)')
), function_acl as (
  select
    expected.signature,
    acl.grantee,
    acl.privilege_type
  from expected
  join pg_proc as procedure_row
    on procedure_row.oid = to_regprocedure(expected.signature)
  cross join lateral aclexplode(
    coalesce(procedure_row.proacl, acldefault('f', procedure_row.proowner))
  ) as acl
)
select
  'browser RPC execute is authenticated-only' as check_name,
  case when
    not exists (
      select 1 from function_acl
      where grantee = 0 and privilege_type = 'EXECUTE'
    )
    and not exists (
      select 1 from function_acl
      where grantee = to_regrole('anon') and privilege_type = 'EXECUTE'
    )
    and (
      select count(distinct signature)
      from function_acl
      where grantee = to_regrole('authenticated') and privilege_type = 'EXECUTE'
    ) = 9
  then 'PASS' else 'FAIL' end as result;

with internal(signature) as (
  values
    ('public.set_net_search_document_updated_at()'),
    ('public.net_search_chunk_lore_document_v1(text,text)'),
    ('public.assert_net_search_gm_document_input_v1(text,text,text,timestamp with time zone,timestamp with time zone,text)'),
    ('public.audit_net_search_gm_document_action_v1(text,uuid)'),
    ('public.rebuild_net_search_document_chunks_v1(uuid,text,text,text)'),
    ('public.net_search_gm_document_payload_v1(uuid)')
), function_acl as (
  select
    internal.signature,
    acl.grantee,
    acl.privilege_type
  from internal
  join pg_proc as procedure_row
    on procedure_row.oid = to_regprocedure(internal.signature)
  cross join lateral aclexplode(
    coalesce(procedure_row.proacl, acldefault('f', procedure_row.proowner))
  ) as acl
)
select
  'internal helpers are not browser executable' as check_name,
  case when not exists (
    select 1
    from function_acl
    where grantee in (0, to_regrole('anon'), to_regrole('authenticated'))
      and privilege_type = 'EXECUTE'
  ) then 'PASS' else 'FAIL' end as result;

select
  'stored section counts match private chunks' as check_name,
  case when not exists (
    select 1
    from public.net_search_knowledge_documents as document
    where document.searchable_section_count <> (
      select count(*)
      from public.net_search_knowledge_chunks as chunk
      where chunk.document_id = document.id
    )
      or document.searchable_section_count < 1
  ) then 'PASS' else 'FAIL' end as result;

with player_rpc_definitions as (
  select lower(pg_get_functiondef(procedure_row.oid)) as definition
  from pg_proc as procedure_row
  where procedure_row.oid in (
    'public.search_net_knowledge_v2(text,integer)'::regprocedure,
    'public.fetch_net_search_home_v2(integer)'::regprocedure,
    'public.fetch_net_search_source_v2(uuid,text)'::regprocedure,
    'public.retrieve_net_search_context_v1(text,integer)'::regprocedure
  )
)
select
  'player RPCs enforce public availability windows' as check_name,
  case when count(*) = 4
    and bool_and(definition like '%visibility = ''public''%')
    and bool_and(definition like '%available_from%')
    and bool_and(definition like '%expires_at%')
  then 'PASS' else 'FAIL' end as result
from player_rpc_definitions;
