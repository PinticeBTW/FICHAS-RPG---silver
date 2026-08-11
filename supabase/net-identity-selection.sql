-- Server-authoritative playable identity classification and global active
-- identity selection for THE NET. Run after schema.sql and npc-cards.sql.

create extension if not exists pgcrypto;

create table if not exists public.net_identity_links (
  id uuid primary key default gen_random_uuid(),
  subject_kind text not null check (subject_kind in ('profile-sheet', 'npc-card', 'character')),
  subject_id uuid not null,
  entity_id text,
  owner_profile_id uuid references public.profiles (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete cascade,
  identity_kind text not null check (identity_kind in ('player', 'npc')),
  playability text not null check (playability in ('playable', 'non-playable')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (subject_kind, subject_id)
);

create table if not exists public.net_active_identities (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  identity_link_id uuid not null references public.net_identity_links (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.net_identity_links is
  'Classifies sheet subjects for THE NET without duplicating character-sheet content.';
comment on table public.net_active_identities is
  'One global active fictional identity per authenticated profile; campaign-scoped selection is deferred.';
comment on column public.net_identity_links.entity_id is
  'Optional explicit Shared World Core id. Never inferred from names or profile UUIDs.';
comment on column public.net_identity_links.owner_profile_id is
  'Authoritative control owner derived from the subject when a GM classifies it; source ownership changes invalidate selection until reclassification.';

create index if not exists net_identity_links_owner_profile_id_idx
  on public.net_identity_links (owner_profile_id);
create index if not exists net_identity_links_campaign_id_idx
  on public.net_identity_links (campaign_id);
create index if not exists net_active_identities_identity_link_id_idx
  on public.net_active_identities (identity_link_id);

create or replace function public.validate_net_identity_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_owner uuid;
  resolved_campaign uuid;
begin
  case new.subject_kind
    when 'profile-sheet' then
      select profile.id
      into resolved_owner
      from public.profiles as profile
      where profile.id = new.subject_id;

      if not found then
        raise exception 'Unknown profile-sheet subject.' using errcode = '23503';
      end if;

      new.owner_profile_id := resolved_owner;
      new.campaign_id := null;
      new.identity_kind := 'player';

    when 'npc-card' then
      select card.owner_profile_id
      into resolved_owner
      from public.npc_cards as card
      where card.id = new.subject_id;

      if not found then
        raise exception 'Unknown npc-card subject.' using errcode = '23503';
      end if;

      new.owner_profile_id := resolved_owner;
      new.campaign_id := null;

    when 'character' then
      select character.owner_profile_id, character.campaign_id
      into resolved_owner, resolved_campaign
      from public.characters as character
      where character.id = new.subject_id;

      if not found then
        raise exception 'Unknown character subject.' using errcode = '23503';
      end if;

      new.owner_profile_id := resolved_owner;
      new.campaign_id := resolved_campaign;

    else
      raise exception 'Unsupported NET identity subject kind.' using errcode = '22023';
  end case;

  return new;
end;
$$;

drop trigger if exists net_identity_links_validate_subject on public.net_identity_links;
create trigger net_identity_links_validate_subject
before insert or update on public.net_identity_links
for each row execute procedure public.validate_net_identity_link();

drop trigger if exists net_identity_links_set_updated_at on public.net_identity_links;
create trigger net_identity_links_set_updated_at
before update on public.net_identity_links
for each row execute procedure public.set_updated_at();

drop trigger if exists net_active_identities_set_updated_at on public.net_active_identities;
create trigger net_active_identities_set_updated_at
before update on public.net_active_identities
for each row execute procedure public.set_updated_at();

create or replace function public.current_user_controls_net_identity_link(
  target_link_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.net_identity_links as identity_link
    where identity_link.id = target_link_id
      and identity_link.owner_profile_id = auth.uid()
      and case identity_link.subject_kind
        when 'profile-sheet' then exists (
          select 1
          from public.profiles as profile
          where profile.id = identity_link.subject_id
            and profile.id = auth.uid()
        )
        when 'npc-card' then exists (
          select 1
          from public.npc_cards as card
          where card.id = identity_link.subject_id
            and card.owner_profile_id = auth.uid()
        )
        when 'character' then exists (
          select 1
          from public.characters as character
          where character.id = identity_link.subject_id
            and character.owner_profile_id = auth.uid()
            and character.campaign_id = identity_link.campaign_id
        )
        else false
      end
  );
$$;

create or replace function public.prune_invalid_net_active_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.net_active_identities as active_identity
  where active_identity.identity_link_id = new.id
    and (
      new.playability <> 'playable'
      or new.identity_kind <> 'player'
      or new.owner_profile_id is distinct from active_identity.profile_id
    );

  return new;
end;
$$;

drop trigger if exists net_identity_links_prune_active on public.net_identity_links;
create trigger net_identity_links_prune_active
after update of owner_profile_id, identity_kind, playability on public.net_identity_links
for each row execute procedure public.prune_invalid_net_active_identity();

create or replace function public.invalidate_net_subject_active_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.net_active_identities as active_identity
  using public.net_identity_links as identity_link
  where identity_link.subject_kind = tg_argv[0]
    and identity_link.subject_id = new.id
    and active_identity.identity_link_id = identity_link.id;

  return new;
end;
$$;

drop trigger if exists npc_cards_invalidate_net_active_identity on public.npc_cards;
create trigger npc_cards_invalidate_net_active_identity
after update of owner_profile_id on public.npc_cards
for each row execute procedure public.invalidate_net_subject_active_identity('npc-card');

drop trigger if exists characters_invalidate_net_active_identity on public.characters;
create trigger characters_invalidate_net_active_identity
after update of owner_profile_id, campaign_id on public.characters
for each row execute procedure public.invalidate_net_subject_active_identity('character');

create or replace function public.delete_net_subject_identity_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.net_identity_links
  where subject_kind = tg_argv[0]
    and subject_id = old.id;

  return old;
end;
$$;

drop trigger if exists npc_cards_delete_net_identity_link on public.npc_cards;
create trigger npc_cards_delete_net_identity_link
after delete on public.npc_cards
for each row execute procedure public.delete_net_subject_identity_link('npc-card');

drop trigger if exists characters_delete_net_identity_link on public.characters;
create trigger characters_delete_net_identity_link
after delete on public.characters
for each row execute procedure public.delete_net_subject_identity_link('character');

create or replace function public.ensure_net_profile_identity_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role = 'player' then
    insert into public.net_identity_links (
      subject_kind,
      subject_id,
      entity_id,
      owner_profile_id,
      campaign_id,
      identity_kind,
      playability
    )
    values (
      'profile-sheet',
      new.id,
      null,
      new.id,
      null,
      'player',
      'playable'
    )
    on conflict (subject_kind, subject_id) do nothing;
  else
    delete from public.net_active_identities
    where profile_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_ensure_net_identity_link on public.profiles;
create trigger profiles_ensure_net_identity_link
after insert or update of role on public.profiles
for each row execute procedure public.ensure_net_profile_identity_link();

insert into public.net_identity_links (
  subject_kind,
  subject_id,
  entity_id,
  owner_profile_id,
  campaign_id,
  identity_kind,
  playability
)
select
  'profile-sheet',
  profile.id,
  null,
  profile.id,
  null,
  'player',
  'playable'
from public.profiles as profile
where profile.role = 'player'
on conflict (subject_kind, subject_id) do nothing;

create or replace function public.classify_net_identity_subject(
  requested_subject_kind text,
  requested_subject_id uuid,
  requested_identity_kind text,
  requested_playability text,
  requested_entity_id text default null
)
returns public.net_identity_links
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  classified_link public.net_identity_links%rowtype;
begin
  if auth.uid() is null or not public.is_current_user_gm() then
    raise exception 'Only an authenticated GM may classify NET identities.'
      using errcode = '42501';
  end if;

  insert into public.net_identity_links (
    subject_kind,
    subject_id,
    entity_id,
    identity_kind,
    playability
  )
  values (
    requested_subject_kind,
    requested_subject_id,
    nullif(btrim(requested_entity_id), ''),
    requested_identity_kind,
    requested_playability
  )
  on conflict (subject_kind, subject_id) do update
  set
    entity_id = excluded.entity_id,
    identity_kind = excluded.identity_kind,
    playability = excluded.playability
  returning * into classified_link;

  return classified_link;
end;
$$;

create or replace function public.set_net_active_identity(
  requested_identity_link_id uuid
)
returns public.net_active_identities
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_role public.app_role;
  requested_link public.net_identity_links%rowtype;
  selected_identity public.net_active_identities%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select profile.role
  into actor_role
  from public.profiles as profile
  where profile.id = actor_id;

  if not found then
    raise exception 'Authenticated profile is unavailable.' using errcode = '42501';
  end if;

  if actor_role = 'gm' then
    raise exception 'GM persona selection is not enabled.' using errcode = '42501';
  end if;

  select *
  into requested_link
  from public.net_identity_links
  where id = requested_identity_link_id
  for update;

  if not found then
    raise exception 'Requested NET identity link does not exist.' using errcode = '22023';
  end if;

  if requested_link.playability <> 'playable'
    or requested_link.identity_kind <> 'player'
    or not public.current_user_controls_net_identity_link(requested_link.id)
  then
    raise exception 'This identity is not an authorised playable identity for the current user.'
      using errcode = '42501';
  end if;

  insert into public.net_active_identities (profile_id, identity_link_id)
  values (actor_id, requested_link.id)
  on conflict (profile_id) do update
  set identity_link_id = excluded.identity_link_id
  returning * into selected_identity;

  return selected_identity;
end;
$$;

alter table public.net_identity_links enable row level security;
alter table public.net_active_identities enable row level security;

drop policy if exists net_identity_links_select_authorised on public.net_identity_links;
create policy net_identity_links_select_authorised
on public.net_identity_links
for select
to authenticated
using (
  public.is_current_user_gm()
  or public.current_user_controls_net_identity_link(id)
);

drop policy if exists net_identity_links_insert_gm on public.net_identity_links;
create policy net_identity_links_insert_gm
on public.net_identity_links
for insert
to authenticated
with check (public.is_current_user_gm());

drop policy if exists net_identity_links_update_gm on public.net_identity_links;
create policy net_identity_links_update_gm
on public.net_identity_links
for update
to authenticated
using (public.is_current_user_gm())
with check (public.is_current_user_gm());

drop policy if exists net_identity_links_delete_gm on public.net_identity_links;
create policy net_identity_links_delete_gm
on public.net_identity_links
for delete
to authenticated
using (public.is_current_user_gm());

drop policy if exists net_active_identities_select_own on public.net_active_identities;
create policy net_active_identities_select_own
on public.net_active_identities
for select
to authenticated
using (profile_id = auth.uid());

revoke all on public.net_identity_links from anon;
revoke all on public.net_active_identities from anon;
revoke insert, update, delete on public.net_identity_links from authenticated;
revoke insert, update, delete on public.net_active_identities from authenticated;
grant select on public.net_identity_links to authenticated;
grant select on public.net_active_identities to authenticated;

revoke all on function public.current_user_controls_net_identity_link(uuid) from public;
revoke all on function public.classify_net_identity_subject(text, uuid, text, text, text) from public;
revoke all on function public.set_net_active_identity(uuid) from public;
grant execute on function public.current_user_controls_net_identity_link(uuid) to authenticated;
grant execute on function public.classify_net_identity_subject(text, uuid, text, text, text) to authenticated;
grant execute on function public.set_net_active_identity(uuid) to authenticated;

revoke all on function public.validate_net_identity_link() from public;
revoke all on function public.prune_invalid_net_active_identity() from public;
revoke all on function public.invalidate_net_subject_active_identity() from public;
revoke all on function public.delete_net_subject_identity_link() from public;
revoke all on function public.ensure_net_profile_identity_link() from public;
