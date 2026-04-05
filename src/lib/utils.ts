import { clsx, type ClassValue } from 'clsx'
import type { Character, CharacterStats, KarmaMode } from '../types/domain'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value))
}

export function percent(value: number, total: number) {
  if (!total) {
    return 0
  }

  return clamp(Math.round((value / total) * 100))
}

export function alignmentFromKarma(karma: number): KarmaMode {
  if (karma > 0) {
    return 'blue'
  }

  if (karma < 0) {
    return 'red'
  }

  return 'gray'
}

export function getToneClasses(mode: KarmaMode) {
  switch (mode) {
    case 'blue':
      return 'border-[color:rgba(83,181,255,0.32)] bg-[color:rgba(83,181,255,0.09)] text-sky-100'
    case 'red':
      return 'border-[color:rgba(255,84,104,0.3)] bg-[color:rgba(255,84,104,0.08)] text-rose-100'
    default:
      return 'border-[color:rgba(243,230,0,0.22)] bg-[color:rgba(243,230,0,0.08)] text-[#f5f1d6]'
  }
}

export function getCharacterVitals(character: Character) {
  const { stats } = character

  return [
    {
      label: 'HP',
      value: `${stats.hpCurrent}/${stats.hpMax}`,
      percent: percent(stats.hpCurrent, stats.hpMax),
      tone: stats.hpCurrent <= stats.hpMax * 0.4 ? 'red' : 'blue',
    },
    {
      label: 'RAM',
      value: `${stats.ramCurrent}/${stats.ramMax}`,
      percent: percent(stats.ramCurrent, stats.ramMax),
      tone: stats.ramCurrent <= stats.ramMax * 0.35 ? 'red' : 'blue',
    },
    {
      label: 'Karma',
      value: `${stats.karma > 0 ? '+' : ''}${stats.karma}`,
      percent: clamp(50 + stats.karma * 10),
      tone: alignmentFromKarma(stats.karma),
    },
    {
      label: 'Psicose',
      value: `${stats.cyberpsychosis}%`,
      percent: stats.cyberpsychosis,
      tone: stats.cyberpsychosis >= 25 ? 'red' : 'gray',
    },
  ] as const
}

export function buildAttributeSummary(stats: CharacterStats) {
  return [
    { key: 'reflex', label: 'Reflexos', value: stats.reflex },
    { key: 'tech', label: 'Tecnica', value: stats.tech },
    { key: 'cool', label: 'Frieza', value: stats.cool },
    { key: 'body', label: 'Corpo', value: stats.body },
    { key: 'intelligence', label: 'INT', value: stats.intelligence },
    { key: 'empathy', label: 'EMP', value: stats.empathy },
    { key: 'luck', label: 'Sorte', value: stats.luck },
  ] as const
}

export function createActivityDetail(label: string, detail: string, tone: KarmaMode) {
  return {
    id: crypto.randomUUID(),
    label,
    detail,
    timestamp: new Date().toISOString(),
    tone,
  }
}
