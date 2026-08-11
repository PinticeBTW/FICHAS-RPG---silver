-- Server-authoritative fictional application accounts for THE NET.
-- Run after net-identity-selection.sql and net-universal-profiles.sql.

create extension if not exists pgcrypto;

create or replace function public.normalize_net_app_handle(raw_handle text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  normalized text := lower(btrim(regexp_replace(btrim(coalesce(raw_handle, '')), '^@+', '')));
begin
  if normalized = ''
    or char_length(normalized) > 32
    or normalized !~ '^[a-z0-9][a-z0-9_.-]*$'
  then
    return null;
  end if;

  return normalized;
end;
$$;

create table if not exists public.net_app_account_policies (
  app_id text primary key,
  account_mode text not null
    check (account_mode in ('none', 'system-identity', 'automatic', 'explicit', 'optional')),
  account_available boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.net_app_account_policies (app_id, account_mode, account_available)
values
  ('iden', 'system-identity', true),
  ('altara', 'automatic', true),
  ('echo', 'explicit', true),
  ('pulse', 'explicit', true),
  ('loop', 'explicit', false),
  ('nvn', 'optional', false),
  ('net-store', 'none', false)
on conflict (app_id) do update
set
  account_mode = excluded.account_mode,
  account_available = excluded.account_available,
  updated_at = timezone('utc', now());

create table if not exists public.net_app_accounts (
  id uuid primary key default gen_random_uuid(),
  app_id text not null references public.net_app_account_policies (app_id),
  identity_link_id uuid references public.net_identity_links (id) on delete cascade,
  entity_id text,
  organisation_id text,
  handle text not null,
  display_name_override text,
  avatar_url_override text,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'disabled')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_app_accounts_supported_app check (
    app_id in ('iden', 'altara', 'echo', 'pulse', 'loop')
  ),
  constraint net_app_accounts_one_owner check (
    num_nonnulls(identity_link_id, entity_id, organisation_id) = 1
  ),
  constraint net_app_accounts_normalized_handle check (
    public.normalize_net_app_handle(handle) is not null
    and handle = public.normalize_net_app_handle(handle)
  ),
  constraint net_app_accounts_owner_text_not_empty check (
    (entity_id is null or btrim(entity_id) <> '')
    and (organisation_id is null or btrim(organisation_id) <> '')
  ),
  constraint net_app_accounts_display_name_limit check (
    display_name_override is null or char_length(display_name_override) <= 40
  ),
  constraint net_app_accounts_avatar_url_limit check (
    avatar_url_override is null or char_length(avatar_url_override) <= 2048
  )
);

comment on table public.net_app_accounts is
  'Fictional in-application accounts. Authentication, RPG identity, software installation, and app account remain separate layers.';
comment on table public.net_app_account_policies is
  'Server contract for account modes and current availability. Keep the typed client policy mirror aligned with these rows.';
comment on column public.net_app_accounts.identity_link_id is
  'Playable character owner. Server RPCs validate control from auth.uid(); clients never supply an owner profile.';
comment on column public.net_app_accounts.entity_id is
  'Canonical Shared World Core owner for server-seeded NPC/service identities without a site login.';
comment on column public.net_app_accounts.organisation_id is
  'Canonical organisation owner. Distinct service/team accounts remain distinct records.';

create unique index if not exists net_app_accounts_identity_owner_unique
  on public.net_app_accounts (app_id, identity_link_id)
  where identity_link_id is not null;
create unique index if not exists net_app_accounts_entity_owner_unique
  on public.net_app_accounts (app_id, entity_id)
  where entity_id is not null;
create unique index if not exists net_app_accounts_organisation_owner_unique
  on public.net_app_accounts (app_id, organisation_id)
  where organisation_id is not null;
create unique index if not exists net_app_accounts_handle_unique
  on public.net_app_accounts (app_id, handle);
create index if not exists net_app_accounts_identity_link_idx
  on public.net_app_accounts (identity_link_id)
  where identity_link_id is not null;

-- Small, explicit mirror of the cross-app canonical seeds already established
-- in Shared World Core. App-specific support/editorial/team identities are not
-- merged into these organisation records.
insert into public.net_app_accounts (
  app_id,
  entity_id,
  organisation_id,
  handle,
  display_name_override,
  status
)
values
  ('echo', 'person-adrian', null, 'adrian', null, 'active'),
  ('echo', 'person-maya', null, 'maya', null, 'active'),
  ('pulse', 'person-adrian', null, 'adrian', null, 'active'),
  ('pulse', 'person-maya', null, 'maya', null, 'active'),
  ('pulse', 'identity-ghost-in-the-net', null, 'ghost_in_the_net', null, 'active'),
  ('altara', 'person-adrian', null, 'adrian', null, 'active'),
  ('altara', 'person-maya', null, 'maya', null, 'active'),
  ('altara', 'identity-ghost-in-the-net', null, 'ghost_in_the_net', null, 'active'),
  ('iden', 'person-adrian', null, 'adrian', null, 'active'),
  ('iden', 'person-maya', null, 'maya', null, 'active'),
  ('iden', 'identity-ghost-in-the-net', null, 'ghost_in_the_net', null, 'active'),
  ('pulse', null, 'org-altara', 'altara', 'ALTARA', 'active'),
  ('pulse', null, 'org-lucid', 'lucid', null, 'active'),
  ('pulse', null, 'org-netwatch', 'netwatch', null, 'active'),
  ('pulse', null, 'org-vox-net', 'voxnet', 'VOX NET Official', 'active'),
  ('pulse', null, 'org-nvn', 'nvn', 'NVN', 'active'),
  ('pulse', null, 'org-nvps', 'nvps', null, 'active')
on conflict do nothing;

drop trigger if exists net_app_account_policies_set_updated_at
  on public.net_app_account_policies;
create trigger net_app_account_policies_set_updated_at
before update on public.net_app_account_policies
for each row execute procedure public.set_updated_at();

drop trigger if exists net_app_accounts_set_updated_at on public.net_app_accounts;
create trigger net_app_accounts_set_updated_at
before update on public.net_app_accounts
for each row execute procedure public.set_updated_at();

create or replace function public.net_identity_account_handle_seed(
  requested_identity_link_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  identity_link public.net_identity_links%rowtype;
  source_name text;
  normalized text;
begin
  select *
  into identity_link
  from public.net_identity_links
  where id = requested_identity_link_id;

  if not found then
    return null;
  end if;

  case identity_link.subject_kind
    when 'profile-sheet' then
      select coalesce(
        nullif(btrim(sheet.field_data ->> 'NOME'), ''),
        nullif(btrim(profile.display_name), ''),
        nullif(btrim(profile.handle), '')
      )
      into source_name
      from public.profiles as profile
      left join public.character_sheet_forms as sheet
        on sheet.profile_id = profile.id
      where profile.id = identity_link.subject_id;

    when 'npc-card' then
      select coalesce(
        nullif(btrim(card.field_data ->> 'NOME'), ''),
        nullif(btrim(card.display_name), '')
      )
      into source_name
      from public.npc_cards as card
      where card.id = identity_link.subject_id;

    when 'character' then
      select coalesce(
        nullif(btrim(character.alias), ''),
        nullif(btrim(character.name), '')
      )
      into source_name
      from public.characters as character
      where character.id = identity_link.subject_id;
  end case;

  normalized := public.normalize_net_app_handle(regexp_replace(coalesce(source_name, ''), '\s+', '', 'g'));
  return coalesce(normalized, 'new-vega-user');
end;
$$;

create or replace function public.ensure_net_app_account(
  requested_identity_link_id uuid,
  requested_app_id text
)
returns public.net_app_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  policy public.net_app_account_policies%rowtype;
  requested_link public.net_identity_links%rowtype;
  existing_account public.net_app_accounts%rowtype;
  saved_account public.net_app_accounts%rowtype;
  base_handle text;
  candidate_handle text;
  suffix text := left(replace(requested_identity_link_id::text, '-', ''), 6);
  attempt integer := 1;
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

  select * into policy
  from public.net_app_account_policies
  where app_id = requested_app_id;

  if not found
    or not policy.account_available
    or policy.account_mode not in ('system-identity', 'automatic')
  then
    raise exception 'This application does not support automatic account provisioning.'
      using errcode = '22023';
  end if;

  select * into requested_link
  from public.net_identity_links
  where id = requested_identity_link_id;

  select * into existing_account
  from public.net_app_accounts
  where app_id = requested_app_id
    and (
      identity_link_id = requested_identity_link_id
      or (
        requested_link.entity_id is not null
        and entity_id = requested_link.entity_id
      )
    )
  order by (identity_link_id = requested_identity_link_id) desc
  limit 1;

  if found then
    return existing_account;
  end if;

  base_handle := public.net_identity_account_handle_seed(requested_identity_link_id);
  candidate_handle := left(base_handle, 32);

  loop
    begin
      insert into public.net_app_accounts (
        app_id,
        identity_link_id,
        handle,
        status
      )
      values (
        requested_app_id,
        requested_identity_link_id,
        candidate_handle,
        'active'
      )
      returning * into saved_account;

      return saved_account;
    exception
      when unique_violation then
        select * into existing_account
        from public.net_app_accounts
        where app_id = requested_app_id
          and identity_link_id = requested_identity_link_id;

        if found then
          return existing_account;
        end if;

        attempt := attempt + 1;
        candidate_handle := left(base_handle, greatest(1, 32 - char_length(suffix) - 2))
          || '-' || suffix;
        if attempt > 2 then
          candidate_handle := left(base_handle, greatest(1, 32 - char_length(suffix) - 5))
            || '-' || suffix || '-' || attempt::text;
        end if;
        if attempt > 100 then
          raise exception 'No collision-free application handle could be provisioned.'
            using errcode = '23505';
        end if;
    end;
  end loop;
end;
$$;

create or replace function public.create_net_app_account(
  requested_identity_link_id uuid,
  requested_app_id text,
  requested_handle text,
  requested_display_name_override text default null,
  requested_avatar_url_override text default null
)
returns public.net_app_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  policy public.net_app_account_policies%rowtype;
  requested_link public.net_identity_links%rowtype;
  normalized_handle text := public.normalize_net_app_handle(requested_handle);
  normalized_display_name text := nullif(btrim(requested_display_name_override), '');
  normalized_avatar_url text := nullif(btrim(requested_avatar_url_override), '');
  saved_account public.net_app_accounts%rowtype;
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

  select * into policy
  from public.net_app_account_policies
  where app_id = requested_app_id;

  if not found or policy.account_mode <> 'explicit' then
    raise exception 'This application does not support explicit account creation.'
      using errcode = '22023';
  end if;
  if not policy.account_available then
    raise exception 'This application is not currently available.' using errcode = '22023';
  end if;
  if requested_app_id = 'loop' then
    raise exception 'LOOP accounts are not available yet.' using errcode = '22023';
  end if;
  if normalized_handle is null then
    raise exception 'Application handle is invalid.' using errcode = '22023';
  end if;
  if normalized_display_name is not null and char_length(normalized_display_name) > 40 then
    raise exception 'Display-name overrides are limited to 40 characters.' using errcode = '22001';
  end if;
  if normalized_avatar_url is not null and char_length(normalized_avatar_url) > 2048 then
    raise exception 'Avatar overrides are limited to 2048 characters.' using errcode = '22001';
  end if;

  select * into requested_link
  from public.net_identity_links
  where id = requested_identity_link_id;

  if exists (
    select 1 from public.net_app_accounts
    where app_id = requested_app_id
      and (
        identity_link_id = requested_identity_link_id
        or (
          requested_link.entity_id is not null
          and entity_id = requested_link.entity_id
        )
      )
  ) then
    raise exception 'An application account already exists for this identity.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.net_app_accounts
    where app_id = requested_app_id
      and handle = normalized_handle
  ) then
    raise exception 'That application handle is already registered.' using errcode = '23505';
  end if;

  begin
    insert into public.net_app_accounts (
      app_id,
      identity_link_id,
      handle,
      display_name_override,
      avatar_url_override,
      status
    )
    values (
      requested_app_id,
      requested_identity_link_id,
      normalized_handle,
      normalized_display_name,
      normalized_avatar_url,
      'active'
    )
    returning * into saved_account;
  exception
    when unique_violation then
      raise exception 'The application account or handle was registered by another request.'
        using errcode = '23505';
  end;

  return saved_account;
end;
$$;

alter table public.net_app_account_policies enable row level security;
alter table public.net_app_accounts enable row level security;

drop policy if exists net_app_account_policies_select_authenticated
  on public.net_app_account_policies;
create policy net_app_account_policies_select_authenticated
on public.net_app_account_policies
for select
to authenticated
using (true);

drop policy if exists net_app_accounts_select_authorised on public.net_app_accounts;
create policy net_app_accounts_select_authorised
on public.net_app_accounts
for select
to authenticated
using (
  (identity_link_id is not null
    and public.current_user_controls_playable_net_identity_link(identity_link_id))
  or public.is_current_user_gm()
  or entity_id is not null
  or organisation_id is not null
);

revoke all on public.net_app_account_policies from anon;
revoke all on public.net_app_accounts from anon;
revoke insert, update, delete on public.net_app_account_policies from authenticated;
revoke insert, update, delete on public.net_app_accounts from authenticated;
grant select on public.net_app_account_policies to authenticated;
grant select on public.net_app_accounts to authenticated;

revoke all on function public.normalize_net_app_handle(text) from public;
revoke all on function public.net_identity_account_handle_seed(uuid) from public;
revoke all on function public.ensure_net_app_account(uuid, text) from public;
revoke all on function public.create_net_app_account(uuid, text, text, text, text) from public;
grant execute on function public.normalize_net_app_handle(text) to authenticated;
grant execute on function public.ensure_net_app_account(uuid, text) to authenticated;
grant execute on function public.create_net_app_account(uuid, text, text, text, text) to authenticated;
