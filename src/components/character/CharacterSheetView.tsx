import type {
  Character,
  CharacterSheetData,
  SheetAttackItem,
  SheetInventoryItem,
  SheetValueItem,
} from '../../types/domain'

interface CharacterSheetViewProps {
  character: Character
}

type DisplayRow = {
  label: string
  value: string
}

type SkillRow = {
  label: string
  code: string
  value: string
  note: string
}

const skillCodeMap: Record<string, string> = {
  acrobacia: 'AGI',
  artes: 'PRE',
  atletismo: 'FOR',
  atualidades: 'INT',
  ciencias: 'INT',
  crime: 'AGI',
  conducao: 'AGI',
  diplomacia: 'PRE',
  domisticacao: 'VIG',
  domesticacao: 'VIG',
  fortitude: 'VIG',
  furtividade: 'AGI',
  iniciativa: 'AGI',
  intimidacao: 'PRE',
  intuicao: 'PRE',
  investigacao: 'INT',
  luta: 'FOR',
  medicina: 'INT',
  mentira: 'PRE',
  percepcao: 'PRE',
  pontaria: 'AGI',
  profissao: 'INT',
  reflexos: 'AGI',
  religiao: 'PRE',
  sobrevivencia: 'PRE',
  tatica: 'PRE',
  tecnologia: 'PRE',
  vontade: 'PRE',
}

function normalizeLabel(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function buildFallbackSheet(character: Character): CharacterSheetData {
  return {
    source: 'Arquivo digital',
    info: [
      { label: 'Nome', value: character.name },
      { label: 'Idade', value: '-' },
      { label: 'Altura', value: '-' },
      { label: 'Sexo', value: '-' },
      { label: 'Nacionalidade', value: '-' },
      { label: 'Cidade', value: '-' },
      { label: 'Tipologia', value: character.archetype || '-' },
      { label: 'Ocupacao', value: '-' },
    ],
    resources: [
      { label: 'PV', value: `${character.stats.hpMax}` },
      { label: 'PV-ATUAL', value: `${character.stats.hpCurrent}` },
      { label: 'PS', value: '-' },
      { label: 'PS-ATUAL', value: '-' },
      { label: 'PE', value: '-' },
      { label: 'PE-ATUAL', value: '-' },
      { label: 'DEFESA', value: String(character.stats.armor) },
      { label: 'BLOQUEIO', value: '0' },
      { label: 'DESL', value: `${character.stats.ramMax}` },
      { label: 'EX', value: '0' },
      { label: 'EX 1', value: '0' },
      { label: 'KARMA', value: `${character.stats.karma}` },
      { label: 'CYBERPHYSHOSIS', value: `${character.stats.cyberpsychosis}` },
    ],
    attributes: [
      { label: 'Agilidade', value: String(character.stats.reflex) },
      { label: 'Vigor', value: String(character.stats.body) },
      { label: 'Presenca', value: String(character.stats.cool) },
      { label: 'Forca', value: String(character.stats.body) },
      { label: 'Inteligencia', value: String(character.stats.intelligence) },
    ],
    skills: character.skills.map((entry) => ({
      label: entry.name,
      value: String(entry.rating),
    })),
    attacks: character.sheet?.attacks ?? [],
    abilities: character.sheet?.abilities ?? [],
    inventory: character.sheet?.inventory ?? [],
  }
}

function toLookup(entries: SheetValueItem[]) {
  return new Map(entries.map((entry) => [normalizeLabel(entry.label), entry.value || '-']))
}

function lookupValue(map: Map<string, string>, labels: string[], fallback = '--') {
  for (const label of labels) {
    const value = map.get(normalizeLabel(label))

    if (value && value.trim() !== '') {
      return value
    }
  }

  return fallback
}

function splitColumns<T>(items: T[]) {
  const middle = Math.ceil(items.length / 2)
  return [items.slice(0, middle), items.slice(middle)] as const
}

function padRows<T>(items: T[], total: number, createEmpty: () => T) {
  return Array.from({ length: total }, (_, index) => items[index] ?? createEmpty())
}

function buildDisplayInfoRows(sheet: CharacterSheetData, character: Character): DisplayRow[] {
  const infoLookup = toLookup(sheet.info)

  return [
    { label: 'Nome', value: lookupValue(infoLookup, ['Nome'], character.name) },
    { label: 'Idade', value: lookupValue(infoLookup, ['Idade']) },
    { label: 'Altura', value: lookupValue(infoLookup, ['Altura']) },
    { label: 'Sexo', value: lookupValue(infoLookup, ['Sexo']) },
    { label: 'Nacionalidade', value: lookupValue(infoLookup, ['Nacionalidade']) },
    { label: 'Cidade', value: lookupValue(infoLookup, ['Cidade']) },
    { label: 'Tipologia', value: lookupValue(infoLookup, ['Tipologia'], character.archetype) },
    { label: 'Ocupacao', value: lookupValue(infoLookup, ['Ocupacao']) },
  ]
}

function buildAttributeCards(sheet: CharacterSheetData) {
  const attributeLookup = toLookup(sheet.attributes)

  return [
    { label: 'Agilidade', value: lookupValue(attributeLookup, ['Agilidade']) },
    { label: 'Vigor', value: lookupValue(attributeLookup, ['Vigor']) },
    { label: 'Presenca', value: lookupValue(attributeLookup, ['Presenca', 'Presença']) },
    { label: 'Forca', value: lookupValue(attributeLookup, ['Forca', 'Força']) },
    { label: 'Inteligencia', value: lookupValue(attributeLookup, ['Inteligencia', 'Inteligência']) },
  ]
}

function buildResourceGrid(sheet: CharacterSheetData) {
  const resourceLookup = toLookup(sheet.resources)

  return {
    hp: lookupValue(resourceLookup, ['PV']),
    hpCurrent: lookupValue(resourceLookup, ['PV-ATUAL', 'PV ATUAL']),
    sanity: lookupValue(resourceLookup, ['PS']),
    sanityCurrent: lookupValue(resourceLookup, ['PS-ATUAL', 'PS ATUAL']),
    effort: lookupValue(resourceLookup, ['PE']),
    effortCurrent: lookupValue(resourceLookup, ['PE-ATUAL', 'PE ATUAL']),
    ram: lookupValue(resourceLookup, ['DESL', 'DESL./RAM', 'RAM']),
    ex: lookupValue(resourceLookup, ['EX']),
    exAlt: lookupValue(resourceLookup, ['EX 1', 'EX1', 'EX 2', 'EX2'], '0'),
    defense: lookupValue(resourceLookup, ['DEFESA', 'Defesa'], '0'),
    block: lookupValue(resourceLookup, ['BLOQUEIO', 'Bloqueio'], '0'),
    karma: lookupValue(resourceLookup, ['KARMA', 'Karma'], '-'),
    cyberpsychosis: lookupValue(resourceLookup, ['CYBERPHYSHOSIS', 'CYBERPSYCHOSIS', 'Cyberpsychosis'], '-'),
  }
}

function getSkillCode(label: string) {
  return skillCodeMap[normalizeLabel(label)] ?? '---'
}

function extractSkillValue(value: string) {
  const [score] = value.split('/')
  return score.trim() || '--'
}

function extractNote(value: string) {
  if (!value.includes('/')) {
    return '--'
  }

  const [, note] = value.split('/')
  return note?.trim() || '--'
}

function buildSkillRows(sheet: CharacterSheetData) {
  return sheet.skills.map((entry) => ({
    label: entry.label,
    code: getSkillCode(entry.label),
    value: extractSkillValue(entry.value),
    note: extractNote(entry.value),
  }))
}

function buildBarcodeLabel(character: Character) {
  return `${character.alias.slice(0, 3).toUpperCase()}-${character.id.slice(-4).toUpperCase()}`
}

export function CharacterSheetView({ character }: CharacterSheetViewProps) {
  const sheet = character.sheet ?? buildFallbackSheet(character)
  const infoRows = buildDisplayInfoRows(sheet, character)
  const attributeCards = buildAttributeCards(sheet)
  const resources = buildResourceGrid(sheet)
  const [skillColumnLeft, skillColumnRight] = splitColumns(buildSkillRows(sheet))
  const attackRows = padRows<SheetAttackItem>(sheet.attacks, 10, () => ({
    name: '',
    test: '',
    damage: '',
  }))
  const inventoryRows = padRows<SheetInventoryItem>(sheet.inventory, 8, () => ({
    name: '',
    slots: '',
  }))

  return (
    <article className="rpg-sheet-shell mx-auto max-w-[1380px] space-y-3">
      <div className="grid gap-3 xl:grid-cols-2">
        <section className="rpg-sheet-page">
          <div className="rpg-sheet-page-inner">
            <header className="mb-3 flex items-start justify-between gap-3 border border-white/60 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <SheetInput defaultValue={character.alias} className="rpg-sheet-title w-full bg-transparent" />
                <SheetInput defaultValue={character.name} className="mt-1.5 rpg-sheet-text w-full bg-transparent" />
              </div>
              <div className="w-[180px] text-right">
                <p className="rpg-sheet-label">Arquivo</p>
                <SheetInput defaultValue={sheet.source} className="mt-1.5 rpg-sheet-text w-full bg-transparent text-right" />
              </div>
            </header>

            <div className="grid gap-px border border-white/60 bg-white/25 lg:grid-cols-[1.03fr_0.97fr]">
              <div className="rpg-sheet-box p-3">
                <div className="rpg-sheet-no-portrait">
                  <div className="w-full px-4 text-center">
                    <p className="rpg-sheet-section text-white/75">Area livre</p>
                    <SheetTextarea
                      defaultValue=""
                      className="mt-3 min-h-[120px] w-full resize-none bg-transparent text-center text-white/80"
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-px bg-white/25 p-px">
                <div className="rpg-sheet-box px-3 py-2.5">
                  <p className="rpg-sheet-section">Informacoes</p>
                </div>
                {infoRows.map((entry) => (
                  <div key={entry.label} className="rpg-sheet-box px-3 py-2">
                    <p className="rpg-sheet-label">{entry.label}:</p>
                    <SheetInput defaultValue={entry.value} className="mt-1 w-full bg-transparent italic rpg-sheet-text" />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 grid gap-px border border-white/60 bg-white/25 lg:grid-cols-[1.12fr_0.58fr]">
              <div className="rpg-sheet-table">
                <div className="grid grid-cols-[1.35fr_0.85fr_1fr] border-b border-white/60 bg-black/8">
                  <TableHeader>Ataques</TableHeader>
                  <TableHeader>Teste</TableHeader>
                  <TableHeader>Dano</TableHeader>
                </div>
                {attackRows.map((row, index) => (
                  <div
                    key={`attack-${index}`}
                    className="grid grid-cols-[1.35fr_0.85fr_1fr] border-t border-white/30"
                  >
                    <TableInputCell defaultValue={row.name} />
                    <TableInputCell defaultValue={row.test} />
                    <TableInputCell defaultValue={row.damage} />
                  </div>
                ))}
              </div>

              <div className="grid gap-px bg-white/25 p-px">
                <div className="rpg-sheet-barcode flex items-end justify-center p-3">
                  <p className="rpg-sheet-section text-black/85">{buildBarcodeLabel(character)}</p>
                </div>

                <div className="rpg-sheet-box px-3 py-2.5 text-center">
                  <p className="rpg-sheet-section">Karma</p>
                  <SheetInput defaultValue={resources.karma} className="mt-1.5 w-full bg-transparent text-center rpg-sheet-number" />
                </div>

                <div className="rpg-sheet-table">
                  <div className="grid grid-cols-[1fr_0.62fr] border-b border-white/60 bg-black/8">
                    <TableHeader>Inventario</TableHeader>
                    <TableHeader>Espaco</TableHeader>
                  </div>
                  {inventoryRows.map((row, index) => (
                    <div key={`inventory-${index}`} className="grid grid-cols-[1fr_0.62fr] border-t border-white/30">
                      <TableInputCell defaultValue={row.name} />
                      <TableInputCell defaultValue={row.slots} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-[1.1fr_0.42fr] gap-px border border-white/60 bg-white/25">
              <div className="rpg-sheet-box px-3 py-3.5">
                <p className="rpg-sheet-section">Cyberpsychosis %</p>
              </div>
              <div className="rpg-sheet-box px-3 py-3.5">
                <SheetInput defaultValue={resources.cyberpsychosis} className="w-full bg-transparent text-center rpg-sheet-massive" />
              </div>
            </div>
          </div>
        </section>

        <section className="rpg-sheet-page">
          <div className="rpg-sheet-page-inner">
            <div className="grid gap-3 md:grid-cols-5">
              {attributeCards.map((entry) => (
                <div key={entry.label}>
                  <div className="rpg-sheet-octagon">
                    <SheetInput defaultValue={entry.value} className="w-full bg-transparent text-center rpg-sheet-massive text-[2.45rem]" />
                  </div>
                  <p className="mt-2 text-center rpg-sheet-section text-[1rem]">{entry.label}</p>
                </div>
              ))}
            </div>

            <section className="rpg-sheet-box mt-4 p-3">
              <div className="mb-3 text-center">
                <p className="rpg-sheet-section">Capacidades</p>
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                {[skillColumnLeft, skillColumnRight].map((column, columnIndex) => (
                  <div key={`skill-column-${columnIndex}`} className="space-y-1">
                    {padRows<SkillRow>(
                      column,
                      10,
                      () => ({ label: '', code: '---', value: '', note: '--' }),
                    ).map((entry, rowIndex) => (
                      <div
                        key={`skill-${columnIndex}-${rowIndex}-${entry.label}`}
                        className="grid grid-cols-[1.2fr_0.42fr_0.42fr_0.68fr] gap-px bg-white/25"
                      >
                        <div className="rpg-sheet-box px-2.5 py-1.5">
                          <p className="rpg-sheet-label text-[0.78rem]">
                            {entry.label || '--'}
                          </p>
                        </div>
                        <div className="rpg-sheet-box flex items-center justify-center px-2 py-1.5">
                          <span className="rpg-sheet-label text-[0.72rem]">
                            {entry.code}
                          </span>
                        </div>
                        <div className="rpg-sheet-box flex items-center justify-center px-2 py-1.5">
                          <SheetInput defaultValue={entry.value} className="w-full bg-transparent text-center rpg-sheet-label text-[0.72rem]" />
                        </div>
                        <div className="rpg-sheet-box flex items-center px-2.5 py-1.5">
                          <SheetSelect
                            defaultValue={entry.note}
                            className="w-full bg-transparent text-[0.72rem] italic text-white"
                            options={['--', 'Bom', 'Fudido']}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>

            <div className="mt-4 grid gap-3 xl:grid-cols-[0.92fr_1.08fr]">
              <div className="rpg-sheet-table">
                {[
                  ['Pontos de vida', resources.hp],
                  ['Atuais', resources.hpCurrent],
                  ['Pontos de sanidade', resources.sanity],
                  ['Atuais', resources.sanityCurrent],
                  ['Pontos de esforco', resources.effort],
                  ['Atuais', resources.effortCurrent],
                ].map(([label, value], index) => (
                  <div key={`${label}-${index}`} className="grid grid-cols-[1.25fr_0.55fr] border-t border-white/30 first:border-t-0">
                    <div className="rpg-sheet-box px-4 py-3">
                      <p className="rpg-sheet-label text-center">{label}</p>
                    </div>
                    <div className="rpg-sheet-box flex items-center justify-center px-3 py-3">
                      <SheetInput defaultValue={value} className="w-full bg-transparent text-center rpg-sheet-number text-[2rem]" />
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-px bg-white/25 p-px">
                <div className="grid grid-cols-[1.1fr_0.55fr_0.72fr] gap-px bg-white/25">
                  <div className="rpg-sheet-box px-3 py-4">
                    <p className="rpg-sheet-title text-[3rem]">RAM</p>
                  </div>
                  <div className="rpg-sheet-box flex items-center justify-center px-3 py-4">
                    <span className="rpg-sheet-number text-[1.9rem]">%</span>
                  </div>
                  <div className="rpg-sheet-box flex items-center justify-center px-3 py-4">
                    <SheetInput defaultValue={resources.ram} className="w-full bg-transparent text-center rpg-sheet-text italic" />
                  </div>
                </div>

                <div className="grid grid-cols-[0.48fr_0.82fr_0.32fr_0.45fr] gap-px bg-white/25">
                  <div className="rpg-sheet-box flex items-center justify-center px-3 py-4">
                    <span className="rpg-sheet-section">EX</span>
                  </div>
                  <div className="rpg-sheet-box flex items-center justify-center px-3 py-4">
                    <SheetInput defaultValue={resources.ex} className="w-full bg-transparent text-center rpg-sheet-number text-[2.5rem]" />
                  </div>
                  <div className="rpg-sheet-box flex items-center justify-center px-3 py-4">
                    <span className="rpg-sheet-number text-[1.9rem]">%</span>
                  </div>
                  <div className="rpg-sheet-box flex items-center justify-center px-3 py-4">
                    <SheetInput defaultValue={resources.exAlt} className="w-full bg-transparent text-center rpg-sheet-number text-[2.5rem]" />
                  </div>
                </div>

                <div className="grid grid-cols-[0.9fr_0.45fr_0.9fr_0.45fr] gap-px bg-white/25">
                  <div className="rpg-sheet-box flex items-center justify-center px-3 py-4">
                    <span className="rpg-sheet-section">Defesa</span>
                  </div>
                  <div className="rpg-sheet-box flex items-center justify-center px-3 py-4">
                    <SheetInput defaultValue={resources.defense} className="w-full bg-transparent text-center rpg-sheet-number text-[2.5rem]" />
                  </div>
                  <div className="rpg-sheet-box flex items-center justify-center px-3 py-4">
                    <span className="rpg-sheet-section">Bloqueio</span>
                  </div>
                  <div className="rpg-sheet-box flex items-center justify-center px-3 py-4">
                    <SheetInput defaultValue={resources.block} className="w-full bg-transparent text-center rpg-sheet-number text-[2.5rem]" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </article>
  )
}

function SheetInput({
  defaultValue,
  className,
}: {
  defaultValue: string
  className?: string
}) {
  return (
    <input
      defaultValue={defaultValue}
      className={`border-none outline-none ${className ?? ''}`}
    />
  )
}

function SheetTextarea({
  defaultValue,
  className,
}: {
  defaultValue: string
  className?: string
}) {
  return (
    <textarea
      defaultValue={defaultValue}
      className={`border-none outline-none ${className ?? ''}`}
    />
  )
}

function SheetSelect({
  defaultValue,
  className,
  options,
}: {
  defaultValue: string
  className?: string
  options: string[]
}) {
  return (
    <select
      defaultValue={defaultValue}
      className={`border-none outline-none ${className ?? ''}`}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}

function TableHeader({ children }: { children: string }) {
  return (
    <div className="px-3 py-2">
      <p className="rpg-sheet-label">{children}</p>
    </div>
  )
}

function TableInputCell({ defaultValue }: { defaultValue: string }) {
  return (
    <div className="px-3 py-2">
      <SheetInput defaultValue={defaultValue} className="w-full bg-transparent rpg-sheet-text" />
    </div>
  )
}
