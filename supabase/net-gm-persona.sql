-- Server-authoritative GM persona context for THE NET.
-- Run after supabase/net-identity-selection.sql.

create table if not exists public.net_gm_persona_sessions (
  gm_profile_id uuid primary key references public.profiles (id) on delete cascade,
  subject_kind text,
  subject_id uuid,
  mode text not null default 'none'
    check (mode in ('none', 'inspect', 'gm-persona')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_gm_persona_sessions_subject_shape check (
    (mode = 'none' and subject_kind is null and subject_id is null)
    or
    (
      mode in ('inspect', 'gm-persona')
      and subject_kind in ('profile-sheet', 'npc-card')
      and subject_id is not null
    )
  )
);

comment on table public.net_gm_persona_sessions is
  'Current GM inspection/persona context. The authenticated actor remains gm_profile_id; this row grants no content-authoring authority.';
comment on column public.net_gm_persona_sessions.mode is
  'Only none, inspect, and GM-controlled NPC persona are supported. Narrative compromise/spoof modes require a separate audited authorization migration.';

create index if not exists net_gm_persona_sessions_subject_idx
  on public.net_gm_persona_sessions (subject_kind, subject_id)
  where subject_id is not null;

drop trigger if exists net_gm_persona_sessions_set_updated_at
  on public.net_gm_persona_sessions;
create trigger net_gm_persona_sessions_set_updated_at
before update on public.net_gm_persona_sessions
for each row execute procedure public.set_updated_at();

create or replace function public.set_net_gm_persona(
  requested_subject_kind text,
  requested_subject_id uuid,
  requested_mode text
)
returns public.net_gm_persona_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  saved_session public.net_gm_persona_sessions%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not public.is_current_user_gm() then
    raise exception 'Only an authenticated GM may select a GM persona.'
      using errcode = '42501';
  end if;

  if requested_subject_id is null
    or requested_subject_kind is null
    or requested_subject_kind not in ('profile-sheet', 'npc-card')
    or requested_mode is null
    or requested_mode not in ('inspect', 'gm-persona')
  then
    raise exception 'Unsupported GM persona request.' using errcode = '22023';
  end if;

  if requested_subject_kind = 'profile-sheet' then
    if requested_mode <> 'inspect' then
      raise exception 'Player profile sheets may only be inspected in this release.'
        using errcode = '42501';
    end if;

    if not exists (
      select 1
      from public.profiles as target_profile
      where target_profile.id = requested_subject_id
        and target_profile.role = 'player'
    ) then
      raise exception 'Requested player profile sheet is unavailable.'
        using errcode = '22023';
    end if;
  elsif requested_subject_kind = 'npc-card' then
    -- npc_cards is globally GM-controlled in the current authoritative policy.
    -- The client never supplies or proves ownership.
    if not exists (
      select 1
      from public.npc_cards as target_card
      where target_card.id = requested_subject_id
    ) then
      raise exception 'Requested NPC card is unavailable.' using errcode = '22023';
    end if;
  end if;

  insert into public.net_gm_persona_sessions (
    gm_profile_id,
    subject_kind,
    subject_id,
    mode
  )
  values (
    actor_id,
    requested_subject_kind,
    requested_subject_id,
    requested_mode
  )
  on conflict (gm_profile_id) do update
  set
    subject_kind = excluded.subject_kind,
    subject_id = excluded.subject_id,
    mode = excluded.mode
  returning * into saved_session;

  return saved_session;
end;
$$;

create or replace function public.clear_net_gm_persona()
returns public.net_gm_persona_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  saved_session public.net_gm_persona_sessions%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not public.is_current_user_gm() then
    raise exception 'Only an authenticated GM may clear a GM persona.'
      using errcode = '42501';
  end if;

  insert into public.net_gm_persona_sessions (
    gm_profile_id,
    subject_kind,
    subject_id,
    mode
  )
  values (actor_id, null, null, 'none')
  on conflict (gm_profile_id) do update
  set
    subject_kind = null,
    subject_id = null,
    mode = 'none'
  returning * into saved_session;

  return saved_session;
end;
$$;

create or replace function public.delete_invalid_net_gm_persona_target()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.net_gm_persona_sessions
  where subject_kind = case tg_table_name
    when 'profiles' then 'profile-sheet'
    when 'npc_cards' then 'npc-card'
  end
    and subject_id = old.id;

  return old;
end;
$$;

drop trigger if exists profiles_delete_net_gm_persona_target on public.profiles;
create trigger profiles_delete_net_gm_persona_target
after delete on public.profiles
for each row execute procedure public.delete_invalid_net_gm_persona_target();

drop trigger if exists npc_cards_delete_net_gm_persona_target on public.npc_cards;
create trigger npc_cards_delete_net_gm_persona_target
after delete on public.npc_cards
for each row execute procedure public.delete_invalid_net_gm_persona_target();

create or replace function public.clear_net_gm_persona_on_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.role = 'gm' and new.role <> 'gm' then
    delete from public.net_gm_persona_sessions where gm_profile_id = new.id;
  end if;

  if old.role = 'player' and new.role <> 'player' then
    delete from public.net_gm_persona_sessions
    where subject_kind = 'profile-sheet'
      and subject_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_clear_net_gm_persona_on_role_change on public.profiles;
create trigger profiles_clear_net_gm_persona_on_role_change
after update of role on public.profiles
for each row
when (old.role is distinct from new.role)
execute procedure public.clear_net_gm_persona_on_profile_role_change();

alter table public.net_gm_persona_sessions enable row level security;

drop policy if exists net_gm_persona_sessions_select_own on public.net_gm_persona_sessions;
create policy net_gm_persona_sessions_select_own
on public.net_gm_persona_sessions
for select
to authenticated
using (
  gm_profile_id = auth.uid()
  and public.is_current_user_gm()
);

revoke all on public.net_gm_persona_sessions from anon;
revoke all on public.net_gm_persona_sessions from authenticated;
grant select on public.net_gm_persona_sessions to authenticated;

revoke all on function public.set_net_gm_persona(text, uuid, text) from public;
revoke all on function public.clear_net_gm_persona() from public;
grant execute on function public.set_net_gm_persona(text, uuid, text) to authenticated;
grant execute on function public.clear_net_gm_persona() to authenticated;

revoke all on function public.delete_invalid_net_gm_persona_target() from public;
revoke all on function public.clear_net_gm_persona_on_profile_role_change() from public;
