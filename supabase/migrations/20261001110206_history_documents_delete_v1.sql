-- Additive delete API. No existing stories are modified by applying this migration.
begin;
-- Receipts contain no story text. They make retries safe and prevent a delayed
-- creation request from resurrecting a permanently deleted page.
create table lorelink_private.entity_deletions (
  entity_id uuid primary key,
  workspace_os_id text not null,
  character_id uuid,
  deleted_by uuid not null,
  mutation_id uuid not null,
  revision integer not null
);
alter table lorelink_private.entity_deletions enable row level security;
revoke all on lorelink_private.entity_deletions from public, anon, authenticated;

create function lorelink_private.prevent_deleted_entity_insert()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('lorelink-entity:'||new.id::text,0));
  if exists(select 1 from lorelink_private.entity_deletions where entity_id=new.id) then
    raise exception 'LORELINK_DELETED' using errcode='40001';
  end if;
  return new;
end $$;
revoke all on function lorelink_private.prevent_deleted_entity_insert() from public,anon,authenticated;
create trigger lorelink_no_resurrection before insert on public.lorelink_entities
  for each row execute function lorelink_private.prevent_deleted_entity_insert();

create function lorelink_private.delete_entity(expected_character uuid, expected_scope text, entity uuid, expected_revision integer, mutation uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare old public.lorelink_entities; receipt lorelink_private.entity_deletions;
begin
  perform lorelink_private.authorize(expected_scope,expected_character,true);
  if entity is null or mutation is null or expected_revision is null or expected_revision<1 then
    raise exception 'LORELINK_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lorelink-entity:'||entity::text,0));
  select * into receipt from lorelink_private.entity_deletions where entity_id=entity;
  if found then
    if receipt.workspace_os_id<>expected_scope or receipt.character_id is distinct from expected_character
      or receipt.deleted_by<>auth.uid() or receipt.mutation_id<>mutation or receipt.revision<>expected_revision then
      raise exception 'LORELINK_NOT_FOUND' using errcode='42501'; end if;
  else
    select * into old from public.lorelink_entities where id=entity for update;
    if not found or old.workspace_os_id<>expected_scope or old.character_id is distinct from expected_character
      or (expected_character is not null and old.created_by<>auth.uid()) then
      raise exception 'LORELINK_NOT_FOUND' using errcode='42501'; end if;
    -- Attached entries remain managed by their source, including their UUID.
    if old.source_entry_id is not null or old.source_document_id is not null then
      raise exception 'LORELINK_SOURCE_REQUIRED' using errcode='42501'; end if;
    if old.revision<>expected_revision then raise exception 'LORELINK_CONFLICT' using errcode='40001'; end if;
    delete from public.lorelink_relations where source=entity or target=entity;
    delete from public.lorelink_nodes where entity_id=entity;
    delete from public.lorelink_revisions where entity_id=entity;
    delete from public.lorelink_entities where id=entity;
    insert into lorelink_private.entity_deletions values(entity,expected_scope,expected_character,auth.uid(),mutation,expected_revision);
  end if;
  return jsonb_build_object('id',entity,'workspace_os_id',expected_scope,'character_id',expected_character,
    'revision',expected_revision,'mutation_id',mutation,'deleted',true);
end $$;
revoke all on function lorelink_private.delete_entity(uuid,text,uuid,integer,uuid) from public,anon,authenticated;

create function public.lorelink_delete_entity_v1(expected_scope text, entity uuid, expected_revision integer, mutation uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select lorelink_private.delete_entity(null,expected_scope,entity,expected_revision,mutation);
$$;
create function public.lorelink_delete_entity_v2(expected_scope text, requested_character uuid, entity uuid, expected_revision integer, mutation uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if requested_character is null then raise exception 'LORELINK_FORBIDDEN' using errcode='42501'; end if;
  return lorelink_private.delete_entity(requested_character,expected_scope,entity,expected_revision,mutation);
end $$;
revoke all on function public.lorelink_delete_entity_v1(text,uuid,integer,uuid),public.lorelink_delete_entity_v2(text,uuid,uuid,integer,uuid) from public,anon;
grant execute on function public.lorelink_delete_entity_v1(text,uuid,integer,uuid),public.lorelink_delete_entity_v2(text,uuid,uuid,integer,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
