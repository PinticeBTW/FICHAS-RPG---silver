-- Fixes "Wallpaper upload failed: new row violates row-level security
-- policy" for a normal player uploading a NEW ALTARA/VEIL wallpaper. The
-- file is selected and previewed locally fine; the failure is entirely
-- server-side.
--
-- CONFIRMED FAILING OPERATION: the storage.objects INSERT itself. Postgres's
-- exact wording ("new row violates row-level security policy") is only ever
-- produced by a failed INSERT/UPDATE `with check` clause -- never by a
-- later RPC call, and set_net_identity_wallpaper (the RPC that saves
-- wallpaper_path onto the profile row after upload) is never reached here.
-- Traced call chain: src/lib/netIdentitySystemService.ts's
-- uploadNetIdentityWallpaper() builds
--   path = `${identityLinkId}/${contentHash.slice(0, 32)}/display.${ext}`
-- and calls storage.from('net-wallpapers').upload(path, blob, { upsert:
-- false }). That INSERT is gated solely by the net_wallpapers_insert_
-- controlled policy, which calls
-- current_user_can_mutate_net_runtime_wallpaper_object(name) -- confirmed
-- the ONLY applicable policy on this bucket/command (no other storage.objects
-- policy matches bucket_id = 'net-wallpapers', no restrictive policies exist
-- anywhere in this schema).
--
-- ROOT CAUSE: that predicate (net-effective-runtime-identity.sql) accepts
-- an object's path-encoded identity_link_id ONLY when it matches EXACTLY:
--   v_identity_link_id = current_net_effective_runtime_identity_link_id()
-- current_net_effective_runtime_identity_link_id() is the single, no-
-- disambiguation-input resolver used for hacking/TAKE CONTROL projection --
-- correct for that purpose, but left as the ONLY accepted authority path
-- here. A normal player's own directly-controlled identity was never
-- accepted through any independent route: the exact same path/service
-- checks are proven satisfied for Adrian by the already-working read side
-- (fetch_net_runtime_identity_system succeeds and installed apps load,
-- which internally re-validates this identical
-- requested_expected_identity_link_id-equals-resolved-identity condition,
-- plus 'altara-settings' service access, via assert_net_effective_runtime_
-- identity -- the same predicates the wallpaper function re-derives), yet
-- the storage insert still fails. Rather than weaken RLS or guess further
-- at an unreproducible live value, this migration removes the single point
-- of failure: the wallpaper predicate now accepts a second,
-- independently-sufficient authority route that does not depend on that one
-- resolver at all.
--
-- FIX (revised): accept the object's encoded identity when EITHER of two
-- independently-sufficient, already-existing EXACT resolvers matches:
--   (a) it equals current_net_effective_runtime_identity_link_id() -- the
--       hacking/TAKE CONTROL projection path, unchanged; or
--   (b) it equals current_net_runtime_source_identity_link_id() -- the
--       exact, hacking-UNAWARE canonical SOURCE resolver (net-system-
--       hacking-runtime-projection.sql), i.e. the caller's own currently
--       active identity or their own GM take-control target -- never any
--       OTHER identity they merely have a standing ownership row for.
--
-- An earlier draft of this migration used current_user_controls_playable_
-- net_identity_link(v_identity_link_id) for branch (b) instead. That was
-- REJECTED on review: it checks raw identity_link.owner_profile_id
-- ownership only, with no reference to net_active_identities at all, so it
-- would accept ANY playable identity_link the authenticated profile has
-- ever owned -- including a second/alt character they are NOT currently
-- playing as, not only their canonical active SOURCE. current_net_runtime_
-- source_identity_link_id() is the precise fix: it is the exact function
-- current_net_effective_runtime_identity_link_id() itself resolves SOURCE
-- through before any hacking projection, already requires BOTH ownership
-- AND net_active_identities.profile_id = auth.uid() (i.e. "is this the
-- identity the player currently has selected"), and its GM branch requires
-- an active take-control session -- returning null for a GM with none.
-- Comparing v_identity_link_id against it by equality is therefore strictly
-- narrower than the rejected ownership branch, while still exactly as
-- permissive as the effective-identity branch already is for TAKE CONTROL
-- and hacking. No other ownership fallback is introduced.
--
-- Neither branch widens authority beyond what already exists elsewhere:
-- (a) is the untouched hacking/take-control projection path; (b) is the
-- same exact-SOURCE comparison the read/mutate boundary for every other
-- normal-player-owned OS resource in this schema is built on. A GM with no
-- take-control session fails both branches by construction: the GM branch
-- of current_net_runtime_source_identity_link_id() (and, transitively,
-- current_net_effective_runtime_identity_link_id(), which resolves SOURCE
-- through the same function) returns null without an active take-control
-- session, and SQL equality against null is never true -- so GM SYSTEM
-- gains no new wallpaper authority, independent of any ownership row that
-- might otherwise exist. The bucket stays private; no policy is broadened
-- to `using (true)` or to a blanket authenticated grant; the policies
-- themselves are untouched -- they reference these two functions by name,
-- so replacing the function bodies (same OIDs) is sufficient without
-- touching storage.objects policy DDL.
--
-- Also verified, no change needed: set_net_identity_wallpaper's own
-- "object exists" check queries the NEW path being saved, never the
-- previous one, so a missing/stale previous wallpaper object already
-- cannot block uploading a replacement.

begin;

do $preflight$
begin
  if to_regprocedure('public.net_wallpaper_identity_link_id(text)') is null
    or to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.current_net_runtime_source_identity_link_id()') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.current_user_can_read_net_runtime_wallpaper_object(text)') is null
    or to_regprocedure('public.current_user_can_mutate_net_runtime_wallpaper_object(text)') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_identity_system_profiles') is null
    or to_regclass('storage.objects') is null
  then
    raise exception 'NET_WALLPAPER_UPLOAD_RLS_FIX_DEPENDENCY_REQUIRED. This migration requires net-effective-runtime-identity.sql, net-multi-os-npc-assignments.sql, and net-system-hacking-runtime-projection.sql to be deployed first.'
      using errcode = '55000';
  end if;
end;
$preflight$;

create or replace function public.current_user_can_read_net_runtime_wallpaper_object(
  requested_object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_identity_link_id uuid;
begin
  if v_actor is null
    or requested_object_name is null
    or split_part(requested_object_name, '/', 2) = ''
    or requested_object_name like '%..%'
  then
    return false;
  end if;

  v_identity_link_id := public.net_wallpaper_identity_link_id(
    requested_object_name
  );
  if v_identity_link_id is null then
    return false;
  end if;

  if (
    v_identity_link_id = public.current_net_effective_runtime_identity_link_id()
    or v_identity_link_id = public.current_net_runtime_source_identity_link_id()
  )
    and (
      public.net_identity_link_can_access_service(
        v_identity_link_id, 'veil-settings'
      )
      or public.net_identity_link_can_access_service(
        v_identity_link_id, 'altara-settings'
      )
    )
  then
    return true;
  end if;

  if public.is_current_user_gm() and exists (
    select 1
    from public.net_gm_persona_sessions as gm_session
    join public.net_identity_links as identity_link
      on identity_link.subject_kind = gm_session.subject_kind
      and identity_link.subject_id = gm_session.subject_id
      and identity_link.id = v_identity_link_id
    join public.net_identity_system_profiles as system_profile
      on system_profile.identity_link_id = identity_link.id
      and system_profile.wallpaper_path = requested_object_name
    where gm_session.gm_profile_id = v_actor
      and gm_session.mode in ('inspect', 'compromised-session')
      and (
        public.net_identity_link_can_access_service(
          identity_link.id, 'veil-settings'
        )
        or public.net_identity_link_can_access_service(
          identity_link.id, 'altara-settings'
        )
      )
  ) then
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.current_user_can_mutate_net_runtime_wallpaper_object(
  requested_object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  if auth.uid() is null
    or requested_object_name is null
    or split_part(requested_object_name, '/', 2) = ''
    or requested_object_name like '%..%'
  then
    return false;
  end if;

  v_identity_link_id := public.net_wallpaper_identity_link_id(
    requested_object_name
  );
  if v_identity_link_id is null
    or not (
      v_identity_link_id = public.current_net_effective_runtime_identity_link_id()
      or v_identity_link_id = public.current_net_runtime_source_identity_link_id()
    )
  then
    return false;
  end if;

  return public.net_identity_link_can_access_service(
      v_identity_link_id, 'veil-settings'
    )
    or public.net_identity_link_can_access_service(
      v_identity_link_id, 'altara-settings'
    );
end;
$$;

revoke all on function public.current_user_can_read_net_runtime_wallpaper_object(text)
  from public, anon, authenticated;
revoke all on function public.current_user_can_mutate_net_runtime_wallpaper_object(text)
  from public, anon, authenticated;
grant execute on function public.current_user_can_read_net_runtime_wallpaper_object(text)
  to authenticated;
grant execute on function public.current_user_can_mutate_net_runtime_wallpaper_object(text)
  to authenticated;

commit;
