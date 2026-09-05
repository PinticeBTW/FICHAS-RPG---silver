// Isolated SQL contract fixture. Auth/JWT and pre-existing tables are synthetic;
// the complete Lorelink migration and the existing workspace RPCs run unchanged.
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'

export const gm = '10000000-0000-4000-8000-000000000001'
export const player = '10000000-0000-4000-8000-000000000002'
export const outsider = '10000000-0000-4000-8000-000000000003'
export const otherGm = '10000000-0000-4000-8000-000000000004'
export const otherPlayer = '10000000-0000-4000-8000-000000000005'
export const secondCharacter = '10000000-0000-4000-8000-000000000006'
export const thirdCharacter = '10000000-0000-4000-8000-000000000007'
export const entryId = '20000000-0000-4000-8000-000000000001'
export const documentId = '20000000-0000-4000-8000-000000000002'
export async function createFixture(path) {
  const db = new PGlite(path)
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth,storage to authenticated,anon;
    create table public.profiles(id uuid primary key,role text,email text,display_name text,handle text,avatar_url text);
    create table public.net_os_families(id text primary key,status text);
    create table public.net_gm_persona_sessions(gm_profile_id uuid primary key,subject_kind text,subject_id uuid,mode text,workspace_os_id text);
    create table public.net_identity_os_assignments(identity_link_id uuid,primary_os_id text);
    create table public.net_identity_links(id uuid primary key,subject_kind text,subject_id uuid,owner_profile_id uuid,campaign_id uuid);
    create table public.npc_cards(id uuid primary key,display_name text,owner_profile_id uuid,field_data jsonb);
    create table public.characters(id uuid primary key,name text,owner_profile_id uuid,campaign_id uuid);
    create table public.character_sheet_forms(profile_id uuid primary key,field_data jsonb);
    create function public.is_current_user_gm() returns boolean language sql stable security definer as
      $$ select exists(select 1 from profiles where id=auth.uid() and role='gm') $$;
    create function public.current_net_effective_runtime_identity_link_id() returns uuid language sql stable as
      $$ select case when auth.uid()='${player}' then '${player}'::uuid else null end $$;
    create table public.net_search_knowledge_entries(id uuid primary key,knowledge_scope text,title text,summary text,content text,
      entry_type text,visibility text,status text,available_from timestamptz,expires_at timestamptz);
    create table public.net_search_knowledge_documents(id uuid primary key,knowledge_scope text,title text,raw_content text,
      visibility text,available_from timestamptz,expires_at timestamptz);
    create table storage.buckets(id text primary key,public boolean);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    -- Deliberately broad legacy policy: restrictive Lorelink guards must still isolate images.
    create policy legacy_gm_storage on storage.objects to authenticated using(public.is_current_user_gm()) with check(public.is_current_user_gm());
    insert into storage.buckets values('rpg-media',false);
    insert into public.net_os_families values('veil','active'),('altara','active');
    insert into public.profiles values('${gm}','gm','gm@example.test','GM de teste','test-gm',null),
      ('${player}','player','player@example.test','Jogador de teste','test-player',null),
      ('${outsider}','outsider','outsider@example.test','Sem acesso','test-outsider',null),
      ('${otherGm}','gm','gm2@example.test','Outro GM','test-gm2',null),
      ('${otherPlayer}','player','player2@example.test','Outro jogador','test-player2',null);
    insert into public.net_identity_os_assignments values('${player}','veil');
    insert into public.net_identity_os_assignments values('${secondCharacter}','altara'),('${thirdCharacter}','veil'),('${otherPlayer}','veil');
    insert into public.character_sheet_forms values('${player}','{"NOME":"Personagem A"}'),('${otherPlayer}','{"NOME":"Outra conta"}');
    insert into public.npc_cards values('${secondCharacter}','Personagem B','${player}','{"NOME":"Personagem B"}'),
      ('${thirdCharacter}','Personagem C','${player}','{"NOME":"Personagem C"}');
    insert into public.net_identity_links values('${player}','profile-sheet','${player}','${player}',null),
      ('${secondCharacter}','npc-card','${secondCharacter}','${player}',null),
      ('${thirdCharacter}','npc-card','${thirdCharacter}','${player}',null),
      ('${otherPlayer}','profile-sheet','${otherPlayer}','${otherPlayer}',null);
    insert into public.net_search_knowledge_entries values('${entryId}','veil','Fonte sintética privada','Resumo original','Texto original','person','classified','active',null,null);
    insert into public.net_search_knowledge_documents values('${documentId}','altara','Documento isolado','Texto de ALTARA','classified',null,null);
  `)
  const base = await readFile(new URL('../../supabase/migrations/20260825224115_net_search_knowledge_scope_isolation_v1.sql',import.meta.url),'utf8')
  for (const name of ['set_net_gm_system_workspace_v1','current_net_search_scope_v1']) {
    const start = base.indexOf(`create or replace function public.${name}(`)
    const end = base.indexOf('$function$;',start)+12
    await db.exec(base.slice(start,end))
  }
  const migration = await readFile(new URL('../../supabase/migrations/20260905013709_lorelink_v1.sql',import.meta.url),'utf8')
  await db.exec(migration)
  const identity = await readFile(new URL('../../supabase/net-identity-selection.sql',import.meta.url),'utf8')
  const controlStart = identity.indexOf('create or replace function public.current_user_controls_net_identity_link(')
  await db.exec(identity.slice(controlStart,identity.indexOf('$$;',controlStart)+3))
  await db.exec(await readFile(new URL('../../supabase/migrations/20260905115239_lorelink_player_stories_v2.sql',import.meta.url),'utf8'))
  return db
}
export async function asActor(db,actor,operation,role='authenticated') {
  return db.transaction(async tx => {
    await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`,[actor ?? ''])
    await tx.exec(`set local role ${role === 'anon' ? 'anon' : 'authenticated'}`)
    return operation(tx)
  })
}
export async function rpc(db,actor,name,args=[],role='authenticated') {
  if (!/^(lorelink_[a-z_]+_v[12]|set_net_gm_system_workspace_v1)$/.test(name)) throw new Error('Unsupported test RPC')
  return asActor(db,actor,async tx => (await tx.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as data`,args)).rows[0].data,role)
}
export function entity(name='Ficha sintética',scope='veil') {
  return { id:crypto.randomUUID(),workspace_os_id:scope,name,kind:'person',summary:'',body:'',tags:[],canon:'draft',visibility:'private',
    fictional_date:'',image:null,archived:false,revision:0,mutation_id:'' }
}
export const save = (db,actor,value,kind='entity',mutation=crypto.randomUUID(),scope=value.workspace_os_id) =>
  rpc(db,actor,`lorelink_save_${kind}_v1`,[scope,value.revision,mutation,value])
