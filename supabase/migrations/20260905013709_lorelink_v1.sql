-- História / Lorelink. Additive; apply only after explicit database approval.
-- Depends on knowledge_scope isolation and the existing private rpg-media bucket.
begin;
do $$ begin
  if to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.current_net_search_scope_v1()') is null
    or not exists (select 1 from information_schema.columns where table_schema='public'
      and table_name='net_gm_persona_sessions' and column_name='workspace_os_id')
    or not exists (select 1 from storage.buckets where id='rpg-media' and not public)
  then raise exception 'LORELINK_BASE_REQUIRED' using errcode='55000'; end if;
end $$;

create schema if not exists lorelink_private;
revoke all on schema lorelink_private from public, anon, authenticated;

create table public.lorelink_entities (
  id uuid primary key,
  workspace_os_id text not null references public.net_os_families(id),
  name text not null check (length(btrim(name)) between 1 and 160),
  kind text not null check (kind in ('person','event','location','organization','object','note')),
  summary text not null default '' check (length(summary)<=2000),
  body text not null default '' check (length(body)<=500000),
  tags text[] not null default '{}' check (cardinality(tags)<=30),
  canon text not null default 'draft' check (canon in ('draft','canonical')),
  visibility text not null default 'private' check (visibility in ('private','revealed')),
  fictional_date text not null default '' check (length(fictional_date)<=200),
  image text,
  source_entry_id uuid unique references public.net_search_knowledge_entries(id) on delete restrict,
  source_document_id uuid unique references public.net_search_knowledge_documents(id) on delete restrict,
  archived boolean not null default false,
  revision integer not null default 1,
  mutation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  unique(workspace_os_id,id),
  check (num_nonnulls(source_entry_id, source_document_id)<=1),
  check ((source_entry_id is null and source_document_id is null) or
    (id=coalesce(source_entry_id,source_document_id) and body='' and summary=''))
);
create table public.lorelink_maps (
  id uuid primary key default gen_random_uuid(),
  workspace_os_id text not null references public.net_os_families(id),
  name text not null default 'Mapa do universo',
  is_default boolean not null default true,
  unique(workspace_os_id,id)
);
create unique index lorelink_default_map on public.lorelink_maps(workspace_os_id) where is_default;
create table public.lorelink_nodes (
  map_id uuid not null,
  entity_id uuid not null,
  workspace_os_id text not null,
  x double precision not null check (x between -1000000 and 1000000),
  y double precision not null check (y between -1000000 and 1000000),
  hidden boolean not null default false,
  revision integer not null default 1,
  mutation_id uuid not null,
  primary key(map_id,entity_id),
  foreign key(workspace_os_id,map_id) references public.lorelink_maps(workspace_os_id,id),
  foreign key(workspace_os_id,entity_id) references public.lorelink_entities(workspace_os_id,id)
);
create table public.lorelink_relations (
  id uuid primary key,
  workspace_os_id text not null,
  source uuid not null,
  target uuid not null,
  label text not null check (length(btrim(label)) between 1 and 120),
  visibility text not null default 'private' check (visibility in ('private','revealed')),
  archived boolean not null default false,
  revision integer not null default 1,
  mutation_id uuid not null,
  foreign key(workspace_os_id,source) references public.lorelink_entities(workspace_os_id,id),
  foreign key(workspace_os_id,target) references public.lorelink_entities(workspace_os_id,id),
  check (source<>target)
);
create index lorelink_relations_source on public.lorelink_relations(workspace_os_id,source);
create index lorelink_relations_target on public.lorelink_relations(workspace_os_id,target);
create table public.lorelink_revisions (
  id bigint generated always as identity primary key,
  workspace_os_id text not null,
  entity_id uuid not null,
  snapshot jsonb not null,
  saved_at timestamptz not null default now(),
  saved_by uuid not null references public.profiles(id),
  foreign key(workspace_os_id,entity_id) references public.lorelink_entities(workspace_os_id,id)
);
create index lorelink_revision_entity on public.lorelink_revisions(workspace_os_id,entity_id,id desc);

-- Tables have no browser grants. The public RPCs are a deliberately narrow API;
-- their private helpers resolve authority from auth.uid(), never client roles.
do $$ declare t text; begin
  foreach t in array array['entities','maps','nodes','relations','revisions'] loop
    execute format('alter table public.lorelink_%I enable row level security',t);
    execute format('revoke all on public.lorelink_%I from public, anon, authenticated',t);
  end loop;
end $$;

create function lorelink_private.context(writing boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); scope text; role_name text; control_mode text;
begin
  select role::text into role_name from public.profiles where id=actor;
  if actor is null or role_name is null or role_name not in ('gm','player')
    or (writing and role_name<>'gm') then
    raise exception 'LORELINK_FORBIDDEN' using errcode='42501';
  end if;
  if role_name='gm' then
    insert into public.net_gm_persona_sessions(gm_profile_id,subject_kind,subject_id,mode,workspace_os_id)
      values(actor,null,null,'none','veil') on conflict(gm_profile_id) do nothing;
    -- Same row lock as the existing workspace transition RPC: writes and switches serialize.
    select workspace_os_id, mode into scope,control_mode from public.net_gm_persona_sessions
      where gm_profile_id=actor for update;
    if control_mode='take-control' then
      raise exception 'LORELINK_GM_SYSTEM_REQUIRED' using errcode='42501';
    end if;
  else
    -- Retain the existing player network entitlement and identity authority.
    scope:=public.current_net_search_scope_v1();
  end if;
  if scope is null or scope not in ('veil','altara') or not exists
    (select 1 from public.net_os_families where id=scope and status='active') then
    raise exception 'LORELINK_SCOPE_UNAVAILABLE' using errcode='42501';
  end if;
  return jsonb_build_object('scope',scope,'role',role_name);
end $$;

create function lorelink_private.check_scope(expected_scope text, writing boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb:=lorelink_private.context(writing);
begin
  if expected_scope is null or expected_scope is distinct from ctx->>'scope' then
    raise exception 'LORELINK_WORKSPACE_CHANGED' using errcode='40001';
  end if;
  return ctx;
end $$;

create function lorelink_private.payload(e public.lorelink_entities)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select to_jsonb(e) || jsonb_build_object(
    'name',coalesce(k.title,d.title,e.name),'summary',coalesce(k.summary,e.summary),
    'body',coalesce(k.content,d.raw_content,e.body),
    'source_kind',case when k.id is not null then 'knowledge' when d.id is not null then 'lore_document' else null end)
  from (select 1) anchor
  left join public.net_search_knowledge_entries k on k.id=e.source_entry_id and k.knowledge_scope=e.workspace_os_id
  left join public.net_search_knowledge_documents d on d.id=e.source_document_id and d.knowledge_scope=e.workspace_os_id;
$$;

create function lorelink_private.visible(e public.lorelink_entities, gm boolean)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select gm or (not e.archived and e.visibility='revealed'
    and (e.source_entry_id is null or exists (select 1 from public.net_search_knowledge_entries k
      where k.id=e.source_entry_id and k.knowledge_scope=e.workspace_os_id and k.visibility='public'
      and k.status='active' and (k.available_from is null or k.available_from<=now()) and (k.expires_at is null or k.expires_at>now())))
    and (e.source_document_id is null or exists (select 1 from public.net_search_knowledge_documents d
      where d.id=e.source_document_id and d.knowledge_scope=e.workspace_os_id and d.visibility='public'
      and (d.available_from is null or d.available_from<=now()) and (d.expires_at is null or d.expires_at>now()))));
$$;

create function public.lorelink_context_v1() returns jsonb language sql security definer
set search_path=public,pg_temp as $$ select lorelink_private.context(); $$;

create function public.lorelink_read_v1(expected_scope text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb:=lorelink_private.check_scope(expected_scope); gm boolean:=ctx->>'role'='gm'; map uuid;
begin
  if gm then
    insert into public.lorelink_maps(workspace_os_id) values(expected_scope)
      on conflict(workspace_os_id) where is_default do nothing;
  end if;
  select id into map from public.lorelink_maps where workspace_os_id=expected_scope and is_default;
  return jsonb_build_object('scope',expected_scope,'role',ctx->>'role','map_id',map,
    'entities',coalesce((select jsonb_agg(lorelink_private.payload(e) order by e.created_at,e.id)
      from public.lorelink_entities e where e.workspace_os_id=expected_scope and lorelink_private.visible(e,gm)),'[]'::jsonb),
    'nodes',coalesce((select jsonb_agg(to_jsonb(n)) from public.lorelink_nodes n
      join public.lorelink_entities e on e.id=n.entity_id and e.workspace_os_id=n.workspace_os_id
      where n.map_id=map and n.workspace_os_id=expected_scope and lorelink_private.visible(e,gm)),'[]'::jsonb),
    'relations',coalesce((select jsonb_agg(to_jsonb(r)) from public.lorelink_relations r
      join public.lorelink_entities a on a.id=r.source and a.workspace_os_id=r.workspace_os_id
      join public.lorelink_entities b on b.id=r.target and b.workspace_os_id=r.workspace_os_id
      where r.workspace_os_id=expected_scope and not r.archived and not a.archived and not b.archived
      and (gm or r.visibility='revealed') and lorelink_private.visible(a,gm) and lorelink_private.visible(b,gm)),'[]'::jsonb));
end $$;

create function public.lorelink_save_entity_v1(expected_scope text, expected_revision integer, mutation uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare old public.lorelink_entities; e public.lorelink_entities; eid uuid:=(payload->>'id')::uuid; tag text;
begin
  perform lorelink_private.check_scope(expected_scope,true);
  if mutation is null or eid is null or expected_revision is null then raise exception 'LORELINK_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lorelink-entity:'||eid::text,0));
  select * into old from public.lorelink_entities where id=eid for update;
  if found then
    if old.workspace_os_id<>expected_scope then raise exception 'LORELINK_NOT_FOUND' using errcode='42501'; end if;
    if old.mutation_id=mutation then return lorelink_private.payload(old); end if;
    if old.revision<>expected_revision then raise exception 'LORELINK_CONFLICT' using errcode='40001'; end if;
    -- Source-backed entities reference their original content and UUID, never copies.
    if old.source_entry_id is not null or old.source_document_id is not null then
      payload:=payload || jsonb_build_object('name',old.name,'summary','','body','');
    end if;
  elsif expected_revision<>0 then raise exception 'LORELINK_CONFLICT' using errcode='40001';
  end if;
  e:=jsonb_populate_record(null::public.lorelink_entities,payload - array['mutation_id','created_by','created_at','updated_at','source_entry_id','source_document_id','revision']);
  if e.name is null or e.kind is null or e.canon is null or e.visibility is null
    or e.archived is null or e.tags is null then raise exception 'LORELINK_INVALID'; end if;
  foreach tag in array e.tags loop
    if tag is null or length(btrim(tag)) not between 1 and 60 then raise exception 'LORELINK_TAG_INVALID'; end if;
  end loop;
  if old.id is null and (e.visibility<>'private' or e.archived) then
    raise exception 'LORELINK_NEW_PRIVATE_REQUIRED' using errcode='22023'; end if;
  if e.image is not null and not lorelink_private.valid_image(e.image,eid,expected_scope) then
    raise exception 'LORELINK_IMAGE_INVALID' using errcode='22023'; end if;
  if old.id is not null then
    insert into public.lorelink_revisions(workspace_os_id,entity_id,snapshot,saved_by)
      values(expected_scope,eid,to_jsonb(old),auth.uid());
    update public.lorelink_entities set name=e.name,kind=e.kind,summary=coalesce(e.summary,''),body=coalesce(e.body,''),
      tags=e.tags,canon=e.canon,visibility=e.visibility,fictional_date=coalesce(e.fictional_date,''),image=e.image,
      archived=e.archived,revision=revision+1,mutation_id=mutation,updated_at=clock_timestamp()
      where id=eid returning * into e;
  else
    insert into public.lorelink_entities(id,workspace_os_id,name,kind,summary,body,tags,canon,visibility,
      fictional_date,image,archived,mutation_id,created_by)
      values(eid,expected_scope,e.name,e.kind,coalesce(e.summary,''),coalesce(e.body,''),e.tags,e.canon,'private',
        coalesce(e.fictional_date,''),e.image,false,mutation,auth.uid()) returning * into e;
  end if;
  return lorelink_private.payload(e);
end $$;

create function public.lorelink_save_node_v1(expected_scope text, expected_revision integer, mutation uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare old public.lorelink_nodes; n public.lorelink_nodes:=jsonb_populate_record(null::public.lorelink_nodes,payload - 'mutation_id');
begin
  perform lorelink_private.check_scope(expected_scope,true);
  perform pg_advisory_xact_lock(hashtextextended('lorelink-node:'||n.map_id::text||n.entity_id::text,0));
  if not exists(select 1 from public.lorelink_entities where id=n.entity_id and workspace_os_id=expected_scope and not archived)
    or not exists(select 1 from public.lorelink_maps where id=n.map_id and workspace_os_id=expected_scope) then
    raise exception 'LORELINK_NOT_FOUND' using errcode='42501'; end if;
  select * into old from public.lorelink_nodes where map_id=n.map_id and entity_id=n.entity_id for update;
  if old.mutation_id=mutation then return to_jsonb(old); end if;
  if expected_revision is distinct from coalesce(old.revision,0) then raise exception 'LORELINK_CONFLICT' using errcode='40001'; end if;
  insert into public.lorelink_nodes(map_id,entity_id,workspace_os_id,x,y,hidden,revision,mutation_id)
    values(n.map_id,n.entity_id,expected_scope,n.x,n.y,n.hidden,coalesce(old.revision,0)+1,mutation)
    on conflict(map_id,entity_id) do update set x=excluded.x,y=excluded.y,hidden=excluded.hidden,
      revision=excluded.revision,mutation_id=excluded.mutation_id returning * into n;
  return to_jsonb(n);
end $$;

create function public.lorelink_save_relation_v1(expected_scope text, expected_revision integer, mutation uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare old public.lorelink_relations; r public.lorelink_relations:=jsonb_populate_record(null::public.lorelink_relations,payload - 'mutation_id');
begin
  perform lorelink_private.check_scope(expected_scope,true);
  perform pg_advisory_xact_lock(hashtextextended('lorelink-relation:'||r.id::text,0));
  select * into old from public.lorelink_relations where id=r.id for update;
  if old.id is not null and old.workspace_os_id<>expected_scope then raise exception 'LORELINK_NOT_FOUND' using errcode='42501'; end if;
  if old.mutation_id=mutation then return to_jsonb(old); end if;
  if expected_revision is distinct from coalesce(old.revision,0) then raise exception 'LORELINK_CONFLICT' using errcode='40001'; end if;
  if (select count(*) from public.lorelink_entities where id in(r.source,r.target)
    and workspace_os_id=expected_scope and not archived)<>2 then raise exception 'LORELINK_NOT_FOUND' using errcode='42501'; end if;
  if old.id is null and r.visibility<>'private' then raise exception 'LORELINK_NEW_PRIVATE_REQUIRED'; end if;
  insert into public.lorelink_relations(id,workspace_os_id,source,target,label,visibility,archived,revision,mutation_id)
    values(r.id,expected_scope,r.source,r.target,r.label,r.visibility,r.archived,coalesce(old.revision,0)+1,mutation)
    on conflict(id) do update set source=excluded.source,target=excluded.target,label=excluded.label,
      visibility=excluded.visibility,archived=excluded.archived,revision=excluded.revision,mutation_id=excluded.mutation_id returning * into r;
  return to_jsonb(r);
end $$;

create function public.lorelink_history_v1(expected_scope text, entity uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform lorelink_private.check_scope(expected_scope,true);
  return coalesce((select jsonb_agg(to_jsonb(v) order by v.id desc) from
    (select id,snapshot,saved_at from public.lorelink_revisions where workspace_os_id=expected_scope and entity_id=entity
    order by id desc limit 30) v),'[]'::jsonb);
end $$;

create function public.lorelink_sources_v1(expected_scope text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform lorelink_private.check_scope(expected_scope,true);
  return coalesce((select jsonb_agg(s) from (
    select id,title,'knowledge' as source_kind from public.net_search_knowledge_entries where knowledge_scope=expected_scope
    union all select id,title,'lore_document' from public.net_search_knowledge_documents where knowledge_scope=expected_scope
  ) s),'[]'::jsonb);
end $$;

create function public.lorelink_attach_v1(expected_scope text, source_id uuid, source_kind text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.lorelink_entities; title text; kind text;
begin
  perform lorelink_private.check_scope(expected_scope,true);
  if source_kind='knowledge' then
    select k.title,case when k.entry_type in('person','event','location','organization') then k.entry_type else 'note' end
      into title,kind from public.net_search_knowledge_entries k where id=source_id and knowledge_scope=expected_scope;
  elsif source_kind='lore_document' then
    select d.title,'note' into title,kind from public.net_search_knowledge_documents d where id=source_id and knowledge_scope=expected_scope;
  end if;
  if title is null then raise exception 'LORELINK_NOT_FOUND' using errcode='42501'; end if;
  insert into public.lorelink_entities(id,workspace_os_id,name,kind,source_entry_id,source_document_id,mutation_id,created_by)
    values(source_id,expected_scope,title,kind,case when source_kind='knowledge' then source_id end,
      case when source_kind='lore_document' then source_id end,gen_random_uuid(),auth.uid()) on conflict(id) do nothing;
  select * into e from public.lorelink_entities where id=source_id and workspace_os_id=expected_scope
    and coalesce(source_entry_id,source_document_id)=source_id;
  if e.id is null then raise exception 'LORELINK_NOT_FOUND' using errcode='42501'; end if;
  return lorelink_private.payload(e);
end $$;

-- Preserve the existing image optimizer, descriptors and private bucket. No public URLs.
create function lorelink_private.decode_image(reference text)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
  select convert_from(decode(translate(substr(reference,14),'-_','+/')
    ||repeat('=',(4-length(substr(reference,14))%4)%4),'base64'),'UTF8')::jsonb;
$$;

create function lorelink_private.valid_image(reference text, entity uuid, scope text)
returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
declare descriptor jsonb; variant jsonb; prefix text:='lorelink-entity/'||entity::text||'/avatar/'||scope||'/';
begin
  if reference not like 'rpg-media:v1:%' then return false; end if;
  descriptor:=lorelink_private.decode_image(reference);
  if descriptor->>'v' is distinct from '1' or jsonb_typeof(descriptor->'d') is distinct from 'object'
    or descriptor->>'h' is null or descriptor->>'h' !~ '^[a-f0-9]{32,64}$' then return false; end if;
  foreach variant in array array[descriptor->'d',descriptor->'t'] loop
    if variant is null then continue; end if;
    if jsonb_typeof(variant) is distinct from 'object' or variant->>'p' is null
      or left(variant->>'p',length(prefix))<>prefix or variant->>'p' like '%..%'
      or variant->>'p' !~ '/[a-f0-9]{32}/(display|thumbnail)\.(webp|png|jpg|jpeg|gif|avif)$'
      or split_part(variant->>'p','/',5)<>left(descriptor->>'h',32)
      or coalesce((variant->>'w')::bigint,0) not between 1 and 64000000
      or coalesce((variant->>'h')::bigint,0) not between 1 and 64000000
      or coalesce((variant->>'b')::bigint,0) not between 1 and 20971520
      or coalesce(variant->>'m','') not in('image/png','image/jpeg','image/webp','image/avif','image/gif')
      then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create function public.lorelink_media_allowed_v1(object_name text, writing boolean)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb; e public.lorelink_entities;
begin
  if split_part(object_name,'/',1)<>'lorelink-entity' then return false; end if;
  ctx:=lorelink_private.context(writing);
  select * into e from public.lorelink_entities where id::text=split_part(object_name,'/',2)
    and workspace_os_id=ctx->>'scope' and workspace_os_id=split_part(object_name,'/',4);
  if e.id is null or not lorelink_private.visible(e,ctx->>'role'='gm')
    or split_part(object_name,'/',3)<>'avatar' or object_name like '%..%' then return false; end if;
  if writing then return true; end if;
  if ctx->>'role'='gm' then return true; end if;
  return e.image is not null and exists (
    select 1 from jsonb_each(lorelink_private.decode_image(e.image)) v
    where v.key in('d','t') and v.value->>'p'=object_name);
exception when others then return false;
end $$;

create policy lorelink_media_read on storage.objects for select to authenticated
  using(bucket_id='rpg-media' and public.lorelink_media_allowed_v1(name,false));
create policy lorelink_media_insert on storage.objects for insert to authenticated
  with check(bucket_id='rpg-media' and public.lorelink_media_allowed_v1(name,true));
-- Restrictive guards prevent older broad GM/media policies from granting cross-universe access.
create policy lorelink_media_read_guard on storage.objects as restrictive for select to authenticated
  using(bucket_id<>'rpg-media' or split_part(name,'/',1)<>'lorelink-entity' or public.lorelink_media_allowed_v1(name,false));
create policy lorelink_media_insert_guard on storage.objects as restrictive for insert to authenticated
  with check(bucket_id<>'rpg-media' or split_part(name,'/',1)<>'lorelink-entity' or public.lorelink_media_allowed_v1(name,true));
create policy lorelink_media_update_guard on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'rpg-media' or split_part(name,'/',1)<>'lorelink-entity')
  with check(bucket_id<>'rpg-media' or split_part(name,'/',1)<>'lorelink-entity');
create policy lorelink_media_delete_guard on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'rpg-media' or split_part(name,'/',1)<>'lorelink-entity');

revoke all on all functions in schema lorelink_private from public,anon,authenticated;
do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname like 'lorelink_%_v1' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;
commit;
