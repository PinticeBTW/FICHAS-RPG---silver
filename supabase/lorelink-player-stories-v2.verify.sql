-- Read-only activation check. No lore, account records or credentials returned.
select
  to_regprocedure('public.lorelink_characters_v2()') is not null as personagens_ativadas,
  to_regprocedure('public.lorelink_read_v2(text,uuid)') is not null as leitura_ativada,
  to_regprocedure('public.lorelink_save_entity_v2(text,uuid,integer,uuid,jsonb)') is not null as escrita_ativada,
  to_regprocedure('public.current_user_controls_net_identity_link(uuid)') is not null as autoridade_existente;

select c.relname as tabela, c.relrowsecurity as rls_ativo,
  has_table_privilege('anon',c.oid,'SELECT') as leitura_direta_anonima,
  has_table_privilege('authenticated',c.oid,'SELECT') as leitura_direta_autenticada
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
  ('lorelink_entities','lorelink_maps','lorelink_nodes','lorelink_relations','lorelink_revisions')
order by c.relname;

select p.proname as operacao, has_function_privilege('anon',p.oid,'EXECUTE') as acesso_anonimo,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as acesso_autenticado
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'lorelink_%_v2'
order by p.proname;
-- Expected: activation flags TRUE; RLS TRUE; direct table access FALSE;
-- anonymous function execution FALSE; authenticated execution TRUE.
-- This checks installation and grants, not the ownership behaviour itself.
