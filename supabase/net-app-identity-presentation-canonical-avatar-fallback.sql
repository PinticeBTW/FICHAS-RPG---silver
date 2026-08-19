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
    'avatar_url', coalesce(v_avatar_ref, v_canonical ->> 'avatar_url'),
    'canonical_avatar_url', v_canonical ->> 'avatar_url'
  );
end;
$$;
