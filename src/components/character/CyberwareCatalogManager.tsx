import { ImagePlus, Plus, Trash2, X } from 'lucide-react'
import { CyberwareIcon } from './CyberwareIcon'
import {
  buildSheetCyberwaresByGroup,
  createEmptySheetCyberware,
  getCyberwareDisplayName,
  parseSheetCyberwareCatalog,
  resolveCyberwareEquipperProfileIds,
  resolveCyberwareViewerProfileIds,
  stringifySheetCyberwareCatalog,
} from '../../lib/cyberwareCatalog'
import { removeCyberwareFromEquippedFieldData } from '../../lib/cyberwareState'
import {
  CYBERWARE_CATALOG_FIELD_KEY,
  CYBERWARE_CYBER_MAX_FIELD_KEY,
  CYBERWARE_SHIELD_MAX_FIELD_KEY,
  cyberwareSheetZones,
} from '../../lib/cyberwareSheetLayout'
import type { Cyberware, CyberwareGroupId } from '../../types/cyberware'

const cyberwareZoneOptions = cyberwareSheetZones.map((zone) => ({
  value: zone.id,
  label: zone.label,
}))

type CyberwareCatalogManagerProps = {
  fieldData: Record<string, string>
  onFieldChange: (fieldName: string, value: string) => void
  playerOptions: Array<{
    id: string
    label: string
    detail: string
  }>
}

function normalizeNumericInput(value: string) {
  const normalized = value.replace(/[^\d]/g, '')
  return normalized ? String(Number(normalized)) : '0'
}

function toggleProfileId(ids: string[], profileId: string, enabled: boolean) {
  if (enabled) {
    return ids.includes(profileId) ? ids : [...ids, profileId]
  }

  return ids.filter((entry) => entry !== profileId)
}

function CyberwareCatalogCard({
  entry,
  groupCount,
  playerOptions,
  onChange,
  onDelete,
}: {
  entry: Cyberware
  groupCount: number
  playerOptions: Array<{
    id: string
    label: string
    detail: string
  }>
  onChange: (patch: Partial<Cyberware>) => void
  onDelete: () => void
}) {
  const fileInputId = `cyberware-icon-${entry.id}`
  const displayName = getCyberwareDisplayName(entry)
  const viewerIds = resolveCyberwareViewerProfileIds(entry) ?? playerOptions.map((option) => option.id)
  const equipperIds = resolveCyberwareEquipperProfileIds(entry) ?? playerOptions.map((option) => option.id)

  const handleUploadIcon = (file: File | null) => {
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onChange({ icon: reader.result })
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <article className="hud-panel rounded-[24px] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="panel-title">Cyberware</p>
          <p className="mt-2 truncate text-lg font-semibold text-white">{displayName}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-stone-500">
            {cyberwareZoneOptions.find((option) => option.value === entry.slotType)?.label ?? entry.slotType}
            {' · '}
            {groupCount} no mesmo slot
          </p>
        </div>

        <button
          type="button"
          onClick={onDelete}
          className="signal-button inline-flex items-center gap-2 px-3 py-2 text-xs"
          data-tone="danger"
          title="Apagar cyberware"
        >
          <Trash2 size={13} />
          Apagar
        </button>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <label className="space-y-2">
          <span className="panel-title text-stone-400">Nome</span>
          <input
            type="text"
            value={entry.name}
            onChange={(event) => onChange({ name: event.target.value })}
            className="input-shell px-3 py-2 text-sm"
          />
        </label>

        <label className="space-y-2">
          <span className="panel-title text-stone-400">Lugar</span>
          <select
            value={entry.slotType}
            onChange={(event) => onChange({ slotType: event.target.value as CyberwareGroupId })}
            className="input-shell px-3 py-2 text-sm"
          >
            {cyberwareZoneOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <span className="panel-title text-stone-400">Cyber</span>
          <input
            type="text"
            inputMode="numeric"
            value={String(entry.cyberCost)}
            onChange={(event) => onChange({ cyberCost: Number(normalizeNumericInput(event.target.value)) })}
            className="input-shell px-3 py-2 text-sm"
          />
        </label>

        <label className="space-y-2">
          <span className="panel-title text-stone-400">Shield</span>
          <input
            type="text"
            inputMode="numeric"
            value={String(entry.shieldValue)}
            onChange={(event) => onChange({ shieldValue: Number(normalizeNumericInput(event.target.value)) })}
            className="input-shell px-3 py-2 text-sm"
          />
        </label>

        <label className="space-y-2 xl:col-span-2">
          <span className="panel-title text-stone-400">Descricao</span>
          <textarea
            value={entry.description}
            onChange={(event) => onChange({ description: event.target.value })}
            className="input-shell min-h-28 px-3 py-2 text-sm"
          />
        </label>

        <label className="space-y-2 xl:col-span-2">
          <span className="panel-title text-stone-400">Icone opcional</span>
          <div className="grid gap-3 md:grid-cols-[96px_minmax(0,1fr)]">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden border border-white/10 bg-black/25">
              <CyberwareIcon
                cyberware={entry}
                alt={displayName}
                accentColor="#f3e600"
                glowFilter="drop-shadow(0 0 4px rgba(243,230,0,0.55))"
                className="h-[82%] w-[82%] object-contain"
                fallbackClassName="flex h-full w-full items-center justify-center font-display text-lg uppercase"
              />
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <label
                  htmlFor={fileInputId}
                  className="signal-button inline-flex cursor-pointer items-center gap-2 px-3 py-2 text-xs"
                >
                  <ImagePlus size={13} />
                  Meter logo
                </label>

                <button
                  type="button"
                  onClick={() => onChange({ icon: '' })}
                  className="signal-button inline-flex items-center gap-2 px-3 py-2 text-xs"
                  data-variant="ghost"
                >
                  <X size={13} />
                  Tirar logo
                </button>
              </div>

              <input
                id={fileInputId}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => handleUploadIcon(event.target.files?.[0] ?? null)}
              />

              <input
                type="text"
                value={entry.icon ?? ''}
                onChange={(event) => onChange({ icon: event.target.value })}
                placeholder="Ex.: kikishi-eyes ou cola um caminho"
                className="input-shell px-3 py-2 text-sm"
              />
            </div>
          </div>
        </label>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <p className="panel-title text-stone-400">Acesso individual</p>
          <p className="mt-2 text-sm leading-7 text-stone-400">
            O Silver escolhe exatamente quem pode ver e quem pode equipar esta cyberware.
          </p>
        </div>

        {!playerOptions.length ? (
          <div className="border border-white/10 bg-black/25 px-4 py-3 text-sm text-stone-300">
            Ainda nao ha players disponiveis para configurar neste acesso.
          </div>
        ) : (
          <div className="overflow-hidden border border-white/10 bg-black/25">
            <div className="grid grid-cols-[minmax(0,1fr)_90px_110px] border-b border-white/10 bg-white/5 px-4 py-2 text-[0.68rem] uppercase tracking-[0.2em] text-stone-500">
              <span>Pessoa</span>
              <span className="text-center">Ver</span>
              <span className="text-center">Equipar</span>
            </div>

            {playerOptions.map((person) => {
              const canView = viewerIds.includes(person.id)
              const canEquip = equipperIds.includes(person.id)

              return (
                <div
                  key={person.id}
                  className="grid grid-cols-[minmax(0,1fr)_90px_110px] items-center gap-3 border-t border-white/10 px-4 py-3 first:border-t-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{person.label}</p>
                    <p className="truncate text-xs text-stone-400">{person.detail}</p>
                  </div>

                  <label className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={canView}
                      onChange={(event) => {
                        const nextViewerIds = toggleProfileId(viewerIds, person.id, event.target.checked)
                        const nextEquipperIds = event.target.checked
                          ? equipperIds
                          : toggleProfileId(equipperIds, person.id, false)

                        onChange({
                          allowedViewerProfileIds: nextViewerIds,
                          allowedEquipperProfileIds: nextEquipperIds,
                        })
                      }}
                      className="h-4 w-4 accent-[#f3e600]"
                    />
                  </label>

                  <label className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={canEquip}
                      onChange={(event) => {
                        const nextViewerIds = event.target.checked
                          ? toggleProfileId(viewerIds, person.id, true)
                          : viewerIds
                        const nextEquipperIds = toggleProfileId(equipperIds, person.id, event.target.checked)

                        onChange({
                          allowedViewerProfileIds: nextViewerIds,
                          allowedEquipperProfileIds: nextEquipperIds,
                        })
                      }}
                      className="h-4 w-4 accent-[#f3e600]"
                    />
                  </label>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </article>
  )
}

export function CyberwareCatalogManager({
  fieldData,
  onFieldChange,
  playerOptions,
}: CyberwareCatalogManagerProps) {
  const entries = parseSheetCyberwareCatalog(fieldData[CYBERWARE_CATALOG_FIELD_KEY])
  const entriesByGroup = buildSheetCyberwaresByGroup(entries)

  const saveEntries = (nextEntries: Cyberware[]) => {
    onFieldChange(CYBERWARE_CATALOG_FIELD_KEY, stringifySheetCyberwareCatalog(nextEntries))
  }

  const handleEntryChange = (entryId: string, patch: Partial<Cyberware>) => {
    const previousEntry = entries.find((entry) => entry.id === entryId)
    saveEntries(
      entries.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)),
    )

    if (previousEntry && patch.slotType && patch.slotType !== previousEntry.slotType) {
      const slotUpdates = removeCyberwareFromEquippedFieldData(fieldData, entryId)

      for (const [fieldName, value] of Object.entries(slotUpdates)) {
        onFieldChange(fieldName, value)
      }
    }
  }

  const handleAddEntry = () => {
    saveEntries([...entries, createEmptySheetCyberware()])
  }

  const handleClearCatalog = () => {
    onFieldChange(CYBERWARE_CATALOG_FIELD_KEY, '[]')
    onFieldChange(CYBERWARE_CYBER_MAX_FIELD_KEY, '')
    onFieldChange(CYBERWARE_SHIELD_MAX_FIELD_KEY, '')

    for (const zone of cyberwareSheetZones) {
      onFieldChange(zone.fieldKey, '[]')
    }
  }

  const handleDeleteEntry = (entryId: string) => {
    saveEntries(entries.filter((entry) => entry.id !== entryId))

    const slotUpdates = removeCyberwareFromEquippedFieldData(fieldData, entryId)

    for (const [fieldName, value] of Object.entries(slotUpdates)) {
      onFieldChange(fieldName, value)
    }
  }

  return (
    <section className="space-y-4">
      <section className="hud-panel rounded-[28px] p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="panel-title">Cyberware</p>
            <p className="mt-2 text-2xl font-semibold text-white">
              Catalogo privado de cyberware
            </p>
            <p className="mt-2 max-w-4xl text-sm leading-7 text-stone-400">
              Aqui defines que cyberwares existem nesta ficha, em que slot entram, e se o
              player as pode ver ou equipar. O page 4 passa a ler esta lista em vez do catalogo
              fixo.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {entries.length ? (
              <button
                type="button"
                onClick={handleClearCatalog}
                className="signal-button inline-flex items-center justify-center gap-2 px-4 py-2 text-sm"
                data-tone="danger"
              >
                <Trash2 size={15} />
                Limpar tudo
              </button>
            ) : null}

            <button
              type="button"
              onClick={handleAddEntry}
              className="signal-button inline-flex items-center justify-center gap-2 px-4 py-2 text-sm"
            >
              <Plus size={15} />
              Adicionar cyberware
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 2xl:grid-cols-2">
        {entries.map((entry) => (
          <CyberwareCatalogCard
            key={entry.id}
            entry={entry}
            groupCount={entriesByGroup[entry.slotType].length}
            playerOptions={playerOptions}
            onChange={(patch) => handleEntryChange(entry.id, patch)}
            onDelete={() => handleDeleteEntry(entry.id)}
          />
        ))}
      </div>

      {!entries.length ? (
        <div className="hud-panel rounded-[24px] px-5 py-4 text-sm leading-7 text-stone-400">
          Este catalogo nao tem cyberwares neste momento. Usa <span className="text-white">Adicionar cyberware</span> para criar uma nova.
        </div>
      ) : null}
    </section>
  )
}
