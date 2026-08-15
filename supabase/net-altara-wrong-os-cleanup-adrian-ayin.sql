-- ALTARA wrong-OS cleanup: Adrian + Ayin (Phase 2).
--
-- Forward migration only. This migration deliberately preserves every
-- identity, OS/currency assignment, sheet/card, shared presentation/media,
-- ALTARA Messenger row, economy account, ledger row and financial revision.

begin;

-- Freeze the reviewed authority and product rows for the complete preflight,
-- mutation and postcondition sequence. Financial tables are read-locked so a
-- concurrent ledger mutation cannot make the reviewed snapshot ambiguous.
lock table
  public.net_identity_links,
  public.net_identity_os_assignments,
  public.net_economy_identity_currency_assignments
in share mode;

lock table
  public.net_identity_app_installs,
  public.net_app_accounts,
  public.net_pulse_profiles,
  public.net_pulse_account_presentation,
  public.net_pulse_posts,
  public.net_pulse_reactions,
  public.net_pulse_boosts,
  public.net_pulse_bookmarks,
  public.net_pulse_follows,
  public.net_pulse_post_mentions,
  public.net_pulse_notifications,
  public.net_pulse_realtime_state,
  public.net_echo_account_signal_state,
  public.net_echo_signals,
  public.net_echo_signal_links,
  public.net_action_audit
in share row exclusive mode;

lock table
  public.net_economy_accounts,
  public.net_economy_transactions,
  public.net_economy_transaction_entries,
  public.net_economy_wallet_realtime_state,
  public.net_economy_vox_bank_state,
  public.net_economy_altara_bank_adoptions,
  public.net_economy_altara_bank_multicurrency_transitions,
  public.net_economy_altara_bank_fx_operations,
  public.net_economy_identity_currency_assignment_audit
in share mode;

do $cleanup$
declare
  v_adrian_id constant uuid := '8e7ebd04-f106-4db8-877b-bb83919406e0'::uuid;
  v_ayin_id constant uuid := '93497f00-fdd8-4153-a1db-be811f88ef64'::uuid;

  v_adrian_subject_id constant uuid := '9f9873b5-89fd-40d5-9682-e20173b10e85'::uuid;
  v_ayin_subject_id constant uuid := 'ffa69533-8497-4734-8bba-ef8ccef59f21'::uuid;

  v_adrian_pulse_id constant uuid := 'b300a44f-b68b-46e7-94b4-4d2dd9cd0e22'::uuid;
  v_adrian_echo_id constant uuid := '3ad14641-61c5-41cd-9520-a6c5031abcfb'::uuid;
  v_adrian_iden_id constant uuid := 'aaf444aa-204d-4452-af4a-4bf3620eb007'::uuid;

  v_hard_post_ids constant uuid[] := array[
    '659f1ecc-fd8f-4584-b785-04b8c283f1e5'::uuid,
    '6723563c-f97b-4823-be52-4fbd52879e8b'::uuid
  ];

  v_tombstone_post_ids constant uuid[] := array[
    '42883b13-6e3a-4997-94a8-d858ab849c67'::uuid,
    '649293d8-406f-4bd2-9b10-eb338ce07524'::uuid,
    '8a12c3a1-4701-49d3-a453-b515dc0a0d88'::uuid,
    '99153de6-7833-465b-94d5-eabe882e8c81'::uuid,
    '0d70fb79-2a94-43d5-8ae3-42a1ef0da7e9'::uuid,
    '48b97f82-a7c8-4480-a318-f343c0c6d835'::uuid
  ];

  v_financial_account_ids constant uuid[] := array[
    '3c1214e1-7532-4426-9add-e4e9ccc399ba'::uuid,
    'd4665e78-64f5-4110-bce6-0db132a994e1'::uuid,
    '84b85de0-e4e2-46d5-9ae7-e6f83d079265'::uuid,
    '3695e3e1-e995-4989-891a-4e22458bd7d8'::uuid,
    '7b5d0c2a-665e-4082-98e0-a921c680746b'::uuid,
    'c20f7e30-bebc-4243-bf4e-fee6785d1b1d'::uuid,
    'dbc398e0-a9da-4db3-9453-572981091cd8'::uuid,
    '4d2a818a-39a5-42d2-8379-8c6da31aeaf6'::uuid
  ];

  v_adrian_link public.net_identity_links%rowtype;
  v_ayin_link public.net_identity_links%rowtype;
  v_pulse_account public.net_app_accounts%rowtype;
  v_echo_account public.net_app_accounts%rowtype;
  v_iden_account public.net_app_accounts%rowtype;
  v_expected record;
  v_stats record;
  v_changed integer;
  v_mismatch_count integer;
  v_financial_before jsonb;
  v_financial_after jsonb;
  v_shared_pulse_before jsonb;
  v_shared_pulse_after jsonb;
  v_echo_audit_ids uuid[];
  v_iden_audit_ids uuid[];

begin
  ---------------------------------------------------------------------------
  -- Authoritative identity / OS / home-currency preflight.
  ---------------------------------------------------------------------------
  select identity_link.*
  into v_adrian_link
  from public.net_identity_links as identity_link
  where identity_link.id = v_adrian_id;

  if not found
    or v_adrian_link.subject_kind <> 'npc-card'
    or v_adrian_link.subject_id <> v_adrian_subject_id
    or v_adrian_link.identity_kind <> 'player'
    or v_adrian_link.playability <> 'playable'
  then
    raise exception 'ALTARA_CLEANUP_ADRIAN_IDENTITY_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.net_identity_os_assignments as assignment
    where assignment.identity_link_id = v_adrian_id
      and assignment.primary_os_id = 'altara'
  ) then
    raise exception 'ALTARA_CLEANUP_ADRIAN_OS_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.net_economy_identity_currency_assignments as assignment
    where assignment.identity_link_id = v_adrian_id
      and assignment.currency_code = 'FINIT'
  ) then
    raise exception 'ALTARA_CLEANUP_ADRIAN_CURRENCY_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  select identity_link.*
  into v_ayin_link
  from public.net_identity_links as identity_link
  where identity_link.id = v_ayin_id;

  if not found
    or v_ayin_link.subject_kind <> 'profile-sheet'
    or v_ayin_link.subject_id <> v_ayin_subject_id
    or v_ayin_link.identity_kind <> 'player'
    or v_ayin_link.playability <> 'playable'
  then
    raise exception 'ALTARA_CLEANUP_AYIN_IDENTITY_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.net_identity_os_assignments as assignment
    where assignment.identity_link_id = v_ayin_id
      and assignment.primary_os_id = 'altara'
  ) then
    raise exception 'ALTARA_CLEANUP_AYIN_OS_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.net_economy_identity_currency_assignments as assignment
    where assignment.identity_link_id = v_ayin_id
      and assignment.currency_code = 'SECTUS'
  ) then
    raise exception 'ALTARA_CLEANUP_AYIN_CURRENCY_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Exact reviewed app-account ownership.
  ---------------------------------------------------------------------------
  select account.*
  into v_pulse_account
  from public.net_app_accounts as account
  where account.id = v_adrian_pulse_id;

  if not found
    or v_pulse_account.app_id <> 'pulse'
    or not (
      v_pulse_account.identity_link_id = v_adrian_id
      or (
        v_pulse_account.entity_id is not null
        and v_adrian_link.entity_id is not null
        and v_pulse_account.entity_id = v_adrian_link.entity_id
      )
    )
  then
    raise exception 'ALTARA_CLEANUP_ADRIAN_PULSE_ACCOUNT_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  select account.*
  into v_echo_account
  from public.net_app_accounts as account
  where account.id = v_adrian_echo_id;

  if not found
    or v_echo_account.app_id <> 'echo'
    or not (
      v_echo_account.identity_link_id = v_adrian_id
      or (
        v_echo_account.entity_id is not null
        and v_adrian_link.entity_id is not null
        and v_echo_account.entity_id = v_adrian_link.entity_id
      )
    )
  then
    raise exception 'ALTARA_CLEANUP_ADRIAN_ECHO_ACCOUNT_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  select account.*
  into v_iden_account
  from public.net_app_accounts as account
  where account.id = v_adrian_iden_id;

  if not found
    or v_iden_account.app_id <> 'iden'
    or not (
      v_iden_account.identity_link_id = v_adrian_id
      or (
        v_iden_account.entity_id is not null
        and v_adrian_link.entity_id is not null
        and v_iden_account.entity_id = v_adrian_link.entity_id
      )
    )
  then
    raise exception 'ALTARA_CLEANUP_ADRIAN_IDEN_ACCOUNT_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.net_identity_app_installs as install
    where install.identity_link_id = v_adrian_id
      and install.app_id in (
        'pulse',
        'echo',
        'nvn',
        'vox-bank',
        'shneider-bank'
      )
  ) <> 5 then
    raise exception 'ALTARA_CLEANUP_ADRIAN_INSTALLS_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  -- Ayin is deliberately a verified no-op for VEIL app/social state.
  if exists (
    select 1
    from public.net_app_accounts as account
    where account.app_id in ('pulse', 'echo', 'iden')
      and (
        account.identity_link_id = v_ayin_id
        or (
          account.entity_id is not null
          and v_ayin_link.entity_id is not null
          and account.entity_id = v_ayin_link.entity_id
        )
      )
  ) then
    raise exception 'ALTARA_CLEANUP_AYIN_APP_ACCOUNT_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.net_identity_app_installs as install
    where install.identity_link_id = v_ayin_id
      and install.app_id in (
        'pulse',
        'echo',
        'nvn',
        'vox-bank',
        'shneider-bank'
      )
  ) then
    raise exception 'ALTARA_CLEANUP_AYIN_INSTALL_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Exact Adrian PULSE private/shared-state snapshot.
  ---------------------------------------------------------------------------
  if (
    select count(*)
    from public.net_pulse_reactions
    where account_id = v_adrian_pulse_id
  ) <> 4 then
    raise exception 'ALTARA_CLEANUP_PULSE_REACTIONS_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.net_pulse_boosts
    where account_id = v_adrian_pulse_id
  ) <> 1 then
    raise exception 'ALTARA_CLEANUP_PULSE_BOOSTS_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.net_pulse_bookmarks
    where account_id = v_adrian_pulse_id
  ) <> 0 then
    raise exception 'ALTARA_CLEANUP_PULSE_BOOKMARKS_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.net_pulse_follows
    where follower_account_id = v_adrian_pulse_id
  ) <> 1 then
    raise exception 'ALTARA_CLEANUP_PULSE_OUTGOING_FOLLOWS_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.net_pulse_notifications
    where recipient_account_id = v_adrian_pulse_id
  ) <> 7 then
    raise exception 'ALTARA_CLEANUP_PULSE_PRIVATE_NOTIFICATIONS_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.net_pulse_follows
    where followed_account_id = v_adrian_pulse_id
  ) <> 1 then
    raise exception 'ALTARA_CLEANUP_PULSE_INCOMING_FOLLOWS_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.net_pulse_post_mentions
    where mentioned_account_id = v_adrian_pulse_id
  ) <> 1 then
    raise exception 'ALTARA_CLEANUP_PULSE_INCOMING_MENTIONS_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.net_pulse_notifications
    where actor_account_id = v_adrian_pulse_id
  ) <> 6 then
    raise exception 'ALTARA_CLEANUP_PULSE_ACTOR_NOTIFICATIONS_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.net_pulse_posts as post
    where post.author_account_id = v_adrian_pulse_id
      and post.deleted_at is null
  ) <> 8
  or exists (
    select 1
    from public.net_pulse_posts as post
    where post.author_account_id = v_adrian_pulse_id
      and post.deleted_at is null
      and post.id <> all(v_hard_post_ids || v_tombstone_post_ids)
  )
  then
    raise exception 'ALTARA_CLEANUP_PULSE_AUTHORED_SET_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Exact hard-delete content.
  --
  -- IMPORTANT:
  -- The first reviewed post contains an actual newline + one space:
  --
  --   cie pulse
  --    5
  --
  -- Hex from production: 6369652070756c73650a2035
  ---------------------------------------------------------------------------
  if not exists (
    select 1
    from public.net_pulse_posts
    where id = '659f1ecc-fd8f-4584-b785-04b8c283f1e5'::uuid
      and author_account_id = v_adrian_pulse_id
      and parent_post_id is null
      and deleted_at is null
      and body = E'cie pulse\n 5'
  )
  or not exists (
    select 1
    from public.net_pulse_posts
    where id = '6723563c-f97b-4823-be52-4fbd52879e8b'::uuid
      and author_account_id = v_adrian_pulse_id
      and parent_post_id is null
      and deleted_at is null
      and body = 'crie pulse'
  )
  then
    raise exception 'ALTARA_CLEANUP_PULSE_HARD_DELETE_CONTENT_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Hard-delete candidates must have no dependency owned by another account.
  ---------------------------------------------------------------------------
  for v_expected in
    select candidate.post_id
    from unnest(v_hard_post_ids) as candidate(post_id)
  loop
    with recursive subtree as (
      select
        post.id,
        post.author_account_id
      from public.net_pulse_posts as post
      where post.id = v_expected.post_id

      union all

      select
        child.id,
        child.author_account_id
      from public.net_pulse_posts as child
      join subtree as parent
        on parent.id = child.parent_post_id
    )
    select
      (
        select count(*)
        from subtree
        where id <> v_expected.post_id
          and author_account_id <> v_adrian_pulse_id
      ) as external_descendants,

      (
        select count(*)
        from public.net_pulse_reactions as reaction
        join subtree
          on subtree.id = reaction.post_id
        where reaction.account_id <> v_adrian_pulse_id
      ) as external_reactions,

      (
        select count(*)
        from public.net_pulse_boosts as boost
        join subtree
          on subtree.id = boost.post_id
        where boost.account_id <> v_adrian_pulse_id
      ) as external_boosts,

      (
        select count(*)
        from public.net_pulse_bookmarks as bookmark
        join subtree
          on subtree.id = bookmark.post_id
        where bookmark.account_id <> v_adrian_pulse_id
      ) as external_bookmarks,

      (
        select count(*)
        from public.net_pulse_post_mentions as mention
        join subtree
          on subtree.id = mention.post_id
        where mention.mentioned_account_id <> v_adrian_pulse_id
      ) as external_mentions,

      (
        select count(*)
        from public.net_pulse_notifications as notification
        join subtree
          on notification.post_id = subtree.id
          or notification.root_post_id = subtree.id
        where notification.actor_account_id <> v_adrian_pulse_id
          or notification.recipient_account_id <> v_adrian_pulse_id
      ) as external_notifications

    into v_stats;

    if v_stats.external_descendants <> 0
      or v_stats.external_reactions <> 0
      or v_stats.external_boosts <> 0
      or v_stats.external_bookmarks <> 0
      or v_stats.external_mentions <> 0
      or v_stats.external_notifications <> 0
    then
      raise exception
        'ALTARA_CLEANUP_PULSE_HARD_DELETE_DEPENDENCY_REVIEW_REQUIRED:%',
        v_expected.post_id
        using errcode = 'P0001';
    end if;
  end loop;

  ---------------------------------------------------------------------------
  -- Shared root posts: validate reviewed production dependency counts.
  ---------------------------------------------------------------------------
  for v_expected in
    select *
    from (
      values
        (
          '42883b13-6e3a-4997-94a8-d858ab849c67'::uuid,
          '@jeffhackeado ent tas fixe?'::text,
          2::bigint,
          3::bigint,
          1::bigint,
          null::bigint
        ),
        (
          '649293d8-406f-4bd2-9b10-eb338ce07524'::uuid,
          'XE WI FIZ PULSE! MAXIMUM PULSE'::text,
          null::bigint,
          1::bigint,
          1::bigint,
          1::bigint
        ),
        (
          '8a12c3a1-4701-49d3-a453-b515dc0a0d88'::uuid,
          'pulse´'::text,
          1::bigint,
          1::bigint,
          1::bigint,
          null::bigint
        ),
        (
          '99153de6-7833-465b-94d5-eabe882e8c81'::uuid,
          'PUTAN da merde'::text,
          1::bigint,
          1::bigint,
          1::bigint,
          1::bigint
        )
    ) as expected(
      post_id,
      expected_body,
      expected_external_descendants,
      expected_external_reactions,
      expected_external_boosts,
      expected_external_bookmarks
    )
  loop
    if not exists (
      select 1
      from public.net_pulse_posts as post
      where post.id = v_expected.post_id
        and post.author_account_id = v_adrian_pulse_id
        and post.parent_post_id is null
        and post.deleted_at is null
        and post.body = v_expected.expected_body
    ) then
      raise exception
        'ALTARA_CLEANUP_PULSE_SHARED_ROOT_REVIEW_REQUIRED:%',
        v_expected.post_id
        using errcode = 'P0001';
    end if;

    with recursive subtree as (
      select
        post.id,
        post.author_account_id
      from public.net_pulse_posts as post
      where post.id = v_expected.post_id

      union all

      select
        child.id,
        child.author_account_id
      from public.net_pulse_posts as child
      join subtree as parent
        on parent.id = child.parent_post_id
    )
    select
      (
        select count(*)
        from subtree
        where id <> v_expected.post_id
          and author_account_id <> v_adrian_pulse_id
      ) as external_descendants,

      (
        select count(*)
        from public.net_pulse_reactions as reaction
        join subtree
          on subtree.id = reaction.post_id
        where reaction.account_id <> v_adrian_pulse_id
      ) as external_reactions,

      (
        select count(*)
        from public.net_pulse_boosts as boost
        join subtree
          on subtree.id = boost.post_id
        where boost.account_id <> v_adrian_pulse_id
      ) as external_boosts,

      (
        select count(*)
        from public.net_pulse_bookmarks as bookmark
        join subtree
          on subtree.id = bookmark.post_id
        where bookmark.account_id <> v_adrian_pulse_id
      ) as external_bookmarks

    into v_stats;

    if (
      v_expected.expected_external_descendants is not null
      and v_stats.external_descendants
        <> v_expected.expected_external_descendants
    )
    or (
      v_expected.expected_external_reactions is not null
      and v_stats.external_reactions
        <> v_expected.expected_external_reactions
    )
    or (
      v_expected.expected_external_boosts is not null
      and v_stats.external_boosts
        <> v_expected.expected_external_boosts
    )
    or (
      v_expected.expected_external_bookmarks is not null
      and v_stats.external_bookmarks
        <> v_expected.expected_external_bookmarks
    )
    then
      raise exception
        'ALTARA_CLEANUP_PULSE_SHARED_ROOT_DEPENDENCY_REVIEW_REQUIRED:%',
        v_expected.post_id
        using errcode = 'P0001';
    end if;
  end loop;

  ---------------------------------------------------------------------------
  -- Shared replies.
  ---------------------------------------------------------------------------
  for v_expected in
    select *
    from (
      values
        (
          '0d70fb79-2a94-43d5-8ae3-42a1ef0da7e9'::uuid,
          'xe'::text
        ),
        (
          '48b97f82-a7c8-4480-a318-f343c0c6d835'::uuid,
          'boa bro! ainda bem q gostas!'::text
        )
    ) as expected(post_id, expected_body)
  loop
    if not exists (
      select 1
      from public.net_pulse_posts as reply
      join public.net_pulse_posts as parent
        on parent.id = reply.parent_post_id
      where reply.id = v_expected.post_id
        and reply.author_account_id = v_adrian_pulse_id
        and reply.deleted_at is null
        and reply.body = v_expected.expected_body
        and parent.author_account_id <> v_adrian_pulse_id
    ) then
      raise exception
        'ALTARA_CLEANUP_PULSE_SHARED_REPLY_REVIEW_REQUIRED:%',
        v_expected.post_id
        using errcode = 'P0001';
    end if;
  end loop;

  ---------------------------------------------------------------------------
  -- Snapshot complete shared PULSE graph.
  ---------------------------------------------------------------------------
  with recursive shared_subtree(
    root_post_id,
    id,
    author_account_id
  ) as (
    select
      post.id,
      post.id,
      post.author_account_id
    from public.net_pulse_posts as post
    where post.id = any(v_tombstone_post_ids)

    union all

    select
      subtree.root_post_id,
      child.id,
      child.author_account_id
    from shared_subtree as subtree
    join public.net_pulse_posts as child
      on child.parent_post_id = subtree.id
  )
  select jsonb_build_object(
    'anchors',
    coalesce((
      select jsonb_agg(
        to_jsonb(post) - 'deleted_at' - 'updated_at'
        order by post.id
      )
      from public.net_pulse_posts as post
      where post.id = any(v_tombstone_post_ids)
    ), '[]'::jsonb),

    'external_descendants',
    coalesce((
      select jsonb_agg(
        to_jsonb(post)
        order by post.id
      )
      from shared_subtree as subtree
      join public.net_pulse_posts as post
        on post.id = subtree.id
      where subtree.id <> subtree.root_post_id
        and subtree.author_account_id <> v_adrian_pulse_id
    ), '[]'::jsonb),

    'external_reactions',
    coalesce((
      select jsonb_agg(
        to_jsonb(reaction)
        order by reaction.post_id, reaction.account_id
      )
      from shared_subtree as subtree
      join public.net_pulse_reactions as reaction
        on reaction.post_id = subtree.id
      where reaction.account_id <> v_adrian_pulse_id
    ), '[]'::jsonb),

    'external_boosts',
    coalesce((
      select jsonb_agg(
        to_jsonb(boost)
        order by boost.post_id, boost.account_id
      )
      from shared_subtree as subtree
      join public.net_pulse_boosts as boost
        on boost.post_id = subtree.id
      where boost.account_id <> v_adrian_pulse_id
    ), '[]'::jsonb),

    'external_bookmarks',
    coalesce((
      select jsonb_agg(
        to_jsonb(bookmark)
        order by bookmark.post_id, bookmark.account_id
      )
      from shared_subtree as subtree
      join public.net_pulse_bookmarks as bookmark
        on bookmark.post_id = subtree.id
      where bookmark.account_id <> v_adrian_pulse_id
    ), '[]'::jsonb),

    'shared_mentions',
    coalesce((
      select jsonb_agg(
        to_jsonb(mention)
        order by mention.post_id, mention.mentioned_account_id
      )
      from shared_subtree as subtree
      join public.net_pulse_post_mentions as mention
        on mention.post_id = subtree.id
    ), '[]'::jsonb),

    'incoming_mentions',
    coalesce((
      select jsonb_agg(
        to_jsonb(mention)
        order by mention.post_id
      )
      from public.net_pulse_post_mentions as mention
      where mention.mentioned_account_id = v_adrian_pulse_id
    ), '[]'::jsonb),

    'external_notifications',
    coalesce((
      select jsonb_agg(
        to_jsonb(notification)
        order by notification.id
      )
      from public.net_pulse_notifications as notification
      where notification.actor_account_id <> v_adrian_pulse_id
        and notification.recipient_account_id <> v_adrian_pulse_id
        and (
          notification.post_id in (
            select subtree.id
            from shared_subtree as subtree
          )
          or notification.root_post_id in (
            select subtree.id
            from shared_subtree as subtree
          )
        )
    ), '[]'::jsonb),

    'actor_notifications',
    coalesce((
      select jsonb_agg(
        to_jsonb(notification)
        order by notification.id
      )
      from public.net_pulse_notifications as notification
      where notification.actor_account_id = v_adrian_pulse_id
    ), '[]'::jsonb),

    'incoming_follows',
    coalesce((
      select jsonb_agg(
        to_jsonb(follow_row)
        order by follow_row.follower_account_id
      )
      from public.net_pulse_follows as follow_row
      where follow_row.followed_account_id = v_adrian_pulse_id
    ), '[]'::jsonb)

  ) into v_shared_pulse_before;

  ---------------------------------------------------------------------------
  -- ECHO and IDEN dependency preflight.
  ---------------------------------------------------------------------------
  if exists (
    select 1
    from public.net_echo_account_signal_state
    where account_id = v_adrian_echo_id
  )
  or exists (
    select 1
    from public.net_echo_signals
    where source_account_id = v_adrian_echo_id
  )
  then
    raise exception 'ALTARA_CLEANUP_ADRIAN_ECHO_DEPENDENCY_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.net_pulse_profiles
    where account_id in (
      v_adrian_echo_id,
      v_adrian_iden_id
    )
  )
  or exists (
    select 1
    from public.net_pulse_account_presentation
    where account_id in (
      v_adrian_echo_id,
      v_adrian_iden_id
    )
  )
  or exists (
    select 1
    from public.net_pulse_posts
    where author_account_id in (
      v_adrian_echo_id,
      v_adrian_iden_id
    )
  )
  or exists (
    select 1
    from public.net_pulse_reactions
    where account_id in (
      v_adrian_echo_id,
      v_adrian_iden_id
    )
  )
  or exists (
    select 1
    from public.net_pulse_boosts
    where account_id in (
      v_adrian_echo_id,
      v_adrian_iden_id
    )
  )
  or exists (
    select 1
    from public.net_pulse_bookmarks
    where account_id in (
      v_adrian_echo_id,
      v_adrian_iden_id
    )
  )
  or exists (
    select 1
    from public.net_pulse_follows
    where follower_account_id in (
      v_adrian_echo_id,
      v_adrian_iden_id
    )
    or followed_account_id in (
      v_adrian_echo_id,
      v_adrian_iden_id
    )
  )
  or exists (
    select 1
    from public.net_pulse_post_mentions
    where mentioned_account_id in (
      v_adrian_echo_id,
      v_adrian_iden_id
    )
  )
  or exists (
    select 1
    from public.net_pulse_notifications
    where recipient_account_id in (
      v_adrian_echo_id,
      v_adrian_iden_id
    )
    or actor_account_id in (
      v_adrian_echo_id,
      v_adrian_iden_id
    )
  )
  or exists (
    select 1
    from public.net_echo_account_signal_state
    where account_id = v_adrian_iden_id
  )
  or exists (
    select 1
    from public.net_echo_signals
    where source_account_id = v_adrian_iden_id
  )
  then
    raise exception
      'ALTARA_CLEANUP_ECHO_IDEN_CROSS_APP_REFERENCE_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  select coalesce(
    array_agg(audit.id order by audit.id),
    array[]::uuid[]
  )
  into v_echo_audit_ids
  from public.net_action_audit as audit
  where audit.presented_account_id = v_adrian_echo_id;

  select coalesce(
    array_agg(audit.id order by audit.id),
    array[]::uuid[]
  )
  into v_iden_audit_ids
  from public.net_action_audit as audit
  where audit.presented_account_id = v_adrian_iden_id;

  ---------------------------------------------------------------------------
  -- Exact financial snapshot and reviewed balance/ledger proof.
  ---------------------------------------------------------------------------
  with expected(
    account_id,
    identity_link_id,
    account_kind,
    institution_id,
    currency_code,
    status,
    balance_amount,
    expected_transaction_count
  ) as (
    values
      (
        '3c1214e1-7532-4426-9add-e4e9ccc399ba'::uuid,
        v_adrian_id,
        'wallet'::text,
        null::uuid,
        'VG'::text,
        'active'::text,
        177::bigint,
        null::bigint
      ),
      (
        'd4665e78-64f5-4110-bce6-0db132a994e1'::uuid,
        v_adrian_id,
        'bank'::text,
        '00000000-0000-0000-0000-00000000e100'::uuid,
        'VG'::text,
        'active'::text,
        291::bigint,
        null::bigint
      ),
      (
        '84b85de0-e4e2-46d5-9ae7-e6f83d079265'::uuid,
        v_adrian_id,
        'bank'::text,
        '00000000-0000-0000-0000-00000000e101'::uuid,
        'VG'::text,
        'active'::text,
        0::bigint,
        null::bigint
      ),
      (
        '3695e3e1-e995-4989-891a-4e22458bd7d8'::uuid,
        v_adrian_id,
        'bank'::text,
        '00000000-0000-0000-0000-00000000e102'::uuid,
        'VG'::text,
        'closed'::text,
        0::bigint,
        2::bigint
      ),
      (
        '7b5d0c2a-665e-4082-98e0-a921c680746b'::uuid,
        v_adrian_id,
        'bank'::text,
        '00000000-0000-0000-0000-00000000e102'::uuid,
        'FINIT'::text,
        'active'::text,
        207::bigint,
        null::bigint
      ),
      (
        'c20f7e30-bebc-4243-bf4e-fee6785d1b1d'::uuid,
        v_ayin_id,
        'wallet'::text,
        null::uuid,
        'VG'::text,
        'active'::text,
        0::bigint,
        null::bigint
      ),
      (
        'dbc398e0-a9da-4db3-9453-572981091cd8'::uuid,
        v_ayin_id,
        'bank'::text,
        '00000000-0000-0000-0000-00000000e102'::uuid,
        'VG'::text,
        'closed'::text,
        0::bigint,
        null::bigint
      ),
      (
        '4d2a818a-39a5-42d2-8379-8c6da31aeaf6'::uuid,
        v_ayin_id,
        'bank'::text,
        '00000000-0000-0000-0000-00000000e102'::uuid,
        'SECTUS'::text,
        'active'::text,
        15::bigint,
        null::bigint
      )
  ),
  actual as (
    select
      expected.*,
      account.id as actual_account_id,
      account.identity_link_id as actual_identity_link_id,
      account.account_kind as actual_account_kind,
      account.institution_id as actual_institution_id,
      account.currency_code as actual_currency_code,
      account.status as actual_status,
      account.balance_amount as actual_balance_amount,
      coalesce(sum(entry.amount), 0)::bigint as ledger_sum,
      count(distinct entry.transaction_id)::bigint as transaction_count
    from expected
    left join public.net_economy_accounts as account
      on account.id = expected.account_id
    left join public.net_economy_transaction_entries as entry
      on entry.account_id = account.id
    group by
      expected.account_id,
      expected.identity_link_id,
      expected.account_kind,
      expected.institution_id,
      expected.currency_code,
      expected.status,
      expected.balance_amount,
      expected.expected_transaction_count,
      account.id,
      account.identity_link_id,
      account.account_kind,
      account.institution_id,
      account.currency_code,
      account.status,
      account.balance_amount
  )
  select count(*)
  into v_mismatch_count
  from actual
  where actual_account_id is null
    or actual_identity_link_id <> identity_link_id
    or actual_account_kind <> account_kind
    or actual_institution_id is distinct from institution_id
    or actual_currency_code <> currency_code
    or actual_status <> status
    or actual_balance_amount <> balance_amount
    or ledger_sum <> balance_amount
    or (
      expected_transaction_count is not null
      and transaction_count <> expected_transaction_count
    );

  if v_mismatch_count <> 0 then
    raise exception 'ALTARA_CLEANUP_FINANCIAL_SNAPSHOT_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'accounts',
    coalesce((
      select jsonb_agg(
        to_jsonb(account)
        order by account.id
      )
      from public.net_economy_accounts as account
      where account.id = any(v_financial_account_ids)
    ), '[]'::jsonb),

    'entries',
    coalesce((
      select jsonb_agg(
        to_jsonb(entry)
        order by entry.id
      )
      from public.net_economy_transaction_entries as entry
      where entry.account_id = any(v_financial_account_ids)
    ), '[]'::jsonb),

    'transactions',
    coalesce((
      select jsonb_agg(
        to_jsonb(transaction_record)
        order by transaction_record.id
      )
      from public.net_economy_transactions as transaction_record
      where transaction_record.id in (
        select distinct entry.transaction_id
        from public.net_economy_transaction_entries as entry
        where entry.account_id = any(v_financial_account_ids)
      )
    ), '[]'::jsonb),

    'realtime',
    coalesce((
      select jsonb_agg(
        to_jsonb(realtime)
        order by realtime.account_id
      )
      from public.net_economy_wallet_realtime_state as realtime
      where realtime.account_id = any(v_financial_account_ids)
    ), '[]'::jsonb),

    'vox_state',
    coalesce((
      select jsonb_agg(
        to_jsonb(vox_state)
        order by vox_state.account_id
      )
      from public.net_economy_vox_bank_state as vox_state
      where vox_state.account_id = any(v_financial_account_ids)
    ), '[]'::jsonb),

    'adoptions',
    coalesce((
      select jsonb_agg(
        to_jsonb(adoption)
        order by adoption.identity_link_id
      )
      from public.net_economy_altara_bank_adoptions as adoption
      where adoption.identity_link_id in (
        v_adrian_id,
        v_ayin_id
      )
    ), '[]'::jsonb),

    'transitions',
    coalesce((
      select jsonb_agg(
        to_jsonb(transition)
        order by transition.identity_link_id
      )
      from public.net_economy_altara_bank_multicurrency_transitions as transition
      where transition.identity_link_id in (
        v_adrian_id,
        v_ayin_id
      )
    ), '[]'::jsonb),

    'fx_operations',
    coalesce((
      select jsonb_agg(
        to_jsonb(operation)
        order by operation.id
      )
      from public.net_economy_altara_bank_fx_operations as operation
      where operation.sender_identity_link_id in (
        v_adrian_id,
        v_ayin_id
      )
      or operation.recipient_identity_link_id in (
        v_adrian_id,
        v_ayin_id
      )
    ), '[]'::jsonb),

    'currency_assignments',
    coalesce((
      select jsonb_agg(
        to_jsonb(assignment)
        order by assignment.identity_link_id
      )
      from public.net_economy_identity_currency_assignments as assignment
      where assignment.identity_link_id in (
        v_adrian_id,
        v_ayin_id
      )
    ), '[]'::jsonb),

    'currency_audit',
    coalesce((
      select jsonb_agg(
        to_jsonb(audit)
        order by audit.id
      )
      from public.net_economy_identity_currency_assignment_audit as audit
      where audit.identity_link_id in (
        v_adrian_id,
        v_ayin_id
      )
    ), '[]'::jsonb)

  ) into v_financial_before;

  ---------------------------------------------------------------------------
  -- Mutations: exact reviewed VEIL-owned launcher/private state only.
  ---------------------------------------------------------------------------
  delete from public.net_identity_app_installs as install
  where install.identity_link_id = v_adrian_id
    and install.app_id in (
      'pulse',
      'echo',
      'nvn',
      'vox-bank',
      'shneider-bank'
    );

  get diagnostics v_changed = row_count;

  if v_changed <> 5 then
    raise exception 'ALTARA_CLEANUP_INSTALL_DELETE_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  delete from public.net_pulse_notifications as notification
  where notification.recipient_account_id = v_adrian_pulse_id;

  get diagnostics v_changed = row_count;

  if v_changed <> 7 then
    raise exception 'ALTARA_CLEANUP_NOTIFICATION_DELETE_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  delete from public.net_pulse_reactions as reaction
  where reaction.account_id = v_adrian_pulse_id;

  get diagnostics v_changed = row_count;

  if v_changed <> 4 then
    raise exception 'ALTARA_CLEANUP_REACTION_DELETE_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  delete from public.net_pulse_boosts as boost
  where boost.account_id = v_adrian_pulse_id;

  get diagnostics v_changed = row_count;

  if v_changed <> 1 then
    raise exception 'ALTARA_CLEANUP_BOOST_DELETE_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  delete from public.net_pulse_bookmarks as bookmark
  where bookmark.account_id = v_adrian_pulse_id;

  get diagnostics v_changed = row_count;

  if v_changed <> 0 then
    raise exception 'ALTARA_CLEANUP_BOOKMARK_DELETE_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  delete from public.net_pulse_follows as follow_row
  where follow_row.follower_account_id = v_adrian_pulse_id;

  get diagnostics v_changed = row_count;

  if v_changed <> 1 then
    raise exception 'ALTARA_CLEANUP_OUTGOING_FOLLOW_DELETE_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Hard-delete final dependency check.
  ---------------------------------------------------------------------------
  if exists (
    select 1
    from public.net_pulse_posts
    where parent_post_id = any(v_hard_post_ids)
  )
  or exists (
    select 1
    from public.net_pulse_reactions
    where post_id = any(v_hard_post_ids)
  )
  or exists (
    select 1
    from public.net_pulse_boosts
    where post_id = any(v_hard_post_ids)
  )
  or exists (
    select 1
    from public.net_pulse_bookmarks
    where post_id = any(v_hard_post_ids)
  )
  or exists (
    select 1
    from public.net_pulse_post_mentions
    where post_id = any(v_hard_post_ids)
  )
  or exists (
    select 1
    from public.net_pulse_notifications
    where post_id = any(v_hard_post_ids)
      or root_post_id = any(v_hard_post_ids)
  )
  then
    raise exception
      'ALTARA_CLEANUP_PULSE_HARD_DELETE_FINAL_DEPENDENCY_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  delete from public.net_pulse_posts as post
  where post.id = any(v_hard_post_ids)
    and post.author_account_id = v_adrian_pulse_id
    and post.deleted_at is null;

  get diagnostics v_changed = row_count;

  if v_changed <> 2 then
    raise exception 'ALTARA_CLEANUP_PULSE_HARD_DELETE_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Tombstone shared posts/replies.
  ---------------------------------------------------------------------------
  update public.net_pulse_posts as post
  set deleted_at = timezone('utc', now())
  where post.id = any(v_tombstone_post_ids)
    and post.author_account_id = v_adrian_pulse_id
    and post.deleted_at is null;

  get diagnostics v_changed = row_count;

  if v_changed <> 6 then
    raise exception 'ALTARA_CLEANUP_PULSE_TOMBSTONE_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Retire Adrian's PULSE identity without deleting shared references.
  ---------------------------------------------------------------------------
  update public.net_app_accounts as account
  set status = 'disabled'
  where account.id = v_adrian_pulse_id;

  get diagnostics v_changed = row_count;

  if v_changed <> 1 then
    raise exception 'ALTARA_CLEANUP_PULSE_DISABLE_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  update public.net_pulse_profiles as profile
  set
    visibility = 'limited',
    discoverable = false
  where profile.account_id = v_adrian_pulse_id;

  get diagnostics v_changed = row_count;

  if v_changed <> 1 then
    raise exception 'ALTARA_CLEANUP_PULSE_PROFILE_RETIRE_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Delete dependency-free ECHO + IDEN app accounts.
  ---------------------------------------------------------------------------
  delete from public.net_app_accounts as account
  where account.id = v_adrian_echo_id
    and account.app_id = 'echo';

  get diagnostics v_changed = row_count;

  if v_changed <> 1 then
    raise exception 'ALTARA_CLEANUP_ECHO_ACCOUNT_DELETE_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  delete from public.net_app_accounts as account
  where account.id = v_adrian_iden_id
    and account.app_id = 'iden';

  get diagnostics v_changed = row_count;

  if v_changed <> 1 then
    raise exception 'ALTARA_CLEANUP_IDEN_ACCOUNT_DELETE_REVIEW_REQUIRED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Postconditions: install cleanup.
  ---------------------------------------------------------------------------
  if exists (
    select 1
    from public.net_identity_app_installs
    where identity_link_id = v_adrian_id
      and app_id in (
        'pulse',
        'echo',
        'nvn',
        'vox-bank',
        'shneider-bank'
      )
  ) then
    raise exception 'ALTARA_CLEANUP_POSTCONDITION_INSTALLS_FAILED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Postconditions: private PULSE state.
  ---------------------------------------------------------------------------
  if exists (
    select 1
    from public.net_pulse_reactions
    where account_id = v_adrian_pulse_id
  )
  or exists (
    select 1
    from public.net_pulse_boosts
    where account_id = v_adrian_pulse_id
  )
  or exists (
    select 1
    from public.net_pulse_bookmarks
    where account_id = v_adrian_pulse_id
  )
  or exists (
    select 1
    from public.net_pulse_follows
    where follower_account_id = v_adrian_pulse_id
  )
  or exists (
    select 1
    from public.net_pulse_notifications
    where recipient_account_id = v_adrian_pulse_id
  )
  then
    raise exception
      'ALTARA_CLEANUP_POSTCONDITION_PULSE_PRIVATE_STATE_FAILED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Postconditions: hard deletes.
  ---------------------------------------------------------------------------
  if exists (
    select 1
    from public.net_pulse_posts
    where id = any(v_hard_post_ids)
  ) then
    raise exception 'ALTARA_CLEANUP_POSTCONDITION_HARD_DELETE_FAILED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Postconditions: tombstones.
  ---------------------------------------------------------------------------
  if (
    select count(*)
    from public.net_pulse_posts
    where id = any(v_tombstone_post_ids)
      and author_account_id = v_adrian_pulse_id
      and deleted_at is not null
  ) <> 6 then
    raise exception 'ALTARA_CLEANUP_POSTCONDITION_TOMBSTONE_FAILED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Postconditions: PULSE retired but historical account preserved.
  ---------------------------------------------------------------------------
  if not exists (
    select 1
    from public.net_app_accounts
    where id = v_adrian_pulse_id
      and app_id = 'pulse'
      and status = 'disabled'
  )
  or not exists (
    select 1
    from public.net_pulse_profiles
    where account_id = v_adrian_pulse_id
      and visibility = 'limited'
      and discoverable = false
  )
  then
    raise exception
      'ALTARA_CLEANUP_POSTCONDITION_PULSE_RETIREMENT_FAILED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Postconditions: other-user/shared PULSE references still there.
  ---------------------------------------------------------------------------
  if (
    select count(*)
    from public.net_pulse_follows
    where followed_account_id = v_adrian_pulse_id
  ) <> 1
  or (
    select count(*)
    from public.net_pulse_post_mentions
    where mentioned_account_id = v_adrian_pulse_id
  ) <> 1
  or (
    select count(*)
    from public.net_pulse_notifications
    where actor_account_id = v_adrian_pulse_id
  ) <> 6
  then
    raise exception
      'ALTARA_CLEANUP_POSTCONDITION_SHARED_PULSE_REFERENCE_FAILED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Snapshot shared PULSE graph again and compare byte-for-byte.
  ---------------------------------------------------------------------------
  with recursive shared_subtree(
    root_post_id,
    id,
    author_account_id
  ) as (
    select
      post.id,
      post.id,
      post.author_account_id
    from public.net_pulse_posts as post
    where post.id = any(v_tombstone_post_ids)

    union all

    select
      subtree.root_post_id,
      child.id,
      child.author_account_id
    from shared_subtree as subtree
    join public.net_pulse_posts as child
      on child.parent_post_id = subtree.id
  )
  select jsonb_build_object(
    'anchors',
    coalesce((
      select jsonb_agg(
        to_jsonb(post) - 'deleted_at' - 'updated_at'
        order by post.id
      )
      from public.net_pulse_posts as post
      where post.id = any(v_tombstone_post_ids)
    ), '[]'::jsonb),

    'external_descendants',
    coalesce((
      select jsonb_agg(
        to_jsonb(post)
        order by post.id
      )
      from shared_subtree as subtree
      join public.net_pulse_posts as post
        on post.id = subtree.id
      where subtree.id <> subtree.root_post_id
        and subtree.author_account_id <> v_adrian_pulse_id
    ), '[]'::jsonb),

    'external_reactions',
    coalesce((
      select jsonb_agg(
        to_jsonb(reaction)
        order by reaction.post_id, reaction.account_id
      )
      from shared_subtree as subtree
      join public.net_pulse_reactions as reaction
        on reaction.post_id = subtree.id
      where reaction.account_id <> v_adrian_pulse_id
    ), '[]'::jsonb),

    'external_boosts',
    coalesce((
      select jsonb_agg(
        to_jsonb(boost)
        order by boost.post_id, boost.account_id
      )
      from shared_subtree as subtree
      join public.net_pulse_boosts as boost
        on boost.post_id = subtree.id
      where boost.account_id <> v_adrian_pulse_id
    ), '[]'::jsonb),

    'external_bookmarks',
    coalesce((
      select jsonb_agg(
        to_jsonb(bookmark)
        order by bookmark.post_id, bookmark.account_id
      )
      from shared_subtree as subtree
      join public.net_pulse_bookmarks as bookmark
        on bookmark.post_id = subtree.id
      where bookmark.account_id <> v_adrian_pulse_id
    ), '[]'::jsonb),

    'shared_mentions',
    coalesce((
      select jsonb_agg(
        to_jsonb(mention)
        order by mention.post_id, mention.mentioned_account_id
      )
      from shared_subtree as subtree
      join public.net_pulse_post_mentions as mention
        on mention.post_id = subtree.id
    ), '[]'::jsonb),

    'incoming_mentions',
    coalesce((
      select jsonb_agg(
        to_jsonb(mention)
        order by mention.post_id
      )
      from public.net_pulse_post_mentions as mention
      where mention.mentioned_account_id = v_adrian_pulse_id
    ), '[]'::jsonb),

    'external_notifications',
    coalesce((
      select jsonb_agg(
        to_jsonb(notification)
        order by notification.id
      )
      from public.net_pulse_notifications as notification
      where notification.actor_account_id <> v_adrian_pulse_id
        and notification.recipient_account_id <> v_adrian_pulse_id
        and (
          notification.post_id in (
            select subtree.id
            from shared_subtree as subtree
          )
          or notification.root_post_id in (
            select subtree.id
            from shared_subtree as subtree
          )
        )
    ), '[]'::jsonb),

    'actor_notifications',
    coalesce((
      select jsonb_agg(
        to_jsonb(notification)
        order by notification.id
      )
      from public.net_pulse_notifications as notification
      where notification.actor_account_id = v_adrian_pulse_id
    ), '[]'::jsonb),

    'incoming_follows',
    coalesce((
      select jsonb_agg(
        to_jsonb(follow_row)
        order by follow_row.follower_account_id
      )
      from public.net_pulse_follows as follow_row
      where follow_row.followed_account_id = v_adrian_pulse_id
    ), '[]'::jsonb)

  ) into v_shared_pulse_after;

  if v_shared_pulse_after is distinct from v_shared_pulse_before then
    raise exception
      'ALTARA_CLEANUP_POSTCONDITION_SHARED_PULSE_GRAPH_FAILED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- ECHO and IDEN gone.
  ---------------------------------------------------------------------------
  if exists (
    select 1
    from public.net_app_accounts
    where id in (
      v_adrian_echo_id,
      v_adrian_iden_id
    )
  ) then
    raise exception
      'ALTARA_CLEANUP_POSTCONDITION_ECHO_IDEN_DELETE_FAILED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Audit rows preserved; SET NULL performed by FK.
  ---------------------------------------------------------------------------
  if exists (
    select requested.audit_id
    from unnest(
      v_echo_audit_ids || v_iden_audit_ids
    ) as requested(audit_id)
    where not exists (
      select 1
      from public.net_action_audit as audit
      where audit.id = requested.audit_id
        and audit.presented_account_id is null
    )
  ) then
    raise exception
      'ALTARA_CLEANUP_POSTCONDITION_AUDIT_PRESERVATION_FAILED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Re-prove identity / OS / currency.
  ---------------------------------------------------------------------------
  if not exists (
    select 1
    from public.net_identity_links
    where id = v_adrian_id
      and subject_kind = 'npc-card'
      and subject_id = v_adrian_subject_id
  )
  or not exists (
    select 1
    from public.net_identity_os_assignments
    where identity_link_id = v_adrian_id
      and primary_os_id = 'altara'
  )
  or not exists (
    select 1
    from public.net_economy_identity_currency_assignments
    where identity_link_id = v_adrian_id
      and currency_code = 'FINIT'
  )
  or not exists (
    select 1
    from public.net_identity_links
    where id = v_ayin_id
      and subject_kind = 'profile-sheet'
      and subject_id = v_ayin_subject_id
  )
  or not exists (
    select 1
    from public.net_identity_os_assignments
    where identity_link_id = v_ayin_id
      and primary_os_id = 'altara'
  )
  or not exists (
    select 1
    from public.net_economy_identity_currency_assignments
    where identity_link_id = v_ayin_id
      and currency_code = 'SECTUS'
  )
  then
    raise exception 'ALTARA_CLEANUP_POSTCONDITION_AUTHORITY_FAILED'
      using errcode = 'P0001';
  end if;

  ---------------------------------------------------------------------------
  -- Rebuild financial snapshot byte-for-byte.
  ---------------------------------------------------------------------------
  select jsonb_build_object(
    'accounts',
    coalesce((
      select jsonb_agg(
        to_jsonb(account)
        order by account.id
      )
      from public.net_economy_accounts as account
      where account.id = any(v_financial_account_ids)
    ), '[]'::jsonb),

    'entries',
    coalesce((
      select jsonb_agg(
        to_jsonb(entry)
        order by entry.id
      )
      from public.net_economy_transaction_entries as entry
      where entry.account_id = any(v_financial_account_ids)
    ), '[]'::jsonb),

    'transactions',
    coalesce((
      select jsonb_agg(
        to_jsonb(transaction_record)
        order by transaction_record.id
      )
      from public.net_economy_transactions as transaction_record
      where transaction_record.id in (
        select distinct entry.transaction_id
        from public.net_economy_transaction_entries as entry
        where entry.account_id = any(v_financial_account_ids)
      )
    ), '[]'::jsonb),

    'realtime',
    coalesce((
      select jsonb_agg(
        to_jsonb(realtime)
        order by realtime.account_id
      )
      from public.net_economy_wallet_realtime_state as realtime
      where realtime.account_id = any(v_financial_account_ids)
    ), '[]'::jsonb),

    'vox_state',
    coalesce((
      select jsonb_agg(
        to_jsonb(vox_state)
        order by vox_state.account_id
      )
      from public.net_economy_vox_bank_state as vox_state
      where vox_state.account_id = any(v_financial_account_ids)
    ), '[]'::jsonb),

    'adoptions',
    coalesce((
      select jsonb_agg(
        to_jsonb(adoption)
        order by adoption.identity_link_id
      )
      from public.net_economy_altara_bank_adoptions as adoption
      where adoption.identity_link_id in (
        v_adrian_id,
        v_ayin_id
      )
    ), '[]'::jsonb),

    'transitions',
    coalesce((
      select jsonb_agg(
        to_jsonb(transition)
        order by transition.identity_link_id
      )
      from public.net_economy_altara_bank_multicurrency_transitions as transition
      where transition.identity_link_id in (
        v_adrian_id,
        v_ayin_id
      )
    ), '[]'::jsonb),

    'fx_operations',
    coalesce((
      select jsonb_agg(
        to_jsonb(operation)
        order by operation.id
      )
      from public.net_economy_altara_bank_fx_operations as operation
      where operation.sender_identity_link_id in (
        v_adrian_id,
        v_ayin_id
      )
      or operation.recipient_identity_link_id in (
        v_adrian_id,
        v_ayin_id
      )
    ), '[]'::jsonb),

    'currency_assignments',
    coalesce((
      select jsonb_agg(
        to_jsonb(assignment)
        order by assignment.identity_link_id
      )
      from public.net_economy_identity_currency_assignments as assignment
      where assignment.identity_link_id in (
        v_adrian_id,
        v_ayin_id
      )
    ), '[]'::jsonb),

    'currency_audit',
    coalesce((
      select jsonb_agg(
        to_jsonb(audit)
        order by audit.id
      )
      from public.net_economy_identity_currency_assignment_audit as audit
      where audit.identity_link_id in (
        v_adrian_id,
        v_ayin_id
      )
    ), '[]'::jsonb)

  ) into v_financial_after;

  if v_financial_after is distinct from v_financial_before then
    raise exception
      'ALTARA_CLEANUP_POSTCONDITION_FINANCIAL_PRESERVATION_FAILED'
      using errcode = 'P0001';
  end if;

end;
$cleanup$;

commit;