-- Forward-only ALTARA MUSIC V1 audit-mode compatibility fix.
-- Run after supabase/net-altara-music.sql.

begin;

do $preflight$
declare
  v_action_mode_expression text;
  v_allowed_modes text[];
  v_audit_definition text;
  v_constraint_validated boolean;
begin
  if to_regclass('public.net_action_audit') is null
    or to_regprocedure('public.assert_net_system_admin()') is null
    or to_regprocedure('public.net_altara_music_assert_studio()') is null
    or to_regprocedure('public.net_altara_music_audit(text,text,uuid)') is null
  then
    raise exception 'ALTARA_MUSIC_AUDIT_MODE_FIX_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;

  select
    pg_get_expr(constraint_record.conbin, constraint_record.conrelid),
    constraint_record.convalidated
  into v_action_mode_expression, v_constraint_validated
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = 'public.net_action_audit'::regclass
    and constraint_record.conname = 'net_action_audit_action_mode_check'
    and constraint_record.contype = 'c';

  if not found or not v_constraint_validated then
    raise exception 'ALTARA_MUSIC_AUDIT_MODE_CONTRACT_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select array_agg(captured_mode[1] order by captured_mode[1])
  into v_allowed_modes
  from regexp_matches(
    v_action_mode_expression,
    '''([^'']+)''',
    'g'
  ) as captured_mode;

  if v_allowed_modes is distinct from array[
    'compromised-session',
    'gm-persona',
    'owner',
    'spoofed',
    'system'
  ]::text[] then
    raise exception 'ALTARA_MUSIC_AUDIT_MODE_CONTRACT_REVIEW_REQUIRED'
      using errcode = '55000', detail = v_action_mode_expression;
  end if;

  v_audit_definition := pg_get_functiondef(
    'public.net_altara_music_audit(text,text,uuid)'::regprocedure
  );

  if position('''gm-system''' in v_audit_definition) = 0
    or position('''authoritative-gm-system:altara-music''' in v_audit_definition) = 0
  then
    raise exception 'ALTARA_MUSIC_AUDIT_HELPER_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$preflight$;

create or replace function public.net_altara_music_audit(
  requested_action text,
  requested_resource_type text,
  requested_resource_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
begin
  v_actor := public.net_altara_music_assert_studio();
  if requested_action is null or char_length(requested_action) not between 1 and 120
    or requested_resource_type is null or char_length(requested_resource_type) not between 1 and 80
    or requested_resource_id is null
  then
    raise exception 'ALTARA_MUSIC_AUDIT_INPUT_INVALID' using errcode = '22023';
  end if;
  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    v_actor, null, null, null, 'system', requested_action,
    'authoritative-gm-system:altara-music', requested_resource_type,
    requested_resource_id
  );
end;
$$;

revoke all on function public.net_altara_music_audit(text,text,uuid)
  from public, anon, authenticated;

commit;
