-- RPGSILVER shared user-media foundation.
-- Run after the core schema, npc-cards.sql, net-identity-selection.sql,
-- net-identity-system-profiles.sql, and net-app-accounts.sql.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'rpg-media',
  'rpg-media',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.current_user_can_write_rpg_media_object(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  subject_kind text := split_part(object_name, '/', 1);
  subject_id text := split_part(object_name, '/', 2);
  media_kind text := split_part(object_name, '/', 3);
begin
  if actor is null
    or subject_kind = ''
    or subject_id = ''
    or media_kind = ''
    or split_part(object_name, '/', 6) = ''
    or object_name like '%..%'
  then
    return false;
  end if;

  case subject_kind
    when 'profile-sheet' then
      return subject_id = actor::text or public.is_current_user_gm();

    when 'npc-card' then
      return exists (
        select 1
        from public.npc_cards as card
        where card.id::text = subject_id
          and (
            public.is_current_user_gm()
            or card.owner_profile_id = actor
            or public.has_sheet_share_access('npc', card.id)
          )
      );

    when 'profile' then
      return subject_id = actor::text;

    when 'character' then
      return exists (
        select 1
        from public.characters as character_record
        where character_record.id::text = subject_id
          and (character_record.owner_profile_id = actor or public.is_current_user_gm())
      );

    when 'identity-link', 'universal-profile' then
      return exists (
        select 1
        from public.net_identity_links as link
        where link.id::text = subject_id
          and public.current_user_controls_playable_net_identity_link(link.id)
      );

    when 'app-account' then
      return exists (
        select 1
        from public.net_app_accounts as account
        where account.id::text = subject_id
          and account.identity_link_id is not null
          and public.current_user_controls_playable_net_identity_link(account.identity_link_id)
      );

    when 'gm-profile' then
      return subject_id = actor::text and public.is_current_user_gm();

    when 'global' then
      return subject_id = 'global' and media_kind = 'cyberware' and public.is_current_user_gm();

    else
      return false;
  end case;
end;
$$;

create or replace function public.current_user_can_read_rpg_media_object(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  subject_kind text := split_part(object_name, '/', 1);
  subject_id text := split_part(object_name, '/', 2);
  media_kind text := split_part(object_name, '/', 3);
begin
  if actor is null or subject_kind = '' or subject_id = '' or media_kind = '' then
    return false;
  end if;

  -- Explicit NET/app overrides are already authenticated-network presentation.
  if media_kind = 'avatar' and subject_kind in ('universal-profile', 'app-account') then
    return true;
  end if;

  -- A sheet portrait is network-readable only after that exact subject has an
  -- active application account. Unlinked/private sheets do not become public.
  if media_kind = 'avatar'
    and subject_kind in ('profile-sheet', 'npc-card', 'character')
    and exists (
      select 1
      from public.net_identity_links as link
      join public.net_app_accounts as account on account.identity_link_id = link.id
      where link.subject_kind = subject_kind
        and link.subject_id::text = subject_id
        and account.status = 'active'
    )
  then
    return true;
  end if;

  if subject_kind = 'global' and subject_id = 'global' and media_kind = 'cyberware' then
    return true;
  end if;

  case subject_kind
    when 'profile-sheet' then
      return subject_id = actor::text
        or public.is_current_user_gm()
        or exists (
          select 1 from public.profiles as sheet_profile
          where sheet_profile.id::text = subject_id
            and public.has_sheet_share_access('profile', sheet_profile.id)
        );

    when 'npc-card' then
      return exists (
        select 1
        from public.npc_cards as card
        where card.id::text = subject_id
          and (
            public.is_current_user_gm()
            or card.owner_profile_id = actor
            or public.has_sheet_share_access('npc', card.id)
          )
      );

    when 'character' then
      return exists (
        select 1
        from public.characters as character_record
        where character_record.id::text = subject_id
          and (character_record.owner_profile_id = actor or public.is_current_user_gm())
      );

    when 'profile' then
      return subject_id = actor::text or public.is_current_user_gm();

    when 'identity-link', 'universal-profile' then
      return public.is_current_user_gm() or exists (
        select 1
        from public.net_identity_links as link
        where link.id::text = subject_id
          and public.current_user_controls_playable_net_identity_link(link.id)
      );

    when 'app-account' then
      return public.is_current_user_gm() or exists (
        select 1
        from public.net_app_accounts as account
        where account.id::text = subject_id
          and account.identity_link_id is not null
          and public.current_user_controls_playable_net_identity_link(account.identity_link_id)
      );

    when 'gm-profile' then
      return subject_id = actor::text and public.is_current_user_gm();

    else
      return false;
  end case;
end;
$$;

drop policy if exists rpg_media_select_authorised on storage.objects;
create policy rpg_media_select_authorised
on storage.objects
for select
to authenticated
using (
  bucket_id = 'rpg-media'
  and public.current_user_can_read_rpg_media_object(name)
);

drop policy if exists rpg_media_insert_authorised on storage.objects;
create policy rpg_media_insert_authorised
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'rpg-media'
  and public.current_user_can_write_rpg_media_object(name)
);

drop policy if exists rpg_media_update_authorised on storage.objects;
create policy rpg_media_update_authorised
on storage.objects
for update
to authenticated
using (
  bucket_id = 'rpg-media'
  and public.current_user_can_write_rpg_media_object(name)
)
with check (
  bucket_id = 'rpg-media'
  and public.current_user_can_write_rpg_media_object(name)
);

drop policy if exists rpg_media_delete_authorised on storage.objects;
create policy rpg_media_delete_authorised
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'rpg-media'
  and public.current_user_can_write_rpg_media_object(name)
);

revoke all on function public.current_user_can_write_rpg_media_object(text) from public;
revoke all on function public.current_user_can_read_rpg_media_object(text) from public;
grant execute on function public.current_user_can_write_rpg_media_object(text) to authenticated;
grant execute on function public.current_user_can_read_rpg_media_object(text) to authenticated;

comment on function public.current_user_can_write_rpg_media_object(text) is
  'Authorises immutable shared-media paths from auth.uid() and existing sheet/identity ownership. GM inspection and compromised sessions do not grant player system-media mutation.';
