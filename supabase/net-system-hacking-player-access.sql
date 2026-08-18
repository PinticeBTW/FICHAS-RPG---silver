-- Player-facing hacking access: the two RPCs the deployed foundation
-- (net-system-hacking-foundation.sql) does not yet provide.
--
-- fetch_net_system_hacking_grants() already exists but is GM-System-only
-- (assert_net_system_admin_read()) -- a normal player has no way to list
-- their OWN authorised targets. fetch_net_system_hacking_targets() below is
-- the player-safe sibling: actor is exclusively
-- current_net_effective_runtime_identity_link_id() (never client-supplied),
-- it returns only enabled grants, and only safe presentation data --
-- target identity id, display name/avatar (via the existing, already
-- non-GM-gated public.net_altara_identity_presentation(), reused rather
-- than reimplemented), OS assignment, and method. It never returns
-- granted_by_profile_id or timestamps.
--
-- fetch_net_system_hacking_target_system() is the read-only "system shell"
-- for the ENTER SYSTEM view: wallpaper + installed-app-id list, the exact
-- same narrow, already-audited projection
-- public.fetch_net_gm_inspected_identity_system() already performs for a
-- GM's own inspect/compromised-session context -- just re-gated to require
-- an ACTIVE row in net_system_hacking_sessions (this actor's own hacking
-- session) instead of net_gm_persona_sessions. It takes no parameters:
-- both actor and target are derived server-side (actor from the effective
-- runtime identity, target from that actor's own active session row), so
-- neither can be supplied or spoofed by the client.
--
-- What this migration deliberately does NOT add: per-app compromised data
-- access (a real PULSE feed, real Messenger conversations, real ALTARA
-- MUSIC library, real bank balances, etc. as the target). The only existing
-- compromised-session authority precedent in this codebase is
-- resolve_current_compromised_pulse_context() / create_net_pulse_post_as_
-- compromised_persona() -- GM-only, gated on net_gm_persona_sessions, and
-- narrowly scoped to PULSE post/reply/profile mutations only. No app RPC
-- anywhere (Messenger, WAVE, ALTARA MUSIC/BANK, NOVA BANK, ECHO, VOX AUDIO/
-- BANK, SHNEIDER BANK, VLT, NVN, Store) currently checks
-- net_system_hacking_sessions for authority, and extending each of them to
-- do so is a much larger, per-app authority review this migration does not
-- attempt. "ENTER SYSTEM" therefore mounts the target's real wallpaper and
-- real installed-app list (safe, already-precedented, genuinely the
-- target's system) but individual apps are not yet interactive while
-- compromised -- see the accompanying report for the exact missing
-- authority boundary.

begin;

do $$
begin
  if to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_system_hacking_grants') is null
    or to_regclass('public.net_system_hacking_sessions') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_identity_system_profiles') is null
    or to_regclass('public.net_identity_app_installs') is null
    or to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.net_altara_identity_presentation(uuid)') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
  then
    raise exception 'NET_SYSTEM_HACKING_PLAYER_ACCESS_DEPENDENCY_REQUIRED. This migration requires net-system-hacking-foundation.sql, net-effective-runtime-identity.sql, and net-altara-messenger.sql (or later) to be deployed first.'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function public.fetch_net_system_hacking_targets()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.current_net_effective_runtime_identity_link_id();
begin
  if v_actor_id is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'target_identity_link_id', grant_row.target_identity_link_id,
      'display_name', presentation ->> 'display_name',
      'avatar_url', presentation ->> 'avatar_url',
      'os_id', assignment.primary_os_id,
      'method', grant_row.method
    ) order by grant_row.updated_at desc)
    from public.net_system_hacking_grants as grant_row
    cross join lateral public.net_altara_identity_presentation(
      grant_row.target_identity_link_id
    ) as presentation
    left join public.net_identity_os_assignments as assignment
      on assignment.identity_link_id = grant_row.target_identity_link_id
    where grant_row.actor_identity_link_id = v_actor_id
      and grant_row.enabled = true
    limit 100
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fetch_net_system_hacking_targets()
  from public, anon, authenticated;
grant execute on function public.fetch_net_system_hacking_targets() to authenticated;

create or replace function public.fetch_net_system_hacking_target_system()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.current_net_effective_runtime_identity_link_id();
  v_session public.net_system_hacking_sessions%rowtype;
  v_profile public.net_identity_system_profiles%rowtype;
  v_installs jsonb;
begin
  if v_actor_id is null then
    raise exception 'NET_SYSTEM_HACKING_SESSION_REQUIRED' using errcode = '42501';
  end if;

  select session_row.*
  into v_session
  from public.net_system_hacking_sessions as session_row
  where session_row.actor_identity_link_id = v_actor_id;

  if not found then
    raise exception 'NET_SYSTEM_HACKING_SESSION_REQUIRED' using errcode = '42501';
  end if;

  select system_profile.* into v_profile
  from public.net_identity_system_profiles as system_profile
  where system_profile.identity_link_id = v_session.target_identity_link_id;

  select coalesce(jsonb_agg(
    jsonb_build_object('app_id', install.app_id)
    order by install.installed_at, install.app_id
  ), '[]'::jsonb)
  into v_installs
  from public.net_identity_app_installs as install
  where install.identity_link_id = v_session.target_identity_link_id
    and public.net_identity_link_can_access_service(v_session.target_identity_link_id, install.app_id);

  return jsonb_build_object(
    'identity_link_id', v_session.target_identity_link_id,
    'display_name', public.net_altara_identity_presentation(v_session.target_identity_link_id) ->> 'display_name',
    'os_id', (
      select assignment.primary_os_id
      from public.net_identity_os_assignments as assignment
      where assignment.identity_link_id = v_session.target_identity_link_id
    ),
    'profile', case when v_profile.identity_link_id is null
      then null
      else to_jsonb(v_profile)
    end,
    'installs', v_installs
  );
end;
$$;

revoke all on function public.fetch_net_system_hacking_target_system()
  from public, anon, authenticated;
grant execute on function public.fetch_net_system_hacking_target_system() to authenticated;

commit;
