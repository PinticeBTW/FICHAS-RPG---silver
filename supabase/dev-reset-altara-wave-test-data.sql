-- DEVELOPMENT / ADMINISTRATIVE RESET ONLY.
--
-- DO NOT RUN IN PRODUCTION AFTER REAL WAVE DATA EXISTS.
--
-- This script removes only ALTARA WAVE test product rows. It preserves the
-- WAVE schema, RPCs, RLS, Realtime row/publication, application installs,
-- service scope, runtime identities, canonical RPG portraits, and every
-- non-WAVE product table.
--
-- Physical Storage objects are deliberately NOT deleted here. Use the
-- separate scripts/dev-reset-altara-wave-storage.mjs command through the
-- Supabase Storage API.

begin;

-- REQUIRED MANUAL SAFETY GATE:
-- Uncomment the next line only after confirming WAVE contains test data only.
-- select set_config(
--   'rpgsilver.altara_wave_test_reset',
--   'DELETE-ALTARA-WAVE-TEST-DATA',
--   true
-- );

do $preflight$
declare
  v_required_tables constant text[] := array[
    'net_altara_wave_accounts',
    'net_altara_wave_posts',
    'net_altara_wave_post_mentions',
    'net_altara_wave_follows',
    'net_altara_wave_reactions',
    'net_altara_wave_boosts',
    'net_altara_wave_bookmarks',
    'net_altara_wave_notifications',
    'net_altara_wave_rate_limits',
    'net_altara_wave_realtime_state'
  ];
  v_table text;
  v_external_dependencies text;
begin
  if current_setting('rpgsilver.altara_wave_test_reset', true)
      is distinct from 'DELETE-ALTARA-WAVE-TEST-DATA'
  then
    raise exception 'ALTARA_WAVE_TEST_RESET_CONFIRMATION_REQUIRED'
      using errcode = '42501';
  end if;

  foreach v_table in array v_required_tables loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'ALTARA_WAVE_TEST_RESET_TABLE_MISSING: %', v_table
        using errcode = '55000';
    end if;
  end loop;

  if (
    select count(*)
    from public.net_altara_wave_realtime_state as state
    where state.channel = 'public'
  ) <> 1 then
    raise exception 'ALTARA_WAVE_TEST_RESET_REALTIME_STATE_INVALID'
      using errcode = '55000';
  end if;

  -- TRUNCATE intentionally has no CASCADE. This additional catalog guard
  -- prints and rejects any future non-WAVE table that starts referencing the
  -- product rows before the destructive statement is reached.
  select string_agg(
    format(
      '%I.%I via %I',
      dependent_namespace.nspname,
      dependent_table.relname,
      constraint_row.conname
    ),
    ', ' order by dependent_namespace.nspname,
      dependent_table.relname,
      constraint_row.conname
  )
  into v_external_dependencies
  from pg_constraint as constraint_row
  join pg_class as dependent_table
    on dependent_table.oid = constraint_row.conrelid
  join pg_namespace as dependent_namespace
    on dependent_namespace.oid = dependent_table.relnamespace
  where constraint_row.contype = 'f'
    and constraint_row.confrelid = any(array[
      'public.net_altara_wave_accounts'::regclass,
      'public.net_altara_wave_posts'::regclass,
      'public.net_altara_wave_post_mentions'::regclass,
      'public.net_altara_wave_follows'::regclass,
      'public.net_altara_wave_reactions'::regclass,
      'public.net_altara_wave_boosts'::regclass,
      'public.net_altara_wave_bookmarks'::regclass,
      'public.net_altara_wave_notifications'::regclass,
      'public.net_altara_wave_rate_limits'::regclass
    ])
    and constraint_row.conrelid <> all(array[
      'public.net_altara_wave_accounts'::regclass,
      'public.net_altara_wave_posts'::regclass,
      'public.net_altara_wave_post_mentions'::regclass,
      'public.net_altara_wave_follows'::regclass,
      'public.net_altara_wave_reactions'::regclass,
      'public.net_altara_wave_boosts'::regclass,
      'public.net_altara_wave_bookmarks'::regclass,
      'public.net_altara_wave_notifications'::regclass,
      'public.net_altara_wave_rate_limits'::regclass
    ]);

  if v_external_dependencies is not null then
    raise exception 'ALTARA_WAVE_TEST_RESET_EXTERNAL_FK_DEPENDENCY: %',
      v_external_dependencies
      using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('dev-reset-altara-wave-test-data', 0)
  );
end;
$preflight$;

-- All FK-related WAVE tables participate in one non-CASCADE TRUNCATE. This is
-- atomic and safely handles the self-referencing post parent/root graph.
truncate table
  public.net_altara_wave_notifications,
  public.net_altara_wave_post_mentions,
  public.net_altara_wave_reactions,
  public.net_altara_wave_boosts,
  public.net_altara_wave_bookmarks,
  public.net_altara_wave_follows,
  public.net_altara_wave_posts,
  public.net_altara_wave_accounts,
  public.net_altara_wave_rate_limits;

-- TRUNCATE does not fire the row-level WAVE invalidation triggers. Preserve
-- the singleton row and advance every projection revision once so open clients
-- receive one authoritative module refresh rather than a deletion storm.
update public.net_altara_wave_realtime_state
set revision = revision + 1,
    content_revision = content_revision + 1,
    profile_revision = profile_revision + 1,
    engagement_revision = engagement_revision + 1,
    notification_revision = notification_revision + 1,
    last_entity = 'reset',
    last_operation = 'truncate',
    last_resource_id = null,
    updated_at = timezone('utc', clock_timestamp())
where channel = 'public';

do $postflight$
declare
  v_remaining bigint;
begin
  select
    (select count(*) from public.net_altara_wave_accounts)
    + (select count(*) from public.net_altara_wave_posts)
    + (select count(*) from public.net_altara_wave_post_mentions)
    + (select count(*) from public.net_altara_wave_follows)
    + (select count(*) from public.net_altara_wave_reactions)
    + (select count(*) from public.net_altara_wave_boosts)
    + (select count(*) from public.net_altara_wave_bookmarks)
    + (select count(*) from public.net_altara_wave_notifications)
    + (select count(*) from public.net_altara_wave_rate_limits)
  into v_remaining;

  if v_remaining <> 0 then
    raise exception 'ALTARA_WAVE_TEST_RESET_POSTFLIGHT_ROWS_REMAIN: %',
      v_remaining
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from public.net_altara_wave_realtime_state as state
    where state.channel = 'public'
  ) <> 1 then
    raise exception 'ALTARA_WAVE_TEST_RESET_POSTFLIGHT_REALTIME_INVALID'
      using errcode = '55000';
  end if;
end;
$postflight$;

commit;
