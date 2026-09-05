-- História pessoal: extensão aditiva da v1. Não altera papéis nem fichas RPG.
-- Aplicar manualmente no Supabase do RPG, depois da migração Lorelink v1.
begin;
do $$ begin
  if to_regprocedure('public.lorelink_context_v1()') is null
    or to_regprocedure('public.current_user_controls_net_identity_link(uuid)') is null
    or to_regclass('public.net_identity_os_assignments') is null then
    raise exception 'LORELINK_BASE_REQUIRED';
  end if;
end $$;

-- character_id references the existing NET identity, not a duplicated character.
-- NULL retains the existing GM universe collection. Private collections are
-- partitioned by author + character + the authoritative universe assignment.
-- Retain the immutable identity UUID if an existing character is deleted. A
-- missing identity denies access; it must NEVER become NULL (GM collection).
-- This also keeps the existing character deletion flow operational.
alter table public.lorelink_entities add column character_id uuid;
alter table public.lorelink_maps add column character_id uuid;
alter table public.lorelink_maps add column created_by uuid references public.profiles(id) on delete restrict;
alter table public.lorelink_nodes add column character_id uuid;
alter table public.lorelink_nodes add column created_by uuid references public.profiles(id) on delete restrict;
alter table public.lorelink_relations add column character_id uuid;
alter table public.lorelink_relations add column created_by uuid references public.profiles(id) on delete restrict;
alter table public.lorelink_entities add constraint lorelink_personal_private check
  (character_id is null or (visibility='private' and source_entry_id is null and source_document_id is null));
alter table public.lorelink_maps add constraint lorelink_personal_map check
  ((character_id is null and created_by is null) or (character_id is not null and created_by is not null and not is_default));
alter table public.lorelink_nodes add constraint lorelink_personal_node check
  ((character_id is null) = (created_by is null));
alter table public.lorelink_relations add constraint lorelink_personal_relation check
  ((character_id is null and created_by is null) or (character_id is not null and created_by is not null and visibility='private'));
create unique index lorelink_character_map on public.lorelink_maps(created_by,character_id,workspace_os_id) where character_id is not null;
create index lorelink_character_entities on public.lorelink_entities(created_by,character_id,workspace_os_id) where character_id is not null;
create index lorelink_character_relations on public.lorelink_relations(created_by,character_id,workspace_os_id) where character_id is not null;
alter table public.lorelink_entities add unique(workspace_os_id,character_id,created_by,id);
alter table public.lorelink_maps add unique(workspace_os_id,character_id,created_by,id);
alter table public.lorelink_nodes add foreign key(workspace_os_id,character_id,created_by,entity_id)
  references public.lorelink_entities(workspace_os_id,character_id,created_by,id);
alter table public.lorelink_nodes add foreign key(workspace_os_id,character_id,created_by,map_id)
  references public.lorelink_maps(workspace_os_id,character_id,created_by,id);
alter table public.lorelink_relations add foreign key(workspace_os_id,character_id,created_by,source)
  references public.lorelink_entities(workspace_os_id,character_id,created_by,id);
alter table public.lorelink_relations add foreign key(workspace_os_id,character_id,created_by,target)
  references public.lorelink_entities(workspace_os_id,character_id,created_by,id);

create function lorelink_private.character_context(requested_character uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare link public.net_identity_links; scope text; title text;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role::text in ('gm','player')) then
    raise exception 'LORELINK_FORBIDDEN' using errcode='42501'; end if;
  -- Lock authority while writing so ownership/universe changes cannot redirect a save.
  select * into link from public.net_identity_links where id=requested_character and owner_profile_id=auth.uid() for share;
  if link.id is null or not public.current_user_controls_net_identity_link(link.id) then
    raise exception 'LORELINK_FORBIDDEN' using errcode='42501'; end if;
  if link.subject_kind='npc-card' then
    perform 1 from public.npc_cards where id=link.subject_id and owner_profile_id=auth.uid() for share;
    if not found then raise exception 'LORELINK_FORBIDDEN' using errcode='42501'; end if;
  elsif link.subject_kind='character' then
    perform 1 from public.characters where id=link.subject_id and owner_profile_id=auth.uid() and campaign_id=link.campaign_id for share;
    if not found then raise exception 'LORELINK_FORBIDDEN' using errcode='42501'; end if;
  end if;
  select primary_os_id into scope from public.net_identity_os_assignments where identity_link_id=link.id for share;
  if scope is null or scope not in ('veil','altara') or not exists
    (select 1 from public.net_os_families where id=scope and status='active') then
    raise exception 'LORELINK_SCOPE_UNAVAILABLE' using errcode='42501'; end if;
  if link.subject_kind='profile-sheet' then
    select coalesce(nullif(btrim(s.field_data->>'NOME'),''),nullif(p.handle,''),p.display_name)
      into title from public.profiles p left join public.character_sheet_forms s on s.profile_id=p.id where p.id=link.subject_id;
  elsif link.subject_kind='npc-card' then
    select coalesce(nullif(btrim(field_data->>'NOME'),''),display_name) into title from public.npc_cards where id=link.subject_id;
  else
    select name into title from public.characters where id=link.subject_id;
  end if;
  return jsonb_build_object('scope',scope,'role','author','character_id',link.id,'character_name',coalesce(title,'Personagem'),
    'subject_id',link.subject_id,'subject_kind',link.subject_kind);
end $$;

create function lorelink_private.authorize(expected_scope text, expected_character uuid, writing boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb;
begin
  if expected_character is null then return lorelink_private.check_scope(expected_scope,writing); end if;
  ctx:=lorelink_private.character_context(expected_character);
  if expected_scope is distinct from ctx->>'scope' then
    raise exception 'LORELINK_WORKSPACE_CHANGED' using errcode='40001'; end if;
  return ctx;
end $$;

create function public.lorelink_characters_v2()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb:='[]'; item record;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role::text in ('gm','player')) then
    raise exception 'LORELINK_FORBIDDEN' using errcode='42501'; end if;
  for item in select l.id from public.net_identity_links l
    join public.net_identity_os_assignments a on a.identity_link_id=l.id
    join public.net_os_families f on f.id=a.primary_os_id and f.status='active' and f.id in ('veil','altara')
    where l.owner_profile_id=auth.uid() and public.current_user_controls_net_identity_link(l.id) order by l.id loop
    result:=result || jsonb_build_array(lorelink_private.character_context(item.id));
  end loop;
  return result;
end $$;

create function public.lorelink_context_v2(requested_character uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select lorelink_private.character_context(requested_character);
$$;

create function public.lorelink_read_v2(expected_scope text, requested_character uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb; map uuid;
begin
  if requested_character is null then raise exception 'LORELINK_FORBIDDEN' using errcode='42501'; end if;
  ctx:=lorelink_private.authorize(expected_scope,requested_character,false);
  insert into public.lorelink_maps(workspace_os_id,character_id,created_by,name,is_default)
    values(expected_scope,requested_character,auth.uid(),'Mapa da personagem',false)
    on conflict(created_by,character_id,workspace_os_id) where character_id is not null do nothing;
  select id into map from public.lorelink_maps where workspace_os_id=expected_scope and character_id=requested_character and created_by=auth.uid();
  return ctx || jsonb_build_object('map_id',map,
    'entities',coalesce((select jsonb_agg(lorelink_private.payload(e) order by e.created_at,e.id) from public.lorelink_entities e
      where e.workspace_os_id=expected_scope and e.character_id=requested_character and e.created_by=auth.uid()),'[]'::jsonb),
    'nodes',coalesce((select jsonb_agg(to_jsonb(n)) from public.lorelink_nodes n where n.map_id=map
      and n.workspace_os_id=expected_scope and n.character_id=requested_character and n.created_by=auth.uid()),'[]'::jsonb),
    'relations',coalesce((select jsonb_agg(to_jsonb(r)) from public.lorelink_relations r
      join public.lorelink_entities a on a.id=r.source and a.character_id=requested_character and a.created_by=auth.uid() and a.workspace_os_id=expected_scope
      join public.lorelink_entities b on b.id=r.target and b.character_id=requested_character and b.created_by=auth.uid() and b.workspace_os_id=expected_scope
      where r.workspace_os_id=expected_scope and r.character_id=requested_character and r.created_by=auth.uid()
      and not r.archived and not a.archived and not b.archived),'[]'::jsonb));
end $$;




-- Legacy universe reads never expose private player collections, including to a GM.
create or replace function lorelink_private.visible(e public.lorelink_entities, gm boolean)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select e.character_id is null and (gm or (not e.archived and e.visibility='revealed'
    and (e.source_entry_id is null or exists (select 1 from public.net_search_knowledge_entries k
      where k.id=e.source_entry_id and k.knowledge_scope=e.workspace_os_id and k.visibility='public'
      and k.status='active' and (k.available_from is null or k.available_from<=now()) and (k.expires_at is null or k.expires_at>now())))
    and (e.source_document_id is null or exists (select 1 from public.net_search_knowledge_documents d
      where d.id=e.source_document_id and d.knowledge_scope=e.workspace_os_id and d.visibility='public'
      and (d.available_from is null or d.available_from<=now()) and (d.expires_at is null or d.expires_at>now())))));
$$;

create function lorelink_private.save_entity(expected_character uuid, expected_scope text, expected_revision integer, mutation uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare old public.lorelink_entities; e public.lorelink_entities; eid uuid:=(payload->>'id')::uuid; tag text;
begin
  perform lorelink_private.authorize(expected_scope,expected_character,true);
  if expected_character is not null and payload->>'visibility' is not null and payload->>'visibility'<>'private' then
    raise exception 'LORELINK_PRIVATE_REQUIRED' using errcode='42501'; end if;
  if mutation is null or eid is null or expected_revision is null then raise exception 'LORELINK_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lorelink-entity:'||eid::text,0));
  select * into old from public.lorelink_entities where id=eid for update;
  if found then
    if old.workspace_os_id<>expected_scope or old.character_id is distinct from expected_character
      or (expected_character is not null and old.created_by<>auth.uid()) then raise exception 'LORELINK_NOT_FOUND' using errcode='42501'; end if;
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
      fictional_date,image,archived,mutation_id,created_by,character_id)
      values(eid,expected_scope,e.name,e.kind,coalesce(e.summary,''),coalesce(e.body,''),e.tags,e.canon,'private',
        coalesce(e.fictional_date,''),e.image,false,mutation,auth.uid(),expected_character) returning * into e;
  end if;
  return lorelink_private.payload(e);
end $$;

create or replace function public.lorelink_save_entity_v1(expected_scope text, expected_revision integer, mutation uuid, payload jsonb)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select lorelink_private.save_entity(null,expected_scope,expected_revision,mutation,payload);
$$;
create function public.lorelink_save_entity_v2(expected_scope text, requested_character uuid, expected_revision integer, mutation uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if requested_character is null then raise exception 'LORELINK_FORBIDDEN' using errcode='42501'; end if;
  return lorelink_private.save_entity(requested_character,expected_scope,expected_revision,mutation,payload);
end $$;

create function lorelink_private.save_node(expected_character uuid, expected_scope text, expected_revision integer, mutation uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare old public.lorelink_nodes; n public.lorelink_nodes:=jsonb_populate_record(null::public.lorelink_nodes,payload - 'mutation_id');
begin
  perform lorelink_private.authorize(expected_scope,expected_character,true);
  if expected_character is not null and payload->>'visibility' is not null and payload->>'visibility'<>'private' then
    raise exception 'LORELINK_PRIVATE_REQUIRED' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lorelink-node:'||n.map_id::text||n.entity_id::text,0));
  if not exists(select 1 from public.lorelink_entities where id=n.entity_id and workspace_os_id=expected_scope and not archived
    and character_id is not distinct from expected_character and (expected_character is null or created_by=auth.uid()))
    or not exists(select 1 from public.lorelink_maps where id=n.map_id and workspace_os_id=expected_scope
    and character_id is not distinct from expected_character and (expected_character is null or created_by=auth.uid())) then
    raise exception 'LORELINK_NOT_FOUND' using errcode='42501'; end if;
  select * into old from public.lorelink_nodes where map_id=n.map_id and entity_id=n.entity_id for update;
  if old.mutation_id=mutation then return to_jsonb(old); end if;
  if expected_revision is distinct from coalesce(old.revision,0) then raise exception 'LORELINK_CONFLICT' using errcode='40001'; end if;
  insert into public.lorelink_nodes(map_id,entity_id,workspace_os_id,x,y,hidden,revision,mutation_id,character_id,created_by)
    values(n.map_id,n.entity_id,expected_scope,n.x,n.y,n.hidden,coalesce(old.revision,0)+1,mutation,expected_character,case when expected_character is not null then auth.uid() end)
    on conflict(map_id,entity_id) do update set x=excluded.x,y=excluded.y,hidden=excluded.hidden,
      revision=excluded.revision,mutation_id=excluded.mutation_id returning * into n;
  return to_jsonb(n);
end $$;

create or replace function public.lorelink_save_node_v1(expected_scope text, expected_revision integer, mutation uuid, payload jsonb)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select lorelink_private.save_node(null,expected_scope,expected_revision,mutation,payload);
$$;
create function public.lorelink_save_node_v2(expected_scope text, requested_character uuid, expected_revision integer, mutation uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if requested_character is null then raise exception 'LORELINK_FORBIDDEN' using errcode='42501'; end if;
  return lorelink_private.save_node(requested_character,expected_scope,expected_revision,mutation,payload);
end $$;

create function lorelink_private.save_relation(expected_character uuid, expected_scope text, expected_revision integer, mutation uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare old public.lorelink_relations; r public.lorelink_relations:=jsonb_populate_record(null::public.lorelink_relations,payload - 'mutation_id');
begin
  perform lorelink_private.authorize(expected_scope,expected_character,true);
  if expected_character is not null and payload->>'visibility' is not null and payload->>'visibility'<>'private' then
    raise exception 'LORELINK_PRIVATE_REQUIRED' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lorelink-relation:'||r.id::text,0));
  select * into old from public.lorelink_relations where id=r.id for update;
  if old.id is not null and (old.workspace_os_id<>expected_scope or old.character_id is distinct from expected_character
    or (expected_character is not null and old.created_by<>auth.uid())) then raise exception 'LORELINK_NOT_FOUND' using errcode='42501'; end if;
  if old.mutation_id=mutation then return to_jsonb(old); end if;
  if expected_revision is distinct from coalesce(old.revision,0) then raise exception 'LORELINK_CONFLICT' using errcode='40001'; end if;
  if (select count(*) from public.lorelink_entities where id in(r.source,r.target)
    and workspace_os_id=expected_scope and not archived
    and character_id is not distinct from expected_character and (expected_character is null or created_by=auth.uid()))<>2 then raise exception 'LORELINK_NOT_FOUND' using errcode='42501'; end if;
  if old.id is null and r.visibility<>'private' then raise exception 'LORELINK_NEW_PRIVATE_REQUIRED'; end if;
  insert into public.lorelink_relations(id,workspace_os_id,source,target,label,visibility,archived,revision,mutation_id,character_id,created_by)
    values(r.id,expected_scope,r.source,r.target,r.label,r.visibility,r.archived,coalesce(old.revision,0)+1,mutation,expected_character,case when expected_character is not null then auth.uid() end)
    on conflict(id) do update set source=excluded.source,target=excluded.target,label=excluded.label,
      visibility=excluded.visibility,archived=excluded.archived,revision=excluded.revision,mutation_id=excluded.mutation_id returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.lorelink_save_relation_v1(expected_scope text, expected_revision integer, mutation uuid, payload jsonb)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select lorelink_private.save_relation(null,expected_scope,expected_revision,mutation,payload);
$$;
create function public.lorelink_save_relation_v2(expected_scope text, requested_character uuid, expected_revision integer, mutation uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if requested_character is null then raise exception 'LORELINK_FORBIDDEN' using errcode='42501'; end if;
  return lorelink_private.save_relation(requested_character,expected_scope,expected_revision,mutation,payload);
end $$;

create function lorelink_private.history(expected_character uuid, expected_scope text, entity uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform lorelink_private.authorize(expected_scope,expected_character,true);
  if not exists(select 1 from public.lorelink_entities where id=entity and workspace_os_id=expected_scope
    and character_id is not distinct from expected_character and (expected_character is null or created_by=auth.uid())) then
    raise exception 'LORELINK_NOT_FOUND' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(v) order by v.id desc) from
    (select id,snapshot,saved_at from public.lorelink_revisions where workspace_os_id=expected_scope and entity_id=entity
    order by id desc limit 30) v),'[]'::jsonb);
end $$;

create or replace function public.lorelink_history_v1(expected_scope text, entity uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select lorelink_private.history(null,expected_scope,entity);
$$;
create function public.lorelink_history_v2(expected_scope text, requested_character uuid, entity uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if requested_character is null then raise exception 'LORELINK_FORBIDDEN' using errcode='42501'; end if;
  return lorelink_private.history(requested_character,expected_scope,entity);
end $$;

create or replace function public.lorelink_media_allowed_v1(object_name text, writing boolean)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb; e public.lorelink_entities;
begin
  if split_part(object_name,'/',1)<>'lorelink-entity' then return false; end if;
  select * into e from public.lorelink_entities where id::text=split_part(object_name,'/',2);
  if e.character_id is not null then
    ctx:=lorelink_private.character_context(e.character_id);
    return e.created_by=auth.uid() and e.workspace_os_id=ctx->>'scope' and not e.archived
      and e.workspace_os_id=split_part(object_name,'/',4) and split_part(object_name,'/',3)='avatar'
      and object_name not like '%..%'
      and object_name ~ '/[a-f0-9]{32}/(display|thumbnail)\.(webp|png|jpg|jpeg|gif|avif)$';
  end if;
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

-- Tables still have RLS and no browser grants. Only these checked RPCs are exposed.
revoke all on all functions in schema lorelink_private from public,anon,authenticated;
do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname like 'lorelink_%_v2' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
