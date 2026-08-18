-- Server-backed shared presentation defaults for THE NET.
-- Run after supabase/net-identity-selection.sql.

create table if not exists public.net_universal_profiles (
  identity_link_id uuid primary key references public.net_identity_links (id) on delete cascade,
  display_name_override text,
  bio text,
  status text,
  avatar_url_override text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_universal_profiles_display_name_limit
    check (display_name_override is null or char_length(display_name_override) <= 40),
  constraint net_universal_profiles_bio_limit
    check (bio is null or char_length(bio) <= 240),
  constraint net_universal_profiles_status_limit
    check (status is null or char_length(status) <= 100),
  constraint net_universal_profiles_avatar_url_limit
    check (avatar_url_override is null or char_length(avatar_url_override) <= 2048)
);

comment on table public.net_universal_profiles is
  'Shared THE NET presentation overrides keyed by an authorised identity link; sheet facts remain in their source records.';
comment on column public.net_universal_profiles.avatar_url_override is
  'Reserved for a future approved profile-media pipeline. This migration does not create an upload path.';

drop trigger if exists net_universal_profiles_set_updated_at on public.net_universal_profiles;
create trigger net_universal_profiles_set_updated_at
before update on public.net_universal_profiles
for each row execute procedure public.set_updated_at();

create or replace function public.current_user_controls_playable_net_identity_link(
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
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
      and public.current_user_controls_net_identity_link(identity_link.id)
  );
$$;

create or replace function public.upsert_net_universal_profile(
  requested_identity_link_id uuid,
  requested_display_name_override text default null,
  requested_bio text default null,
  requested_status text default null,
  requested_avatar_url_override text default null
)
returns public.net_universal_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_profile public.net_universal_profiles%rowtype;
  normalized_display_name text := nullif(btrim(requested_display_name_override), '');
  normalized_bio text := nullif(btrim(requested_bio), '');
  normalized_status text := nullif(btrim(requested_status), '');
  normalized_avatar_url text := nullif(btrim(requested_avatar_url_override), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if requested_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(requested_identity_link_id)
  then
    raise exception 'The requested playable identity is not authorised for this account.'
      using errcode = '42501';
  end if;

  if normalized_display_name is not null and char_length(normalized_display_name) > 40 then
    raise exception 'Display name overrides are limited to 40 characters.' using errcode = '22001';
  end if;
  if normalized_bio is not null and char_length(normalized_bio) > 240 then
    raise exception 'NET profile bios are limited to 240 characters.' using errcode = '22001';
  end if;
  if normalized_status is not null and char_length(normalized_status) > 100 then
    raise exception 'NET profile statuses are limited to 100 characters.' using errcode = '22001';
  end if;
  if normalized_avatar_url is not null and char_length(normalized_avatar_url) > 2048 then
    raise exception 'Avatar overrides are limited to 2048 characters.' using errcode = '22001';
  end if;

  insert into public.net_universal_profiles (
    identity_link_id,
    display_name_override,
    bio,
    status,
    avatar_url_override
  )
  values (
    requested_identity_link_id,
    normalized_display_name,
    normalized_bio,
    normalized_status,
    normalized_avatar_url
  )
  on conflict (identity_link_id) do update
  set
    display_name_override = excluded.display_name_override,
    bio = excluded.bio,
    status = excluded.status,
    avatar_url_override = excluded.avatar_url_override
  returning * into saved_profile;

  return saved_profile;
end;
$$;

alter table public.net_universal_profiles enable row level security;

drop policy if exists net_universal_profiles_select_controlled on public.net_universal_profiles;
create policy net_universal_profiles_select_controlled
on public.net_universal_profiles
for select
to authenticated
using (public.current_user_controls_playable_net_identity_link(identity_link_id));

revoke all on public.net_universal_profiles from anon;
revoke insert, update, delete on public.net_universal_profiles from authenticated;
grant select on public.net_universal_profiles to authenticated;

revoke all on function public.current_user_controls_playable_net_identity_link(uuid) from public;
revoke all on function public.upsert_net_universal_profile(uuid, text, text, text, text) from public;
grant execute on function public.current_user_controls_playable_net_identity_link(uuid) to authenticated;
grant execute on function public.upsert_net_universal_profile(uuid, text, text, text, text) to authenticated;
