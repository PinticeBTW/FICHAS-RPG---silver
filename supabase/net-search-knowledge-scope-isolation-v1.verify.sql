-- SELECT-only verifier for 20260825224115_net_search_knowledge_scope_isolation_v1.sql.
-- Run immediately after the migration and before creating ALTARA-specific lore.
-- Expected result: exactly 15 rows, all PASS.

with function_defs as (
  select
    required.name,
    procedure_row.oid,
    lower(pg_get_functiondef(procedure_row.oid)) as definition
  from (
    values
      ('scope_resolver', 'public.current_net_search_scope_v1()'),
      ('scope_setter', 'public.set_net_gm_system_workspace_v1(text)'),
      ('search', 'public.search_net_knowledge_v2(text,integer)'),
      ('home', 'public.fetch_net_search_home_v2(integer)'),
      ('source', 'public.fetch_net_search_source_v2(uuid,text)'),
      ('gm_directory', 'public.fetch_net_search_gm_directory_v2(text,text,text,text,integer)'),
      ('context', 'public.retrieve_net_search_context_v1(text,integer)'),
      ('gm_entry_fetch', 'public.fetch_net_search_gm_entry(uuid)'),
      ('gm_entry_save', 'public.save_net_search_gm_entry(uuid,text,text,text,text,text[],text[],text,timestamptz,timestamptz,text[])'),
      ('gm_entry_lifecycle', 'public.set_net_search_gm_entry_lifecycle(uuid,text)'),
      ('gm_entry_delete', 'public.delete_net_search_gm_entry(uuid)'),
      ('gm_lore_preview', 'public.preview_net_search_gm_lore_import_v1(text,text)'),
      ('gm_document_fetch', 'public.fetch_net_search_gm_document_v1(uuid)'),
      ('gm_document_save', 'public.save_net_search_gm_document_v1(uuid,text,text,text,timestamptz,timestamptz,text)'),
      ('gm_document_delete', 'public.delete_net_search_gm_document_v1(uuid)')
  ) as required(name, signature)
  left join pg_proc as procedure_row
    on procedure_row.oid = to_regprocedure(required.signature)
),
function_acl as (
  select
    function_defs.name,
    expanded_acl.grantee,
    expanded_acl.privilege_type
  from function_defs
  join pg_proc as procedure_row
    on procedure_row.oid = function_defs.oid
  cross join lateral aclexplode(
    coalesce(procedure_row.proacl, acldefault('f', procedure_row.proowner))
  ) as expanded_acl
),
legacy_function_acl as (
  select
    expanded_acl.grantee,
    expanded_acl.privilege_type
  from (
    values
      ('public.search_net_knowledge(text,integer)'),
      ('public.fetch_net_search_home(integer)'),
      ('public.fetch_net_search_entry(uuid)'),
      ('public.fetch_net_search_gm_directory(text,text,text,integer)')
  ) as legacy(signature)
  join pg_proc as procedure_row
    on procedure_row.oid = to_regprocedure(legacy.signature)
  cross join lateral aclexplode(
    coalesce(procedure_row.proacl, acldefault('f', procedure_row.proowner))
  ) as expanded_acl
),
internal_function_acl as (
  select
    expanded_acl.grantee,
    expanded_acl.privilege_type
  from (
    values
      ('public.assert_net_search_gm_scope_v1()'),
      ('public.net_search_gm_entry_payload(uuid)'),
      ('public.net_search_gm_document_payload_v1(uuid)')
  ) as internal(signature)
  join pg_proc as procedure_row
    on procedure_row.oid = to_regprocedure(internal.signature)
  cross join lateral aclexplode(
    coalesce(procedure_row.proacl, acldefault('f', procedure_row.proowner))
  ) as expanded_acl
),
table_acl as (
  select
    table_row.relname,
    expanded_acl.grantee,
    expanded_acl.privilege_type
  from pg_class as table_row
  join pg_namespace as schema_row
    on schema_row.oid = table_row.relnamespace
  cross join lateral aclexplode(
    coalesce(table_row.relacl, acldefault('r', table_row.relowner))
  ) as expanded_acl
  where schema_row.nspname = 'public'
    and table_row.relname in (
      'net_search_knowledge_entries',
      'net_search_knowledge_documents',
      'net_search_knowledge_chunks'
    )
),
checks as (
  select 1 as check_order,
    'Existing V1 knowledge is assigned to VEIL scope'::text as check_name,
    not exists (
      select 1
      from public.net_search_knowledge_entries as entry
      where entry.knowledge_scope <> 'veil'
    ) and not exists (
      select 1
      from public.net_search_knowledge_documents as document
      where document.knowledge_scope <> 'veil'
    ) as passed

  union all
  select 2,
    'Entries, documents, and inherited chunks carry a valid scope',
    not exists (
      select 1
      from public.net_search_knowledge_entries as entry
      where entry.knowledge_scope not in ('veil', 'altara')
    ) and not exists (
      select 1
      from public.net_search_knowledge_documents as document
      where document.knowledge_scope not in ('veil', 'altara')
    ) and not exists (
      select 1
      from public.net_search_knowledge_chunks as chunk
      left join public.net_search_knowledge_documents as document
        on document.id = chunk.document_id
      where document.id is null
        or document.knowledge_scope not in ('veil', 'altara')
    ) and (
      select count(*) = 3
      from pg_constraint as constraint_row
      where constraint_row.conname in (
        'net_gm_persona_sessions_workspace_os_shape',
        'net_search_knowledge_entries_scope_shape',
        'net_search_knowledge_documents_scope_shape'
      )
        and constraint_row.contype = 'c'
    )

  union all
  select 3,
    'ALTARA player Search cannot return VEIL records',
    coalesce((select position('entry.knowledge_scope = v_scope' in definition) > 0
      and position('document.knowledge_scope = v_scope' in definition) > 0
      from function_defs where name = 'search'), false)
    and coalesce((select position('current_net_search_scope_v1()' in definition) > 0
      from function_defs where name = 'search'), false)

  union all
  select 4,
    'VEIL player Search cannot return ALTARA records',
    coalesce((select position('assignment.primary_os_id' in definition) > 0
      and position('gm_session.workspace_os_id' in definition) > 0
      and position($needle$v_scope not in ('veil', 'altara')$needle$ in definition) > 0
      from function_defs where name = 'scope_resolver'), false)
    and coalesce((select position('entry.knowledge_scope = v_scope' in definition) > 0
      and position('document.knowledge_scope = v_scope' in definition) > 0
      from function_defs where name = 'home'), false)

  union all
  select 5,
    'ALTARA GM directory cannot list VEIL records',
    coalesce((select position('assert_net_search_gm_scope_v1()' in definition) > 0
      and position('entry.knowledge_scope = v_scope' in definition) > 0
      and position('document.knowledge_scope = v_scope' in definition) > 0
      from function_defs where name = 'gm_directory'), false)

  union all
  select 6,
    'VEIL GM directory cannot list ALTARA records',
    coalesce((select position('entry.knowledge_scope = v_scope' in definition) > 0
      and position('document.knowledge_scope = v_scope' in definition) > 0
      and position($needle$normalized_source_filter in ('all', 'entries')$needle$ in definition) > 0
      from function_defs where name = 'gm_directory'), false)

  union all
  select 7,
    'Wrong-scope source UUID returns no row',
    coalesce((select position('entry.id = requested_source_id' in definition) > 0
      and position('entry.knowledge_scope = v_scope' in definition) > 0
      and position('document.id = requested_source_id' in definition) > 0
      and position('document.knowledge_scope = v_scope' in definition) > 0
      from function_defs where name = 'source'), false)
    and position(
      'knowledge_scope = public.current_net_search_scope_v1()'
      in lower(pg_get_functiondef('public.net_search_gm_entry_payload(uuid)'::regprocedure))
    ) > 0
    and position(
      'knowledge_scope = public.current_net_search_scope_v1()'
      in lower(pg_get_functiondef('public.net_search_gm_document_payload_v1(uuid)'::regprocedure))
    ) > 0

  union all
  select 8,
    'Retrieval context is scope filtered',
    coalesce((select position('entry.knowledge_scope = v_scope' in definition) > 0
      and position('document.knowledge_scope = v_scope' in definition) > 0
      from function_defs where name = 'context'), false)

  union all
  select 9,
    'AI cannot receive cross-scope chunks',
    coalesce((select position('document.knowledge_scope = v_scope' in definition) > 0
      and position('chunk.document_id = document.id' in definition) > 0
      and position('candidate.match_order = 1' in definition) > 0
      from function_defs where name = 'context'), false)

  union all
  select 10,
    'Canonical entry creation is scope-bound',
    coalesce((select position('knowledge_scope,' in definition) > 0
      and position('v_scope,' in definition) > 0
      and position('entry.knowledge_scope = v_scope' in definition) > 0
      from function_defs where name = 'gm_entry_save'), false)

  union all
  select 11,
    'Lore document import and creation are scope-bound',
    coalesce((select position('assert_net_search_gm_scope_v1()' in definition) > 0
      from function_defs where name = 'gm_lore_preview'), false)
    and coalesce((select position('knowledge_scope,' in definition) > 0
      and position('v_scope,' in definition) > 0
      and position('document.knowledge_scope = v_scope' in definition) > 0
      from function_defs where name = 'gm_document_save'), false)

  union all
  select 12,
    'Entry and document update/delete cannot cross scope',
    coalesce((select position('entry.knowledge_scope = v_scope' in definition) > 0
      from function_defs where name = 'gm_entry_lifecycle'), false)
    and coalesce((select position('entry.knowledge_scope = v_scope' in definition) > 0
      from function_defs where name = 'gm_entry_delete'), false)
    and coalesce((select position('document.knowledge_scope = v_scope' in definition) > 0
      from function_defs where name = 'gm_document_save'), false)
    and coalesce((select position('document.knowledge_scope = v_scope' in definition) > 0
      from function_defs where name = 'gm_document_delete'), false)

  union all
  select 13,
    'PUBLIC / RESTRICTED / CLASSIFIED enforcement remains intact',
    (
      select count(*) = 4
      from function_defs
      where name in ('search', 'home', 'source', 'context')
        and position($needle$visibility = 'public'$needle$ in definition) > 0
    ) and exists (
      select 1
      from pg_constraint as constraint_row
      where constraint_row.conrelid = 'public.net_search_knowledge_entries'::regclass
        and pg_get_constraintdef(constraint_row.oid) like '%classified%'
    ) and exists (
      select 1
      from pg_constraint as constraint_row
      where constraint_row.conrelid = 'public.net_search_knowledge_documents'::regclass
        and pg_get_constraintdef(constraint_row.oid) like '%classified%'
    )

  union all
  select 14,
    'available_from / expires_at enforcement remains intact',
    (
      select count(*) = 4
      from function_defs
      where name in ('search', 'home', 'source', 'context')
        and position('available_from' in definition) > 0
        and position('expires_at' in definition) > 0
        and position('statement_timestamp()' in definition) > 0
    )

  union all
  select 15,
    'No direct-table or legacy-RPC browser bypass exists',
    (
      select count(*) = 15
      from function_defs
      where oid is not null
    ) and not exists (
      select 1
      from table_acl
      where grantee in (0, to_regrole('anon'), to_regrole('authenticated'))
        and privilege_type in (
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        )
    ) and (
      select count(*) = 14
      from function_acl
      where name <> 'scope_resolver'
        and grantee = to_regrole('authenticated')
        and privilege_type = 'EXECUTE'
    ) and not exists (
      select 1
      from function_acl
      where grantee in (0, to_regrole('anon'))
        and privilege_type = 'EXECUTE'
    ) and not exists (
      select 1
      from function_acl
      where name = 'scope_resolver'
        and grantee = to_regrole('authenticated')
        and privilege_type = 'EXECUTE'
    ) and not exists (
      select 1
      from legacy_function_acl
      where grantee in (0, to_regrole('anon'), to_regrole('authenticated'))
        and privilege_type = 'EXECUTE'
    ) and not exists (
      select 1
      from internal_function_acl
      where grantee in (0, to_regrole('anon'), to_regrole('authenticated'))
        and privilege_type = 'EXECUTE'
    )
)
select
  check_name,
  case when passed then 'PASS' else 'FAIL' end as result
from checks
order by check_order;
