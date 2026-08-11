-- Durable PULSE posts/replies with server-authored audit records.
-- Run after supabase/net-app-accounts.sql.

create extension if not exists pgcrypto;

create table if not exists public.net_pulse_posts (
  id uuid primary key default gen_random_uuid(),
  author_account_id uuid not null references public.net_app_accounts (id) on delete restrict,
  parent_post_id uuid references public.net_pulse_posts (id) on delete restrict,
  body text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_pulse_posts_body_valid check (
    body = btrim(body)
    and char_length(body) between 1 and 360
  )
);

comment on table public.net_pulse_posts is
  'Durable player-authored PULSE posts and replies. Author presentation is resolved from net_app_accounts and identity/profile sources at read time.';
comment on column public.net_pulse_posts.parent_post_id is
  'Null for a root Pulse; references another durable Pulse for a reply. Nested server replies remain supported by the existing thread UI.';

create index if not exists net_pulse_posts_created_at_idx
  on public.net_pulse_posts (created_at desc);
create index if not exists net_pulse_posts_author_created_idx
  on public.net_pulse_posts (author_account_id, created_at desc);
create index if not exists net_pulse_posts_parent_created_idx
  on public.net_pulse_posts (parent_post_id, created_at asc)
  where parent_post_id is not null;

drop trigger if exists net_pulse_posts_set_updated_at on public.net_pulse_posts;
create trigger net_pulse_posts_set_updated_at
before update on public.net_pulse_posts
for each row execute procedure public.set_updated_at();

create table if not exists public.net_action_audit (
  id uuid primary key default gen_random_uuid(),
  authenticated_actor_profile_id uuid not null references public.profiles (id) on delete restrict,
  presented_account_id uuid references public.net_app_accounts (id) on delete set null,
  persona_subject_kind text,
  persona_subject_id uuid,
  action_mode text not null
    check (action_mode in ('owner', 'gm-persona', 'compromised-session', 'spoofed', 'system')),
  action_type text not null check (btrim(action_type) <> ''),
  authorization_basis text not null check (btrim(authorization_basis) <> ''),
  resource_type text,
  resource_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  constraint net_action_audit_persona_pair check (
    (persona_subject_kind is null and persona_subject_id is null)
    or (persona_subject_kind is not null and persona_subject_id is not null)
  ),
  constraint net_action_audit_persona_kind check (
    persona_subject_kind is null
    or persona_subject_kind in (
      'profile-sheet',
      'npc-card',
      'character',
      'entity',
      'organisation',
      'service'
    )
  ),
  constraint net_action_audit_resource_pair check (
    (resource_type is null and resource_id is null)
    or (resource_type is not null and resource_id is not null)
  )
);

comment on table public.net_action_audit is
  'Hidden authoritative action ledger. Client sessions never write audit rows directly; content RPCs derive actor, mode, and authorization basis.';

create index if not exists net_action_audit_actor_created_idx
  on public.net_action_audit (authenticated_actor_profile_id, created_at desc);
create index if not exists net_action_audit_account_created_idx
  on public.net_action_audit (presented_account_id, created_at desc)
  where presented_account_id is not null;
create index if not exists net_action_audit_resource_idx
  on public.net_action_audit (resource_type, resource_id)
  where resource_id is not null;

create or replace function public.create_net_pulse_post(
  requested_author_account_id uuid,
  requested_body text,
  requested_parent_post_id uuid default null
)
returns public.net_pulse_posts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
  author_account public.net_app_accounts%rowtype;
  parent_post public.net_pulse_posts%rowtype;
  normalized_body text := btrim(coalesce(requested_body, ''));
  saved_post public.net_pulse_posts%rowtype;
begin
  if actor_profile_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if requested_author_account_id is null then
    raise exception 'A PULSE author account is required.' using errcode = '22023';
  end if;

  select *
  into author_account
  from public.net_app_accounts
  where id = requested_author_account_id;

  if not found
    or author_account.app_id <> 'pulse'
    or author_account.identity_link_id is null
  then
    raise exception 'The requested account cannot author PULSE content.' using errcode = '42501';
  end if;

  if author_account.status <> 'active' then
    raise exception 'Only an active PULSE account may author content.' using errcode = '42501';
  end if;

  if not public.current_user_controls_playable_net_identity_link(author_account.identity_link_id) then
    raise exception 'The authenticated actor does not control this PULSE account.' using errcode = '42501';
  end if;

  if normalized_body = '' then
    raise exception 'PULSE content cannot be empty.' using errcode = '22023';
  end if;
  if char_length(normalized_body) > 360 then
    raise exception 'PULSE content is limited to 360 characters.' using errcode = '22001';
  end if;

  if requested_parent_post_id is not null then
    select *
    into parent_post
    from public.net_pulse_posts
    where id = requested_parent_post_id;

    if not found then
      raise exception 'The requested parent PULSE does not exist.' using errcode = '23503';
    end if;
  end if;

  insert into public.net_pulse_posts (
    author_account_id,
    parent_post_id,
    body
  )
  values (
    author_account.id,
    requested_parent_post_id,
    normalized_body
  )
  returning * into saved_post;

  insert into public.net_action_audit (
    authenticated_actor_profile_id,
    presented_account_id,
    persona_subject_kind,
    persona_subject_id,
    action_mode,
    action_type,
    authorization_basis,
    resource_type,
    resource_id
  )
  values (
    actor_profile_id,
    author_account.id,
    null,
    null,
    'owner',
    case when requested_parent_post_id is null
      then 'pulse.post.create'
      else 'pulse.reply.create'
    end,
    'controlled-playable-identity',
    'pulse-post',
    saved_post.id
  );

  return saved_post;
end;
$$;

-- One security-definer read avoids an N+1 query and exposes only public PULSE
-- presentation. It does not expose identity ownership, auth data, or audit.
create or replace function public.fetch_net_pulse_feed(
  requested_limit integer default 200
)
returns table (
  id uuid,
  author_account_id uuid,
  parent_post_id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  author_handle text,
  author_display_name text,
  author_avatar_url text,
  author_status text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  safe_limit integer := least(greatest(coalesce(requested_limit, 200), 1), 500);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  return query
  select
    post.id,
    post.author_account_id,
    post.parent_post_id,
    post.body,
    post.created_at,
    post.updated_at,
    account.handle as author_handle,
    coalesce(
      nullif(btrim(account.display_name_override), ''),
      nullif(btrim(universal_profile.display_name_override), ''),
      case identity_link.subject_kind
        when 'profile-sheet' then coalesce(
          nullif(btrim(profile_sheet.field_data ->> 'NOME'), ''),
          nullif(btrim(profile.display_name), '')
        )
        when 'npc-card' then coalesce(
          nullif(btrim(npc_card.field_data ->> 'NOME'), ''),
          nullif(btrim(npc_card.display_name), '')
        )
        when 'character' then coalesce(
          nullif(btrim(campaign_character.alias), ''),
          nullif(btrim(campaign_character.name), '')
        )
      end,
      account.handle
    ) as author_display_name,
    coalesce(
      nullif(btrim(account.avatar_url_override), ''),
      nullif(btrim(universal_profile.avatar_url_override), ''),
      case identity_link.subject_kind
        when 'profile-sheet' then coalesce(
          nullif(btrim(profile_sheet.field_data ->> 'FOTO2'), ''),
          nullif(btrim(profile_sheet.field_data ->> 'FOTO'), '')
        )
        when 'npc-card' then coalesce(
          nullif(btrim(npc_card.field_data ->> 'FOTO2'), ''),
          nullif(btrim(npc_card.field_data ->> 'FOTO'), '')
        )
        when 'character' then nullif(btrim(campaign_character.portrait_url), '')
      end
    ) as author_avatar_url,
    account.status as author_status
  from public.net_pulse_posts as post
  join public.net_app_accounts as account
    on account.id = post.author_account_id
    and account.app_id = 'pulse'
  left join public.net_identity_links as identity_link
    on identity_link.id = account.identity_link_id
  left join public.net_universal_profiles as universal_profile
    on universal_profile.identity_link_id = identity_link.id
  left join public.profiles as profile
    on identity_link.subject_kind = 'profile-sheet'
    and profile.id = identity_link.subject_id
  left join public.character_sheet_forms as profile_sheet
    on identity_link.subject_kind = 'profile-sheet'
    and profile_sheet.profile_id = identity_link.subject_id
  left join public.npc_cards as npc_card
    on identity_link.subject_kind = 'npc-card'
    and npc_card.id = identity_link.subject_id
  left join public.characters as campaign_character
    on identity_link.subject_kind = 'character'
    and campaign_character.id = identity_link.subject_id
  order by post.created_at desc
  limit safe_limit;
end;
$$;

alter table public.net_pulse_posts enable row level security;
alter table public.net_action_audit enable row level security;

drop policy if exists net_pulse_posts_select_authenticated on public.net_pulse_posts;
create policy net_pulse_posts_select_authenticated
on public.net_pulse_posts
for select
to authenticated
using (true);

drop policy if exists net_action_audit_select_gm on public.net_action_audit;
create policy net_action_audit_select_gm
on public.net_action_audit
for select
to authenticated
using (public.is_current_user_gm());

revoke all on public.net_pulse_posts from anon;
revoke all on public.net_action_audit from anon;
revoke insert, update, delete on public.net_pulse_posts from authenticated;
revoke insert, update, delete on public.net_action_audit from authenticated;
grant select on public.net_pulse_posts to authenticated;
grant select on public.net_action_audit to authenticated;

revoke all on function public.create_net_pulse_post(uuid, text, uuid) from public;
revoke all on function public.fetch_net_pulse_feed(integer) from public;
grant execute on function public.create_net_pulse_post(uuid, text, uuid) to authenticated;
grant execute on function public.fetch_net_pulse_feed(integer) to authenticated;
