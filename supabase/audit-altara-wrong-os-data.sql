-- ALTARA wrong-OS data audit: Adrian + Ayin (Phase 1, read-only).
--
-- This is a diagnostic script, not a migration. It intentionally contains
-- only WITH/SELECT/UNION queries and catalog reads. Run it manually in the
-- Supabase SQL Editor with a role that can inspect the private/RLS-protected
-- tables. It does not call any project RPC or mutation function.
--
-- Result set 1: identity-scoped inventory and bounded review samples.
-- Result set 2: expected-table deployment manifest.
-- Result set 3: actual foreign-key/delete-action graph for cleanup planning.

with recursive
targets (
  identity_name,
  identity_link_id,
  expected_subject_kind,
  expected_subject_id,
  expected_primary_os_id,
  expected_home_currency
) as (
  values
    (
      'Adrian'::text,
      '8e7ebd04-f106-4db8-877b-bb83919406e0'::uuid,
      'npc-card'::text,
      '9f9873b5-89fd-40d5-9682-e20173b10e85'::uuid,
      'altara'::text,
      'FINIT'::text
    ),
    (
      'Ayin'::text,
      '93497f00-fdd8-4153-a1db-be811f88ef64'::uuid,
      'profile-sheet'::text,
      'ffa69533-8497-4734-8bba-ef8ccef59f21'::uuid,
      'altara'::text,
      'SECTUS'::text
    )
),
target_context as (
  select
    target.*,
    identity_link.subject_kind,
    identity_link.subject_id,
    identity_link.entity_id,
    identity_link.owner_profile_id,
    identity_link.identity_kind,
    identity_link.playability,
    os_assignment.primary_os_id,
    os_assignment.assignment_basis as os_assignment_basis,
    currency_assignment.currency_code as home_currency,
    currency_assignment.assignment_basis as currency_assignment_basis
  from targets as target
  left join public.net_identity_links as identity_link
    on identity_link.id = target.identity_link_id
  left join public.net_identity_os_assignments as os_assignment
    on os_assignment.identity_link_id = identity_link.id
  left join public.net_economy_identity_currency_assignments as currency_assignment
    on currency_assignment.identity_link_id = identity_link.id
),
veil_account_services (service_id) as (
  values ('pulse'::text), ('echo'::text), ('iden'::text), ('loop'::text)
),
veil_install_services (service_id) as (
  values
    ('pulse'::text),
    ('echo'::text),
    ('nvn'::text),
    ('vox-bank'::text),
    ('shneider-bank'::text)
),
target_app_accounts as (
  select
    context.identity_name,
    context.identity_link_id as target_identity_link_id,
    context.entity_id as target_entity_id,
    account.*,
    case
      when account.identity_link_id = context.identity_link_id
        then 'net_app_accounts.identity_link_id'
      else 'net_identity_links.entity_id -> net_app_accounts.entity_id'
    end as ownership_path
  from target_context as context
  join public.net_app_accounts as account
    on account.identity_link_id = context.identity_link_id
    or (
      context.entity_id is not null
      and account.entity_id = context.entity_id
    )
  where account.app_id in ('pulse', 'echo', 'iden', 'loop')
),
target_pulse_accounts as (
  select *
  from target_app_accounts
  where app_id = 'pulse'
),
target_pulse_account_ids as (
  select distinct id
  from target_pulse_accounts
),
target_echo_accounts as (
  select *
  from target_app_accounts
  where app_id = 'echo'
),
target_posts as (
  select
    account.identity_name,
    account.target_identity_link_id as identity_link_id,
    post.id,
    post.author_account_id,
    post.parent_post_id,
    post.body,
    post.created_at,
    post.updated_at,
    post.deleted_at,
    parent.author_account_id as parent_author_account_id
  from target_pulse_accounts as account
  join public.net_pulse_posts as post
    on post.author_account_id = account.id
  left join public.net_pulse_posts as parent
    on parent.id = post.parent_post_id
),
pulse_post_tree as (
  select
    post.identity_name,
    post.identity_link_id,
    post.id as candidate_post_id,
    post.id as member_post_id,
    post.author_account_id as member_author_account_id,
    0 as depth
  from target_posts as post

  union all

  select
    tree.identity_name,
    tree.identity_link_id,
    tree.candidate_post_id,
    child.id,
    child.author_account_id,
    tree.depth + 1
  from pulse_post_tree as tree
  join public.net_pulse_posts as child
    on child.parent_post_id = tree.member_post_id
  where tree.depth < 16
),
pulse_post_review as (
  select
    post.*,
    (
      select count(*)
      from pulse_post_tree as tree
      where tree.candidate_post_id = post.id
        and tree.depth > 0
    ) as descendant_count,
    (
      select count(*)
      from pulse_post_tree as tree
      where tree.candidate_post_id = post.id
        and tree.depth > 0
        and not exists (
          select 1
          from target_pulse_account_ids as target_account
          where target_account.id = tree.member_author_account_id
        )
    ) as external_descendant_count,
    (
      select count(*)
      from pulse_post_tree as tree
      join public.net_pulse_reactions as reaction
        on reaction.post_id = tree.member_post_id
      where tree.candidate_post_id = post.id
        and not exists (
          select 1
          from target_pulse_account_ids as target_account
          where target_account.id = reaction.account_id
        )
    ) as external_reaction_count,
    (
      select count(*)
      from pulse_post_tree as tree
      join public.net_pulse_boosts as boost
        on boost.post_id = tree.member_post_id
      where tree.candidate_post_id = post.id
        and not exists (
          select 1
          from target_pulse_account_ids as target_account
          where target_account.id = boost.account_id
        )
    ) as external_boost_count,
    (
      select count(*)
      from pulse_post_tree as tree
      join public.net_pulse_bookmarks as bookmark
        on bookmark.post_id = tree.member_post_id
      where tree.candidate_post_id = post.id
        and not exists (
          select 1
          from target_pulse_account_ids as target_account
          where target_account.id = bookmark.account_id
        )
    ) as external_bookmark_count,
    (
      select count(*)
      from pulse_post_tree as tree
      join public.net_pulse_post_mentions as mention
        on mention.post_id = tree.member_post_id
      where tree.candidate_post_id = post.id
        and not exists (
          select 1
          from target_pulse_account_ids as target_account
          where target_account.id = mention.mentioned_account_id
        )
    ) as external_mention_count,
    (
      select count(*)
      from pulse_post_tree as tree
      join public.net_pulse_notifications as notification
        on notification.post_id = tree.member_post_id
        or notification.root_post_id = tree.member_post_id
      where tree.candidate_post_id = post.id
        and (
          not exists (
            select 1
            from target_pulse_account_ids as target_account
            where target_account.id = notification.actor_account_id
          )
          or not exists (
            select 1
            from target_pulse_account_ids as target_account
            where target_account.id = notification.recipient_account_id
          )
        )
    ) as external_notification_count,
    (
      post.parent_author_account_id is not null
      and not exists (
        select 1
        from target_pulse_account_ids as target_account
        where target_account.id = post.parent_author_account_id
      )
    ) as has_external_parent
  from target_posts as post
),
ranked_pulse_posts as (
  select
    review.*,
    row_number() over (
      partition by review.identity_link_id
      order by review.created_at desc, review.id desc
    ) as review_rank
  from pulse_post_review as review
),
target_economy_accounts as (
  select
    target.identity_name,
    target.identity_link_id as target_identity_link_id,
    account.*,
    institution.institution_code,
    institution.display_name as institution_display_name,
    case
      when account.account_kind = 'wallet' and account.currency_code = 'VG'
        then 'vlt'
      when account.account_kind = 'wallet' and account.currency_code = 'KARMA'
        then 'karma'
      when account.institution_id = '00000000-0000-0000-0000-00000000e100'::uuid
        then 'vox-bank'
      when account.institution_id = '00000000-0000-0000-0000-00000000e101'::uuid
        then 'shneider-bank'
      when account.institution_id = '00000000-0000-0000-0000-00000000e102'::uuid
        then 'altara-bank'
      else 'unknown'
    end as service_id
  from targets as target
  join public.net_economy_accounts as account
    on account.identity_link_id = target.identity_link_id
  left join public.net_economy_institutions as institution
    on institution.id = account.institution_id
),
target_transaction_ids as (
  select distinct
    account.target_identity_link_id as identity_link_id,
    entry.transaction_id
  from target_economy_accounts as account
  join public.net_economy_transaction_entries as entry
    on entry.account_id = account.id
),
financial_accounts as (
  select
    account.identity_name,
    account.target_identity_link_id as identity_link_id,
    account.id as account_id,
    account.service_id,
    account.account_kind,
    account.institution_id,
    account.institution_code,
    account.institution_display_name,
    account.payment_identifier,
    account.currency_code,
    account.status,
    account.balance_amount,
    account.created_at,
    account.updated_at,
    coalesce(sum(entry.amount), 0)::bigint as ledger_sum,
    count(entry.transaction_id)::bigint as transaction_count,
    min(entry.created_at) as earliest_transaction_at,
    max(entry.created_at) as latest_transaction_at,
    realtime.revision as realtime_revision,
    realtime.updated_at as realtime_updated_at,
    case
      when account.service_id in ('vox-bank', 'shneider-bank', 'altara-bank') then exists (
        select 1
        from public.net_identity_app_installs as install
        where install.identity_link_id = account.target_identity_link_id
          and install.app_id = account.service_id
      )
      else null
    end as app_installed,
    case
      when account.service_id = 'unknown' then false
      else exists (
        select 1
        from public.net_identity_os_assignments as assignment
        join public.net_os_service_scopes as scope
          on scope.service_id = account.service_id
        left join public.net_os_families as family
          on family.id = assignment.primary_os_id
        where assignment.identity_link_id = account.target_identity_link_id
          and family.status = 'active'
          and (
            scope.scope_kind = 'global'
            or (
              scope.scope_kind = 'primary-os'
              and scope.required_os_id = assignment.primary_os_id
            )
          )
      )
    end as service_eligible
  from target_economy_accounts as account
  left join public.net_economy_transaction_entries as entry
    on entry.account_id = account.id
  left join public.net_economy_wallet_realtime_state as realtime
    on realtime.account_id = account.id
  group by
    account.identity_name,
    account.target_identity_link_id,
    account.id,
    account.service_id,
    account.account_kind,
    account.institution_id,
    account.institution_code,
    account.institution_display_name,
    account.payment_identifier,
    account.currency_code,
    account.status,
    account.balance_amount,
    account.created_at,
    account.updated_at,
    realtime.revision,
    realtime.updated_at
),
financial_expectations (
  identity_link_id,
  service_id,
  expected_currency,
  expected_balance
) as (
  values
    (
      '8e7ebd04-f106-4db8-877b-bb83919406e0'::uuid,
      'vlt'::text,
      'VG'::text,
      177::bigint
    ),
    (
      '8e7ebd04-f106-4db8-877b-bb83919406e0'::uuid,
      'vox-bank'::text,
      'VG'::text,
      291::bigint
    ),
    (
      '8e7ebd04-f106-4db8-877b-bb83919406e0'::uuid,
      'shneider-bank'::text,
      'VG'::text,
      0::bigint
    )
),
target_action_audit as (
  select distinct
    target.identity_name,
    target.identity_link_id,
    audit.*
  from targets as target
  join public.net_action_audit as audit
    on (
      audit.presented_account_id in (
        select account.id
        from target_app_accounts as account
        where account.target_identity_link_id = target.identity_link_id
      )
      or (
        audit.persona_subject_kind = target.expected_subject_kind
        and audit.persona_subject_id = target.expected_subject_id
      )
      or (
        audit.resource_type in ('pulse-post', 'net-pulse-post')
        and audit.resource_id in (
          select post.id
          from target_posts as post
          where post.identity_link_id = target.identity_link_id
        )
      )
      or (
        audit.resource_type = 'economy-transaction'
        and audit.resource_id in (
          select target_transaction.transaction_id
          from target_transaction_ids as target_transaction
          where target_transaction.identity_link_id = target.identity_link_id
        )
      )
    )
),
ranked_action_audit as (
  select
    audit.*,
    row_number() over (
      partition by audit.identity_link_id
      order by audit.created_at desc, audit.id desc
    ) as review_rank
  from target_action_audit as audit
),
inventory as (
  -- Authoritative identity, OS, currency, and stable ownership root.
  select
    10 as section_order,
    'AUTHORITY BASELINE'::text as section,
    'multi-os'::text as service,
    'net_identity_links / net_identity_os_assignments'::text as table_name,
    context.identity_name,
    context.identity_link_id,
    'fixed identity_link_id -> exact subject tuple'::text as ownership_path,
    case when context.subject_id is null then 0 else 1 end::bigint as row_count,
    jsonb_build_object(
      'expected_subject_kind', context.expected_subject_kind,
      'actual_subject_kind', context.subject_kind,
      'expected_subject_id', context.expected_subject_id,
      'actual_subject_id', context.subject_id,
      'entity_id', context.entity_id,
      'owner_profile_id', context.owner_profile_id,
      'identity_kind', context.identity_kind,
      'playability', context.playability,
      'expected_primary_os_id', context.expected_primary_os_id,
      'actual_primary_os_id', context.primary_os_id,
      'os_assignment_basis', context.os_assignment_basis,
      'expected_home_currency', context.expected_home_currency,
      'actual_home_currency', context.home_currency,
      'currency_assignment_basis', context.currency_assignment_basis,
      'authority_tuple_matches', (
        context.subject_kind = context.expected_subject_kind
        and context.subject_id = context.expected_subject_id
        and context.primary_os_id = context.expected_primary_os_id
        and context.home_currency = context.expected_home_currency
      )
    ) as important_ids,
    'Canonical identity and authority baseline; never cleanup data.'::text as content_type,
    'CITY and display names are intentionally absent from every predicate.'::text as reference_notes,
    'AUDIT_PRESERVE'::text as classification
  from target_context as context

  union all

  -- Canonical source records are shared character data, not VEIL product rows.
  select
    15,
    'SHARED SUBJECT SOURCE',
    'character data',
    'npc_cards / character_sheet_forms',
    target.identity_name,
    target.identity_link_id,
    'exact net_identity_links.subject_kind + subject_id',
    (
      case when target.expected_subject_kind = 'npc-card' then (
        select count(*) from public.npc_cards as card
        where card.id = target.expected_subject_id
      ) else 0 end
      +
      case when target.expected_subject_kind = 'profile-sheet' then (
        select count(*) from public.character_sheet_forms as sheet
        where sheet.profile_id = target.expected_subject_id
      ) else 0 end
    )::bigint,
    jsonb_build_object(
      'subject_kind', target.expected_subject_kind,
      'subject_id', target.expected_subject_id,
      'npc_card_exists', case
        when target.expected_subject_kind = 'npc-card' then exists (
          select 1 from public.npc_cards as card
          where card.id = target.expected_subject_id
        )
        else false
      end,
      'profile_sheet_exists', case
        when target.expected_subject_kind = 'profile-sheet' then exists (
          select 1 from public.character_sheet_forms as sheet
          where sheet.profile_id = target.expected_subject_id
        )
        else false
      end
    ),
    'Canonical character/NPC sheet source shared by every ecosystem.',
    'Never delete or edit as wrong-OS cleanup.',
    'SHARED_REVIEW'
  from targets as target

  union all

  -- Exact deployed VEIL service scope; eligibility is derived without calling an RPC.
  select
    20,
    'SERVICE SCOPE',
    'veil ecosystem',
    'net_os_service_scopes',
    context.identity_name,
    context.identity_link_id,
    'net_identity_os_assignments.primary_os_id -> net_os_service_scopes',
    count(scope.service_id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'service_id', scope.service_id,
          'scope_kind', scope.scope_kind,
          'required_os_id', scope.required_os_id,
          'currently_eligible', (
            scope.scope_kind = 'global'
            or scope.required_os_id = context.primary_os_id
          )
        ) order by scope.service_id
      ) filter (where scope.service_id is not null),
      '[]'::jsonb
    ),
    'Server service-scope authority, not identity-owned content.',
    'An ALTARA assignment should make every primary-os/veil service ineligible.',
    'AUDIT_PRESERVE'
  from target_context as context
  left join public.net_os_service_scopes as scope
    on scope.required_os_id = 'veil'
    or scope.service_id in (
      'pulse', 'echo', 'iden', 'vlt', 'vox-bank', 'shneider-bank',
      'nvn', 'net-store', 'veil-settings', 'loop'
    )
  group by
    context.identity_name,
    context.identity_link_id,
    context.primary_os_id

  union all

  -- VEIL app accounts, including the entity_id seed reuse path.
  select
    30,
    'APP ACCOUNTS',
    service.service_id,
    'net_app_accounts',
    target.identity_name,
    target.identity_link_id,
    'identity_link_id OR stable net_identity_links.entity_id',
    count(account.id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'account_id', account.id,
          'app_id', account.app_id,
          'ownership_path', account.ownership_path,
          'account_identity_link_id', account.identity_link_id,
          'entity_id', account.entity_id,
          'handle', account.handle,
          'status', account.status,
          'created_at', account.created_at,
          'avatar_reference_kind', case
            when account.avatar_url_override is null then 'none'
            when account.avatar_url_override like 'rpg-media:v1:%' then 'rpg-media:v1'
            when account.avatar_url_override like 'http%' then 'remote-or-signed-url'
            else 'private-or-legacy-path'
          end
        ) order by account.created_at, account.id
      ) filter (where account.id is not null),
      '[]'::jsonb
    ),
    'VEIL application account root.',
    'PULSE has RESTRICT children; ECHO signals may SET NULL; entity-owned seeds require shared-world review.',
    case
      when count(account.id) = 0 then 'NONE'
      else 'SHARED_REVIEW'
    end
  from targets as target
  cross join veil_account_services as service
  left join target_app_accounts as account
    on account.target_identity_link_id = target.identity_link_id
    and account.app_id = service.service_id
  group by
    target.identity_name,
    target.identity_link_id,
    service.service_id

  union all

  -- Optional VEIL installations. Removing these never removes finance/content.
  select
    40,
    'APP INSTALLS',
    service.service_id,
    'net_identity_app_installs',
    target.identity_name,
    target.identity_link_id,
    'net_identity_app_installs.identity_link_id',
    count(install.app_id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'app_id', install.app_id,
          'installed_at', install.installed_at,
          'updated_at', install.updated_at
        ) order by install.app_id
      ) filter (where install.app_id is not null),
      '[]'::jsonb
    ),
    'Launcher installation state only.',
    'VLT, IDEN, NET STORE and VEIL Settings are system/implicit and have no install row.',
    case
      when count(install.app_id) = 0 then 'NONE'
      else 'SAFE_SOCIAL_DELETE'
    end
  from targets as target
  cross join veil_install_services as service
  left join public.net_identity_app_installs as install
    on install.identity_link_id = target.identity_link_id
    and install.app_id = service.service_id
  group by
    target.identity_name,
    target.identity_link_id,
    service.service_id

  union all

  -- PULSE-owned public profile/preferences.
  select
    100,
    'PULSE',
    'pulse',
    'net_pulse_profiles',
    target.identity_name,
    target.identity_link_id,
    'target PULSE app-account UUID -> account_id',
    (
      select count(*)
      from public.net_pulse_profiles as profile
      join target_pulse_accounts as account on account.id = profile.account_id
      where account.target_identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'account_id', account.id,
          'visibility', profile.visibility,
          'discoverable', profile.discoverable,
          'default_feed', profile.default_feed,
          'bio_preview', left(regexp_replace(coalesce(profile.bio, ''), '[[:space:]]+', ' ', 'g'), 160),
          'created_at', profile.created_at,
          'updated_at', profile.updated_at
        ) order by account.id
      )
      from public.net_pulse_profiles as profile
      join target_pulse_accounts as account on account.id = profile.account_id
      where account.target_identity_link_id = target.identity_link_id
    ), '[]'::jsonb),
    'PULSE-owned profile/preferences.',
    'CASCADE from the app account, but account deletion is separately constrained by shared references.',
    case
      when exists (
        select 1 from public.net_pulse_profiles as profile
        join target_pulse_accounts as account on account.id = profile.account_id
        where account.target_identity_link_id = target.identity_link_id
      ) then 'SAFE_SOCIAL_DELETE'
      else 'NONE'
    end
  from targets as target

  union all

  -- Derived PULSE avatar projection is distinct from the shared media object.
  select
    101,
    'PULSE',
    'pulse',
    'net_pulse_account_presentation',
    target.identity_name,
    target.identity_link_id,
    'target PULSE app-account UUID -> account_id',
    (
      select count(*)
      from public.net_pulse_account_presentation as presentation
      join target_pulse_accounts as account on account.id = presentation.account_id
      where account.target_identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'account_id', presentation.account_id,
          'avatar_reference_kind', case
            when presentation.avatar_url is null then 'none'
            when presentation.avatar_url like 'rpg-media:v1:%' then 'rpg-media:v1'
            when presentation.avatar_url like 'http%' then 'remote-or-signed-url'
            else 'private-or-legacy-path'
          end,
          'updated_at', presentation.updated_at
        ) order by presentation.account_id
      )
      from public.net_pulse_account_presentation as presentation
      join target_pulse_accounts as account on account.id = presentation.account_id
      where account.target_identity_link_id = target.identity_link_id
    ), '[]'::jsonb),
    'Derived PULSE avatar cache; it is not ownership authority.',
    'CASCADE from the app account; deleting this row does not delete private rpg-media bytes.',
    case when exists (
      select 1
      from public.net_pulse_account_presentation as presentation
      join target_pulse_accounts as account on account.id = presentation.account_id
      where account.target_identity_link_id = target.identity_link_id
    ) then 'SAFE_SOCIAL_DELETE' else 'NONE' end
  from targets as target

  union all

  -- ECHO graph edges involving signals presented through the target account.
  select
    212,
    'ECHO',
    'echo',
    'net_echo_signal_links',
    target.identity_name,
    target.identity_link_id,
    'target source_account_id -> signal UUID -> from/to signal edge',
    (
      select count(*)
      from public.net_echo_signal_links as link
      where link.from_signal_id in (
        select signal.id
        from public.net_echo_signals as signal
        join target_echo_accounts as account on account.id = signal.source_account_id
        where account.target_identity_link_id = target.identity_link_id
      )
      or link.to_signal_id in (
        select signal.id
        from public.net_echo_signals as signal
        join target_echo_accounts as account on account.id = signal.source_account_id
        where account.target_identity_link_id = target.identity_link_id
      )
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          link.created_at,
          jsonb_build_object(
            'from_signal_id', link.from_signal_id,
            'to_signal_id', link.to_signal_id,
            'relationship_kind', link.relationship_kind,
            'label', link.label,
            'created_at', link.created_at
          ) as row_data
        from public.net_echo_signal_links as link
        where link.from_signal_id in (
          select signal.id
          from public.net_echo_signals as signal
          join target_echo_accounts as account on account.id = signal.source_account_id
          where account.target_identity_link_id = target.identity_link_id
        )
        or link.to_signal_id in (
          select signal.id
          from public.net_echo_signals as signal
          join target_echo_accounts as account on account.id = signal.source_account_id
          where account.target_identity_link_id = target.identity_link_id
        )
        order by link.created_at desc, link.from_signal_id, link.to_signal_id
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'Shared ECHO topology connected to a world signal presented through the target account.',
    'Edges CASCADE only when a signal is deleted; wrong-OS cleanup must preserve both signals and graph.',
    case when exists (
      select 1
      from public.net_echo_signal_links as link
      where link.from_signal_id in (
        select signal.id
        from public.net_echo_signals as signal
        join target_echo_accounts as account on account.id = signal.source_account_id
        where account.target_identity_link_id = target.identity_link_id
      )
      or link.to_signal_id in (
        select signal.id
        from public.net_echo_signals as signal
        join target_echo_accounts as account on account.id = signal.source_account_id
        where account.target_identity_link_id = target.identity_link_id
      )
    ) then 'SHARED_REVIEW' else 'NONE' end
  from targets as target

  union all

  -- Authored PULSE roots/replies, with 50 newest bounded previews and cross-user risk counts.
  select
    110,
    'PULSE',
    'pulse',
    'net_pulse_posts',
    target.identity_name,
    target.identity_link_id,
    'target PULSE app-account UUID -> author_account_id',
    (
      select count(*)
      from ranked_pulse_posts as post
      where post.identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'post_id', post.id,
          'parent_post_id', post.parent_post_id,
          'kind', case when post.parent_post_id is null then 'root' else 'reply' end,
          'created_at', post.created_at,
          'deleted_at', post.deleted_at,
          'body_preview', left(regexp_replace(post.body, '[[:space:]]+', ' ', 'g'), 160),
          'descendant_count', post.descendant_count,
          'external_descendant_count', post.external_descendant_count,
          'external_reaction_count', post.external_reaction_count,
          'external_boost_count', post.external_boost_count,
          'external_bookmark_count', post.external_bookmark_count,
          'external_mention_count', post.external_mention_count,
          'external_notification_count', post.external_notification_count,
          'has_external_parent', post.has_external_parent
        ) order by post.created_at desc, post.id desc
      )
      from ranked_pulse_posts as post
      where post.identity_link_id = target.identity_link_id
        and post.review_rank <= 50
    ), '[]'::jsonb),
    'Player-authored PULSE roots/replies; previews are capped at 50 and 160 characters.',
    'parent_post_id is RESTRICT; external replies/engagement/notifications must not be cascaded blindly.',
    case
      when not exists (
        select 1 from ranked_pulse_posts as post
        where post.identity_link_id = target.identity_link_id
      ) then 'NONE'
      when exists (
        select 1
        from ranked_pulse_posts as post
        where post.identity_link_id = target.identity_link_id
          and (
            post.has_external_parent
            or post.external_descendant_count > 0
            or post.external_reaction_count > 0
            or post.external_boost_count > 0
            or post.external_bookmark_count > 0
            or post.external_mention_count > 0
            or post.external_notification_count > 0
          )
      ) then 'SHARED_REVIEW'
      else 'SAFE_SOCIAL_DELETE'
    end
  from targets as target

  union all

  -- PULSE reactions initiated by the target account.
  select
    120,
    'PULSE',
    'pulse',
    'net_pulse_reactions',
    target.identity_name,
    target.identity_link_id,
    'target PULSE app-account UUID -> account_id',
    (
      select count(*)
      from public.net_pulse_reactions as reaction
      join target_pulse_accounts as account on account.id = reaction.account_id
      where account.target_identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          reaction.created_at,
          jsonb_build_object(
            'post_id', reaction.post_id,
            'account_id', reaction.account_id,
            'created_at', reaction.created_at
          ) as row_data
        from public.net_pulse_reactions as reaction
        join target_pulse_accounts as account on account.id = reaction.account_id
        where account.target_identity_link_id = target.identity_link_id
        order by reaction.created_at desc, reaction.post_id desc
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'Reaction made by Adrian/Ayin.',
    'The referenced post may belong to another user; delete only the reaction row.',
    case when exists (
      select 1
      from public.net_pulse_reactions as reaction
      join target_pulse_accounts as account on account.id = reaction.account_id
      where account.target_identity_link_id = target.identity_link_id
    ) then 'SAFE_SOCIAL_DELETE' else 'NONE' end
  from targets as target

  union all

  select
    121,
    'PULSE',
    'pulse',
    'net_pulse_boosts',
    target.identity_name,
    target.identity_link_id,
    'target PULSE app-account UUID -> account_id',
    (
      select count(*)
      from public.net_pulse_boosts as boost
      join target_pulse_accounts as account on account.id = boost.account_id
      where account.target_identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          boost.created_at,
          jsonb_build_object(
            'post_id', boost.post_id,
            'account_id', boost.account_id,
            'created_at', boost.created_at
          ) as row_data
        from public.net_pulse_boosts as boost
        join target_pulse_accounts as account on account.id = boost.account_id
        where account.target_identity_link_id = target.identity_link_id
        order by boost.created_at desc, boost.post_id desc
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'Boost/repost made by Adrian/Ayin.',
    'The original post is shared world data and must remain.',
    case when exists (
      select 1
      from public.net_pulse_boosts as boost
      join target_pulse_accounts as account on account.id = boost.account_id
      where account.target_identity_link_id = target.identity_link_id
    ) then 'SAFE_SOCIAL_DELETE' else 'NONE' end
  from targets as target

  union all

  select
    122,
    'PULSE',
    'pulse',
    'net_pulse_bookmarks',
    target.identity_name,
    target.identity_link_id,
    'target PULSE app-account UUID -> account_id',
    (
      select count(*)
      from public.net_pulse_bookmarks as bookmark
      join target_pulse_accounts as account on account.id = bookmark.account_id
      where account.target_identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          bookmark.created_at,
          jsonb_build_object(
            'post_id', bookmark.post_id,
            'account_id', bookmark.account_id,
            'created_at', bookmark.created_at
          ) as row_data
        from public.net_pulse_bookmarks as bookmark
        join target_pulse_accounts as account on account.id = bookmark.account_id
        where account.target_identity_link_id = target.identity_link_id
        order by bookmark.created_at desc, bookmark.post_id desc
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'Private bookmark state owned by Adrian/Ayin.',
    'The bookmarked post remains shared world data.',
    case when exists (
      select 1
      from public.net_pulse_bookmarks as bookmark
      join target_pulse_accounts as account on account.id = bookmark.account_id
      where account.target_identity_link_id = target.identity_link_id
    ) then 'SAFE_SOCIAL_DELETE' else 'NONE' end
  from targets as target

  union all

  -- Outgoing follows represent target use; incoming follows belong to other users.
  select
    123,
    'PULSE',
    'pulse',
    'net_pulse_follows (outgoing)',
    target.identity_name,
    target.identity_link_id,
    'target PULSE app-account UUID -> follower_account_id',
    (
      select count(*)
      from public.net_pulse_follows as follow
      join target_pulse_accounts as account on account.id = follow.follower_account_id
      where account.target_identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          follow.created_at,
          jsonb_build_object(
            'follower_account_id', follow.follower_account_id,
            'followed_account_id', follow.followed_account_id,
            'created_at', follow.created_at
          ) as row_data
        from public.net_pulse_follows as follow
        join target_pulse_accounts as account on account.id = follow.follower_account_id
        where account.target_identity_link_id = target.identity_link_id
        order by follow.created_at desc, follow.followed_account_id
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'Accounts followed by Adrian/Ayin.',
    'Delete the directed edge only; never delete the followed account.',
    case when exists (
      select 1
      from public.net_pulse_follows as follow
      join target_pulse_accounts as account on account.id = follow.follower_account_id
      where account.target_identity_link_id = target.identity_link_id
    ) then 'SAFE_SOCIAL_DELETE' else 'NONE' end
  from targets as target

  union all

  select
    124,
    'PULSE',
    'pulse',
    'net_pulse_follows (incoming)',
    target.identity_name,
    target.identity_link_id,
    'target PULSE app-account UUID -> followed_account_id',
    (
      select count(*)
      from public.net_pulse_follows as follow
      join target_pulse_accounts as account on account.id = follow.followed_account_id
      where account.target_identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          follow.created_at,
          jsonb_build_object(
            'follower_account_id', follow.follower_account_id,
            'followed_account_id', follow.followed_account_id,
            'created_at', follow.created_at
          ) as row_data
        from public.net_pulse_follows as follow
        join target_pulse_accounts as account on account.id = follow.followed_account_id
        where account.target_identity_link_id = target.identity_link_id
        order by follow.created_at desc, follow.follower_account_id
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'Other accounts following Adrian/Ayin.',
    'This is another user''s social action; do not delete automatically.',
    case when exists (
      select 1
      from public.net_pulse_follows as follow
      join target_pulse_accounts as account on account.id = follow.followed_account_id
      where account.target_identity_link_id = target.identity_link_id
    ) then 'SHARED_REVIEW' else 'NONE' end
  from targets as target

  union all

  -- Mentions authored by the target versus world content mentioning the target.
  select
    130,
    'PULSE',
    'pulse',
    'net_pulse_post_mentions (in target-authored posts)',
    target.identity_name,
    target.identity_link_id,
    'target authored post UUID -> post_id',
    (
      select count(*)
      from public.net_pulse_post_mentions as mention
      join target_posts as post on post.id = mention.post_id
      where post.identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          mention.created_at,
          jsonb_build_object(
            'post_id', mention.post_id,
            'mentioned_account_id', mention.mentioned_account_id,
            'source_handle', mention.source_handle,
            'created_at', mention.created_at
          ) as row_data
        from public.net_pulse_post_mentions as mention
        join target_posts as post on post.id = mention.post_id
        where post.identity_link_id = target.identity_link_id
        order by mention.created_at desc, mention.post_id desc
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'Recognised mentions authored inside Adrian/Ayin content.',
    'CASCADE with the post, but references another account and therefore needs content review.',
    case when exists (
      select 1
      from public.net_pulse_post_mentions as mention
      join target_posts as post on post.id = mention.post_id
      where post.identity_link_id = target.identity_link_id
    ) then 'SHARED_REVIEW' else 'NONE' end
  from targets as target

  union all

  select
    131,
    'PULSE',
    'pulse',
    'net_pulse_post_mentions (target mentioned)',
    target.identity_name,
    target.identity_link_id,
    'target PULSE app-account UUID -> mentioned_account_id',
    (
      select count(*)
      from public.net_pulse_post_mentions as mention
      join target_pulse_accounts as account
        on account.id = mention.mentioned_account_id
      where account.target_identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          mention.created_at,
          jsonb_build_object(
            'post_id', mention.post_id,
            'mentioned_account_id', mention.mentioned_account_id,
            'source_handle', mention.source_handle,
            'created_at', mention.created_at
          ) as row_data
        from public.net_pulse_post_mentions as mention
        join target_pulse_accounts as account
          on account.id = mention.mentioned_account_id
        where account.target_identity_link_id = target.identity_link_id
        order by mention.created_at desc, mention.post_id desc
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'World/other-user posts mentioning Adrian/Ayin.',
    'Do not delete another author''s post or mention automatically.',
    case when exists (
      select 1
      from public.net_pulse_post_mentions as mention
      join target_pulse_accounts as account
        on account.id = mention.mentioned_account_id
      where account.target_identity_link_id = target.identity_link_id
    ) then 'SHARED_REVIEW' else 'NONE' end
  from targets as target

  union all

  -- Private inbox is target-owned; actor rows delivered to others are shared.
  select
    140,
    'PULSE',
    'pulse',
    'net_pulse_notifications (recipient)',
    target.identity_name,
    target.identity_link_id,
    'target PULSE app-account UUID -> recipient_account_id',
    (
      select count(*)
      from public.net_pulse_notifications as notification
      join target_pulse_accounts as account
        on account.id = notification.recipient_account_id
      where account.target_identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          notification.created_at,
          jsonb_build_object(
            'notification_id', notification.id,
            'type', notification.notification_type,
            'actor_account_id', notification.actor_account_id,
            'post_id', notification.post_id,
            'root_post_id', notification.root_post_id,
            'created_at', notification.created_at,
            'read_at', notification.read_at
          ) as row_data
        from public.net_pulse_notifications as notification
        join target_pulse_accounts as account
          on account.id = notification.recipient_account_id
        where account.target_identity_link_id = target.identity_link_id
        order by notification.created_at desc, notification.id desc
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'Private PULSE inbox owned by Adrian/Ayin.',
    'Rows RESTRICT account/post deletion and require explicit child cleanup.',
    case when exists (
      select 1
      from public.net_pulse_notifications as notification
      join target_pulse_accounts as account
        on account.id = notification.recipient_account_id
      where account.target_identity_link_id = target.identity_link_id
    ) then 'SAFE_SOCIAL_DELETE' else 'NONE' end
  from targets as target

  union all

  select
    141,
    'PULSE',
    'pulse',
    'net_pulse_notifications (actor)',
    target.identity_name,
    target.identity_link_id,
    'target PULSE app-account UUID -> actor_account_id',
    (
      select count(*)
      from public.net_pulse_notifications as notification
      join target_pulse_accounts as account
        on account.id = notification.actor_account_id
      where account.target_identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          notification.created_at,
          jsonb_build_object(
            'notification_id', notification.id,
            'type', notification.notification_type,
            'recipient_account_id', notification.recipient_account_id,
            'post_id', notification.post_id,
            'root_post_id', notification.root_post_id,
            'created_at', notification.created_at,
            'read_at', notification.read_at
          ) as row_data
        from public.net_pulse_notifications as notification
        join target_pulse_accounts as account
          on account.id = notification.actor_account_id
        where account.target_identity_link_id = target.identity_link_id
        order by notification.created_at desc, notification.id desc
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'System-created rows delivered to other users because Adrian/Ayin acted.',
    'Belongs to another account''s inbox; preserve until shared-reference review.',
    case when exists (
      select 1
      from public.net_pulse_notifications as notification
      join target_pulse_accounts as account
        on account.id = notification.actor_account_id
      where account.target_identity_link_id = target.identity_link_id
    ) then 'SHARED_REVIEW' else 'NONE' end
  from targets as target

  union all

  -- ECHO private account state. GM grants are kept distinct from user discovery/save state.
  select
    200,
    'ECHO',
    'echo',
    'net_echo_account_signal_state',
    target.identity_name,
    target.identity_link_id,
    'target ECHO app-account UUID -> account_id',
    (
      select count(*)
      from public.net_echo_account_signal_state as state
      join target_echo_accounts as account on account.id = state.account_id
      where account.target_identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.updated_at desc)
      from (
        select
          state.updated_at,
          jsonb_build_object(
            'account_id', state.account_id,
            'signal_id', state.signal_id,
            'granted_at', state.granted_at,
            'discovered_at', state.discovered_at,
            'saved_at', state.saved_at,
            'updated_at', state.updated_at,
            'row_classification', case
              when state.granted_at is not null then 'SHARED_REVIEW'
              else 'SAFE_SOCIAL_DELETE'
            end
          ) as row_data
        from public.net_echo_account_signal_state as state
        join target_echo_accounts as account on account.id = state.account_id
        where account.target_identity_link_id = target.identity_link_id
        order by state.updated_at desc, state.signal_id desc
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'Private grant/discovery/save state.',
    'CASCADE from app account; rows with granted_at also encode an authoritative GM grant.',
    case
      when not exists (
        select 1
        from public.net_echo_account_signal_state as state
        join target_echo_accounts as account on account.id = state.account_id
        where account.target_identity_link_id = target.identity_link_id
      ) then 'NONE'
      when exists (
        select 1
        from public.net_echo_account_signal_state as state
        join target_echo_accounts as account on account.id = state.account_id
        where account.target_identity_link_id = target.identity_link_id
          and state.granted_at is not null
      ) then 'SHARED_REVIEW'
      else 'SAFE_SOCIAL_DELETE'
    end
  from targets as target

  union all

  -- ECHO signals are GM-curated world data; source_account_id is presentation only.
  select
    210,
    'ECHO',
    'echo',
    'net_echo_signals (source account)',
    target.identity_name,
    target.identity_link_id,
    'target ECHO app-account UUID -> source_account_id',
    (
      select count(*)
      from public.net_echo_signals as signal
      join target_echo_accounts as account on account.id = signal.source_account_id
      where account.target_identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          signal.created_at,
          jsonb_build_object(
            'signal_id', signal.id,
            'kind', signal.kind,
            'status', signal.status,
            'title_preview', left(signal.title, 120),
            'source_account_id', signal.source_account_id,
            'created_at', signal.created_at
          ) as row_data
        from public.net_echo_signals as signal
        join target_echo_accounts as account on account.id = signal.source_account_id
        where account.target_identity_link_id = target.identity_link_id
        order by signal.created_at desc, signal.id desc
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'GM-curated shared signal using the account as optional presentation source.',
    'Never delete the signal. Account deletion would SET NULL source_account_id and preserve source_label.',
    case when exists (
      select 1
      from public.net_echo_signals as signal
      join target_echo_accounts as account on account.id = signal.source_account_id
      where account.target_identity_link_id = target.identity_link_id
    ) then 'SHARED_REVIEW' else 'NONE' end
  from targets as target

  union all

  -- Stable UUID references in ECHO world data, independent of account source.
  select
    211,
    'ECHO',
    'echo',
    'net_echo_signals (stable resource reference)',
    target.identity_name,
    target.identity_link_id,
    'primary_reference_resource_id = identity_link_id OR subject_id (text)',
    (
      select count(*)
      from public.net_echo_signals as signal
      where signal.primary_reference_resource_id in (
        target.identity_link_id::text,
        target.expected_subject_id::text
      )
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          signal.created_at,
          jsonb_build_object(
            'signal_id', signal.id,
            'status', signal.status,
            'title_preview', left(signal.title, 120),
            'reference_app_id', signal.primary_reference_app_id,
            'reference_kind', signal.primary_reference_resource_kind,
            'reference_id', signal.primary_reference_resource_id,
            'created_at', signal.created_at
          ) as row_data
        from public.net_echo_signals as signal
        where signal.primary_reference_resource_id in (
          target.identity_link_id::text,
          target.expected_subject_id::text
        )
        order by signal.created_at desc, signal.id desc
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'Shared world signal referring to the stable identity/subject UUID.',
    'Descriptive cross-app references are never ownership; preserve the signal.',
    case when exists (
      select 1
      from public.net_echo_signals as signal
      where signal.primary_reference_resource_id in (
        target.identity_link_id::text,
        target.expected_subject_id::text
      )
    ) then 'SHARED_REVIEW' else 'NONE' end
  from targets as target

  union all

  -- IDEN has no separate credential/trust/event persistence in this repository.
  select
    300,
    'IDEN',
    'iden',
    '(no dedicated IDEN state table)',
    target.identity_name,
    target.identity_link_id,
    'IDEN account is inventoried through net_app_accounts',
    0::bigint,
    jsonb_build_object(
      'dedicated_iden_tables_found', false,
      'shared_profile_table', 'net_universal_profiles',
      'source_sheet_is_canonical', true
    ),
    'IDEN UI projects app-account, universal-profile and source-sheet data.',
    'Do not delete the character sheet or shared universal profile as VEIL cleanup.',
    'NONE'
  from targets as target

  union all

  -- Shared universal profile is cross-app and must not be mistaken for IDEN-only state.
  select
    310,
    'SHARED PROFILE',
    'cross-app',
    'net_universal_profiles',
    target.identity_name,
    target.identity_link_id,
    'net_universal_profiles.identity_link_id',
    count(profile.identity_link_id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'identity_link_id', profile.identity_link_id,
          'has_display_name_override', profile.display_name_override is not null,
          'has_bio', profile.bio is not null,
          'has_status', profile.status is not null,
          'avatar_reference_kind', case
            when profile.avatar_url_override is null then 'none'
            when profile.avatar_url_override like 'rpg-media:v1:%' then 'rpg-media:v1'
            when profile.avatar_url_override like 'http%' then 'remote-or-signed-url'
            else 'private-or-legacy-path'
          end,
          'updated_at', profile.updated_at
        )
      ) filter (where profile.identity_link_id is not null),
      '[]'::jsonb
    ),
    'Shared THE NET presentation used outside IDEN.',
    'Preserve; removal could break ALTARA presentation and avatars.',
    case when count(profile.identity_link_id) = 0 then 'NONE' else 'SHARED_REVIEW' end
  from targets as target
  left join public.net_universal_profiles as profile
    on profile.identity_link_id = target.identity_link_id
  group by target.identity_name, target.identity_link_id

  union all

  -- NVN has no identity-owned reader state; only stable world references are reported.
  select
    400,
    'NVN',
    'nvn',
    '(no identity-owned NVN reader-state table)',
    target.identity_name,
    target.identity_link_id,
    'repository schema audit',
    0::bigint,
    jsonb_build_object(
      'articles_are_world_data', true,
      'article_media_is_world_data', true,
      'incidents_are_world_data', true,
      'radio_is_global', true
    ),
    'NVN articles/media/incidents/radio are GM/world state, not player interaction state.',
    'Only the optional NVN app-install row is identity-owned.',
    'NONE'
  from targets as target

  union all

  select
    410,
    'NVN',
    'nvn',
    'net_nvn_articles (stable resource reference)',
    target.identity_name,
    target.identity_link_id,
    'primary_reference_resource_id = identity_link_id OR subject_id (text)',
    (
      select count(*)
      from public.net_nvn_articles as article
      where article.primary_reference_resource_id in (
        target.identity_link_id::text,
        target.expected_subject_id::text
      )
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          article.created_at,
          jsonb_build_object(
            'article_id', article.id,
            'slug', article.slug,
            'status', article.status,
            'headline_preview', left(article.headline, 160),
            'reference_app_id', article.primary_reference_app_id,
            'reference_kind', article.primary_reference_resource_kind,
            'reference_id', article.primary_reference_resource_id,
            'media_count', (
              select count(*)
              from public.net_nvn_article_media as media
              where media.article_id = article.id
            ),
            'created_at', article.created_at
          ) as row_data
        from public.net_nvn_articles as article
        where article.primary_reference_resource_id in (
          target.identity_link_id::text,
          target.expected_subject_id::text
        )
        order by article.created_at desc, article.id desc
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'World/newsroom content that refers to Adrian/Ayin through a stable UUID.',
    'Never delete an article or its media merely because the referenced identity moved OS.',
    case when exists (
      select 1
      from public.net_nvn_articles as article
      where article.primary_reference_resource_id in (
        target.identity_link_id::text,
        target.expected_subject_id::text
      )
    ) then 'SHARED_REVIEW' else 'NONE' end
  from targets as target

  union all

  -- NET STORE, VEIL Settings and LOOP have no additional identity state here.
  select
    500,
    'OTHER VEIL PRODUCTS',
    product.service_id,
    product.table_name,
    target.identity_name,
    target.identity_link_id,
    product.ownership_path,
    0::bigint,
    product.details,
    product.content_type,
    product.reference_notes,
    'NONE'
  from targets as target
  cross join (
    values
      (
        'net-store'::text,
        '(no identity-owned NET STORE table)'::text,
        'system application; no install/account row'::text,
        jsonb_build_object('catalogue_is_global', true),
        'Store catalogue is shared product data.'::text,
        'Do not delete catalogue rows; none are identity-owned.'::text
      ),
      (
        'veil-settings'::text,
        'net_identity_system_profiles (shared backend)'::text,
        'identity_link_id; inventoried separately below'::text,
        jsonb_build_object('separate_veil_preferences_table_found', false),
        'Wallpaper profile is a neutral shared OS backend.'::text,
        'Do not treat shared wallpaper state as VEIL-only.'::text
      ),
      (
        'loop'::text,
        '(no LOOP state table)'::text,
        'optional net_app_accounts row only'::text,
        jsonb_build_object('loop_product_implemented', false),
        'LOOP has no persisted product implementation.'::text,
        'Any legacy app account is already inventoried in net_app_accounts.'::text
      )
  ) as product(
    service_id,
    table_name,
    ownership_path,
    details,
    content_type,
    reference_notes
  )

  union all

  -- Shared per-identity wallpaper metadata; preserve for ALTARA Settings.
  select
    510,
    'SHARED SYSTEM PROFILE',
    'veil-settings / altara-settings',
    'net_identity_system_profiles',
    target.identity_name,
    target.identity_link_id,
    'net_identity_system_profiles.identity_link_id',
    count(profile.identity_link_id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'identity_link_id', profile.identity_link_id,
          'wallpaper_path', profile.wallpaper_path,
          'wallpaper_preset_id', profile.wallpaper_preset_id,
          'wallpaper_fit', profile.wallpaper_fit,
          'wallpaper_position', profile.wallpaper_position,
          'updated_at', profile.updated_at
        )
      ) filter (where profile.identity_link_id is not null),
      '[]'::jsonb
    ),
    'Neutral per-identity wallpaper presentation used by both OS-native settings UIs.',
    'Preserve: ALTARA custom wallpaper persistence depends on this same row.',
    case when count(profile.identity_link_id) = 0 then 'NONE' else 'SHARED_REVIEW' end
  from targets as target
  left join public.net_identity_system_profiles as profile
    on profile.identity_link_id = target.identity_link_id
  group by target.identity_name, target.identity_link_id

  union all

  -- Private wallpaper objects. Details are bounded to 25 per identity.
  select
    511,
    'SHARED SYSTEM PROFILE',
    'veil-settings / altara-settings',
    'storage.objects (net-wallpapers)',
    target.identity_name,
    target.identity_link_id,
    'bucket_id + first path segment = identity_link_id',
    (
      select count(*)
      from storage.objects as object
      where object.bucket_id = 'net-wallpapers'
        and split_part(object.name, '/', 1) = target.identity_link_id::text
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          object.created_at,
          jsonb_build_object(
            'object_id', object.id,
            'object_name', object.name,
            'created_at', object.created_at,
            'updated_at', object.updated_at,
            'mime_type', object.metadata ->> 'mimetype',
            'size', object.metadata ->> 'size'
          ) as row_data
        from storage.objects as object
        where object.bucket_id = 'net-wallpapers'
          and split_part(object.name, '/', 1) = target.identity_link_id::text
        order by object.created_at desc, object.id desc
        limit 25
      ) as detail
    ), '[]'::jsonb),
    'Private wallpaper bytes/metadata shared by VEIL and ALTARA settings authority.',
    'Never delete as wrong-OS data without checking the currently selected ALTARA wallpaper path.',
    case when exists (
      select 1
      from storage.objects as object
      where object.bucket_id = 'net-wallpapers'
        and split_part(object.name, '/', 1) = target.identity_link_id::text
    ) then 'SHARED_REVIEW' else 'NONE' end
  from targets as target

  union all

  -- Shared rpg-media objects reachable through the exact subject, identity or
  -- VEIL app-account keys. These bytes may also back ALTARA/GM/sheet avatars.
  select
    512,
    'SHARED MEDIA',
    'rpg-media',
    'storage.objects (rpg-media)',
    target.identity_name,
    target.identity_link_id,
    'exact subject/identity/app-account Storage path prefix',
    (
      select count(*)
      from storage.objects as object
      where object.bucket_id = 'rpg-media'
        and (
          (
            split_part(object.name, '/', 1) = target.expected_subject_kind
            and split_part(object.name, '/', 2) = target.expected_subject_id::text
          )
          or (
            split_part(object.name, '/', 1) in ('identity-link', 'universal-profile')
            and split_part(object.name, '/', 2) = target.identity_link_id::text
          )
          or (
            split_part(object.name, '/', 1) = 'app-account'
            and split_part(object.name, '/', 2) in (
              select account.id::text
              from target_app_accounts as account
              where account.target_identity_link_id = target.identity_link_id
            )
          )
        )
    )::bigint,
    coalesce((
      select jsonb_agg(detail.row_data order by detail.created_at desc)
      from (
        select
          object.created_at,
          jsonb_build_object(
            'object_id', object.id,
            'object_name', object.name,
            'created_at', object.created_at,
            'updated_at', object.updated_at,
            'mime_type', object.metadata ->> 'mimetype',
            'size', object.metadata ->> 'size'
          ) as row_data
        from storage.objects as object
        where object.bucket_id = 'rpg-media'
          and (
            (
              split_part(object.name, '/', 1) = target.expected_subject_kind
              and split_part(object.name, '/', 2) = target.expected_subject_id::text
            )
            or (
              split_part(object.name, '/', 1) in ('identity-link', 'universal-profile')
              and split_part(object.name, '/', 2) = target.identity_link_id::text
            )
            or (
              split_part(object.name, '/', 1) = 'app-account'
              and split_part(object.name, '/', 2) in (
                select account.id::text
                from target_app_accounts as account
                where account.target_identity_link_id = target.identity_link_id
              )
            )
          )
        order by object.created_at desc, object.id desc
        limit 50
      ) as detail
    ), '[]'::jsonb),
    'Private optimized media potentially shared by sheets, PULSE, GM and ALTARA presentation.',
    'Never delete from an app-data cleanup solely because the path was reached through a VEIL account.',
    case when exists (
      select 1
      from storage.objects as object
      where object.bucket_id = 'rpg-media'
        and (
          (
            split_part(object.name, '/', 1) = target.expected_subject_kind
            and split_part(object.name, '/', 2) = target.expected_subject_id::text
          )
          or (
            split_part(object.name, '/', 1) in ('identity-link', 'universal-profile')
            and split_part(object.name, '/', 2) = target.identity_link_id::text
          )
          or (
            split_part(object.name, '/', 1) = 'app-account'
            and split_part(object.name, '/', 2) in (
              select account.id::text
              from target_app_accounts as account
              where account.target_identity_link_id = target.identity_link_id
            )
          )
        )
    ) then 'SHARED_REVIEW' else 'NONE' end
  from targets as target

  union all

  -- Generic active-identity rows are user session state, not VEIL app data.
  select
    520,
    'SHARED SESSION STATE',
    'multi-os',
    'net_active_identities',
    target.identity_name,
    target.identity_link_id,
    'net_active_identities.identity_link_id',
    count(active_identity.profile_id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'profile_id', active_identity.profile_id,
          'updated_at', active_identity.updated_at
        )
      ) filter (where active_identity.profile_id is not null),
      '[]'::jsonb
    ),
    'Current active-character selection for a real authenticated profile.',
    'Preserve; deleting it changes login/session selection rather than VEIL product data.',
    case when count(active_identity.profile_id) = 0 then 'NONE' else 'SHARED_REVIEW' end
  from targets as target
  left join public.net_active_identities as active_identity
    on active_identity.identity_link_id = target.identity_link_id
  group by target.identity_name, target.identity_link_id

  union all

  -- Current GM control/inspect rows can refer to a target subject but are not owned by it.
  select
    521,
    'SHARED SESSION STATE',
    'gm-control',
    'net_gm_persona_sessions',
    target.identity_name,
    target.identity_link_id,
    'exact subject_kind + subject_id',
    count(session.gm_profile_id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'gm_profile_id', session.gm_profile_id,
          'mode', session.mode,
          'subject_kind', session.subject_kind,
          'subject_id', session.subject_id,
          'session_generation', to_jsonb(session) ->> 'session_generation',
          'updated_at', session.updated_at
        )
      ) filter (where session.gm_profile_id is not null),
      '[]'::jsonb
    ),
    'Current GM session targeting the subject.',
    'Never delete as social cleanup; end it through the explicit GM control flow if needed.',
    case when count(session.gm_profile_id) = 0 then 'NONE' else 'SHARED_REVIEW' end
  from targets as target
  left join public.net_gm_persona_sessions as session
    on session.subject_kind = target.expected_subject_kind
    and session.subject_id = target.expected_subject_id
  group by target.identity_name, target.identity_link_id

  union all

  -- Derived GM directory presentation; not app data or authority.
  select
    522,
    'SHARED PRESENTATION',
    'gm-directory',
    'net_gm_identity_directory_summaries',
    target.identity_name,
    target.identity_link_id,
    'exact subject_kind + subject_id',
    count(summary.subject_id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'subject_kind', summary.subject_kind,
          'subject_id', summary.subject_id,
          'owner_profile_id', summary.owner_profile_id,
          'has_avatar', summary.avatar_url is not null,
          'source_updated_at', summary.source_updated_at,
          'refreshed_at', summary.refreshed_at
        )
      ) filter (where summary.subject_id is not null),
      '[]'::jsonb
    ),
    'Derived private GM directory projection.',
    'Preserve or allow its normal refresh trigger to manage it; never treat as product ownership.',
    case when count(summary.subject_id) = 0 then 'NONE' else 'SHARED_REVIEW' end
  from targets as target
  left join public.net_gm_identity_directory_summaries as summary
    on summary.subject_kind = target.expected_subject_kind
    and summary.subject_id = target.expected_subject_id
  group by target.identity_name, target.identity_link_id

  union all

  -- PULSE rate-limit rows are keyed by real auth actor, not fictional identity.
  select
    530,
    'PULSE',
    'pulse',
    'net_pulse_rate_limits',
    context.identity_name,
    context.identity_link_id,
    'net_identity_links.owner_profile_id -> actor_profile_id (non-exclusive)',
    count(rate_limit.action_class)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'actor_profile_id', rate_limit.actor_profile_id,
          'action_class', rate_limit.action_class,
          'short_count', rate_limit.short_count,
          'long_count', rate_limit.long_count,
          'updated_at', rate_limit.updated_at
        ) order by rate_limit.action_class
      ) filter (where rate_limit.action_class is not null),
      '[]'::jsonb
    ),
    'Compact abuse budget for the authenticated actor profile.',
    'A profile may control multiple identities; this is not safe identity-owned cleanup.',
    case when count(rate_limit.action_class) = 0 then 'NONE' else 'SHARED_REVIEW' end
  from target_context as context
  left join public.net_pulse_rate_limits as rate_limit
    on rate_limit.actor_profile_id = context.owner_profile_id
  group by context.identity_name, context.identity_link_id

  union all

  -- The PULSE invalidation row is one global/shared singleton, never identity data.
  select
    540,
    'PULSE',
    'pulse',
    'net_pulse_realtime_state',
    target.identity_name,
    target.identity_link_id,
    'shared singleton last_account_id metadata only',
    (
      select count(*)
      from public.net_pulse_realtime_state as realtime
      where to_jsonb(realtime) ->> 'last_account_id' in (
        select account.id::text
        from target_pulse_accounts as account
        where account.target_identity_link_id = target.identity_link_id
      )
    )::bigint,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'channel', realtime.channel,
          'revision', realtime.revision,
          'notification_revision', to_jsonb(realtime) ->> 'notification_revision',
          'last_account_id', to_jsonb(realtime) ->> 'last_account_id',
          'updated_at', realtime.updated_at
        )
      )
      from public.net_pulse_realtime_state as realtime
      where to_jsonb(realtime) ->> 'last_account_id' in (
        select account.id::text
        from target_pulse_accounts as account
        where account.target_identity_link_id = target.identity_link_id
      )
    ), '[]'::jsonb),
    'Transient global invalidation metadata; not content ownership.',
    'Never delete/reset the singleton for one identity. Later mutations naturally overwrite last_* metadata.',
    case when exists (
      select 1
      from public.net_pulse_realtime_state as realtime
      where to_jsonb(realtime) ->> 'last_account_id' in (
        select account.id::text
        from target_pulse_accounts as account
        where account.target_identity_link_id = target.identity_link_id
      )
    ) then 'SHARED_REVIEW' else 'NONE' end
  from targets as target

  union all

  -- Audit ledger includes PULSE, persona and economy resources. Always preserve.
  select
    600,
    'AUDIT',
    'cross-app',
    'net_action_audit',
    target.identity_name,
    target.identity_link_id,
    'presented app account OR exact persona subject OR target post/transaction resource UUID',
    (
      select count(*)
      from ranked_action_audit as audit
      where audit.identity_link_id = target.identity_link_id
    )::bigint,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'audit_id', audit.id,
          'presented_account_id', audit.presented_account_id,
          'persona_subject_kind', audit.persona_subject_kind,
          'persona_subject_id', audit.persona_subject_id,
          'action_mode', audit.action_mode,
          'action_type', audit.action_type,
          'authorization_basis', audit.authorization_basis,
          'resource_type', audit.resource_type,
          'resource_id', audit.resource_id,
          'created_at', audit.created_at
        ) order by audit.created_at desc, audit.id desc
      )
      from ranked_action_audit as audit
      where audit.identity_link_id = target.identity_link_id
        and audit.review_rank <= 50
    ), '[]'::jsonb),
    'Immutable/security-relevant action history; sample capped at 50.',
    'Never delete as wrong-OS cleanup.',
    case when exists (
      select 1
      from ranked_action_audit as audit
      where audit.identity_link_id = target.identity_link_id
    ) then 'AUDIT_PRESERVE' else 'NONE' end
  from targets as target

  union all

  -- Per-account financial inventory: cached balance, ledger sum and activity range.
  select
    700,
    'FINANCIAL',
    account.service_id,
    'net_economy_accounts + ledger',
    account.identity_name,
    account.identity_link_id,
    'net_economy_accounts.identity_link_id -> entries.account_id -> transactions.id',
    1::bigint,
    jsonb_build_object(
      'account_id', account.account_id,
      'account_kind', account.account_kind,
      'institution_id', account.institution_id,
      'institution_code', account.institution_code,
      'institution_display_name', account.institution_display_name,
      'payment_identifier', account.payment_identifier,
      'currency_code', account.currency_code,
      'status', account.status,
      'cached_balance', account.balance_amount,
      'ledger_sum', account.ledger_sum,
      'ledger_matches_cache', account.balance_amount = account.ledger_sum,
      'transaction_count', account.transaction_count,
      'earliest_transaction_at', account.earliest_transaction_at,
      'latest_transaction_at', account.latest_transaction_at,
      'currently_service_eligible', account.service_eligible,
      'currently_app_installed', account.app_installed,
      'runtime_state', case
        when account.status <> 'active' then 'CLOSED_HISTORY'
        when account.service_eligible then 'ACTIVE_ELIGIBLE'
        else 'DORMANT_WRONG_OS'
      end,
      'realtime_revision', account.realtime_revision,
      'realtime_updated_at', account.realtime_updated_at,
      'created_at', account.created_at,
      'updated_at', account.updated_at
    ),
    'Immutable ledger-backed financial account.',
    'Never delete accounts, entries, transactions, realtime rows, bank state or audit in Phase 1.',
    'FINANCIAL_PRESERVE'
  from financial_accounts as account

  union all

  -- Explicit check of the known Adrian live balances. Ayin remains discovery-only.
  select
    710,
    'FINANCIAL EXPECTATION',
    expectation.service_id,
    'net_economy_accounts + ledger',
    target.identity_name,
    target.identity_link_id,
    'fixed reviewed expectation -> stable identity/account shape',
    count(account.account_id)::bigint,
    jsonb_build_object(
      'expected_currency', expectation.expected_currency,
      'expected_balance', expectation.expected_balance,
      'matching_account_count', count(account.account_id),
      'actual_balances', coalesce(
        jsonb_agg(account.balance_amount order by account.account_id)
          filter (where account.account_id is not null),
        '[]'::jsonb
      ),
      'actual_ledger_sums', coalesce(
        jsonb_agg(account.ledger_sum order by account.account_id)
          filter (where account.account_id is not null),
        '[]'::jsonb
      ),
      'result', case
        when count(account.account_id) = 1
          and max(account.balance_amount) = expectation.expected_balance
          and max(account.ledger_sum) = expectation.expected_balance
          then 'MATCH'
        when count(account.account_id) = 0 then 'ABSENT'
        else 'DIFF_REVIEW_REQUIRED'
      end
    ),
    'Production expectation supplied for Adrian.',
    'A mismatch blocks future destructive cleanup but is never corrected by this audit.',
    'FINANCIAL_PRESERVE'
  from financial_expectations as expectation
  join targets as target on target.identity_link_id = expectation.identity_link_id
  left join financial_accounts as account
    on account.identity_link_id = expectation.identity_link_id
    and account.service_id = expectation.service_id
    and account.currency_code = expectation.expected_currency
    and (
      expectation.service_id <> 'vlt'
      or account.account_kind = 'wallet'
    )
  group by
    expectation.service_id,
    expectation.expected_currency,
    expectation.expected_balance,
    target.identity_name,
    target.identity_link_id

  union all

  -- VOX yield state is private account state and remains financial history.
  select
    720,
    'FINANCIAL',
    'vox-bank',
    'net_economy_vox_bank_state',
    target.identity_name,
    target.identity_link_id,
    'target VOX account UUID -> account_id',
    (
      select count(*)
      from public.net_economy_vox_bank_state as state
      join target_economy_accounts as account on account.id = state.account_id
      where account.target_identity_link_id = target.identity_link_id
        and account.service_id = 'vox-bank'
    )::bigint,
    coalesce((
      select jsonb_agg(to_jsonb(state) order by state.account_id)
      from public.net_economy_vox_bank_state as state
      join target_economy_accounts as account on account.id = state.account_id
      where account.target_identity_link_id = target.identity_link_id
        and account.service_id = 'vox-bank'
    ), '[]'::jsonb),
    'VOX yield anchor/principal state.',
    'Financial state; preserve even while VOX is dormant under ALTARA OS.',
    case when exists (
      select 1
      from public.net_economy_vox_bank_state as state
      join target_economy_accounts as account on account.id = state.account_id
      where account.target_identity_link_id = target.identity_link_id
        and account.service_id = 'vox-bank'
    ) then 'FINANCIAL_PRESERVE' else 'NONE' end
  from targets as target

  union all

  -- Legacy adoption/correction maps remain immutable financial provenance.
  select
    730,
    'FINANCIAL',
    'altara-bank legacy correction',
    'net_economy_altara_bank_adoptions',
    target.identity_name,
    target.identity_link_id,
    'identity_link_id',
    count(adoption.identity_link_id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'source_wallet_account_id', adoption.source_wallet_account_id,
          'eligible_amount', adoption.eligible_amount,
          'captured_at', adoption.captured_at,
          'destination_bank_account_id', adoption.destination_bank_account_id,
          'adoption_transaction_id', adoption.adoption_transaction_id,
          'adopted_at', adoption.adopted_at
        )
      ) filter (where adoption.identity_link_id is not null),
      '[]'::jsonb
    ),
    'Immutable legacy VG adoption provenance.',
    'Preserve even though future ALTARA banking uses local currencies.',
    case when count(adoption.identity_link_id) = 0 then 'NONE' else 'FINANCIAL_PRESERVE' end
  from targets as target
  left join public.net_economy_altara_bank_adoptions as adoption
    on adoption.identity_link_id = target.identity_link_id
  group by target.identity_name, target.identity_link_id

  union all

  select
    731,
    'FINANCIAL',
    'altara-bank local currency transition',
    'net_economy_altara_bank_multicurrency_transitions',
    target.identity_name,
    target.identity_link_id,
    'identity_link_id',
    count(transition.identity_link_id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'legacy_vg_bank_account_id', transition.legacy_vg_bank_account_id,
          'new_bank_account_id', transition.new_bank_account_id,
          'new_currency_code', transition.new_currency_code,
          'adoption_transaction_id', transition.adoption_transaction_id,
          'correction_transaction_id', transition.correction_transaction_id,
          'corrected_vg_amount', transition.corrected_vg_amount,
          'transitioned_at', transition.transitioned_at
        )
      ) filter (where transition.identity_link_id is not null),
      '[]'::jsonb
    ),
    'Immutable map linking closed legacy VG and active local-currency accounts.',
    'Preserve; this proves the compensating VG correction and opening intent.',
    case when count(transition.identity_link_id) = 0 then 'NONE' else 'FINANCIAL_PRESERVE' end
  from targets as target
  left join public.net_economy_altara_bank_multicurrency_transitions as transition
    on transition.identity_link_id = target.identity_link_id
  group by target.identity_name, target.identity_link_id

  union all

  select
    732,
    'FINANCIAL',
    'altara-bank FX',
    'net_economy_altara_bank_fx_operations',
    target.identity_name,
    target.identity_link_id,
    'sender_identity_link_id OR recipient_identity_link_id',
    count(operation.id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'operation_id', operation.id,
          'sender_identity_link_id', operation.sender_identity_link_id,
          'recipient_identity_link_id', operation.recipient_identity_link_id,
          'sender_account_id', operation.sender_account_id,
          'recipient_account_id', operation.recipient_account_id,
          'source_currency_code', operation.source_currency_code,
          'target_currency_code', operation.target_currency_code,
          'source_amount', operation.source_amount,
          'target_amount', operation.target_amount,
          'source_transaction_id', operation.source_transaction_id,
          'target_transaction_id', operation.target_transaction_id,
          'rate_revision', operation.rate_revision,
          'created_at', operation.created_at
        ) order by operation.created_at desc, operation.id desc
      ) filter (where operation.id is not null),
      '[]'::jsonb
    ),
    'ALTARA cross-currency financial operation.',
    'ALTARA data, not a cleanup candidate; both linked balanced transactions must remain.',
    case when count(operation.id) = 0 then 'NONE' else 'FINANCIAL_PRESERVE' end
  from targets as target
  left join public.net_economy_altara_bank_fx_operations as operation
    on operation.sender_identity_link_id = target.identity_link_id
    or operation.recipient_identity_link_id = target.identity_link_id
  group by target.identity_name, target.identity_link_id

  union all

  -- Currency assignment audit is authority history, not removable product data.
  select
    740,
    'AUDIT',
    'altara-bank currency authority',
    'net_economy_identity_currency_assignment_audit',
    target.identity_name,
    target.identity_link_id,
    'identity_link_id',
    count(audit.id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'audit_id', audit.id,
          'previous_currency_code', audit.previous_currency_code,
          'assigned_currency_code', audit.assigned_currency_code,
          'reason', audit.reason,
          'assigned_by_profile_id', audit.assigned_by_profile_id,
          'created_at', audit.created_at
        ) order by audit.created_at desc, audit.id desc
      ) filter (where audit.id is not null),
      '[]'::jsonb
    ),
    'Authoritative local-currency assignment history.',
    'Preserve permanently.',
    case when count(audit.id) = 0 then 'NONE' else 'AUDIT_PRESERVE' end
  from targets as target
  left join public.net_economy_identity_currency_assignment_audit as audit
    on audit.identity_link_id = target.identity_link_id
  group by target.identity_name, target.identity_link_id
)
select
  inventory.section,
  inventory.service,
  inventory.table_name,
  inventory.identity_name as identity,
  inventory.identity_link_id,
  inventory.ownership_path,
  inventory.row_count,
  inventory.important_ids,
  inventory.content_type,
  inventory.reference_notes,
  inventory.classification
from inventory
order by
  inventory.section_order,
  inventory.identity_name,
  inventory.service,
  inventory.table_name;

-- Result set 2: verify that every repository-discovered table expected by this
-- audit exists in the deployed database. Any exists=false result blocks Phase 2.
with expected_tables (service, schema_name, table_name) as (
  values
    ('shared'::text, 'public'::text, 'net_identity_links'::text),
    ('shared', 'public', 'npc_cards'),
    ('shared', 'public', 'character_sheet_forms'),
    ('shared', 'public', 'net_identity_os_assignments'),
    ('shared', 'public', 'net_os_service_scopes'),
    ('shared', 'public', 'net_app_accounts'),
    ('shared', 'public', 'net_identity_app_installs'),
    ('shared', 'public', 'net_identity_system_profiles'),
    ('shared', 'public', 'net_universal_profiles'),
    ('shared', 'public', 'net_active_identities'),
    ('shared', 'public', 'net_gm_persona_sessions'),
    ('shared', 'public', 'net_gm_identity_directory_summaries'),
    ('audit', 'public', 'net_action_audit'),
    ('pulse', 'public', 'net_pulse_profiles'),
    ('pulse', 'public', 'net_pulse_account_presentation'),
    ('pulse', 'public', 'net_pulse_posts'),
    ('pulse', 'public', 'net_pulse_reactions'),
    ('pulse', 'public', 'net_pulse_boosts'),
    ('pulse', 'public', 'net_pulse_bookmarks'),
    ('pulse', 'public', 'net_pulse_follows'),
    ('pulse', 'public', 'net_pulse_post_mentions'),
    ('pulse', 'public', 'net_pulse_notifications'),
    ('pulse', 'public', 'net_pulse_rate_limits'),
    ('pulse', 'public', 'net_pulse_realtime_state'),
    ('echo', 'public', 'net_echo_signals'),
    ('echo', 'public', 'net_echo_signal_links'),
    ('echo', 'public', 'net_echo_account_signal_state'),
    ('nvn', 'public', 'net_nvn_articles'),
    ('nvn', 'public', 'net_nvn_article_media'),
    ('nvn', 'public', 'net_nvn_incidents'),
    ('nvn', 'public', 'net_nvn_incident_updates'),
    ('nvn', 'public', 'net_nvn_radio_clips'),
    ('nvn', 'public', 'net_nvn_radio_station'),
    ('nvn', 'public', 'net_nvn_realtime_state'),
    ('economy', 'public', 'net_economy_accounts'),
    ('economy', 'public', 'net_economy_transactions'),
    ('economy', 'public', 'net_economy_transaction_entries'),
    ('economy', 'public', 'net_economy_wallet_realtime_state'),
    ('economy', 'public', 'net_economy_institutions'),
    ('economy', 'public', 'net_economy_vox_bank_state'),
    ('economy', 'public', 'net_economy_altara_bank_adoptions'),
    ('economy', 'public', 'net_economy_altara_bank_multicurrency_transitions'),
    ('economy', 'public', 'net_economy_altara_bank_fx_operations'),
    ('economy', 'public', 'net_economy_identity_currency_assignments'),
    ('economy', 'public', 'net_economy_identity_currency_assignment_audit'),
    ('wallpaper', 'storage', 'objects')
)
select
  expected.service,
  expected.schema_name,
  expected.table_name,
  to_regclass(format('%I.%I', expected.schema_name, expected.table_name)) is not null
    as exists_in_database
from expected_tables as expected
order by expected.service, expected.schema_name, expected.table_name;

-- Result set 3: actual FK/delete-action graph. Phase 2 must use these deployed
-- constraints, not assumptions from ORM/frontend behavior.
with relevant_tables (table_name) as (
  values
    ('net_identity_links'::text),
    ('npc_cards'),
    ('character_sheet_forms'),
    ('net_app_accounts'),
    ('net_identity_app_installs'),
    ('net_identity_system_profiles'),
    ('net_universal_profiles'),
    ('net_active_identities'),
    ('net_gm_persona_sessions'),
    ('net_gm_identity_directory_summaries'),
    ('net_action_audit'),
    ('net_pulse_profiles'),
    ('net_pulse_account_presentation'),
    ('net_pulse_posts'),
    ('net_pulse_reactions'),
    ('net_pulse_boosts'),
    ('net_pulse_bookmarks'),
    ('net_pulse_follows'),
    ('net_pulse_post_mentions'),
    ('net_pulse_notifications'),
    ('net_pulse_rate_limits'),
    ('net_echo_signals'),
    ('net_echo_signal_links'),
    ('net_echo_account_signal_state'),
    ('net_nvn_articles'),
    ('net_nvn_article_media'),
    ('net_nvn_incidents'),
    ('net_nvn_incident_updates'),
    ('net_nvn_radio_clips'),
    ('net_nvn_radio_station'),
    ('net_economy_accounts'),
    ('net_economy_transactions'),
    ('net_economy_transaction_entries'),
    ('net_economy_wallet_realtime_state'),
    ('net_economy_vox_bank_state'),
    ('net_economy_altara_bank_adoptions'),
    ('net_economy_altara_bank_multicurrency_transitions'),
    ('net_economy_altara_bank_fx_operations'),
    ('net_economy_identity_currency_assignments'),
    ('net_economy_identity_currency_assignment_audit')
)
select
  child_namespace.nspname as child_schema,
  child.relname as child_table,
  constraint_row.conname as constraint_name,
  parent_namespace.nspname as parent_schema,
  parent.relname as parent_table,
  pg_get_constraintdef(constraint_row.oid, true) as definition,
  case constraint_row.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else constraint_row.confdeltype::text
  end as on_delete
from pg_catalog.pg_constraint as constraint_row
join pg_catalog.pg_class as child
  on child.oid = constraint_row.conrelid
join pg_catalog.pg_namespace as child_namespace
  on child_namespace.oid = child.relnamespace
join pg_catalog.pg_class as parent
  on parent.oid = constraint_row.confrelid
join pg_catalog.pg_namespace as parent_namespace
  on parent_namespace.oid = parent.relnamespace
where constraint_row.contype = 'f'
  and child_namespace.nspname = 'public'
  and parent_namespace.nspname = 'public'
  and (
    child.relname in (select table_name from relevant_tables)
    or parent.relname in (select table_name from relevant_tables)
  )
order by
  parent_namespace.nspname,
  parent.relname,
  child_namespace.nspname,
  child.relname,
  constraint_row.conname;
