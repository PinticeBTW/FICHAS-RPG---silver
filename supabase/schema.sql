create extension if not exists pgcrypto;

do $$
begin
  create type public.app_role as enum ('gm', 'player');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.karma_alignment as enum ('blue', 'red', 'gray');
exception
  when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique not null,
  display_name text not null,
  handle text unique not null,
  role public.app_role not null default 'player',
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code_name text not null,
  description text not null default '',
  timeline text not null default '',
  season text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null default 'player',
  status text not null default 'active' check (status in ('active', 'invited', 'archived')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (campaign_id, profile_id)
);

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  owner_profile_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  alias text not null,
  archetype text not null default '',
  biography text not null default '',
  portrait_url text not null default '',
  status_label text not null default 'Pending sync',
  alignment public.karma_alignment not null default 'gray',
  allow_player_stat_edits boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (campaign_id, owner_profile_id)
);

create table if not exists public.character_stats (
  character_id uuid primary key references public.characters (id) on delete cascade,
  hp_current integer not null default 0 check (hp_current >= 0),
  hp_max integer not null default 0 check (hp_max >= 0),
  ram_current integer not null default 0 check (ram_current >= 0),
  ram_max integer not null default 0 check (ram_max >= 0),
  karma integer not null default 0,
  cyberpsychosis integer not null default 0 check (cyberpsychosis >= 0),
  humanity integer not null default 0 check (humanity >= 0),
  armor integer not null default 0 check (armor >= 0),
  initiative integer not null default 0,
  reflex integer not null default 0,
  tech integer not null default 0,
  cool integer not null default 0,
  body integer not null default 0,
  intelligence integer not null default 0,
  empathy integer not null default 0,
  luck integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.character_skills (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  name text not null,
  category text not null default 'Field',
  rating integer not null default 0,
  notes text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.character_abilities (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  name text not null,
  cost text not null default '',
  effect text not null default '',
  source text not null default '',
  notes text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.character_inventory (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  name text not null,
  category text not null default 'Gear',
  quantity integer not null default 1 check (quantity >= 0),
  equipped boolean not null default false,
  notes text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.character_cyberware (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  slot text not null check (slot in ('head', 'optic', 'nervous', 'torso', 'left arm', 'right arm', 'legs')),
  name text not null,
  tier text not null default 'Mk-I',
  effect text not null default '',
  cost text not null default '',
  notes text not null default '',
  stability integer not null default 0,
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.character_notes (
  character_id uuid primary key references public.characters (id) on delete cascade,
  player_journal text not null default '',
  gm_intel text not null default '',
  mission_log text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pdf_documents (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  file_name text not null,
  display_name text not null,
  file_size bigint,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pdf_document_access (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.pdf_documents (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (document_id, profile_id)
);

create table if not exists public.character_sheet_forms (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  template_key text not null default 'jeff-v1',
  field_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute procedure public.set_updated_at();

drop trigger if exists campaign_members_set_updated_at on public.campaign_members;
create trigger campaign_members_set_updated_at
before update on public.campaign_members
for each row execute procedure public.set_updated_at();

drop trigger if exists characters_set_updated_at on public.characters;
create trigger characters_set_updated_at
before update on public.characters
for each row execute procedure public.set_updated_at();

drop trigger if exists character_stats_set_updated_at on public.character_stats;
create trigger character_stats_set_updated_at
before update on public.character_stats
for each row execute procedure public.set_updated_at();

drop trigger if exists character_skills_set_updated_at on public.character_skills;
create trigger character_skills_set_updated_at
before update on public.character_skills
for each row execute procedure public.set_updated_at();

drop trigger if exists character_abilities_set_updated_at on public.character_abilities;
create trigger character_abilities_set_updated_at
before update on public.character_abilities
for each row execute procedure public.set_updated_at();

drop trigger if exists character_inventory_set_updated_at on public.character_inventory;
create trigger character_inventory_set_updated_at
before update on public.character_inventory
for each row execute procedure public.set_updated_at();

drop trigger if exists character_cyberware_set_updated_at on public.character_cyberware;
create trigger character_cyberware_set_updated_at
before update on public.character_cyberware
for each row execute procedure public.set_updated_at();

drop trigger if exists character_notes_set_updated_at on public.character_notes;
create trigger character_notes_set_updated_at
before update on public.character_notes
for each row execute procedure public.set_updated_at();

drop trigger if exists pdf_documents_set_updated_at on public.pdf_documents;
create trigger pdf_documents_set_updated_at
before update on public.pdf_documents
for each row execute procedure public.set_updated_at();

drop trigger if exists character_sheet_forms_set_updated_at on public.character_sheet_forms;
create trigger character_sheet_forms_set_updated_at
before update on public.character_sheet_forms
for each row execute procedure public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fallback_handle text;
begin
  fallback_handle :=
    '@' ||
    lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9]+', '-', 'g')) ||
    '-' ||
    left(new.id::text, 6);

  insert into public.profiles (id, email, display_name, handle, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'handle', fallback_handle),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    handle = coalesce(excluded.handle, public.profiles.handle),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_campaign_member(target_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.campaign_members member
    where member.campaign_id = target_campaign
      and member.profile_id = auth.uid()
      and member.status = 'active'
  );
$$;

create or replace function public.is_gm_for_campaign(target_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.campaign_members member
    where member.campaign_id = target_campaign
      and member.profile_id = auth.uid()
      and member.status = 'active'
      and member.role = 'gm'
  );
$$;

create or replace function public.is_current_user_gm()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'gm'
  );
$$;

create or replace function public.is_profile_role_unchanged(
  target_profile uuid,
  next_role public.app_role
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = target_profile
      and profiles.role = next_role
  );
$$;

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, update, delete on public.campaign_members to authenticated;
grant select, insert, update, delete on public.characters to authenticated;
grant select, insert, update, delete on public.character_stats to authenticated;
grant select, insert, update, delete on public.character_skills to authenticated;
grant select, insert, update, delete on public.character_abilities to authenticated;
grant select, insert, update, delete on public.character_inventory to authenticated;
grant select, insert, update, delete on public.character_cyberware to authenticated;
grant select, insert, update, delete on public.character_notes to authenticated;
grant select, insert, update, delete on public.pdf_documents to authenticated;
grant select, insert, update, delete on public.pdf_document_access to authenticated;
grant select, insert, update, delete on public.character_sheet_forms to authenticated;

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.characters enable row level security;
alter table public.character_stats enable row level security;
alter table public.character_skills enable row level security;
alter table public.character_abilities enable row level security;
alter table public.character_inventory enable row level security;
alter table public.character_cyberware enable row level security;
alter table public.character_notes enable row level security;
alter table public.pdf_documents enable row level security;
alter table public.pdf_document_access enable row level security;
alter table public.character_sheet_forms enable row level security;

drop policy if exists profiles_select_shared_campaign on public.profiles;
create policy profiles_select_shared_campaign
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.is_current_user_gm()
);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and public.is_profile_role_unchanged(id, role)
);

drop policy if exists campaigns_select_member on public.campaigns;
create policy campaigns_select_member
on public.campaigns
for select
to authenticated
using (public.is_campaign_member(id));

drop policy if exists campaigns_insert_creator on public.campaigns;
create policy campaigns_insert_creator
on public.campaigns
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists campaigns_update_gm on public.campaigns;
create policy campaigns_update_gm
on public.campaigns
for update
to authenticated
using (public.is_gm_for_campaign(id))
with check (public.is_gm_for_campaign(id));

drop policy if exists campaigns_delete_gm on public.campaigns;
create policy campaigns_delete_gm
on public.campaigns
for delete
to authenticated
using (public.is_gm_for_campaign(id));

drop policy if exists campaign_members_select_member on public.campaign_members;
create policy campaign_members_select_member
on public.campaign_members
for select
to authenticated
using (public.is_campaign_member(campaign_id));

drop policy if exists campaign_members_insert_gm on public.campaign_members;
create policy campaign_members_insert_gm
on public.campaign_members
for insert
to authenticated
with check (public.is_gm_for_campaign(campaign_id));

drop policy if exists campaign_members_update_gm on public.campaign_members;
create policy campaign_members_update_gm
on public.campaign_members
for update
to authenticated
using (public.is_gm_for_campaign(campaign_id))
with check (public.is_gm_for_campaign(campaign_id));

drop policy if exists campaign_members_delete_gm on public.campaign_members;
create policy campaign_members_delete_gm
on public.campaign_members
for delete
to authenticated
using (public.is_gm_for_campaign(campaign_id));

drop policy if exists characters_select_owner_or_gm on public.characters;
create policy characters_select_owner_or_gm
on public.characters
for select
to authenticated
using (
  public.is_gm_for_campaign(campaign_id)
  or owner_profile_id = auth.uid()
);

drop policy if exists characters_insert_gm on public.characters;
create policy characters_insert_gm
on public.characters
for insert
to authenticated
with check (public.is_gm_for_campaign(campaign_id));

drop policy if exists characters_update_owner_or_gm on public.characters;
create policy characters_update_owner_or_gm
on public.characters
for update
to authenticated
using (
  public.is_gm_for_campaign(campaign_id)
  or owner_profile_id = auth.uid()
)
with check (
  public.is_gm_for_campaign(campaign_id)
  or owner_profile_id = auth.uid()
);

drop policy if exists characters_delete_gm on public.characters;
create policy characters_delete_gm
on public.characters
for delete
to authenticated
using (public.is_gm_for_campaign(campaign_id));

drop policy if exists character_stats_select_owner_or_gm on public.character_stats;
create policy character_stats_select_owner_or_gm
on public.character_stats
for select
to authenticated
using (
  exists (
    select 1
    from public.characters character
    where character.id = character_stats.character_id
      and (
        public.is_gm_for_campaign(character.campaign_id)
        or character.owner_profile_id = auth.uid()
      )
  )
);

drop policy if exists character_stats_insert_owner_or_gm on public.character_stats;
create policy character_stats_insert_owner_or_gm
on public.character_stats
for insert
to authenticated
with check (
  exists (
    select 1
    from public.characters character
    where character.id = character_stats.character_id
      and (
        public.is_gm_for_campaign(character.campaign_id)
        or (
          character.owner_profile_id = auth.uid()
          and character.allow_player_stat_edits
        )
      )
  )
);

drop policy if exists character_stats_update_owner_or_gm on public.character_stats;
create policy character_stats_update_owner_or_gm
on public.character_stats
for update
to authenticated
using (
  exists (
    select 1
    from public.characters character
    where character.id = character_stats.character_id
      and (
        public.is_gm_for_campaign(character.campaign_id)
        or (
          character.owner_profile_id = auth.uid()
          and character.allow_player_stat_edits
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.characters character
    where character.id = character_stats.character_id
      and (
        public.is_gm_for_campaign(character.campaign_id)
        or (
          character.owner_profile_id = auth.uid()
          and character.allow_player_stat_edits
        )
      )
  )
);

drop policy if exists character_stats_delete_gm on public.character_stats;
create policy character_stats_delete_gm
on public.character_stats
for delete
to authenticated
using (
  exists (
    select 1
    from public.characters character
    where character.id = character_stats.character_id
      and public.is_gm_for_campaign(character.campaign_id)
  )
);

drop policy if exists character_skills_select_owner_or_gm on public.character_skills;
create policy character_skills_select_owner_or_gm
on public.character_skills
for select
to authenticated
using (
  exists (
    select 1
    from public.characters character
    where character.id = character_skills.character_id
      and (
        public.is_gm_for_campaign(character.campaign_id)
        or character.owner_profile_id = auth.uid()
      )
  )
);

drop policy if exists character_skills_manage_gm on public.character_skills;
create policy character_skills_manage_gm
on public.character_skills
for all
to authenticated
using (
  exists (
    select 1
    from public.characters character
    where character.id = character_skills.character_id
      and public.is_gm_for_campaign(character.campaign_id)
  )
)
with check (
  exists (
    select 1
    from public.characters character
    where character.id = character_skills.character_id
      and public.is_gm_for_campaign(character.campaign_id)
  )
);

drop policy if exists character_abilities_select_owner_or_gm on public.character_abilities;
create policy character_abilities_select_owner_or_gm
on public.character_abilities
for select
to authenticated
using (
  exists (
    select 1
    from public.characters character
    where character.id = character_abilities.character_id
      and (
        public.is_gm_for_campaign(character.campaign_id)
        or character.owner_profile_id = auth.uid()
      )
  )
);

drop policy if exists character_abilities_manage_gm on public.character_abilities;
create policy character_abilities_manage_gm
on public.character_abilities
for all
to authenticated
using (
  exists (
    select 1
    from public.characters character
    where character.id = character_abilities.character_id
      and public.is_gm_for_campaign(character.campaign_id)
  )
)
with check (
  exists (
    select 1
    from public.characters character
    where character.id = character_abilities.character_id
      and public.is_gm_for_campaign(character.campaign_id)
  )
);

drop policy if exists character_inventory_select_owner_or_gm on public.character_inventory;
create policy character_inventory_select_owner_or_gm
on public.character_inventory
for select
to authenticated
using (
  exists (
    select 1
    from public.characters character
    where character.id = character_inventory.character_id
      and (
        public.is_gm_for_campaign(character.campaign_id)
        or character.owner_profile_id = auth.uid()
      )
  )
);

drop policy if exists character_inventory_manage_gm on public.character_inventory;
create policy character_inventory_manage_gm
on public.character_inventory
for all
to authenticated
using (
  exists (
    select 1
    from public.characters character
    where character.id = character_inventory.character_id
      and public.is_gm_for_campaign(character.campaign_id)
  )
)
with check (
  exists (
    select 1
    from public.characters character
    where character.id = character_inventory.character_id
      and public.is_gm_for_campaign(character.campaign_id)
  )
);

drop policy if exists character_cyberware_select_owner_or_gm on public.character_cyberware;
create policy character_cyberware_select_owner_or_gm
on public.character_cyberware
for select
to authenticated
using (
  exists (
    select 1
    from public.characters character
    where character.id = character_cyberware.character_id
      and (
        public.is_gm_for_campaign(character.campaign_id)
        or character.owner_profile_id = auth.uid()
      )
  )
);

drop policy if exists character_cyberware_manage_gm on public.character_cyberware;
create policy character_cyberware_manage_gm
on public.character_cyberware
for all
to authenticated
using (
  exists (
    select 1
    from public.characters character
    where character.id = character_cyberware.character_id
      and public.is_gm_for_campaign(character.campaign_id)
  )
)
with check (
  exists (
    select 1
    from public.characters character
    where character.id = character_cyberware.character_id
      and public.is_gm_for_campaign(character.campaign_id)
  )
);

drop policy if exists character_notes_select_owner_or_gm on public.character_notes;
create policy character_notes_select_owner_or_gm
on public.character_notes
for select
to authenticated
using (
  exists (
    select 1
    from public.characters character
    where character.id = character_notes.character_id
      and (
        public.is_gm_for_campaign(character.campaign_id)
        or character.owner_profile_id = auth.uid()
      )
  )
);

drop policy if exists character_notes_insert_owner_or_gm on public.character_notes;
create policy character_notes_insert_owner_or_gm
on public.character_notes
for insert
to authenticated
with check (
  exists (
    select 1
    from public.characters character
    where character.id = character_notes.character_id
      and (
        public.is_gm_for_campaign(character.campaign_id)
        or character.owner_profile_id = auth.uid()
      )
  )
);

drop policy if exists character_notes_update_owner_or_gm on public.character_notes;
create policy character_notes_update_owner_or_gm
on public.character_notes
for update
to authenticated
using (
  exists (
    select 1
    from public.characters character
    where character.id = character_notes.character_id
      and (
        public.is_gm_for_campaign(character.campaign_id)
        or character.owner_profile_id = auth.uid()
      )
  )
)
with check (
  exists (
    select 1
    from public.characters character
    where character.id = character_notes.character_id
      and (
        public.is_gm_for_campaign(character.campaign_id)
        or character.owner_profile_id = auth.uid()
      )
  )
);

drop policy if exists character_notes_delete_gm on public.character_notes;
create policy character_notes_delete_gm
on public.character_notes
for delete
to authenticated
using (
  exists (
    select 1
    from public.characters character
    where character.id = character_notes.character_id
      and public.is_gm_for_campaign(character.campaign_id)
  )
);

drop policy if exists pdf_documents_select_allowed on public.pdf_documents;
create policy pdf_documents_select_allowed
on public.pdf_documents
for select
to authenticated
using (
  public.is_current_user_gm()
  or exists (
    select 1
    from public.pdf_document_access access_entry
    where access_entry.document_id = pdf_documents.id
      and access_entry.profile_id = auth.uid()
  )
);

drop policy if exists pdf_documents_insert_gm on public.pdf_documents;
create policy pdf_documents_insert_gm
on public.pdf_documents
for insert
to authenticated
with check (public.is_current_user_gm());

drop policy if exists pdf_documents_update_gm on public.pdf_documents;
create policy pdf_documents_update_gm
on public.pdf_documents
for update
to authenticated
using (public.is_current_user_gm())
with check (public.is_current_user_gm());

drop policy if exists pdf_documents_delete_gm on public.pdf_documents;
create policy pdf_documents_delete_gm
on public.pdf_documents
for delete
to authenticated
using (public.is_current_user_gm());

drop policy if exists pdf_document_access_select_allowed on public.pdf_document_access;
create policy pdf_document_access_select_allowed
on public.pdf_document_access
for select
to authenticated
using (
  public.is_current_user_gm()
  or profile_id = auth.uid()
);

drop policy if exists pdf_document_access_insert_gm on public.pdf_document_access;
create policy pdf_document_access_insert_gm
on public.pdf_document_access
for insert
to authenticated
with check (public.is_current_user_gm());

drop policy if exists pdf_document_access_update_gm on public.pdf_document_access;
create policy pdf_document_access_update_gm
on public.pdf_document_access
for update
to authenticated
using (public.is_current_user_gm())
with check (public.is_current_user_gm());

drop policy if exists pdf_document_access_delete_gm on public.pdf_document_access;
create policy pdf_document_access_delete_gm
on public.pdf_document_access
for delete
to authenticated
using (public.is_current_user_gm());

drop policy if exists character_sheet_forms_select_allowed on public.character_sheet_forms;
create policy character_sheet_forms_select_allowed
on public.character_sheet_forms
for select
to authenticated
using (
  public.is_current_user_gm()
  or profile_id = auth.uid()
);

drop policy if exists character_sheet_forms_insert_allowed on public.character_sheet_forms;
create policy character_sheet_forms_insert_allowed
on public.character_sheet_forms
for insert
to authenticated
with check (
  public.is_current_user_gm()
  or profile_id = auth.uid()
);

drop policy if exists character_sheet_forms_update_allowed on public.character_sheet_forms;
create policy character_sheet_forms_update_allowed
on public.character_sheet_forms
for update
to authenticated
using (
  public.is_current_user_gm()
  or profile_id = auth.uid()
)
with check (
  public.is_current_user_gm()
  or profile_id = auth.uid()
);

drop policy if exists character_sheet_forms_delete_allowed on public.character_sheet_forms;
create policy character_sheet_forms_delete_allowed
on public.character_sheet_forms
for delete
to authenticated
using (
  public.is_current_user_gm()
  or profile_id = auth.uid()
);

comment on table public.characters is
'Players may update personal character fields through the UI. Protected core stat enforcement is handled primarily in character_stats RLS.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'campaign-pdfs',
  'campaign-pdfs',
  false,
  52428800,
  array['application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists campaign_pdfs_select_authenticated on storage.objects;
create policy campaign_pdfs_select_authenticated
on storage.objects
for select
to authenticated
using (
  bucket_id = 'campaign-pdfs'
  and (
    public.is_current_user_gm()
    or exists (
      select 1
      from public.pdf_documents document
      join public.pdf_document_access access_entry
        on access_entry.document_id = document.id
      where document.storage_path = name
        and access_entry.profile_id = auth.uid()
    )
  )
);

drop policy if exists campaign_pdfs_insert_gm on storage.objects;
create policy campaign_pdfs_insert_gm
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'campaign-pdfs'
  and public.is_current_user_gm()
);

drop policy if exists campaign_pdfs_update_gm on storage.objects;
create policy campaign_pdfs_update_gm
on storage.objects
for update
to authenticated
using (
  bucket_id = 'campaign-pdfs'
  and public.is_current_user_gm()
)
with check (
  bucket_id = 'campaign-pdfs'
  and public.is_current_user_gm()
);

drop policy if exists campaign_pdfs_delete_gm on storage.objects;
create policy campaign_pdfs_delete_gm
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'campaign-pdfs'
  and public.is_current_user_gm()
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'character_sheet_forms'
  ) then
    alter publication supabase_realtime add table public.character_sheet_forms;
  end if;
exception
  when duplicate_object then null;
end $$;
