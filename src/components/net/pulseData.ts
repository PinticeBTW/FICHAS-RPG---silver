export type PulseAccountKind = 'citizen' | 'official' | 'corporate' | 'anonymous'

export interface PulseAccount {
  id: string
  displayName: string
  handle: string
  bio: string
  kind: PulseAccountKind
  verified: boolean
  organisation?: string
  district?: string
  followers: number
  following: number
  pulses?: number
  viewerFollowing?: boolean
  visibility?: 'public' | 'limited'
  discoverable?: boolean
  avatarUrl?: string
}

export type PulseMediaKind = 'city' | 'signal' | 'incident' | 'chart'

export interface PulseMedia {
  kind: PulseMediaKind
  label: string
}

export interface PulsePostData {
  id: string
  /** Present only for durable rows in public.net_pulse_posts. */
  serverPostId?: string
  /** Authoritative database timestamp for durable PULSE ordering only. */
  serverCreatedAt?: string
  authorId: string
  content: string
  minutesAgo: number
  createdLabel: string
  district?: string
  breaking?: boolean
  corrupted?: boolean
  media?: PulseMedia
  quotedPostId?: string
  replyToPostId?: string
  hashtags?: string[]
  heat: number
  replies: number
  boosts: number
  reactions: number
  reactedByMe?: boolean
  boostedByMe?: boolean
  bookmarkedByMe?: boolean
  viewerFollowsAuthor?: boolean
  followedBoosterAccountId?: string
  followedBoosterHandle?: string
  followingActivityAt?: string
  mentions?: readonly {
    accountId: string
    sourceHandle: string
    currentHandle: string
  }[]
}

export interface PulseTrend {
  id: string
  topic: string
  pulses: number
  heat: number
  district?: string
}

export interface PulseDistrictHeat {
  id: string
  name: string
  heat: number
}

export const SELF_ACCOUNT_ID = 'self'

function formatAgo(minutesAgo: number): string {
  if (minutesAgo < 1) return 'NOW'
  if (minutesAgo < 60) return `${minutesAgo}M`
  return `${Math.round(minutesAgo / 60)}H`
}

export function formatPulseCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  }

  return `${value}`
}

export const pulseAccounts: PulseAccount[] = [
  {
    id: 'adrian',
    displayName: 'Adrian',
    handle: 'adrian',
    bio: "Rooftop signals, night shifts, and things I probably shouldn't post.",
    kind: 'citizen',
    verified: false,
    district: 'Neon Row',
    followers: 8400,
    following: 212,
  },
  {
    id: 'maya',
    displayName: 'Maya',
    handle: 'maya',
    bio: 'Old Quarter archivist. I remember what the city forgets.',
    kind: 'citizen',
    verified: false,
    district: 'Old Quarter',
    followers: 5200,
    following: 340,
  },
  {
    id: 'voxnet',
    displayName: 'VOX NET Official',
    handle: 'VoxNet',
    bio: 'The pulse of New Vega. Owned and ranked by VOX NET.',
    kind: 'corporate',
    verified: true,
    organisation: 'VOX NET',
    followers: 4_200_000,
    following: 12,
  },
  {
    id: 'lucid',
    displayName: 'Lucid Interactive',
    handle: 'lucid',
    bio: 'We build ECHO. Resonance is a right, not a privilege.',
    kind: 'corporate',
    verified: true,
    organisation: 'Lucid Interactive',
    followers: 990_000,
    following: 58,
  },
  {
    id: 'netwatch',
    displayName: 'NetWatch',
    handle: 'netwatch',
    bio: 'Identity and security enforcement for the New Vega grid.',
    kind: 'official',
    verified: true,
    organisation: 'NetWatch',
    district: 'District 11',
    followers: 2_100_000,
    following: 2,
  },
  {
    id: 'nvn',
    displayName: 'NVN',
    handle: 'NVN',
    bio: 'New Vega News. First on the grid, first on the ground.',
    kind: 'corporate',
    verified: true,
    organisation: 'NVN',
    followers: 3_400_000,
    following: 88,
  },
  {
    id: 'ghost',
    displayName: 'Ghost in the Net',
    handle: 'ghost_in_the_net',
    bio: 'nothing here is real. everything here is true.',
    kind: 'anonymous',
    verified: false,
    followers: 61_000,
    following: 3,
  },
  {
    id: 'nvps',
    displayName: 'New Vega Public Safety',
    handle: 'NVPS',
    bio: 'Official public safety notices for New Vega districts.',
    kind: 'official',
    verified: true,
    organisation: 'NVPS',
    followers: 2_700_000,
    following: 1,
  },
]

type PulsePostSeed = Omit<PulsePostData, 'createdLabel'>

const postSeeds: PulsePostSeed[] = [
  {
    id: 'p-district04-surge',
    authorId: 'nvps',
    content:
      'Power surge reported across District 04 substations. Residents are advised to avoid open relay junctions until NetWatch clears the sector.',
    minutesAgo: 4,
    district: 'District 04',
    breaking: true,
    hashtags: ['District04'],
    heat: 88,
    replies: 312,
    boosts: 940,
    reactions: 1200,
  },
  {
    id: 'p-adrian-mock',
    authorId: 'adrian',
    content:
      '"avoid open relay junctions" is doing a LOT of lifting in that sentence, NVPS. what actually happened?',
    minutesAgo: 3,
    replyToPostId: 'p-district04-surge',
    heat: 34,
    replies: 18,
    boosts: 12,
    reactions: 260,
  },
  {
    id: 'p-explosion-industrial',
    authorId: 'nvn',
    content:
      'BREAKING: Fire crews responding to an explosion at a warehouse in the eastern Industrial District. Cause unknown. NVN has a crew en route.',
    minutesAgo: 6,
    district: 'Industrial District',
    breaking: true,
    media: { kind: 'incident', label: 'INCIDENT FEED // EASTERN INDUSTRIAL' },
    hashtags: ['Industrial'],
    heat: 96,
    replies: 540,
    boosts: 1800,
    reactions: 2600,
  },
  {
    id: 'p-lucid-echo-update',
    authorId: 'lucid',
    content:
      'ECHO Resonance Layer 2.3 is live: sharper Chain Echo decryption and lower drop-off on Dead Echo recovery. Resonate responsibly.',
    minutesAgo: 80,
    media: { kind: 'signal', label: 'ECHO // PATCH 2.3' },
    hashtags: ['ECHO', 'Resonance'],
    heat: 52,
    replies: 44,
    boosts: 210,
    reactions: 1900,
  },
  {
    id: 'p-netwatch-warning',
    authorId: 'netwatch',
    content:
      'Security notice: unverified relay skins are circulating claiming to be NetWatch-signed. Do not install unsigned identity patches.',
    minutesAgo: 18,
    district: 'District 11',
    hashtags: ['NetWatch'],
    heat: 61,
    replies: 76,
    boosts: 320,
    reactions: 540,
  },
  {
    id: 'p-maya-old-quarter',
    authorId: 'maya',
    content:
      "something's off at Platform 06 tonight. lights cycling on their own, no maintenance logged. anyone else near Old Quarter seeing this?",
    minutesAgo: 34,
    district: 'Old Quarter',
    hashtags: ['OldQuarter'],
    heat: 58,
    replies: 91,
    boosts: 60,
    reactions: 410,
  },
  {
    id: 'p-ghost-coverup',
    authorId: 'ghost',
    content:
      "they logged the District 04 surge as 'maintenance'. maintenance doesn't need a NetWatch containment perimeter. ask why nobody's saying the word MESH.",
    minutesAgo: 12,
    quotedPostId: 'p-district04-surge',
    hashtags: ['District04'],
    heat: 74,
    replies: 205,
    boosts: 480,
    reactions: 890,
  },
  {
    id: 'p-ghost-corrupted',
    authorId: 'ghost',
    content: '[SIGNAL LOST // PARTIAL RECOVERY] ...they never turn off the—',
    minutesAgo: 27,
    corrupted: true,
    heat: 45,
    replies: 133,
    boosts: 90,
    reactions: 300,
  },
  {
    id: 'p-adrian-neon-row',
    authorId: 'adrian',
    content:
      'Neon Row after 2AM hits different. new mural on Rooftop 31, whoever did it — respect.',
    minutesAgo: 41,
    district: 'Neon Row',
    media: { kind: 'city', label: 'ROOFTOP 31 // NEON ROW' },
    hashtags: ['NeonRow'],
    heat: 66,
    replies: 22,
    boosts: 140,
    reactions: 1100,
  },
  {
    id: 'p-maya-surveillance',
    authorId: 'maya',
    content:
      "NetWatch wants 'temporary' relay logging in Old Quarter. we all know how temporary that turns out to be.",
    minutesAgo: 52,
    district: 'Old Quarter',
    hashtags: ['Surveillance', 'OldQuarter'],
    heat: 70,
    replies: 188,
    boosts: 260,
    reactions: 730,
  },
  {
    id: 'p-netwatch-reply-surveillance',
    authorId: 'netwatch',
    content:
      'Logging is scoped, time-limited, and reviewed by New Vega civic compliance. Full policy is public record.',
    minutesAgo: 50,
    replyToPostId: 'p-maya-surveillance',
    heat: 40,
    replies: 64,
    boosts: 30,
    reactions: 180,
  },
  {
    id: 'p-nvn-resonance-spike',
    authorId: 'nvn',
    content:
      'Unexplained resonance spike registered city-wide around 03:00. Lucid Interactive has not commented.',
    minutesAgo: 2,
    hashtags: ['Resonance'],
    heat: 80,
    replies: 97,
    boosts: 410,
    reactions: 620,
  },
  {
    id: 'p-voxnet-trend-notice',
    authorId: 'voxnet',
    content:
      '#District04 is trending city-wide. VOX NET ranks Pulses by heat, verification, and network reach.',
    minutesAgo: 22,
    media: { kind: 'chart', label: 'CITY HEAT // #District04' },
    hashtags: ['District04'],
    heat: 91,
    replies: 15,
    boosts: 88,
    reactions: 340,
  },
]

export const pulsePosts: PulsePostData[] = postSeeds.map((seed) => ({
  ...seed,
  createdLabel: formatAgo(seed.minutesAgo),
}))

export const pulseTrends: PulseTrend[] = [
  { id: 'district04', topic: 'District04', pulses: 12_400, heat: 91, district: 'District 04' },
  { id: 'resonance', topic: 'Resonance', pulses: 8_300, heat: 82 },
  { id: 'neonrow', topic: 'NeonRow', pulses: 6_100, heat: 74, district: 'Neon Row' },
  { id: 'surveillance', topic: 'Surveillance', pulses: 4_200, heat: 63, district: 'Old Quarter' },
  { id: 'echo', topic: 'ECHO', pulses: 3_100, heat: 55 },
]

export const pulseDistrictHeat: PulseDistrictHeat[] = [
  { id: 'neon-row', name: 'Neon Row', heat: 74 },
  { id: 'district-04', name: 'District 04', heat: 91 },
  { id: 'old-quarter', name: 'Old Quarter', heat: 58 },
  { id: 'blackwater', name: 'Blackwater', heat: 36 },
  { id: 'central', name: 'Central', heat: 45 },
]
