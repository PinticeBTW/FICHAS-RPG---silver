-- Regression fix: altara-messenger-and-profile-directory-security-hardening.sql
-- redirected webSheetService.ts's listSheetProfiles() to the GM-only
-- fetch_net_gm_sheet_profile_directory() RPC. That RPC is correct for its two
-- genuinely GM-only callers (SheetWorkspacePage's Silver workspace directory,
-- Master Notes' shareable-player picker), but listSheetProfiles() is also the
-- data source for a normal player's own Sheet Workspace directory refresh and
-- for SELECT ACTIVE CHARACTER (useNetPlayableIdentityCandidates), both of
-- which are reachable for profile.role = 'player' and now hard-fail with
-- GM_PROFILE_DIRECTORY_REQUIRED.
--
-- Before this migration, a normal (non-GM) caller reading public.profiles
-- directly was already correctly narrowed by RLS
-- (profiles_select_shared_campaign: id = auth.uid() or has_sheet_share_access)
-- to their own row plus any explicitly GM-shared rows -- never "all global
-- profiles", and never a thrown error. This migration restores exactly that
-- narrowed, non-GM result set as its own bounded, server-asserted RPC, reusing
-- the existing has_sheet_share_access() authority helper rather than
-- reimplementing it. It does not touch public.profiles RLS/grants, and it
-- does not touch either GM-only directory RPC.
--
-- Forward-only: run after
-- altara-messenger-and-profile-directory-security-hardening.sql.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
    or to_regtype('public.sheet_share_target_kind') is null
    or to_regprocedure('public.fetch_net_gm_sheet_profile_directory()') is null
  then
    raise exception 'NET_PLAYER_SHEET_PROFILE_DIRECTORY_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

-- Deliberately does not check is_current_user_gm(): GM already has its own
-- dedicated, broader directory (fetch_net_gm_sheet_profile_directory). This
-- RPC exists specifically to express the narrower, non-GM contract, so a
-- caller routed here by mistake gets exactly their own row plus explicit
-- shares -- never the full table -- regardless of role.
create or replace function public.fetch_net_player_sheet_profile_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'NET_PLAYER_SHEET_DIRECTORY_AUTH_REQUIRED' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', bounded_profile.id,
      'email', bounded_profile.email,
      'display_name', bounded_profile.display_name,
      'handle', bounded_profile.handle,
      'role', bounded_profile.role,
      'avatar_url', bounded_profile.avatar_url
    ) order by bounded_profile.display_name, bounded_profile.id)
    from (
      select profile.id, profile.email, profile.display_name, profile.handle,
        profile.role, profile.avatar_url
      from public.profiles as profile
      where profile.id = auth.uid()
        or public.has_sheet_share_access('profile', profile.id)
      order by profile.display_name, profile.id
      limit 50
    ) as bounded_profile
  ), '[]'::jsonb);
end;
$$;

comment on function public.fetch_net_player_sheet_profile_directory() is
  'Non-GM bounded directory (max 50) of the caller''s own account row plus any profile explicitly authorised via has_sheet_share_access(''profile'', id). Mirrors the non-GM clause of profiles_select_shared_campaign; never returns the full profiles table regardless of caller role.';

revoke all on function public.fetch_net_player_sheet_profile_directory()
  from public, anon, authenticated;
grant execute on function public.fetch_net_player_sheet_profile_directory()
  to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc as procedure_record
    where procedure_record.oid =
      'public.fetch_net_player_sheet_profile_directory()'::regprocedure::oid
      and (
        not procedure_record.prosecdef
        or not (
          'search_path=public, pg_temp'
          = any(coalesce(procedure_record.proconfig, array[]::text[]))
        )
      )
  ) then
    raise exception 'NET_PLAYER_SHEET_PROFILE_DIRECTORY_DEFINER_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

commit;
