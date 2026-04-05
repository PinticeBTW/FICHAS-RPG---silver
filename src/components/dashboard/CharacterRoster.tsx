import { Search } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Character } from '../../types/domain'
import { getCharacterVitals } from '../../lib/utils'
import { EmptyState } from '../common/EmptyState'
import { Panel } from '../common/Panel'
import { StatusBadge } from '../common/StatusBadge'

interface CharacterRosterProps {
  characters: Character[]
  title: string
  description: string
}

export function CharacterRoster({
  characters,
  title,
  description,
}: CharacterRosterProps) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const filteredCharacters = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase()

    if (!normalized) {
      return characters
    }

    return characters.filter((character) =>
      [character.name, character.alias, character.ownerName, character.ownerHandle]
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    )
  }, [characters, deferredQuery])

  return (
    <Panel title={title} eyebrow="Arquivo de operativos" description={description} className="rounded-[32px]">
      <div className="mb-5 flex items-center gap-3 border border-white/10 bg-black/25 px-4 py-3">
        <Search size={16} className="text-stone-400" />
        <input
          className="w-full bg-transparent text-sm text-white outline-none"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Procurar por alias, nome ou jogador"
        />
      </div>

      {!filteredCharacters.length ? (
        <EmptyState
          title="Sem personagens correspondentes"
          detail="Experimenta outro alias ou outro nome de jogador."
        />
      ) : (
        <div className="space-y-4">
          {filteredCharacters.map((character) => (
            <article key={character.id} className="hud-panel rounded-[24px] p-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-center gap-4">
                  <img
                    src={character.portraitUrl}
                    alt={character.alias}
                    className="h-20 w-20 bg-black object-cover"
                  />

                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-[2rem] leading-none text-white">{character.alias}</p>
                      <StatusBadge label={character.statusLabel} tone={character.alignment} />
                    </div>
                    <p className="mt-2 text-sm uppercase tracking-[0.18em] text-stone-400">
                      {character.name} / {character.ownerName}
                    </p>
                    <p className="mt-2 text-sm text-stone-300">{character.archetype}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {getCharacterVitals(character).map((entry) => (
                    <div
                      key={entry.label}
                      className="min-w-[88px] border border-white/10 bg-black/25 px-3 py-2"
                    >
                      <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">
                        {entry.label}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-white">{entry.value}</p>
                    </div>
                  ))}

                  <Link className="signal-button px-4 py-2 text-sm" to={`/app/characters/${character.id}`}>
                    Abrir ficha
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </Panel>
  )
}
