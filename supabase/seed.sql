-- Run this after users have signed up at least once, so `profiles` rows already exist.
-- Replace the email addresses below with your real group members before executing.

with silver as (
  select id
  from public.profiles
  where email = 'silver@example.com'
),
campaign as (
  insert into public.campaigns (name, code_name, description, timeline, season, created_by)
  select
    'Neon Drift',
    'ND-77',
    'Private crew campaign dashboard',
    'Night cycle 6',
    'Act 2',
    silver.id
  from silver
  returning id
)
insert into public.campaign_members (campaign_id, profile_id, role, status)
select campaign.id, member.id, member.role, 'active'
from campaign
join (
  select id, case when email = 'silver@example.com' then 'gm'::public.app_role else 'player'::public.app_role end as role
  from public.profiles
  where email in (
    'silver@example.com',
    'player-one@example.com',
    'player-two@example.com',
    'player-three@example.com'
  )
) as member on true
on conflict (campaign_id, profile_id) do nothing;

-- Optional: promote Silver globally in the profile table too.
update public.profiles
set role = 'gm'
where email = 'silver@example.com';

-- Optional starter character for each non-GM member in the new campaign.
insert into public.characters (
  campaign_id,
  owner_profile_id,
  name,
  alias,
  archetype,
  biography,
  status_label
)
select
  campaign_members.campaign_id,
  profile.id,
  profile.display_name,
  profile.display_name,
  'Operator',
  'Initial character scaffold created from the Supabase seed.',
  'Awaiting calibration'
from public.campaign_members
join public.profiles as profile on profile.id = campaign_members.profile_id
where campaign_members.role = 'player'
  and profile.email in (
    'player-one@example.com',
    'player-two@example.com',
    'player-three@example.com'
  )
on conflict (campaign_id, owner_profile_id) do nothing;

insert into public.character_stats (
  character_id,
  hp_current,
  hp_max,
  ram_current,
  ram_max,
  karma,
  cyberpsychosis,
  humanity,
  armor,
  initiative,
  reflex,
  tech,
  cool,
  body,
  intelligence,
  empathy,
  luck
)
select
  characters.id,
  18,
  20,
  7,
  10,
  0,
  12,
  75,
  10,
  5,
  6,
  6,
  5,
  6,
  6,
  5,
  4
from public.characters
join public.profiles on public.profiles.id = public.characters.owner_profile_id
where public.profiles.email in (
  'player-one@example.com',
  'player-two@example.com',
  'player-three@example.com'
)
on conflict (character_id) do nothing;

insert into public.character_notes (character_id, player_journal, gm_intel, mission_log)
select
  characters.id,
  '',
  '',
  'Seeded mission log entry.'
from public.characters
join public.profiles on public.profiles.id = public.characters.owner_profile_id
where public.profiles.email in (
  'player-one@example.com',
  'player-two@example.com',
  'player-three@example.com'
)
on conflict (character_id) do nothing;
