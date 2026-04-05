import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  type EditableField,
  EditableListSection,
} from '../components/character/EditableListSection'
import { EmptyState } from '../components/common/EmptyState'
import { MetricCard } from '../components/common/MetricCard'
import { Panel } from '../components/common/Panel'
import { CyberwareDeck } from '../components/cyberware/CyberwareDeck'
import { DashboardHero } from '../components/dashboard/DashboardHero'
import { useAuth } from '../hooks/useAuth'
import { useCampaign } from '../hooks/useCampaign'
import { createEmptyCyberware } from '../lib/constants'
import type { CyberwareItem } from '../types/domain'

const cyberwareFields: EditableField<CyberwareItem>[] = [
  { key: 'name', label: 'Implante', type: 'text' },
  {
    key: 'slot',
    label: 'Zona',
    type: 'select',
    options: [
      { label: 'Cabeca', value: 'head' },
      { label: 'Optica', value: 'optic' },
      { label: 'Sistema nervoso', value: 'nervous' },
      { label: 'Torso', value: 'torso' },
      { label: 'Braco esquerdo', value: 'left arm' },
      { label: 'Braco direito', value: 'right arm' },
      { label: 'Pernas', value: 'legs' },
    ],
  },
  { key: 'tier', label: 'Nivel', type: 'text' },
  { key: 'cost', label: 'Custo', type: 'text' },
  { key: 'stability', label: 'Estabilidade', type: 'number', min: -10, max: 10 },
  { key: 'effect', label: 'Efeito', type: 'textarea' },
  { key: 'notes', label: 'Notas', type: 'textarea' },
]

export function CyberwarePage() {
  const { profile } = useAuth()
  const { characters, error, updateCollectionItem, removeCollectionItem } = useCampaign()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const availableCharacters = useMemo(() => {
    if (!profile) {
      return []
    }

    return profile.role === 'gm'
      ? characters
      : characters.filter((entry) => entry.ownerProfileId === profile.id)
  }, [characters, profile])

  const character =
    availableCharacters.find((entry) => entry.id === selectedId) ?? availableCharacters[0] ?? null

  if (!profile) {
    return <Navigate to="/" replace />
  }

  if (error) {
    return <EmptyState title="Cyberware indisponivel" detail={error} />
  }

  if (!character) {
    return (
      <EmptyState
        title="Sem personagem disponivel"
        detail="Liga uma personagem antes de abrir esta pagina."
      />
    )
  }

  const totalStability = character.cyberware.reduce(
    (accumulator, item) => accumulator + item.stability,
    0,
  )

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="Cyberware"
        title={`Cyberware de ${character.alias}`}
        description="Vista simples dos implantes, zonas do corpo e estabilidade."
        tone={character.alignment}
        aside={
          <div className="grid w-full gap-3 md:grid-cols-2 xl:grid-cols-1">
            <MetricCard
              label="Implantes"
              value={String(character.cyberware.length)}
              detail="Sistemas instalados"
              tone="gray"
            />
            <MetricCard
              label="Estabilidade"
              value={`${totalStability > 0 ? '+' : ''}${totalStability}`}
              detail="Soma total da estabilidade"
              tone={totalStability < 0 ? 'red' : totalStability > 0 ? 'blue' : 'gray'}
            />
          </div>
        }
      />

      {profile.role === 'gm' ? (
        <Panel
          title="Personagem"
          eyebrow="Selecao do GM"
          description="Troca entre personagens para ver ou editar implantes."
          className="rounded-[30px]"
        >
          <div className="flex flex-wrap gap-3">
            {availableCharacters.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`px-4 py-2 text-sm transition ${
                  entry.id === character.id
                    ? 'signal-button'
                    : 'border border-white/10 bg-black/25 text-stone-200'
                }`}
                onClick={() => setSelectedId(entry.id)}
              >
                {entry.alias}
              </button>
            ))}
          </div>
        </Panel>
      ) : null}

      <CyberwareDeck character={character} />

      <EditableListSection
        title="Lista de cyberware"
        eyebrow="Registo"
        description="Lista simples para editar implantes, zonas e notas."
        items={character.cyberware}
        fields={cyberwareFields}
        emptyTitle="Sem implantes"
        emptyDetail="Adiciona o primeiro implante para preencher o mapa do corpo."
        canEdit={profile.role === 'gm'}
        onSave={(item) => updateCollectionItem('cyberware', character.id, item)}
        onDelete={(itemId) => removeCollectionItem('cyberware', character.id, itemId)}
        createItem={createEmptyCyberware}
      />
    </div>
  )
}
