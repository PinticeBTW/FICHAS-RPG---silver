import { Grid3X3, Shield, UserRound, Wrench, Zap } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { Character, Profile } from '../../types/domain'
import { cn } from '../../lib/utils'
import { StatusBadge } from './StatusBadge'

interface SidebarProps {
  profile: Profile
  character: Character | null
}

function buildPreviewRows(profile: Profile, character: Character | null) {
  if (character?.sheet?.info?.length) {
    return character.sheet.info
      .filter((entry) => entry.value && entry.value !== '-')
      .slice(0, 6)
  }

  return [
    { label: 'Nome', value: profile.displayName },
    { label: 'Handle', value: profile.handle },
    { label: 'Email', value: profile.email },
    { label: 'Papel', value: profile.role === 'gm' ? 'Silver / GM' : 'Jogador' },
  ]
}

export function Sidebar({ profile, character }: SidebarProps) {
  const links =
    profile.role === 'gm'
      ? [
          { to: '/app/gm', label: 'Arquivo GM', icon: Shield },
          { to: '/app/player', label: 'Vista jogador', icon: UserRound },
        ]
      : [{ to: '/app/player', label: 'Terminal', icon: Grid3X3 }]

  const shared = [
    { to: '/app/cyberware', label: 'Cyberware', icon: Wrench },
    { to: '/app/characters/me', label: 'Ficha', icon: Zap },
  ]
  const previewRows = buildPreviewRows(profile, character)
  const previewStats = character
    ? [
        { label: 'HP', value: `${character.stats.hpCurrent}/${character.stats.hpMax}` },
        { label: 'RAM', value: `${character.stats.ramCurrent}/${character.stats.ramMax}` },
        {
          label: 'Karma',
          value: `${character.stats.karma > 0 ? '+' : ''}${character.stats.karma}`,
        },
        { label: 'Psicose', value: `${character.stats.cyberpsychosis}%` },
      ]
    : [
        { label: 'HP', value: '--' },
        { label: 'RAM', value: '--' },
        { label: 'Karma', value: '--' },
        { label: 'Psicose', value: '--' },
      ]

  return (
    <aside className="hud-panel sticky top-6 hidden h-[calc(100vh-3rem)] min-w-[340px] rounded-[30px] p-5 xl:block">
      <div>
        <p className="panel-title">Ficha lateral</p>
        <p className="mt-3 sheet-title">{character?.alias ?? profile.displayName}</p>
        <p className="mt-2 text-sm leading-7 text-stone-300">
          {character?.name ?? 'Arquivo pessoal em espera de campanha.'}
        </p>
      </div>

      <div className="ghost-divider mt-6" />

      <div className="sheet-frame mt-5 rounded-[24px] p-3">
        <div className="sheet-grid rounded-[18px] p-3">
          <div className="sheet-cell grid min-h-[200px] overflow-hidden">
            <div className="grid h-full md:grid-cols-[105px_1fr]">
              <div className="flex items-center justify-center border-b border-white/10 bg-black/35 p-3 md:border-b-0 md:border-r md:border-white/10">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={profile.displayName}
                    className="h-full min-h-[120px] w-full object-cover"
                  />
                ) : (
                  <div className="sheet-kicker text-stone-500">Sem retrato</div>
                )}
              </div>

              <div className="grid gap-px bg-white/10 p-px">
                {previewRows.map((entry) => (
                  <div key={entry.label} className="sheet-cell px-3 py-2.5">
                    <p className="sheet-kicker">{entry.label}</p>
                    <p className="mt-1 sheet-value">{entry.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            {previewStats.map((entry) => (
              <div key={entry.label} className="sheet-cell px-3 py-3">
                <p className="sheet-kicker">{entry.label}</p>
                <p className="mt-2 sheet-subtitle">{entry.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <StatusBadge
              label={profile.role === 'gm' ? 'Acesso GM' : 'Acesso jogador'}
              tone="gray"
            />
          </div>
        </div>
      </div>

      <nav className="mt-6 space-y-2">
        {[...links, ...shared].map((link) => {
          const Icon = link.icon

          return (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn('sheet-nav-link', isActive && 'border-[#f3e600]/80 bg-[#f3e600]/9 text-white')
              }
            >
              <span className="flex items-center gap-3">
                <Icon size={16} />
                <span>{link.label}</span>
              </span>
              <span className="font-mono text-[10px]">/</span>
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
