import { Link } from 'react-router-dom'
import type { Character } from '../../types/domain'
import { buildAttributeSummary, formatTimestamp, getCharacterVitals } from '../../lib/utils'
import { MetricCard } from '../common/MetricCard'
import { Panel } from '../common/Panel'
import { StatusBadge } from '../common/StatusBadge'

interface CharacterHeaderProps {
  character: Character
}

export function CharacterHeader({ character }: CharacterHeaderProps) {
  const attributes = buildAttributeSummary(character.stats)

  return (
    <Panel className="rounded-[32px]">
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="flex flex-col gap-6 md:flex-row">
          <img
            src={character.portraitUrl}
            alt={character.alias}
            className="h-48 w-full rounded-[28px] object-cover md:h-56 md:w-48"
          />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge label={character.statusLabel} tone={character.alignment} />
              <StatusBadge
                label={
                  character.allowPlayerStatEdits
                    ? 'Atributos editaveis pelo jogador'
                    : 'Atributos bloqueados pelo GM'
                }
                tone={character.allowPlayerStatEdits ? 'blue' : 'gray'}
              />
            </div>
            <h2 className="mt-4 text-4xl font-semibold text-white">{character.alias}</h2>
            <p className="mt-2 text-sm uppercase tracking-[0.28em] text-slate-400">
              {character.name} - {character.archetype}
            </p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              {character.biography}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-slate-400">
              <span>Dono: {character.ownerName}</span>
              <span>Ultima atualizacao: {formatTimestamp(character.updatedAt)}</span>
              <Link className="text-cyan-200 transition hover:text-cyan-100" to="/app/cyberware">
                Abrir cyberware
              </Link>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {getCharacterVitals(character).map((entry) => (
              <MetricCard
                key={entry.label}
                label={entry.label}
                value={entry.value}
                progress={entry.percent}
                tone={entry.tone}
              />
            ))}
          </div>

          <div className="rounded-[26px] border border-white/10 bg-white/[0.03] p-4">
            <p className="panel-title">Atributos base</p>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {attributes.map((attribute) => (
                <div key={attribute.key} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
                    {attribute.label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-white">{attribute.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  )
}
