import { X } from 'lucide-react'
import type { Cyberware, CyberwareGroupId } from '../../types/cyberware'
import {
  getCyberwareDisplayDescription,
  getCyberwareDisplayName,
  resolveCyberwareEquipperProfileIds,
  resolveCyberwareViewerProfileIds,
} from '../../lib/cyberwareCatalog'
import { CyberwareDetails } from './CyberwareDetails'
import { CyberwareIcon } from './CyberwareIcon'
import type { CwColors } from './CyberwareSlot'

interface CyberwarePickerProps {
  groupId: CyberwareGroupId
  groupLabel: string
  slotIndex: number
  currentCyberware: Cyberware | null
  compatibleCyberwares: Cyberware[]
  colors: CwColors
  isGmViewer: boolean
  canEquipCyberware: (cyberware: Cyberware) => boolean
  canRemoveCurrentCyberware: boolean
  onClose: () => void
  onEquip: (cyberware: Cyberware) => void
  onRemove: () => void
}

export function CyberwarePicker({
  groupId,
  groupLabel,
  slotIndex,
  currentCyberware,
  compatibleCyberwares,
  colors,
  isGmViewer,
  canEquipCyberware,
  canRemoveCurrentCyberware,
  onClose,
  onEquip,
  onRemove,
}: CyberwarePickerProps) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-[#02001a]/72 backdrop-blur-[1px]">
      <div
        className="relative flex h-[80%] w-[76%] min-w-0 flex-col overflow-hidden rounded-sm border bg-[#04051d]/96"
        style={{ borderColor: colors.faint, boxShadow: `0 0 22px ${colors.dim}` }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-[#05061f]/95 text-[#f8f8f4] transition hover:bg-[#0a0c2c]"
          style={{ borderColor: colors.faint }}
          title="Fechar"
        >
          <X size={16} />
        </button>

        <div className="border-b px-6 py-5 pr-16" style={{ borderColor: colors.faint }}>
          <p
            className="font-display text-[1.18rem] uppercase"
            style={{ color: colors.accent, letterSpacing: '0.18em' }}
          >
            {groupLabel}
          </p>
          <p className="mt-1.5 text-[0.88rem] uppercase tracking-[0.16em] text-[#aeb6c6]">
            Slot {slotIndex + 1} • {groupId}
          </p>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.95fr)_minmax(0,1.4fr)] gap-5 p-5">
          <div className="min-w-0 space-y-4">
            <CyberwareDetails
              title="Equipada"
              cyberware={currentCyberware}
              colors={colors}
              emptyLabel="Este slot ainda esta vazio. Escolhe uma cyberware da lista."
            />

            {currentCyberware && canRemoveCurrentCyberware ? (
              <button
                type="button"
                onClick={onRemove}
                className="w-full rounded-sm border px-4 py-3 text-[0.86rem] font-semibold uppercase tracking-[0.16em] text-[#ff8d8d] transition hover:bg-[#2a0b14]"
                style={{ borderColor: 'rgba(255,90,90,0.4)' }}
              >
                Remover Cyberware
              </button>
            ) : null}
          </div>

          <div
            className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pr-2"
            style={{ scrollbarWidth: 'thin' }}
          >
            <div className="space-y-4">
              {compatibleCyberwares.map((cyberware) => {
                const isCurrent = currentCyberware?.id === cyberware.id
                const canEquip = canEquipCyberware(cyberware)
                const displayName = getCyberwareDisplayName(cyberware)
                const displayDescription = getCyberwareDisplayDescription(cyberware)
                const viewerAccess = resolveCyberwareViewerProfileIds(cyberware)
                const equipperAccess = resolveCyberwareEquipperProfileIds(cyberware)
                const viewerLabel =
                  viewerAccess === null
                    ? 'Todos veem'
                    : viewerAccess.length
                      ? `${viewerAccess.length} veem`
                      : 'Ninguem ve'
                const equipperLabel =
                  equipperAccess === null
                    ? 'Todos equipam'
                    : equipperAccess.length
                      ? `${equipperAccess.length} equipam`
                      : 'Ninguem equipa'

                return (
                  <button
                    key={cyberware.id}
                    type="button"
                    onClick={() => onEquip(cyberware)}
                    disabled={!canEquip}
                    className="w-full overflow-hidden rounded-sm border bg-[#060824]/94 p-4 text-left transition hover:bg-[#0a1034] disabled:cursor-not-allowed disabled:opacity-65"
                    style={{
                      borderColor: isCurrent ? colors.accent : colors.faint,
                      boxShadow: isCurrent ? `0 0 16px ${colors.dim}` : 'none',
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-[1.1rem] uppercase leading-[1.05] tracking-[0.08em] text-[#f8f8f4]">
                          {displayName}
                        </p>
                        <p className="mt-2.5 text-[0.95rem] leading-[1.45] text-[#d5d7df]">
                          {displayDescription}
                        </p>
                      </div>

                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm border"
                        style={{ borderColor: colors.faint, color: colors.accent }}
                      >
                        <CyberwareIcon
                          cyberware={cyberware}
                          alt={displayName}
                          accentColor={colors.accent}
                          glowFilter={colors.glowFilter}
                          className="h-[76%] w-[76%] object-contain"
                          fallbackClassName="flex h-full w-full items-center justify-center font-display text-[0.86rem] uppercase"
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-2 text-[0.82rem] font-semibold uppercase tracking-[0.12em]">
                        <span
                          className="rounded-sm border px-3 py-1.5"
                          style={{ borderColor: colors.faint, color: colors.accent }}
                        >
                          Cyber {cyberware.cyberCost}
                        </span>
                        <span
                          className="rounded-sm border px-3 py-1.5"
                          style={{ borderColor: colors.faint, color: colors.accent }}
                        >
                          Shield {cyberware.shieldValue}
                        </span>
                        {isGmViewer ? (
                          <>
                            <span
                              className="rounded-sm border px-3 py-1.5"
                              style={{ borderColor: colors.faint, color: viewerAccess && !viewerAccess.length ? '#f5c16c' : '#9ee7b5' }}
                            >
                              {viewerLabel}
                            </span>
                            <span
                              className="rounded-sm border px-3 py-1.5"
                              style={{ borderColor: colors.faint, color: equipperAccess && !equipperAccess.length ? '#f5c16c' : '#9ee7b5' }}
                            >
                              {equipperLabel}
                            </span>
                          </>
                        ) : null}
                      </div>

                      <span
                        className="text-[0.82rem] font-semibold uppercase tracking-[0.14em]"
                        style={{ color: isCurrent ? colors.accent : '#f8f8f4' }}
                      >
                        {isCurrent
                          ? 'Equipada'
                          : !canEquip
                            ? 'Bloqueada pelo Silver'
                            : currentCyberware
                              ? 'Substituir'
                              : 'Equipar'}
                      </span>
                    </div>
                  </button>
                )
              })}

              {!compatibleCyberwares.length ? (
                <div
                  className="rounded-sm border px-4 py-5 text-[0.96rem] text-[#aeb6c6]"
                  style={{ borderColor: colors.faint }}
                >
                  Ainda nao ha cyberwares mock disponiveis para este grupo.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
