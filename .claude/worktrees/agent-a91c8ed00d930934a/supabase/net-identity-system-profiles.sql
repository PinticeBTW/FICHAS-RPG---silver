-- Character-scoped fictional computer state for THE NET.
-- Run after net-identity-selection.sql and net-universal-profiles.sql.

create table if not exists public.net_identity_system_profiles (
  identity_link_id uuid primary key references public.net_identity_links (id) on delete cascade,
  wallpaper_path text,
  wallpaper_fit text not null default 'cover'
    check (wallpaper_fit in ('cover', 'contain')),
  wallpaper_position text not null default 'center'
    check (wallpaper_position in ('center', 'top', 'bottom')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.net_identity_app_installs (
  identity_link_id uuid not null references public.net_identity_links (id) on delete cascade,
  app_id text not null check (app_id in ('echo', 'pulse', 'nvn')),
  installed_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (identity_link_id, app_id)
);

comment on table public.net_identity_system_profiles is
  'Character-scoped wallpaper metadata. Signed URLs and wallpaper bytes are never stored here.';
comment on table public.net_identity_app_installs is
  'Optional THE NET applications installed for one playable identity. System apps remain implicit.';

drop trigger if exists net_identity_system_profiles_set_updated_at
  on public.net_identity_system_profiles;
create trigger net_identity_system_profiles_set_updated_at
before update on public.net_identity_system_profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists net_identity_app_installs_set_updated_at
  on public.net_identity_app_installs;
create trigger net_identity_app_installs_set_updated_at
before update on public.net_identity_app_installs
for each row execute procedure public.set_updated_at();

create or replace function public.set_net_identity_app_install(
  requested_identity_link_id uuid,
  requested_app_id text,
  requested_installed boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if requested_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(requested_identity_link_id)
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;

  if requested_app_id is null or requested_app_id not in ('echo', 'pulse', 'nvn') then
    raise exception 'This application is not an installable optional NET module.'
      using errcode = '22023';
  end if;

  if requested_installed is null then
    raise exception 'Installation state is required.' using errcode = '22023';
  end if;

  if requested_installed then
    insert into public.net_identity_app_installs (identity_link_id, app_id)
    values (requested_identity_link_id, requested_app_id)
    on conflict (identity_link_id, app_id) do update
    set updated_at = timezone('utc', now());
  else
    delete from public.net_identity_app_installs
    where identity_link_id = requested_identity_link_id
      and app_id = requested_app_id;
  end if;

  return requested_installed;
end;
$$;

create or replace function public.set_net_identity_wallpaper(
  requested_identity_link_id uuid,
  requested_wallpaper_path text,
  requested_fit text,
  requested_position text
)
returns public.net_identity_system_profiles
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  normalized_path text := nullif(btrim(requested_wallpaper_path), '');
  saved_profile public.net_identity_system_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if requested_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(requested_identity_link_id)
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;

  if normalized_path is null
    or split_part(normalized_path, '/', 1) <> requested_identity_link_id::text
    or split_part(normalized_path, '/', 2) = ''
    or normalized_path like '%..%'
  then
    raise exception 'Wallpaper path does not belong to the requested identity.'
      using errcode = '22023';
  end if;

  if requested_fit is null
    or requested_fit not in ('cover', 'contain')
    or requested_position is null
    or requested_position not in ('center', 'top', 'bottom')
  then
    raise exception 'Unsupported wallpaper presentation.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'net-wallpapers'
      and object.name = normalized_path
  ) then
    raise exception 'Wallpaper object is unavailable.' using errcode = '22023';
  end if;

  insert into public.net_identity_system_profiles (
    identity_link_id,
    wallpaper_path,
    wallpaper_fit,
    wallpaper_position
  )
  values (
    requested_identity_link_id,
    normalized_path,
    requested_fit,
    requested_position
  )
  on conflict (identity_link_id) do update
  set
    wallpaper_path = excluded.wallpaper_path,
    wallpaper_fit = excluded.wallpaper_fit,
    wallpaper_position = excluded.wallpaper_position
  returning * into saved_profile;

  return saved_profile;
end;
$$;

create or replace function public.clear_net_identity_wallpaper(
  requested_identity_link_id uuid
)
returns public.net_identity_system_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_profile public.net_identity_system_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if requested_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(requested_identity_link_id)
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;

  insert into public.net_identity_system_profiles (
    identity_link_id,
    wallpaper_path,
    wallpaper_fit,
    wallpaper_position
  )
  values (requested_identity_link_id, null, 'cover', 'center')
  on conflict (identity_link_id) do update
  set
    wallpaper_path = null,
    wallpaper_fit = 'cover',
    wallpaper_position = 'center'
  returning * into saved_profile;

  return saved_profile;
end;
$$;

alter table public.net_identity_system_profiles enable row level security;
alter table public.net_identity_app_installs enable row level security;

drop policy if exists net_identity_system_profiles_select_authorised
  on public.net_identity_system_profiles;
create policy net_identity_system_profiles_select_authorised
on public.net_identity_system_profiles
for select
to authenticated
using (
  public.current_user_controls_playable_net_identity_link(identity_link_id)
  or public.is_current_user_gm()
);

drop policy if exists net_identity_app_installs_select_authorised
  on public.net_identity_app_installs;
create policy net_identity_app_installs_select_authorised
on public.net_identity_app_installs
for select
to authenticated
using (
  public.current_user_controls_playable_net_identity_link(identity_link_id)
  or public.is_current_user_gm()
);

revoke all on public.net_identity_system_profiles from anon;
revoke all on public.net_identity_app_installs from anon;
revoke insert, update, delete on public.net_identity_system_profiles from authenticated;
revoke insert, update, delete on public.net_identity_app_installs from authenticated;
grant select on public.net_identity_system_profiles to authenticated;
grant select on public.net_identity_app_installs to authenticated;

revoke all on function public.set_net_identity_app_install(uuid, text, boolean) from public;
revoke all on function public.set_net_identity_wallpaper(uuid, text, text, text) from public;
revoke all on function public.clear_net_identity_wallpaper(uuid) from public;
grant execute on function public.set_net_identity_app_install(uuid, text, boolean) to authenticated;
grant execute on function public.set_net_identity_wallpaper(uuid, text, text, text) to authenticated;
grant execute on function public.clear_net_identity_wallpaper(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'net-wallpapers',
  'net-wallpapers',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.net_wallpaper_identity_link_id(object_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if object_name is null or split_part(object_name, '/', 2) = '' then
    return null;
  end if;
  return split_part(object_name, '/', 1)::uuid;
exception
  when invalid_text_representation then return null;
end;
$$;

drop policy if exists net_wallpapers_select_authorised on storage.objects;
create policy net_wallpapers_select_authorised
on storage.objects
for select
to authenticated
using (
  bucket_id = 'net-wallpapers'
  and (
    public.is_current_user_gm()
    or public.current_user_controls_playable_net_identity_link(
      public.net_wallpaper_identity_link_id(name)
    )
  )
);

drop policy if exists net_wallpapers_insert_controlled on storage.objects;
create policy net_wallpapers_insert_controlled
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'net-wallpapers'
  and public.current_user_controls_playable_net_identity_link(
    public.net_wallpaper_identity_link_id(name)
  )
);

drop policy if exists net_wallpapers_update_controlled on storage.objects;
create policy net_wallpapers_update_controlled
on storage.objects
for update
to authenticated
using (
  bucket_id = 'net-wallpapers'
  and public.current_user_controls_playable_net_identity_link(
    public.net_wallpaper_identity_link_id(name)
  )
)
with check (
  bucket_id = 'net-wallpapers'
  and public.current_user_controls_playable_net_identity_link(
    public.net_wallpaper_identity_link_id(name)
  )
);

drop policy if exists net_wallpapers_delete_controlled on storage.objects;
create policy net_wallpapers_delete_controlled
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'net-wallpapers'
  and public.current_user_controls_playable_net_identity_link(
    public.net_wallpaper_identity_link_id(name)
  )
);

revoke all on function public.net_wallpaper_identity_link_id(text) from public;
grant execute on function public.net_wallpaper_identity_link_id(text) to authenticated;
