-- SELECT-only verification for supabase/net-search-knowledge-v1.sql.
-- Every row should return PASS after the migration is applied.

select
  'GM authority uses base profile role' as check_name,
  case when to_regclass('public.profiles') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'id'
    )
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'role'
    )
    then 'PASS' else 'FAIL' end as result;

select
  'knowledge + audit tables use RLS' as check_name,
  case when to_regclass('public.net_search_knowledge_entries') is not null
    and to_regclass('public.net_search_knowledge_audit') is not null
    and (
      select count(*)
      from pg_class
      where oid in (
        'public.net_search_knowledge_entries'::regclass,
        'public.net_search_knowledge_audit'::regclass
      )
        and relrowsecurity
    ) = 2
    then 'PASS' else 'FAIL' end as result;

select
  'no direct browser table grants' as check_name,
  case when not exists (
    select 1
    from pg_class as relation
    cross join lateral aclexplode(
      coalesce(relation.relacl, acldefault('r', relation.relowner))
    ) as acl
    where relation.oid in (
        'public.net_search_knowledge_entries'::regclass,
        'public.net_search_knowledge_audit'::regclass
      )
      and acl.grantee in (0, to_regrole('anon'), to_regrole('authenticated'))
  ) then 'PASS' else 'FAIL' end as result;

select
  'no browser RLS policies' as check_name,
  case when not exists (
    select 1
    from pg_policy
    where polrelid in (
      'public.net_search_knowledge_entries'::regclass,
      'public.net_search_knowledge_audit'::regclass
    )
  ) then 'PASS' else 'FAIL' end as result;

select
  'full-text GIN index' as check_name,
  case when exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'net_search_knowledge_entries'
      and indexname = 'net_search_knowledge_search_document_idx'
      and indexdef ilike '%using gin%'
  ) then 'PASS' else 'FAIL' end as result;

with expected(signature) as (
  values
    ('public.search_net_knowledge(text,integer)'),
    ('public.fetch_net_search_home(integer)'),
    ('public.fetch_net_search_entry(uuid)'),
    ('public.fetch_net_search_gm_directory(text,text,text,integer)'),
    ('public.fetch_net_search_gm_entry(uuid)'),
    ('public.save_net_search_gm_entry(uuid,text,text,text,text,text[],text[],text,timestamp with time zone,timestamp with time zone,text[])'),
    ('public.set_net_search_gm_entry_lifecycle(uuid,text)'),
    ('public.delete_net_search_gm_entry(uuid)')
)
select
  'browser RPCs installed' as check_name,
  case when bool_and(to_regprocedure(signature) is not null)
    then 'PASS' else 'FAIL' end as result
from expected;

with expected(signature) as (
  values
    ('public.search_net_knowledge(text,integer)'),
    ('public.fetch_net_search_home(integer)'),
    ('public.fetch_net_search_entry(uuid)'),
    ('public.fetch_net_search_gm_directory(text,text,text,integer)'),
    ('public.fetch_net_search_gm_entry(uuid)'),
    ('public.save_net_search_gm_entry(uuid,text,text,text,text,text[],text[],text,timestamp with time zone,timestamp with time zone,text[])'),
    ('public.set_net_search_gm_entry_lifecycle(uuid,text)'),
    ('public.delete_net_search_gm_entry(uuid)')
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
  'RPC execute is authenticated-only' as check_name,
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
    ) = 8
  then 'PASS' else 'FAIL' end as result;
