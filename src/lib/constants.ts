import type {
  AbilityItem,
  Campaign,
  Character,
  CharacterNotes,
  CharacterSheetData,
  CharacterStats,
  CyberwareItem,
  InventoryItem,
  Profile,
  SheetAbilityItem,
  SheetAttackItem,
  SheetInventoryItem,
  SheetValueItem,
  SkillItem,
} from '../types/domain'

export const APP_NAME = 'Ghost Grid'
export const APP_TAGLINE = 'Painel privado da campanha'

export const defaultPortrait =
  'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=600&q=80'

export const slotLabels = [
  'head',
  'optic',
  'nervous',
  'torso',
  'left arm',
  'right arm',
  'legs',
] as const

export const createEmptyStats = (): CharacterStats => ({
  hpCurrent: 18,
  hpMax: 20,
  ramCurrent: 7,
  ramMax: 10,
  karma: 0,
  cyberpsychosis: 16,
  humanity: 74,
  armor: 11,
  initiative: 6,
  reflex: 7,
  tech: 6,
  cool: 5,
  body: 6,
  intelligence: 7,
  empathy: 5,
  luck: 4,
})

export const createEmptyNotes = (): CharacterNotes => ({
  playerJournal: '',
  gmIntel: '',
  missionLog: '',
})

export const createEmptySkill = (): SkillItem => ({
  id: crypto.randomUUID(),
  name: 'Nova pericia',
  category: 'Campo',
  rating: 4,
  notes: '',
})

export const createEmptyAbility = (): AbilityItem => ({
  id: crypto.randomUUID(),
  name: 'Nova habilidade',
  cost: '2 PE',
  effect: 'Descreve o efeito.',
  source: 'Ficha',
  notes: '',
})

export const createEmptyInventoryItem = (): InventoryItem => ({
  id: crypto.randomUUID(),
  name: 'Novo item',
  category: 'Equipamento',
  quantity: 1,
  equipped: false,
  notes: '',
})

export const createEmptyCyberware = (): CyberwareItem => ({
  id: crypto.randomUUID(),
  slot: 'torso',
  name: 'Novo implante',
  tier: 'Mk-I',
  effect: 'Descreve o beneficio do sistema.',
  cost: '4 humanidade',
  notes: '',
  stability: 0,
})

export const seedCampaign: Campaign = {
  id: 'campaign-neon-drift',
  name: 'Neon Drift',
  codeName: 'ND-77',
  description:
    'Painel privado para gerir a campanha, personagens e progresso do grupo.',
  timeline: 'Ciclo nocturno 6',
  season: 'Acto 2',
}

type ImportedCharacterSeed = {
  id: string
  email: string
  displayName: string
  handle: string
  avatarUrl: string
  source: string
  name: string
  alias: string
  typology: string
  age: string
  height: string
  sex: string
  nationality: string
  city: string
  occupation: string
  karma: string
  cyberpsychosis: string
  deslocacaoRam: string
  experience: string
  experienceAlt: string
  attributes: {
    agility: string
    vigor: string
    presence: string
    strength: string
    intelligence: string
  }
  resources: {
    hpCurrent: string
    hpMax: string
    psCurrent: string
    psMax: string
    peCurrent: string
    peMax: string
    defense: string
    block: string
  }
  skills: Array<{ label: string; value: string }>
  attacks: SheetAttackItem[]
  abilities: SheetAbilityItem[]
  inventory: SheetInventoryItem[]
}

const importedCharacterSeeds: ImportedCharacterSeed[] = [
  {
    id: 'player-ayin',
    email: 'ayin@ghostgrid.local',
    displayName: 'Ayin',
    handle: '@ayin',
    avatarUrl:
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80',
    source: 'AYING EDGETR.pdf',
    name: 'Ayin',
    alias: 'Ayin',
    typology: 'Cyborg',
    age: '23',
    height: '1.76',
    sex: 'Masculino',
    nationality: 'Era City',
    city: 'Era City',
    occupation: '',
    karma: '-',
    cyberpsychosis: '-',
    deslocacaoRam: '-',
    experience: '20',
    experienceAlt: '20',
    attributes: {
      agility: '3',
      vigor: '2',
      presence: '2',
      strength: '1',
      intelligence: '2',
    },
    resources: {
      hpCurrent: '48',
      hpMax: '48',
      psCurrent: '38',
      psMax: '40',
      peCurrent: '31',
      peMax: '35',
      defense: '5',
      block: '5',
    },
    skills: [
      { label: 'Medicina', value: '5' },
      { label: 'Pontaria', value: '5' },
    ],
    attacks: [
      { name: 'Braco com ferro', test: '1d20', damage: '1d6 19' },
      { name: 'Disparaite', test: '1d20', damage: '2d8 19' },
      { name: 'Fica parado', test: '1d20', damage: '1d4' },
    ],
    abilities: [
      {
        name: 'High noon',
        cost: '6PE',
        description: 'Ele comeca logo antes da iniciativa.',
      },
      {
        name: 'Crime scene',
        cost: '13PE',
        description: 'Ve as ultimas coisas que aconteceram na cena.',
      },
      {
        name: 'Trick shot',
        cost: '9PE',
        description: 'Pode disparar mesmo com inimigos atras de cover.',
      },
    ],
    inventory: [
      { name: 'Desert Eagle', slots: '2' },
      { name: 'Fato +3 defesa', slots: '2' },
      { name: 'Paralizador eletrico', slots: '2' },
    ],
  },
  {
    id: 'player-jack',
    email: 'jack.reaper@ghostgrid.local',
    displayName: 'Jack Reaper',
    handle: '@jackreaper',
    avatarUrl:
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80',
    source: 'JACK REAPER.pdf',
    name: 'Jack Reaper',
    alias: 'Jack Reaper',
    typology: 'Cyborg',
    age: '27',
    height: '1.90',
    sex: 'Masculino',
    nationality: 'New V3ga',
    city: 'N3W Vega',
    occupation: '',
    karma: '+25',
    cyberpsychosis: '-',
    deslocacaoRam: '-',
    experience: '25',
    experienceAlt: '35',
    attributes: {
      agility: '3',
      vigor: '1',
      presence: '2',
      strength: '2',
      intelligence: '2',
    },
    resources: {
      hpCurrent: '6',
      hpMax: '64',
      psCurrent: '30',
      psMax: '38',
      peCurrent: '4',
      peMax: '38',
      defense: '7',
      block: '5',
    },
    skills: [
      { label: 'Luta', value: '5' },
      { label: 'Pontaria', value: '5' },
      { label: 'Tecnologia', value: '15' },
    ],
    attacks: [
      { name: 'Arma lazer', test: '3d20', damage: '1d10 19' },
      { name: 'Braco fudido', test: '2d20', damage: '2d6 19' },
      { name: 'Katana', test: '2d20', damage: '1d10+5' },
    ],
    abilities: [
      {
        name: 'Visao de verao',
        cost: '6PE',
        description: 'Ve pessoas pela parede e marca o alvo.',
      },
      {
        name: 'Olha cores',
        cost: '4PE',
        description: 'Le o nivel de perigo por cores.',
      },
      {
        name: 'IEEE JULLYIEE',
        cost: '6PE',
        description: '+5 tecnologia e +5 mecanico.',
      },
      {
        name: 'Nossa gigantxi',
        cost: '6PE',
        description: '+5 pontaria e +5 furtividade.',
      },
    ],
    inventory: [
      { name: 'Carregador', slots: '1' },
      { name: 'Telemovel', slots: '1' },
      { name: 'Arma lazer', slots: '2' },
    ],
  },
  {
    id: 'player-jeff',
    email: 'jeff@ghostgrid.local',
    displayName: 'Jeff',
    handle: '@jeff',
    avatarUrl:
      'https://images.unsplash.com/photo-1504257432389-52343af06ae3?auto=format&fit=crop&w=400&q=80',
    source: 'JEFF.pdf',
    name: 'Jeff',
    alias: 'Jeff',
    typology: 'Robo',
    age: '5',
    height: '1.70',
    sex: 'Masculino',
    nationality: 'New V3ga',
    city: 'N3W Vega',
    occupation: '',
    karma: '-',
    cyberpsychosis: '-',
    deslocacaoRam: 'RAM:140',
    experience: '100',
    experienceAlt: '0',
    attributes: {
      agility: '4',
      vigor: '2',
      presence: '2',
      strength: '1',
      intelligence: '4',
    },
    resources: {
      hpCurrent: '40',
      hpMax: '40',
      psCurrent: '-',
      psMax: '-',
      peCurrent: '20',
      peMax: '20',
      defense: '0',
      block: '9',
    },
    skills: [
      { label: 'Acrobacia', value: '15' },
      { label: 'Atualidades', value: '15' },
      { label: 'Crime', value: '5' },
      { label: 'Diplomacia', value: '5' },
      { label: 'Medicina', value: '5' },
      { label: 'Mentira', value: '5' },
      { label: 'Tecnologia', value: '15' },
    ],
    attacks: [],
    abilities: [
      {
        name: 'Penso bem',
        cost: '10%RAM',
        description: 'Busca bem na web em acao livre.',
      },
      {
        name: 'Multifudido',
        cost: '70%RAM',
        description: 'Faz as acoes que quiser.',
      },
      {
        name: 'Orion loc',
        cost: '5%RAM',
        description: 'Ve a localizacao do Orion.',
      },
    ],
    inventory: [{ name: 'Safeware', slots: 'Implante' }],
  },
  {
    id: 'player-jett',
    email: 'jett@ghostgrid.local',
    displayName: 'Jett',
    handle: '@jett',
    avatarUrl:
      'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=400&q=80',
    source: 'JETT.pdf',
    name: 'Jett Rar',
    alias: 'Jett',
    typology: 'Cyborg',
    age: '23',
    height: '1.70',
    sex: 'Masculino',
    nationality: 'New V3ga',
    city: 'N3W Vega',
    occupation: '',
    karma: '+18',
    cyberpsychosis: '-',
    deslocacaoRam: '-',
    experience: '15',
    experienceAlt: '15',
    attributes: {
      agility: '3',
      vigor: '2',
      presence: '1',
      strength: '2',
      intelligence: '1',
    },
    resources: {
      hpCurrent: '41',
      hpMax: '41',
      psCurrent: '24',
      psMax: '34',
      peCurrent: '18',
      peMax: '22',
      defense: '4',
      block: '3',
    },
    skills: [
      { label: 'Atletismo', value: '5' },
      { label: 'Furtividade', value: '5' },
      { label: 'Medicina', value: '5' },
      { label: 'Reflexos', value: '5' },
    ],
    attacks: [
      { name: 'Faquei-te', test: '2d20', damage: '1d8(19)' },
      { name: 'Soco de Marte', test: '2d20', damage: '1d6(19)' },
      { name: 'Katana', test: '2d20', damage: '1d10+5(19)' },
    ],
    abilities: [
      { name: 'Corrida insana', cost: '4PE', description: 'Corre o dobro.' },
      { name: 'Ataque insano', cost: '4PE', description: 'Ataca 2 vezes.' },
      {
        name: 'Dida (LA)',
        cost: '6PE',
        description: '+5 diplomacia ou +5 pontaria.',
      },
    ],
    inventory: [
      { name: 'Telemovel', slots: '1' },
      { name: 'Colar fudido dima', slots: '1' },
      { name: 'Katana', slots: '2' },
    ],
  },
  {
    id: 'player-lorenzo',
    email: 'lorenzo@ghostgrid.local',
    displayName: 'Lorenzo',
    handle: '@lorenzo',
    avatarUrl:
      'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=400&q=80',
    source: 'LORENZO.pdf',
    name: 'Lorenzo',
    alias: 'Lorenzo',
    typology: 'Humano',
    age: '40',
    height: '1.75',
    sex: 'Masculino',
    nationality: 'New V3ga',
    city: 'N3W Vega',
    occupation: '',
    karma: '-23',
    cyberpsychosis: '-',
    deslocacaoRam: 'RAM:140',
    experience: '100',
    experienceAlt: '0',
    attributes: {
      agility: '4',
      vigor: '2',
      presence: '2',
      strength: '1',
      intelligence: '4',
    },
    resources: {
      hpCurrent: '40',
      hpMax: '40',
      psCurrent: '-',
      psMax: '-',
      peCurrent: '20',
      peMax: '20',
      defense: '0',
      block: '9',
    },
    skills: [
      { label: 'Acrobacia', value: '15' },
      { label: 'Atualidades', value: '15' },
      { label: 'Crime', value: '5' },
      { label: 'Diplomacia', value: '5' },
      { label: 'Medicina', value: '5' },
      { label: 'Mentira', value: '5' },
      { label: 'Tecnologia', value: '15' },
    ],
    attacks: [
      { name: 'Soco esqueletico aleijado', test: '1d20agi+1d20fo', damage: '1d4/2' },
      { name: 'Friends gather around', test: '2d20 autodano', damage: '-1d4' },
      {
        name: 'Me chupe seu serelepe',
        test: '2d20 autodano',
        damage: '-1d4',
      },
      { name: 'Aiii nao facas isso', test: 'Fortitude(vitima)', damage: '???' },
    ],
    abilities: [
      {
        name: 'Me chupe seu serelepe',
        cost: '8PE',
        description: 'O plasma deixa buffs ou debuffs quando e injetado.',
      },
      {
        name: 'Friends gather around',
        cost: '8PE',
        description: 'Buff de coisas tecnologicas com plasma.',
      },
      {
        name: 'Aiii nao facas isso',
        cost: '15PE',
        description: 'Plasma + sangue = efeito incerto.',
      },
      {
        name: 'Aiii didaa(LA)',
        cost: '6PE',
        description: '+5 diplomacia ou +5 pontaria.',
      },
    ],
    inventory: [
      { name: 'Maquina modificada', slots: '1' },
      { name: 'Capa', slots: '2' },
      { name: 'Isqueiro', slots: '1' },
    ],
  },
  {
    id: 'player-orion',
    email: 'orion@ghostgrid.local',
    displayName: 'Orion',
    handle: '@orion',
    avatarUrl:
      'https://images.unsplash.com/photo-1507591064344-4c6ce005b128?auto=format&fit=crop&w=400&q=80',
    source: 'ORION.pdf',
    name: 'Orion Haylo',
    alias: 'Orion',
    typology: 'Cyborg',
    age: '17',
    height: '1.70',
    sex: 'Masculino',
    nationality: 'New V3ga',
    city: 'N3W Vega',
    occupation: 'Mercenario',
    karma: '-22',
    cyberpsychosis: '-',
    deslocacaoRam: '-',
    experience: '15',
    experienceAlt: '10',
    attributes: {
      agility: '3',
      vigor: '2',
      presence: '1',
      strength: '2',
      intelligence: '1',
    },
    resources: {
      hpCurrent: '13',
      hpMax: '38',
      psCurrent: '17',
      psMax: '32',
      peCurrent: '24',
      peMax: '34',
      defense: '4',
      block: '2',
    },
    skills: [
      { label: 'Crime', value: '5' },
      { label: 'Mentira', value: '5' },
      { label: 'Pontaria', value: '5' },
    ],
    attacks: [
      { name: 'Soco normal de cabrao', test: '2d20', damage: '1d4 19' },
      { name: 'Soco de mlk sonhado', test: '2d20', damage: '1d6 19' },
      { name: 'Sou negro?', test: 'Garantido', damage: '1xporcena' },
      { name: 'Dentei a puta', test: '2d20', damage: '1d12 19P' },
    ],
    abilities: [
      {
        name: 'Nao me toques',
        cost: '2PE',
        description: 'Quando esta abaixo de metade da vida ou sanidade usa isto.',
      },
      {
        name: 'Sou negro?',
        cost: '6PE',
        description: 'Consegue roubar uma coisa de forma garantida.',
      },
    ],
    inventory: [],
  },
  {
    id: 'player-vanessa',
    email: 'vanessa@ghostgrid.local',
    displayName: 'Vanessa Schneider',
    handle: '@vanessa',
    avatarUrl:
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80',
    source: 'VANESSA SCHENEIDER.pdf',
    name: 'Vanessa Schneider',
    alias: 'Vanessa',
    typology: 'Cyborg',
    age: '18',
    height: '1.70',
    sex: 'Feminino',
    nationality: 'New V3ga',
    city: 'N3W Vega',
    occupation: '',
    karma: '-',
    cyberpsychosis: '-',
    deslocacaoRam: '-',
    experience: '5',
    experienceAlt: '10',
    attributes: {
      agility: '2',
      vigor: '1',
      presence: '3',
      strength: '1',
      intelligence: '2',
    },
    resources: {
      hpCurrent: '17',
      hpMax: '25',
      psCurrent: '8',
      psMax: '28',
      peCurrent: '15',
      peMax: '24',
      defense: '3',
      block: '1',
    },
    skills: [
      { label: 'Artes', value: '5' },
      { label: 'Reflexos', value: '5' },
    ],
    attacks: [
      { name: 'Soquei', test: '1d20', damage: '1d4 (19)' },
      { name: 'Mototerra sem gaix', test: '1d20', damage: '3d4 (19)' },
    ],
    abilities: [
      {
        name: 'Vou-te ver',
        cost: '3PE',
        description: 'Ve a reputacao do alvo.',
      },
      {
        name: 'Ouco bueda be',
        cost: '3PE',
        description: 'Dobra os dados ligados a percepcao.',
      },
      {
        name: 'Apurei tudo',
        cost: '4PE',
        description: 'Vantagem em testes de sentidos do grupo.',
      },
    ],
    inventory: [
      { name: '50 pau', slots: '1' },
      { name: 'Mala da Cybushi', slots: '1' },
      { name: 'Cartao de credito', slots: '1' },
    ],
  },
]

function parseNumber(value: string, fallback = 0) {
  const match = value.match(/-?\\d+/)
  return match ? Number(match[0]) : fallback
}

function toKarmaNumber(value: string) {
  if (!value || value.trim() === '-' || value.trim() === '') {
    return 0
  }

  return parseNumber(value, 0)
}

function toAlignment(value: string): Character['alignment'] {
  const karma = toKarmaNumber(value)

  if (karma > 0) {
    return 'blue'
  }

  if (karma < 0) {
    return 'red'
  }

  return 'gray'
}

function buildStatusLabel(seed: ImportedCharacterSeed) {
  const hpCurrent = parseNumber(seed.resources.hpCurrent, 0)
  const hpMax = parseNumber(seed.resources.hpMax, 0)

  if (hpMax > 0 && hpCurrent <= Math.ceil(hpMax * 0.35)) {
    return 'Ferido'
  }

  if (toKarmaNumber(seed.karma) > 0) {
    return 'Estavel'
  }

  if (toKarmaNumber(seed.karma) < 0) {
    return 'Instavel'
  }

  return 'Neutro'
}

function buildBiography(seed: ImportedCharacterSeed) {
  const location = seed.city || seed.nationality
  const occupation = seed.occupation ? ` ${seed.occupation}.` : ''
  return `${seed.typology} de ${location || 'origem desconhecida'}.${occupation} Ficha importada de ${seed.source}.`
}

function buildSheetData(seed: ImportedCharacterSeed): CharacterSheetData {
  const info: SheetValueItem[] = [
    { label: 'Idade', value: seed.age },
    { label: 'Altura', value: seed.height },
    { label: 'Sexo', value: seed.sex },
    { label: 'Nacionalidade', value: seed.nationality },
    { label: 'Cidade', value: seed.city },
    { label: 'Tipologia', value: seed.typology },
    { label: 'Ocupacao', value: seed.occupation || '-' },
    { label: 'Karma', value: seed.karma || '-' },
    { label: 'Cyberpsychosis', value: seed.cyberpsychosis || '-' },
  ]

  const resources: SheetValueItem[] = [
    { label: 'PV', value: `${seed.resources.hpCurrent} / ${seed.resources.hpMax}` },
    { label: 'PS', value: `${seed.resources.psCurrent} / ${seed.resources.psMax}` },
    { label: 'PE', value: `${seed.resources.peCurrent} / ${seed.resources.peMax}` },
    { label: 'Defesa', value: seed.resources.defense },
    { label: 'Bloqueio', value: seed.resources.block },
    { label: 'Desl./RAM', value: seed.deslocacaoRam || '-' },
    { label: 'EX', value: seed.experience || '-' },
    { label: 'EX 2', value: seed.experienceAlt || '-' },
  ]

  const attributes: SheetValueItem[] = [
    { label: 'Agilidade', value: seed.attributes.agility },
    { label: 'Vigor', value: seed.attributes.vigor },
    { label: 'Presenca', value: seed.attributes.presence },
    { label: 'Forca', value: seed.attributes.strength },
    { label: 'Inteligencia', value: seed.attributes.intelligence },
  ]

  return {
    source: seed.source,
    info,
    resources,
    attributes,
    skills: seed.skills,
    attacks: seed.attacks,
    abilities: seed.abilities,
    inventory: seed.inventory,
  }
}

function buildSkillItems(seed: ImportedCharacterSeed): SkillItem[] {
  return seed.skills.map((entry) => ({
    id: crypto.randomUUID(),
    name: entry.label,
    category: 'Ficha',
    rating: parseNumber(entry.value, 0),
    notes: '',
  }))
}

function buildAbilityItems(seed: ImportedCharacterSeed): AbilityItem[] {
  return seed.abilities.map((entry) => ({
    id: crypto.randomUUID(),
    name: entry.name,
    cost: entry.cost,
    effect: entry.description,
    source: 'Ficha',
    notes: '',
  }))
}

function buildInventoryItems(seed: ImportedCharacterSeed): InventoryItem[] {
  return seed.inventory.map((entry) => ({
    id: crypto.randomUUID(),
    name: entry.name,
    category: entry.slots ? `Espaco ${entry.slots}` : 'Ficha',
    quantity: 1,
    equipped: false,
    notes: '',
  }))
}

function buildStats(seed: ImportedCharacterSeed): CharacterStats {
  const hpCurrent = parseNumber(seed.resources.hpCurrent, 0)
  const hpMax = parseNumber(seed.resources.hpMax, hpCurrent)
  const karma = toKarmaNumber(seed.karma)
  const cyberpsychosis = parseNumber(seed.cyberpsychosis, 0)
  const ramValue = parseNumber(seed.deslocacaoRam, 0)

  return {
    ...createEmptyStats(),
    hpCurrent,
    hpMax,
    ramCurrent: ramValue,
    ramMax: ramValue,
    karma,
    cyberpsychosis,
    humanity: cyberpsychosis ? Math.max(0, 100 - cyberpsychosis) : 100,
    armor: parseNumber(seed.resources.defense, 0),
    initiative: seed.skills.find((entry) => entry.label === 'Iniciativa')
      ? parseNumber(seed.skills.find((entry) => entry.label === 'Iniciativa')!.value, 0)
      : 0,
    reflex: seed.skills.find((entry) => entry.label === 'Reflexos')
      ? parseNumber(seed.skills.find((entry) => entry.label === 'Reflexos')!.value, 0)
      : parseNumber(seed.attributes.agility, 0),
    tech: seed.skills.find((entry) => entry.label === 'Tecnologia')
      ? parseNumber(seed.skills.find((entry) => entry.label === 'Tecnologia')!.value, 0)
      : 0,
    cool: parseNumber(seed.attributes.presence, 0),
    body: parseNumber(seed.attributes.strength, 0),
    intelligence: parseNumber(seed.attributes.intelligence, 0),
    empathy: parseNumber(seed.attributes.presence, 0),
    luck: 0,
  }
}

export const seedProfiles: Profile[] = [
  {
    id: 'silver-gm',
    email: 'silver@ghostgrid.local',
    displayName: 'Silver',
    handle: '@silver',
    role: 'gm',
    avatarUrl:
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80',
    activeCampaignId: seedCampaign.id,
  },
  ...importedCharacterSeeds.map((seed) => ({
    id: seed.id,
    email: seed.email,
    displayName: seed.displayName,
    handle: seed.handle,
    role: 'player' as const,
    avatarUrl: seed.avatarUrl,
    activeCampaignId: seedCampaign.id,
  })),
]

export const seedCharacters: Character[] = importedCharacterSeeds.map((seed) => ({
  id: `char-${seed.id}`,
  campaignId: seedCampaign.id,
  ownerProfileId: seed.id,
  ownerName: seed.displayName,
  ownerHandle: seed.handle,
  name: seed.name,
  alias: seed.alias,
  archetype: seed.typology,
  biography: buildBiography(seed),
  portraitUrl: seed.avatarUrl || defaultPortrait,
  statusLabel: buildStatusLabel(seed),
  alignment: toAlignment(seed.karma),
  allowPlayerStatEdits: false,
  updatedAt: new Date().toISOString(),
  stats: buildStats(seed),
  skills: buildSkillItems(seed),
  abilities: buildAbilityItems(seed),
  inventory: buildInventoryItems(seed),
  cyberware: [],
  notes: {
    ...createEmptyNotes(),
    playerJournal: `Ficha importada de ${seed.source}.`,
    gmIntel: seed.occupation ? `Ocupacao registada: ${seed.occupation}.` : '',
    missionLog: `${seed.alias} entrou no arquivo da campanha.`,
  },
  sheet: buildSheetData(seed),
}))
