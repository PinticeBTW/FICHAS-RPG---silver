-- Shared APP-LOCAL identity presentation: one central table + RPC surface
-- that any identity-facing app can use to let a player override the
-- display name/avatar THAT APP shows for their current legitimate identity,
-- without ever touching the character sheet, the identity canonical record,
-- or any other app's own presentation.
--
-- INSPECTION SUMMARY (why this shape, not a second parallel account table):
--   - net_app_accounts (net-app-accounts.sql) already has per-(app_id,
--     identity_link_id) display_name_override/avatar_url_override columns,
--     but it is a heavier "in-world ACCOUNT" concept: a NOT NULL globally-
--     unique-per-app handle, a status lifecycle, and entity/organisation
--     owner variants for world-seeded service accounts. Its app_id CHECK
--     constraint is hard-limited to ('iden','altara','echo','pulse','loop'),
--     and 'iden'/'echo'/'altara' are confirmed retired (netAppAccountService.
--     ts explicitly filters app_id='altara' rows out as legacy history).
--     Realistically only PULSE actively uses it today, through its own
--     dedicated net_pulse_profiles + PulseProfileEditor.tsx UX, which this
--     migration does not touch. None of RELAY/VLT/VOX BANK/SHNEIDER BANK/
--     VOX AUDIO/ALTARA Messenger/ALTARA BANK/NOVA BANK/ALTARA MUSIC/WAVE
--     have or want a public @handle -- they identify purely by canonical
--     character identity. Widening net_app_accounts' handle/status/CHECK
--     shape to fit them would be a worse, more invasive fit than one new,
--     minimal, identity-link-keyed table.
--   - net_universal_profiles (net-universal-profiles.sql) is a SEPARATE,
--     SIBLING override layer, shared across every app for one identity, used
--     today by net_altara_identity_presentation/net_veil_messenger_identity_
--     presentation/net_economy_identity_display_name. It is NOT part of this
--     feature's fallback chain. Confirmed product rule: app-local
--     presentation is app override -> TRUE character-sheet presentation
--     only, so "reset" genuinely means "the sheet, right now" -- never a
--     universal-profile value the player set somewhere else and may not even
--     remember exists. This migration does not read, write, or otherwise
--     touch net_universal_profiles at all.
--   - The shared media pipeline already has a reserved, RLS-supported
--     'universal-profile' subject kind whose SELECT policy already makes
--     media_kind='avatar' objects readable by any authenticated user (the
--     exact visibility an app-local avatar needs, since other participants
--     must see it too), and whose WRITE policy is already scoped to "the
--     controlling player of that exact identity_link_id" -- with zero
--     schema changes. App-local avatars reuse that exact subject kind with
--     a per-app `slot`, giving each app its own object path under the same
--     identity with NO new Storage RLS branch required. Reusing this
--     subject kind for Storage paths is unrelated to, and does not
--     reintroduce, the net_universal_profiles TABLE in the fallback chain.
--
-- CENTRAL MODEL: net_app_identity_presentations, one row per (app_id,
-- identity_link_id), holding only the two override fields. Effective
-- presentation for any (app_id, identity_link_id) is resolved through
-- fetch_net_app_identity_presentation (general, any target identity -- used
-- to render OTHER participants) and fetch_net_app_identity_profile_editor
-- (caller's own current legitimate identity only -- used by the editor).
-- Both fall back to net_identity_canonical_presentation -- TRUE canonical
-- character-sheet presentation, with no net_universal_profiles influence --
-- when no app-local override exists. It reuses the exact same per-subject-
-- kind (profile-sheet/npc-card/character) lookup shape already proven in
-- net_altara_identity_presentation/net_veil_messenger_identity_presentation,
-- written once more here (rather than refactoring either of those in place,
-- which would change behaviour for their other, unrelated call sites), with
-- the universal-profile layer those two functions carry intentionally
-- omitted.
--
-- SAFETY NOTE ON NOT MODIFYING EXISTING PRESENTATION FUNCTIONS: adding a
-- new trailing DEFAULT parameter to net_altara_identity_presentation(uuid)
-- or net_veil_messenger_identity_presentation(uuid) would register a SECOND
-- overload (Postgres resolves functions by name + declared parameter
-- COUNT/types, not by which trailing parameters carry defaults), leaving
-- the original 1-argument overload physically present and selected for
-- every existing 1-argument call. That is *closer* to safe than an outright
-- signature change, but two overloads of the same name differing only by a
-- defaulted trailing argument is a documented Postgres ambiguity hazard.
-- ALTARA WAVE, ALTARA BANK, NOVA BANK, and multi-os NPC assignments all
-- call net_altara_identity_presentation(uuid) today and are explicitly out
-- of scope for this batch, so this migration does not touch either function
-- at all -- zero risk to any of those four files. RELAY and ALTARA
-- Messenger's own member/author/recipient/search presentation call sites
-- are instead switched to call the new, independent, explicitly-app-scoped
-- fetch_net_app_identity_presentation('<app-id>', identity_link_id)
-- directly. net_veil_messenger_identity_presentation and net_altara_
-- identity_presentation remain deployed unchanged; the former simply has no
-- remaining caller inside net-veil-messenger.sql after this migration, the
-- latter keeps serving WAVE/BANK/NPC-assignments exactly as before.
--
-- Forward-only. Does not edit net-app-accounts.sql, net-universal-
-- profiles.sql, rpg-shared-media.sql, net-altara-messenger.sql, or
-- net-veil-messenger.sql in place -- every changed function below is
-- redeployed here via CREATE OR REPLACE FUNCTION under its EXACT existing
-- name and signature, using each function's verified current production
-- body (confirmed via direct inspection: net_altara_conversation_members_
-- json, search_net_altara_messenger_recipients, fetch_net_altara_message_
-- page, and send_net_altara_message have never been patched since net-
-- altara-messenger.sql; fetch_net_altara_messenger_sidebar's current body
-- is the one deployed by net-altara-messenger-bank-music-runtime-identity-
-- fix.sql, not the retired original -- using the original here would
-- silently revert that fix).

begin;

do $preflight$
begin
  if to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_universal_profiles') is null
    or to_regclass('public.character_sheet_forms') is null
    or to_regclass('public.npc_cards') is null
    or to_regclass('public.characters') is null
    or to_regclass('public.profiles') is null
    or to_regclass('public.net_veil_messenger_conversations') is null
    or to_regclass('public.net_veil_messenger_conversation_members') is null
    or to_regclass('public.net_veil_messenger_messages') is null
    or to_regclass('public.net_altara_conversations') is null
    or to_regclass('public.net_altara_conversation_members') is null
    or to_regclass('public.net_altara_messages') is null
    or to_regprocedure('public.current_net_runtime_source_identity_link_id()') is null
    or to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
    or to_regprocedure('public.net_veil_messenger_assert_context(uuid)') is null
    or to_regprocedure('public.net_veil_messenger_effective_identity(uuid)') is null
    or to_regprocedure('public.net_veil_messenger_identity_can_use_messenger(uuid)') is null
    or to_regprocedure('public.net_veil_messenger_bump_revisions(uuid[])') is null
    or to_regprocedure('public.net_altara_assert_messenger_context(uuid)') is null
    or to_regprocedure('public.net_altara_identity_can_use_messenger(uuid)') is null
    or to_regprocedure('public.net_altara_bump_messenger_revisions(uuid[])') is null
    or to_regprocedure('public.is_current_user_gm()') is null
  then
    raise exception 'NET_APP_IDENTITY_PRESENTATION_DEPENDENCY_REQUIRED. This migration requires net-universal-profiles.sql, net-system-hacking-runtime-projection.sql, net-multi-os-npc-assignments.sql, net-altara-messenger.sql (+ its bank-music-runtime-identity-fix patch), and net-veil-messenger.sql to be deployed first.'
      using errcode = '55000';
  end if;

  if to_regclass('public.net_app_identity_presentations') is not null then
    raise exception 'NET_APP_IDENTITY_PRESENTATION_SCHEMA_COLLISION_REVIEW_REQUIRED' using errcode = '42P07';
  end if;
end;
$preflight$;

-- ==================================================================
-- SCHEMA
-- ==================================================================

create table public.net_app_identity_presentations (
  app_id text not null,
  identity_link_id uuid not null
    references public.net_identity_links (id) on delete cascade,
  custom_display_name text,
  custom_avatar_ref text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (app_id, identity_link_id),
  constraint net_app_identity_presentations_app_valid check (
    app_id in (
      'relay', 'vlt', 'vox-bank', 'shneider-bank', 'vox-audio',
      'altara-messenger', 'altara-bank', 'nova-bank', 'altara-music', 'altara-wave'
    )
  ),
  constraint net_app_identity_presentations_display_name_limit check (
    custom_display_name is null or char_length(custom_display_name) <= 40
  ),
  constraint net_app_identity_presentations_avatar_ref_limit check (
    custom_avatar_ref is null or char_length(custom_avatar_ref) <= 2048
  )
);

comment on table public.net_app_identity_presentations is
  'App-local display-name/avatar overrides. One row per (app_id, identity_link_id). NULL/absent falls back to net_identity_canonical_presentation (TRUE character-sheet/npc-card/character presentation only -- net_universal_profiles is never consulted for this fallback). Visual presentation only -- never joined into ownership, balance, or audit resolution anywhere.';
comment on column public.net_app_identity_presentations.custom_avatar_ref is
  'Opaque rpg-media shared reference (same format as net_universal_profiles.avatar_url_override), never a raw URL or base64 payload.';

drop trigger if exists net_app_identity_presentations_set_updated_at
  on public.net_app_identity_presentations;
create trigger net_app_identity_presentations_set_updated_at
before update on public.net_app_identity_presentations
for each row execute procedure public.set_updated_at();

-- ==================================================================
-- CANONICAL FALLBACK -- TRUE character-sheet presentation only. Reuses the
-- same per-subject-kind (profile-sheet/npc-card/character) lookup shape
-- already proven in net_altara_identity_presentation/net_veil_messenger_
-- identity_presentation, but deliberately WITHOUT their net_universal_
-- profiles override layer: app-local presentation's fallback is the sheet,
-- never a cross-app override the player may have set elsewhere. Does not
-- modify, call, or otherwise touch either of those two functions, or
-- net_universal_profiles itself.
-- ==================================================================

create or replace function public.net_identity_canonical_presentation(
  requested_identity_link_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.net_identity_links%rowtype;
  v_name text;
  v_avatar_url text;
begin
  select identity_link.*
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id;

  if not found then
    return jsonb_build_object(
      'identity_link_id', requested_identity_link_id,
      'display_name', 'Former New Vega identity',
      'avatar_url', null
    );
  end if;

  -- Deliberately no net_universal_profiles lookup here: this function is the
  -- TRUE canonical character-sheet presentation, with no cross-app override
  -- layer mixed in. v_name/v_avatar_url start null and are filled purely
  -- from the sheet/npc-card/character record below.
  case v_link.subject_kind
    when 'profile-sheet' then
      select
        coalesce(
          v_name,
          nullif(btrim(sheet.field_data ->> 'NOME'), ''),
          nullif(btrim(profile.display_name), ''),
          nullif(btrim(profile.handle), '')
        ),
        coalesce(
          v_avatar_url,
          nullif(btrim(sheet.field_data ->> 'FOTO2'), ''),
          nullif(btrim(sheet.field_data ->> 'FOTO'), ''),
          nullif(btrim(profile.avatar_url), '')
        )
      into v_name, v_avatar_url
      from public.profiles as profile
      left join public.character_sheet_forms as sheet
        on sheet.profile_id = profile.id
      where profile.id = v_link.subject_id;

    when 'npc-card' then
      select
        coalesce(
          v_name,
          nullif(btrim(card.field_data ->> 'NOME'), ''),
          nullif(btrim(card.display_name), '')
        ),
        coalesce(
          v_avatar_url,
          nullif(btrim(card.field_data ->> 'FOTO2'), ''),
          nullif(btrim(card.field_data ->> 'FOTO'), '')
        )
      into v_name, v_avatar_url
      from public.npc_cards as card
      where card.id = v_link.subject_id;

    when 'character' then
      select
        coalesce(
          v_name,
          nullif(btrim(character.alias), ''),
          nullif(btrim(character.name), '')
        ),
        coalesce(v_avatar_url, nullif(btrim(character.portrait_url), ''))
      into v_name, v_avatar_url
      from public.characters as character
      where character.id = v_link.subject_id;
  end case;

  if v_avatar_url is not null
    and (
      char_length(v_avatar_url) > 2048
      or lower(v_avatar_url) like 'data:%'
    )
  then
    v_avatar_url := null;
  end if;

  return jsonb_build_object(
    'identity_link_id', v_link.id,
    'display_name', left(coalesce(v_name, 'New Vega identity'), 160),
    'avatar_url', v_avatar_url
  );
end;
$$;

-- ==================================================================
-- IDENTITY AUTHORITY (same proven SOURCE-or-EFFECTIVE dual check already
-- deployed for RELAY/ALTARA Messenger/ALTARA BANK, now app-id-parameterised)
-- ==================================================================

create or replace function public.net_app_identity_presentation_effective_identity(
  requested_app_id text,
  requested_expected_identity_link_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select requested_expected_identity_link_id
  where requested_app_id is not null
    and requested_expected_identity_link_id is not null
    and (
      requested_expected_identity_link_id = public.current_net_runtime_source_identity_link_id()
      or requested_expected_identity_link_id = public.current_net_effective_runtime_identity_link_id()
    )
    and public.net_identity_link_can_access_service(requested_expected_identity_link_id, requested_app_id);
$$;

comment on function public.net_app_identity_presentation_effective_identity(text, uuid) is
  'Validates the client-claimed identity against canonical SOURCE or hacking-projected EFFECTIVE runtime identity (never trusts the raw client value) and current OS/service eligibility for the named app. Covers normal player, TAKE CONTROL, ACT AS NPC, and hacking SOURCE/TARGET uniformly; returns null (never raises) for GM SYSTEM with no persona.';

create or replace function public.assert_net_app_identity_presentation_context(
  requested_app_id text,
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  if auth.uid() is null then
    raise exception 'NET_APP_PROFILE_AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_identity_link_id := public.net_app_identity_presentation_effective_identity(
    requested_app_id,
    requested_expected_identity_link_id
  );

  if v_identity_link_id is null then
    raise exception 'NET_APP_PROFILE_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  return v_identity_link_id;
end;
$$;

-- ==================================================================
-- READ RPCs
-- ==================================================================

-- General-purpose: resolves ANY identity's presentation within ONE named
-- app. No caller-ownership check -- this is how apps render OTHER
-- participants (message authors, conversation members, directory search,
-- counterparties), exactly like the existing per-app presentation helpers
-- it is modelled on.
create or replace function public.fetch_net_app_identity_presentation(
  requested_app_id text,
  requested_identity_link_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_avatar_ref text;
  v_canonical jsonb;
begin
  if auth.uid() is null then
    raise exception 'NET_APP_PROFILE_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if requested_app_id is null or requested_identity_link_id is null then
    raise exception 'NET_APP_PROFILE_REQUEST_INVALID' using errcode = '22023';
  end if;

  select
    nullif(btrim(override.custom_display_name), ''),
    nullif(btrim(override.custom_avatar_ref), '')
  into v_name, v_avatar_ref
  from public.net_app_identity_presentations as override
  where override.app_id = requested_app_id
    and override.identity_link_id = requested_identity_link_id;

  v_canonical := public.net_identity_canonical_presentation(requested_identity_link_id);

  return jsonb_build_object(
    'identity_link_id', requested_identity_link_id,
    'display_name', coalesce(v_name, v_canonical ->> 'display_name'),
    'avatar_url', coalesce(v_avatar_ref, v_canonical ->> 'avatar_url')
  );
end;
$$;

-- Owner-only, richer shape for the shared editor: exposes the raw override
-- fields (so the UI can show "APP OVERRIDE" vs "USING CHARACTER SHEET")
-- alongside the canonical default and the resulting effective value.
create or replace function public.fetch_net_app_identity_profile_editor(
  requested_app_id text,
  requested_expected_identity_link_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_name text;
  v_avatar_ref text;
  v_canonical jsonb;
begin
  if auth.uid() is null then
    raise exception 'NET_APP_PROFILE_AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_identity_link_id := public.net_app_identity_presentation_effective_identity(
    requested_app_id,
    requested_expected_identity_link_id
  );
  if v_identity_link_id is null then
    raise exception 'NET_APP_PROFILE_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  select override.custom_display_name, override.custom_avatar_ref
  into v_name, v_avatar_ref
  from public.net_app_identity_presentations as override
  where override.app_id = requested_app_id
    and override.identity_link_id = v_identity_link_id;

  v_canonical := public.net_identity_canonical_presentation(v_identity_link_id);

  return jsonb_build_object(
    'identity_link_id', v_identity_link_id,
    'app_id', requested_app_id,
    'custom_display_name', v_name,
    'custom_avatar_ref', v_avatar_ref,
    'canonical_display_name', v_canonical ->> 'display_name',
    'canonical_avatar_url', v_canonical ->> 'avatar_url',
    'effective_display_name', coalesce(nullif(btrim(v_name), ''), v_canonical ->> 'display_name'),
    'effective_avatar_url', coalesce(nullif(btrim(v_avatar_ref), ''), v_canonical ->> 'avatar_url')
  );
end;
$$;

-- ==================================================================
-- WRITE RPC (also serves RESET: pass both fields null/empty)
-- ==================================================================

create or replace function public.set_net_app_identity_presentation(
  requested_app_id text,
  requested_expected_identity_link_id uuid,
  requested_display_name text default null,
  requested_avatar_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_name text := nullif(btrim(requested_display_name), '');
  v_avatar_ref text := nullif(btrim(requested_avatar_ref), '');
begin
  v_identity_link_id := public.assert_net_app_identity_presentation_context(
    requested_app_id,
    requested_expected_identity_link_id
  );

  if v_name is not null and char_length(v_name) > 40 then
    raise exception 'NET_APP_PROFILE_DISPLAY_NAME_LIMIT' using errcode = '22001';
  end if;
  if v_avatar_ref is not null and char_length(v_avatar_ref) > 2048 then
    raise exception 'NET_APP_PROFILE_AVATAR_REF_LIMIT' using errcode = '22001';
  end if;

  if v_name is null and v_avatar_ref is null then
    -- Full reset: no override row means "canonical sheet presentation",
    -- so remove the row entirely rather than keep an all-null one.
    delete from public.net_app_identity_presentations
    where app_id = requested_app_id
      and identity_link_id = v_identity_link_id;
  else
    insert into public.net_app_identity_presentations (
      app_id,
      identity_link_id,
      custom_display_name,
      custom_avatar_ref
    ) values (
      requested_app_id,
      v_identity_link_id,
      v_name,
      v_avatar_ref
    )
    on conflict (app_id, identity_link_id) do update
    set
      custom_display_name = excluded.custom_display_name,
      custom_avatar_ref = excluded.custom_avatar_ref;
  end if;

  return public.fetch_net_app_identity_profile_editor(requested_app_id, v_identity_link_id);
end;
$$;

comment on function public.set_net_app_identity_presentation(text, uuid, text, text) is
  'Upserts (or, when both fields are empty, deletes) the caller''s own app-local presentation override for requested_app_id. Storage cleanup of a replaced/removed avatar object is the client''s responsibility (upload -> save -> remove-old, matching the existing commit/rollback pattern used elsewhere for shared media), exactly as net_universal_profiles.avatar_url_override already leaves to the caller.';

-- ==================================================================
-- RELAY: switch member/author/recipient/search presentation call sites to
-- the new central resolver. Bodies below are byte-for-byte the current
-- production bodies from net-veil-messenger.sql with only the presentation
-- call itself changed; every other check, order-by, limit, and error stays
-- identical.
-- ==================================================================

create or replace function public.net_veil_messenger_conversation_members_json(
  requested_conversation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'identity', presentation.value,
        'role', member_row.member_role,
        'available', public.net_veil_messenger_identity_can_use_messenger(
          member_row.identity_link_id
        )
      )
      order by
        case member_row.member_role when 'owner' then 0 else 1 end,
        lower(presentation.value ->> 'display_name'),
        member_row.identity_link_id
    ),
    '[]'::jsonb
  )
  from public.net_veil_messenger_conversation_members as member_row
  cross join lateral (
    select public.fetch_net_app_identity_presentation(
      'relay',
      member_row.identity_link_id
    ) as value
  ) as presentation
  where member_row.conversation_id = requested_conversation_id;
$$;

create or replace function public.fetch_net_veil_messenger_sidebar(
  requested_expected_identity_link_id uuid,
  requested_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_limit integer := greatest(1, least(coalesce(requested_limit, 50), 50));
  v_conversations jsonb;
begin
  if auth.uid() is null then
    raise exception 'RELAY_AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_identity_link_id := public.net_veil_messenger_effective_identity(
    requested_expected_identity_link_id
  );

  if v_identity_link_id is null then
    if public.is_current_user_gm() then
      return jsonb_build_object(
        'status', 'identity-required',
        'reason', 'TAKE CONTROL or ACT AS a VEIL identity to access RELAY.',
        'identity', null,
        'conversations', '[]'::jsonb
      );
    end if;
    if requested_expected_identity_link_id is null then
      raise exception 'RELAY_ACCESS_DENIED' using errcode = '42501';
    end if;
    raise exception 'RELAY_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  with conversation_page as (
    select
      conversation.id,
      conversation.conversation_kind,
      conversation.title,
      conversation.direct_identity_a,
      conversation.direct_identity_b,
      conversation.created_at,
      conversation.updated_at,
      membership.member_role,
      membership.last_read_at,
      membership.last_read_message_id
    from public.net_veil_messenger_conversation_members as membership
    join public.net_veil_messenger_conversations as conversation
      on conversation.id = membership.conversation_id
    where membership.identity_link_id = v_identity_link_id
    order by conversation.updated_at desc, conversation.id desc
    limit v_limit
  ), hydrated as (
    select
      conversation_page.*,
      case
        when conversation_page.conversation_kind = 'direct'
          and conversation_page.direct_identity_a = v_identity_link_id
          then conversation_page.direct_identity_b
        when conversation_page.conversation_kind = 'direct'
          then conversation_page.direct_identity_a
        else null
      end as direct_recipient_id,
      latest.id as latest_message_id,
      latest.body as latest_message_body,
      latest.created_at as latest_message_at,
      latest.author_identity_link_id as latest_author_id,
      coalesce(unread.value, 0) as unread_count,
      public.net_veil_messenger_conversation_members_json(
        conversation_page.id
      ) as members,
      not exists (
        select 1
        from public.net_veil_messenger_conversation_members as current_member
        where current_member.conversation_id = conversation_page.id
          and not public.net_veil_messenger_identity_can_use_messenger(
            current_member.identity_link_id
          )
      ) as can_send
    from conversation_page
    left join lateral (
      select message.*
      from public.net_veil_messenger_messages as message
      where message.conversation_id = conversation_page.id
      order by message.created_at desc, message.id desc
      limit 1
    ) as latest on true
    left join lateral (
      select count(*)::integer as value
      from (
        select 1
        from public.net_veil_messenger_messages as unread_message
        where unread_message.conversation_id = conversation_page.id
          and (
            unread_message.created_at > conversation_page.last_read_at
            or (
              unread_message.created_at = conversation_page.last_read_at
              and (
                conversation_page.last_read_message_id is null
                or unread_message.id > conversation_page.last_read_message_id
              )
            )
          )
          and unread_message.author_identity_link_id is distinct from v_identity_link_id
        order by unread_message.created_at, unread_message.id
        limit 100
      ) as bounded_unread
    ) as unread on true
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'conversation_id', hydrated.id,
        'kind', hydrated.conversation_kind,
        'title', case
          when hydrated.conversation_kind = 'group' then hydrated.title
          else direct_presentation.value ->> 'display_name'
        end,
        'avatar_url', case
          when hydrated.conversation_kind = 'direct'
            then direct_presentation.value ->> 'avatar_url'
          else null
        end,
        'direct_recipient', case
          when hydrated.conversation_kind = 'direct' then direct_presentation.value
          else null
        end,
        'role', hydrated.member_role,
        'members', hydrated.members,
        'member_count', jsonb_array_length(hydrated.members),
        'can_send', hydrated.can_send,
        'latest_message', case
          when hydrated.latest_message_id is null then null
          else jsonb_build_object(
            'message_id', hydrated.latest_message_id,
            'body', left(hydrated.latest_message_body, 180),
            'created_at', hydrated.latest_message_at,
            'author', public.fetch_net_app_identity_presentation(
              'relay',
              hydrated.latest_author_id
            ),
            'mine', hydrated.latest_author_id = v_identity_link_id
          )
        end,
        'unread_count', least(hydrated.unread_count, 99),
        'unread_capped', hydrated.unread_count >= 100,
        'created_at', hydrated.created_at,
        'updated_at', hydrated.updated_at
      )
      order by hydrated.updated_at desc, hydrated.id desc
    ),
    '[]'::jsonb
  )
  into v_conversations
  from hydrated
  left join lateral (
    select public.fetch_net_app_identity_presentation(
      'relay',
      hydrated.direct_recipient_id
    ) as value
  ) as direct_presentation
    on hydrated.direct_recipient_id is not null;

  return jsonb_build_object(
    'status', 'ready',
    'identity', public.fetch_net_app_identity_presentation('relay', v_identity_link_id),
    'conversations', v_conversations
  );
end;
$$;

create or replace function public.search_net_veil_messenger_recipients(
  requested_expected_identity_link_id uuid,
  requested_query text,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := greatest(1, least(coalesce(requested_limit, 20), 20));
  v_results jsonb;
begin
  if auth.uid() is null then
    raise exception 'RELAY_AUTH_REQUIRED' using errcode = '42501';
  end if;
  v_identity_link_id := public.net_veil_messenger_effective_identity(
    requested_expected_identity_link_id
  );
  if v_identity_link_id is null then
    raise exception 'RELAY_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  if v_query = '' then
    return '[]'::jsonb;
  end if;

  with eligible as (
    select
      identity_link.id,
      presentation.value
    from public.net_identity_links as identity_link
    cross join lateral (
      select public.fetch_net_app_identity_presentation('relay', identity_link.id) as value
    ) as presentation
    where identity_link.id <> v_identity_link_id
      and public.net_veil_messenger_identity_can_use_messenger(identity_link.id)
      and lower(presentation.value ->> 'display_name') like '%' || v_query || '%'
    order by lower(presentation.value ->> 'display_name'), identity_link.id
    limit v_limit
  )
  select coalesce(jsonb_agg(eligible.value), '[]'::jsonb)
  into v_results
  from eligible;

  return v_results;
end;
$$;

create or replace function public.fetch_net_veil_message_page(
  requested_expected_identity_link_id uuid,
  requested_conversation_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_identity_link_id uuid;
  v_limit integer := greatest(1, least(coalesce(requested_limit, 30), 50));
  v_conversation public.net_veil_messenger_conversations%rowtype;
  v_messages jsonb;
  v_oldest_at timestamptz;
  v_oldest_id uuid;
  v_has_more boolean := false;
  v_can_send boolean;
  v_title text;
  v_avatar_url text;
begin
  if auth.uid() is null then
    raise exception 'RELAY_AUTH_REQUIRED' using errcode = '42501';
  end if;
  v_actor_identity_link_id := public.net_veil_messenger_effective_identity(
    requested_expected_identity_link_id
  );
  if v_actor_identity_link_id is null then
    raise exception 'RELAY_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'RELAY_CURSOR_INVALID' using errcode = '22023';
  end if;

  select conversation.*
  into v_conversation
  from public.net_veil_messenger_conversations as conversation
  join public.net_veil_messenger_conversation_members as membership
    on membership.conversation_id = conversation.id
    and membership.identity_link_id = v_actor_identity_link_id
  where conversation.id = requested_conversation_id;

  if not found then
    raise exception 'RELAY_CONVERSATION_NOT_FOUND' using errcode = '42501';
  end if;

  select not exists (
    select 1
    from public.net_veil_messenger_conversation_members as member_row
    where member_row.conversation_id = requested_conversation_id
      and not public.net_veil_messenger_identity_can_use_messenger(
        member_row.identity_link_id
      )
  )
  into v_can_send;

  if v_conversation.conversation_kind = 'direct' then
    select
      presentation.value ->> 'display_name',
      presentation.value ->> 'avatar_url'
    into v_title, v_avatar_url
    from (
      select case
        when v_conversation.direct_identity_a = v_actor_identity_link_id
          then v_conversation.direct_identity_b
        else v_conversation.direct_identity_a
      end as identity_link_id
    ) as recipient
    cross join lateral (
      select public.fetch_net_app_identity_presentation(
        'relay',
        recipient.identity_link_id
      ) as value
    ) as presentation;
  else
    v_title := v_conversation.title;
    v_avatar_url := null;
  end if;

  with message_page as (
    select message.*
    from public.net_veil_messenger_messages as message
    where message.conversation_id = requested_conversation_id
      and (
        requested_cursor_at is null
        or (message.created_at, message.id) < (
          requested_cursor_at,
          requested_cursor_id
        )
      )
    order by message.created_at desc, message.id desc
    limit v_limit
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'message_id', message_page.id,
        'conversation_id', message_page.conversation_id,
        'author', public.fetch_net_app_identity_presentation(
          'relay',
          message_page.author_identity_link_id
        ),
        'body', message_page.body,
        'created_at', message_page.created_at,
        'mine', message_page.author_identity_link_id = v_actor_identity_link_id
      )
      order by message_page.created_at, message_page.id
    ),
    '[]'::jsonb
  )
  into v_messages
  from message_page;

  with message_page as (
    select message.created_at, message.id
    from public.net_veil_messenger_messages as message
    where message.conversation_id = requested_conversation_id
      and (
        requested_cursor_at is null
        or (message.created_at, message.id) < (
          requested_cursor_at,
          requested_cursor_id
        )
      )
    order by message.created_at desc, message.id desc
    limit v_limit
  )
  select message_page.created_at, message_page.id
  into v_oldest_at, v_oldest_id
  from message_page
  order by message_page.created_at, message_page.id
  limit 1;

  if v_oldest_at is not null then
    select exists (
      select 1
      from public.net_veil_messenger_messages as older_message
      where older_message.conversation_id = requested_conversation_id
        and (older_message.created_at, older_message.id) < (
          v_oldest_at,
          v_oldest_id
        )
    )
    into v_has_more;
  end if;

  return jsonb_build_object(
    'conversation', jsonb_build_object(
      'conversation_id', v_conversation.id,
      'kind', v_conversation.conversation_kind,
      'title', v_title,
      'avatar_url', v_avatar_url,
      'role', (
        select membership.member_role
        from public.net_veil_messenger_conversation_members as membership
        where membership.conversation_id = v_conversation.id
          and membership.identity_link_id = v_actor_identity_link_id
      ),
      'members', public.net_veil_messenger_conversation_members_json(
        v_conversation.id
      ),
      'can_send', v_can_send,
      'updated_at', v_conversation.updated_at
    ),
    'messages', v_messages,
    'next_cursor', case
      when v_has_more then jsonb_build_object(
        'created_at', v_oldest_at,
        'message_id', v_oldest_id
      )
      else null
    end
  );
end;
$$;

create or replace function public.send_net_veil_message(
  requested_expected_identity_link_id uuid,
  requested_conversation_id uuid,
  requested_body text,
  requested_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_identity_link_id uuid;
  v_body text := btrim(coalesce(requested_body, ''));
  v_message public.net_veil_messenger_messages%rowtype;
  v_inserted boolean := false;
  v_recent_message_count integer := 0;
  v_rate_cutoff_at timestamptz;
begin
  v_actor_identity_link_id := public.net_veil_messenger_assert_context(
    requested_expected_identity_link_id
  );

  if requested_request_key is null then
    raise exception 'RELAY_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'RELAY_MESSAGE_INVALID' using errcode = '22023';
  end if;

  perform 1
  from public.net_identity_links as identity_link
  where identity_link.id = v_actor_identity_link_id
  for update;

  if not found then
    raise exception 'RELAY_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  perform 1
  from public.net_veil_messenger_conversations as conversation
  join public.net_veil_messenger_conversation_members as membership
    on membership.conversation_id = conversation.id
    and membership.identity_link_id = v_actor_identity_link_id
  where conversation.id = requested_conversation_id
  for share of conversation, membership;

  if not found then
    raise exception 'RELAY_CONVERSATION_NOT_FOUND' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.net_veil_messenger_conversation_members as member_row
    where member_row.conversation_id = requested_conversation_id
      and not public.net_veil_messenger_identity_can_use_messenger(
        member_row.identity_link_id
      )
  ) then
    raise exception 'RELAY_MEMBER_ACCESS_CHANGED' using errcode = '42501';
  end if;

  select message.*
  into v_message
  from public.net_veil_messenger_messages as message
  where message.author_identity_link_id = v_actor_identity_link_id
    and message.request_key = requested_request_key;

  if v_message.id is not null then
    if v_message.conversation_id is distinct from requested_conversation_id
      or v_message.body is distinct from v_body
    then
      raise exception 'RELAY_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
  else
    v_rate_cutoff_at := clock_timestamp() - interval '10 seconds';

    select count(*)::integer
    into v_recent_message_count
    from (
      select recent_message.id
      from public.net_veil_messenger_messages as recent_message
      where recent_message.author_identity_link_id = v_actor_identity_link_id
        and recent_message.created_at >= v_rate_cutoff_at
      order by recent_message.created_at desc, recent_message.id desc
      limit 20
    ) as bounded_recent_messages;

    if v_recent_message_count >= 20 then
      raise exception 'RELAY_RATE_LIMITED' using errcode = 'P0001';
    end if;

    insert into public.net_veil_messenger_messages (
      conversation_id,
      author_identity_link_id,
      request_key,
      body
    ) values (
      requested_conversation_id,
      v_actor_identity_link_id,
      requested_request_key,
      v_body
    )
    returning * into v_message;

    v_inserted := true;
  end if;

  if v_inserted then
    update public.net_veil_messenger_conversations
    set updated_at = timezone('utc', clock_timestamp())
    where id = requested_conversation_id;

    perform public.net_veil_messenger_bump_revisions(array(
      select member_row.identity_link_id
      from public.net_veil_messenger_conversation_members as member_row
      where member_row.conversation_id = requested_conversation_id
    ));
  end if;

  return jsonb_build_object(
    'message_id', v_message.id,
    'conversation_id', v_message.conversation_id,
    'author', public.fetch_net_app_identity_presentation(
      'relay',
      v_message.author_identity_link_id
    ),
    'body', v_message.body,
    'created_at', v_message.created_at,
    'mine', true,
    'created', v_inserted
  );
end;
$$;

-- ==================================================================
-- ALTARA MESSENGER: same switch, same guarantee -- membership, RLS,
-- rate-limiting, idempotency, and every other rule below is reproduced
-- verbatim from the verified current production bodies; only the
-- presentation call itself changes.
-- ==================================================================

create or replace function public.net_altara_conversation_members_json(
  requested_conversation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'identity', presentation.value,
        'role', member_row.member_role,
        'available', public.net_altara_identity_can_use_messenger(
          member_row.identity_link_id
        )
      )
      order by
        case member_row.member_role when 'owner' then 0 else 1 end,
        lower(presentation.value ->> 'display_name'),
        member_row.identity_link_id
    ),
    '[]'::jsonb
  )
  from public.net_altara_conversation_members as member_row
  cross join lateral (
    select public.fetch_net_app_identity_presentation(
      'altara-messenger',
      member_row.identity_link_id
    ) as value
  ) as presentation
  where member_row.conversation_id = requested_conversation_id;
$$;

create or replace function public.fetch_net_altara_messenger_sidebar(
  requested_expected_identity_link_id uuid,
  requested_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_limit integer := greatest(1, least(coalesce(requested_limit, 50), 50));
  v_conversations jsonb;
begin
  if auth.uid() is null then
    raise exception 'ALTARA_MESSENGER_AUTH_REQUIRED' using errcode = '42501';
  end if;

  if requested_expected_identity_link_id is not null
    and (
      requested_expected_identity_link_id = public.current_net_runtime_source_identity_link_id()
      or requested_expected_identity_link_id = public.current_net_effective_runtime_identity_link_id()
    )
    and public.net_altara_identity_can_use_messenger(requested_expected_identity_link_id)
  then
    v_identity_link_id := requested_expected_identity_link_id;
  end if;

  if v_identity_link_id is null then
    if public.is_current_user_gm() then
      return jsonb_build_object(
        'status', 'identity-required',
        'reason', 'TAKE CONTROL of an ALTARA identity to access personal communications.',
        'identity', null,
        'conversations', '[]'::jsonb
      );
    end if;
    if requested_expected_identity_link_id is null then
      raise exception 'ALTARA_MESSENGER_ACCESS_DENIED' using errcode = '42501';
    end if;
    raise exception 'ALTARA_MESSENGER_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  with conversation_page as (
    select
      conversation.id,
      conversation.conversation_kind,
      conversation.title,
      conversation.direct_identity_a,
      conversation.direct_identity_b,
      conversation.created_at,
      conversation.updated_at,
      membership.member_role,
      membership.last_read_at,
      membership.last_read_message_id
    from public.net_altara_conversation_members as membership
    join public.net_altara_conversations as conversation
      on conversation.id = membership.conversation_id
    where membership.identity_link_id = v_identity_link_id
    order by conversation.updated_at desc, conversation.id desc
    limit v_limit
  ), hydrated as (
    select
      conversation_page.*,
      case
        when conversation_page.conversation_kind = 'direct'
          and conversation_page.direct_identity_a = v_identity_link_id
          then conversation_page.direct_identity_b
        when conversation_page.conversation_kind = 'direct'
          then conversation_page.direct_identity_a
        else null
      end as direct_recipient_id,
      latest.id as latest_message_id,
      latest.body as latest_message_body,
      latest.created_at as latest_message_at,
      latest.author_identity_link_id as latest_author_id,
      coalesce(unread.value, 0) as unread_count,
      public.net_altara_conversation_members_json(
        conversation_page.id
      ) as members,
      not exists (
        select 1
        from public.net_altara_conversation_members as current_member
        where current_member.conversation_id = conversation_page.id
          and not public.net_altara_identity_can_use_messenger(
            current_member.identity_link_id
          )
      ) as can_send
    from conversation_page
    left join lateral (
      select message.*
      from public.net_altara_messages as message
      where message.conversation_id = conversation_page.id
      order by message.created_at desc, message.id desc
      limit 1
    ) as latest on true
    left join lateral (
      select count(*)::integer as value
      from (
        select 1
        from public.net_altara_messages as unread_message
        where unread_message.conversation_id = conversation_page.id
          and (
            unread_message.created_at > conversation_page.last_read_at
            or (
              unread_message.created_at = conversation_page.last_read_at
              and (
                conversation_page.last_read_message_id is null
                or unread_message.id > conversation_page.last_read_message_id
              )
            )
          )
          and unread_message.author_identity_link_id is distinct from v_identity_link_id
        order by unread_message.created_at, unread_message.id
        limit 100
      ) as bounded_unread
    ) as unread on true
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'conversation_id', hydrated.id,
        'kind', hydrated.conversation_kind,
        'title', case
          when hydrated.conversation_kind = 'group' then hydrated.title
          else direct_presentation.value ->> 'display_name'
        end,
        'avatar_url', case
          when hydrated.conversation_kind = 'direct'
            then direct_presentation.value ->> 'avatar_url'
          else null
        end,
        'direct_recipient', case
          when hydrated.conversation_kind = 'direct' then direct_presentation.value
          else null
        end,
        'role', hydrated.member_role,
        'members', hydrated.members,
        'member_count', jsonb_array_length(hydrated.members),
        'can_send', hydrated.can_send,
        'latest_message', case
          when hydrated.latest_message_id is null then null
          else jsonb_build_object(
            'message_id', hydrated.latest_message_id,
            'body', left(hydrated.latest_message_body, 180),
            'created_at', hydrated.latest_message_at,
            'author', public.fetch_net_app_identity_presentation(
              'altara-messenger',
              hydrated.latest_author_id
            ),
            'mine', hydrated.latest_author_id = v_identity_link_id
          )
        end,
        'unread_count', least(hydrated.unread_count, 99),
        'unread_capped', hydrated.unread_count >= 100,
        'created_at', hydrated.created_at,
        'updated_at', hydrated.updated_at
      )
      order by hydrated.updated_at desc, hydrated.id desc
    ),
    '[]'::jsonb
  )
  into v_conversations
  from hydrated
  left join lateral (
    select public.fetch_net_app_identity_presentation(
      'altara-messenger',
      hydrated.direct_recipient_id
    ) as value
  ) as direct_presentation
    on hydrated.direct_recipient_id is not null;

  return jsonb_build_object(
    'status', 'ready',
    'identity', public.fetch_net_app_identity_presentation('altara-messenger', v_identity_link_id),
    'conversations', v_conversations
  );
end;
$$;

create or replace function public.search_net_altara_messenger_recipients(
  requested_expected_identity_link_id uuid,
  requested_query text,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := greatest(1, least(coalesce(requested_limit, 20), 20));
  v_results jsonb;
begin
  v_identity_link_id := public.net_altara_assert_messenger_context(
    requested_expected_identity_link_id
  );

  if v_query = '' then
    return '[]'::jsonb;
  end if;

  with eligible as (
    select
      identity_link.id,
      presentation.value
    from public.net_identity_links as identity_link
    cross join lateral (
      select public.fetch_net_app_identity_presentation('altara-messenger', identity_link.id) as value
    ) as presentation
    where identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
      and identity_link.id <> v_identity_link_id
      and public.net_altara_identity_can_use_messenger(identity_link.id)
      and lower(presentation.value ->> 'display_name') like '%' || v_query || '%'
    order by lower(presentation.value ->> 'display_name'), identity_link.id
    limit v_limit
  )
  select coalesce(jsonb_agg(eligible.value), '[]'::jsonb)
  into v_results
  from eligible;

  return v_results;
end;
$$;

create or replace function public.fetch_net_altara_message_page(
  requested_expected_identity_link_id uuid,
  requested_conversation_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_identity_link_id uuid;
  v_limit integer := greatest(1, least(coalesce(requested_limit, 30), 50));
  v_conversation public.net_altara_conversations%rowtype;
  v_messages jsonb;
  v_oldest_at timestamptz;
  v_oldest_id uuid;
  v_has_more boolean := false;
  v_can_send boolean;
  v_title text;
  v_avatar_url text;
begin
  v_actor_identity_link_id := public.net_altara_assert_messenger_context(
    requested_expected_identity_link_id
  );

  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'ALTARA_MESSENGER_CURSOR_INVALID' using errcode = '22023';
  end if;

  select conversation.*
  into v_conversation
  from public.net_altara_conversations as conversation
  join public.net_altara_conversation_members as membership
    on membership.conversation_id = conversation.id
    and membership.identity_link_id = v_actor_identity_link_id
  where conversation.id = requested_conversation_id;

  if not found then
    raise exception 'ALTARA_MESSENGER_CONVERSATION_NOT_FOUND' using errcode = '42501';
  end if;

  select not exists (
    select 1
    from public.net_altara_conversation_members as member_row
    where member_row.conversation_id = requested_conversation_id
      and not public.net_altara_identity_can_use_messenger(
        member_row.identity_link_id
      )
  )
  into v_can_send;

  if v_conversation.conversation_kind = 'direct' then
    select
      presentation.value ->> 'display_name',
      presentation.value ->> 'avatar_url'
    into v_title, v_avatar_url
    from (
      select case
        when v_conversation.direct_identity_a = v_actor_identity_link_id
          then v_conversation.direct_identity_b
        else v_conversation.direct_identity_a
      end as identity_link_id
    ) as recipient
    cross join lateral (
      select public.fetch_net_app_identity_presentation(
        'altara-messenger',
        recipient.identity_link_id
      ) as value
    ) as presentation;
  else
    v_title := v_conversation.title;
    v_avatar_url := null;
  end if;

  with message_page as (
    select message.*
    from public.net_altara_messages as message
    where message.conversation_id = requested_conversation_id
      and (
        requested_cursor_at is null
        or (message.created_at, message.id) < (
          requested_cursor_at,
          requested_cursor_id
        )
      )
    order by message.created_at desc, message.id desc
    limit v_limit
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'message_id', message_page.id,
        'conversation_id', message_page.conversation_id,
        'author', public.fetch_net_app_identity_presentation(
          'altara-messenger',
          message_page.author_identity_link_id
        ),
        'body', message_page.body,
        'created_at', message_page.created_at,
        'mine', message_page.author_identity_link_id = v_actor_identity_link_id
      )
      order by message_page.created_at, message_page.id
    ),
    '[]'::jsonb
  )
  into v_messages
  from message_page;

  with message_page as (
    select message.created_at, message.id
    from public.net_altara_messages as message
    where message.conversation_id = requested_conversation_id
      and (
        requested_cursor_at is null
        or (message.created_at, message.id) < (
          requested_cursor_at,
          requested_cursor_id
        )
      )
    order by message.created_at desc, message.id desc
    limit v_limit
  )
  select message_page.created_at, message_page.id
  into v_oldest_at, v_oldest_id
  from message_page
  order by message_page.created_at, message_page.id
  limit 1;

  if v_oldest_at is not null then
    select exists (
      select 1
      from public.net_altara_messages as older_message
      where older_message.conversation_id = requested_conversation_id
        and (older_message.created_at, older_message.id) < (
          v_oldest_at,
          v_oldest_id
        )
    )
    into v_has_more;
  end if;

  return jsonb_build_object(
    'conversation', jsonb_build_object(
      'conversation_id', v_conversation.id,
      'kind', v_conversation.conversation_kind,
      'title', v_title,
      'avatar_url', v_avatar_url,
      'role', (
        select membership.member_role
        from public.net_altara_conversation_members as membership
        where membership.conversation_id = v_conversation.id
          and membership.identity_link_id = v_actor_identity_link_id
      ),
      'members', public.net_altara_conversation_members_json(
        v_conversation.id
      ),
      'can_send', v_can_send,
      'updated_at', v_conversation.updated_at
    ),
    'messages', v_messages,
    'next_cursor', case
      when v_has_more then jsonb_build_object(
        'created_at', v_oldest_at,
        'message_id', v_oldest_id
      )
      else null
    end
  );
end;
$$;

create or replace function public.send_net_altara_message(
  requested_expected_identity_link_id uuid,
  requested_conversation_id uuid,
  requested_body text,
  requested_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_identity_link_id uuid;
  v_body text := btrim(coalesce(requested_body, ''));
  v_message public.net_altara_messages%rowtype;
  v_inserted boolean := false;
  v_recent_message_count integer := 0;
  v_rate_cutoff_at timestamptz;
begin
  v_actor_identity_link_id := public.net_altara_assert_messenger_context(
    requested_expected_identity_link_id
  );

  if requested_request_key is null then
    raise exception 'ALTARA_MESSENGER_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'ALTARA_MESSENGER_MESSAGE_INVALID' using errcode = '22023';
  end if;

  perform 1
  from public.net_identity_links as identity_link
  where identity_link.id = v_actor_identity_link_id
  for update;

  if not found then
    raise exception 'ALTARA_MESSENGER_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  perform 1
  from public.net_altara_conversations as conversation
  join public.net_altara_conversation_members as membership
    on membership.conversation_id = conversation.id
    and membership.identity_link_id = v_actor_identity_link_id
  where conversation.id = requested_conversation_id
  for share of conversation, membership;

  if not found then
    raise exception 'ALTARA_MESSENGER_CONVERSATION_NOT_FOUND' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.net_altara_conversation_members as member_row
    where member_row.conversation_id = requested_conversation_id
      and not public.net_altara_identity_can_use_messenger(
        member_row.identity_link_id
      )
  ) then
    raise exception 'ALTARA_MESSENGER_MEMBER_ACCESS_CHANGED' using errcode = '42501';
  end if;

  select message.*
  into v_message
  from public.net_altara_messages as message
  where message.author_identity_link_id = v_actor_identity_link_id
    and message.request_key = requested_request_key;

  if v_message.id is not null then
    if v_message.conversation_id is distinct from requested_conversation_id
      or v_message.body is distinct from v_body
    then
      raise exception 'ALTARA_MESSENGER_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
  else
    v_rate_cutoff_at := clock_timestamp() - interval '10 seconds';

    select count(*)::integer
    into v_recent_message_count
    from (
      select recent_message.id
      from public.net_altara_messages as recent_message
      where recent_message.author_identity_link_id = v_actor_identity_link_id
        and recent_message.created_at >= v_rate_cutoff_at
      order by recent_message.created_at desc, recent_message.id desc
      limit 20
    ) as bounded_recent_messages;

    if v_recent_message_count >= 20 then
      raise exception 'ALTARA_MESSENGER_RATE_LIMITED' using errcode = 'P0001';
    end if;

    insert into public.net_altara_messages (
      conversation_id,
      author_identity_link_id,
      request_key,
      body
    ) values (
      requested_conversation_id,
      v_actor_identity_link_id,
      requested_request_key,
      v_body
    )
    returning * into v_message;

    v_inserted := true;
  end if;

  if v_inserted then
    update public.net_altara_conversations
    set updated_at = timezone('utc', clock_timestamp())
    where id = requested_conversation_id;

    perform public.net_altara_bump_messenger_revisions(array(
      select member_row.identity_link_id
      from public.net_altara_conversation_members as member_row
      where member_row.conversation_id = requested_conversation_id
    ));
  end if;

  return jsonb_build_object(
    'message_id', v_message.id,
    'conversation_id', v_message.conversation_id,
    'author', public.fetch_net_app_identity_presentation(
      'altara-messenger',
      v_message.author_identity_link_id
    ),
    'body', v_message.body,
    'created_at', v_message.created_at,
    'mine', true,
    'created', v_inserted
  );
end;
$$;

-- ==================================================================
-- RLS + GRANTS
-- ==================================================================

alter table public.net_app_identity_presentations enable row level security;

-- No direct-table policy: every access goes through the SECURITY DEFINER
-- RPCs above, matching the established pattern for RELAY/ALTARA Messenger
-- conversation data. There is nothing sensitive stored here (only visual
-- overrides), but centralising through the RPCs keeps the write path
-- (ownership/authority validation) impossible to bypass.
revoke all on public.net_app_identity_presentations from anon, authenticated;

revoke all on function public.net_identity_canonical_presentation(uuid)
  from public, anon, authenticated;
revoke all on function public.net_app_identity_presentation_effective_identity(text, uuid)
  from public, anon, authenticated;
revoke all on function public.assert_net_app_identity_presentation_context(text, uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_app_identity_presentation(text, uuid)
  from public, anon, authenticated;

revoke all on function public.fetch_net_app_identity_profile_editor(text, uuid)
  from public, anon;
revoke all on function public.set_net_app_identity_presentation(text, uuid, text, text)
  from public, anon;
grant execute on function public.fetch_net_app_identity_profile_editor(text, uuid)
  to authenticated;
grant execute on function public.set_net_app_identity_presentation(text, uuid, text, text)
  to authenticated;

commit;
