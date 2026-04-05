import type { Character, CyberwareItem } from '../../types/domain'
import { slotLabels } from '../../lib/constants'
import { cn } from '../../lib/utils'
import { Panel } from '../common/Panel'
import { StatusBadge } from '../common/StatusBadge'

interface CyberwareDeckProps {
  character: Character
}

const alignmentLabels: Record<Character['alignment'], string> = {
  blue: 'Azul',
  red: 'Vermelho',
  gray: 'Cinzento',
}

const slotNames: Record<(typeof slotLabels)[number], string> = {
  head: 'Cabeca',
  optic: 'Optica',
  nervous: 'Sistema nervoso',
  torso: 'Torso',
  'left arm': 'Braco esquerdo',
  'right arm': 'Braco direito',
  legs: 'Pernas',
}

function groupBySlot(items: CyberwareItem[]) {
  return slotLabels.map((slot) => ({
    slot,
    items: items.filter((item) => item.slot === slot),
  }))
}

export function CyberwareDeck({ character }: CyberwareDeckProps) {
  const groups = groupBySlot(character.cyberware)
  const toneMap = {
    blue: 'drop-shadow-[0_0_18px_rgba(51,215,255,0.34)]',
    red: 'drop-shadow-[0_0_18px_rgba(255,75,99,0.34)]',
    gray: 'drop-shadow-[0_0_18px_rgba(139,149,167,0.26)]',
  }

  return (
    <Panel
      title="Mapa de cyberware"
      eyebrow="Corpo"
      description="Vista simples do corpo com os implantes distribuidos a volta."
      tone={character.alignment}
      className="rounded-[32px]"
    >
      <div className="grid gap-4 xl:grid-cols-[1fr_420px_1fr]">
        <div className="space-y-4">
          {groups.slice(0, 3).map((group) => (
            <SlotCard key={group.slot} slot={slotNames[group.slot]} items={group.items} />
          ))}
        </div>

        <div className="rounded-[30px] border border-white/10 bg-black/20 p-5">
          <div className="flex items-center justify-between">
            <p className="panel-title">Alinhamento</p>
            <StatusBadge
              label={alignmentLabels[character.alignment]}
              tone={character.alignment}
            />
          </div>

          <div className="relative mt-6 flex h-[520px] items-center justify-center overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(51,215,255,0.10),transparent_24%),rgba(6,10,18,0.92)]">
            <div
              className={cn(
                'absolute h-60 w-60 rounded-full bg-white/3 blur-3xl',
                character.alignment === 'blue' && 'bg-cyan-300/10',
                character.alignment === 'red' && 'bg-rose-300/10',
              )}
            />
            <svg
              viewBox="0 0 180 420"
              className={cn('relative h-[420px] w-[180px] text-white/80', toneMap[character.alignment])}
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="90" cy="40" r="26" stroke="currentColor" strokeWidth="3" />
              <path
                d="M65 85H115V150H65V85ZM55 150H125L133 240H47L55 150ZM70 240L62 400M110 240L118 400M32 155L55 232M148 155L125 232"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="90" cy="120" r="6" fill="currentColor" />
              <circle cx="58" cy="200" r="5" fill="currentColor" />
              <circle cx="122" cy="200" r="5" fill="currentColor" />
              <circle cx="90" cy="215" r="5" fill="currentColor" />
              <circle cx="72" cy="320" r="5" fill="currentColor" />
              <circle cx="108" cy="320" r="5" fill="currentColor" />
            </svg>
          </div>
        </div>

        <div className="space-y-4">
          {groups.slice(3).map((group) => (
            <SlotCard key={group.slot} slot={slotNames[group.slot]} items={group.items} />
          ))}
        </div>
      </div>
    </Panel>
  )
}

function SlotCard({
  slot,
  items,
}: {
  slot: string
  items: CyberwareItem[]
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="panel-title">{slot}</p>
        <span className="text-xs uppercase tracking-[0.24em] text-slate-500">
          {items.length} instalad{items.length === 1 ? 'o' : 'os'}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {!items.length ? (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500">
            Sem implantes.
          </div>
        ) : (
          items.map((item) => (
            <article key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-white">{item.name}</p>
                <StatusBadge label={item.tier} tone="gray" />
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">{item.effect}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.22em] text-slate-500">
                <span>{item.cost}</span>
                <span>Estabilidade {item.stability > 0 ? '+' : ''}{item.stability}</span>
              </div>
              {item.notes ? <p className="mt-3 text-sm text-slate-400">{item.notes}</p> : null}
            </article>
          ))
        )}
      </div>
    </div>
  )
}
