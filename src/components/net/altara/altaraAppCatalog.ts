import type { LucideIcon } from 'lucide-react'

import { netAppScopeAllows } from '../../../lib/netOsTypes'
import {
  getNetAppDefinition,
  type NetAppId,
} from '../netAppCatalog'
import type { NetWindowConstraints } from '../netWindowGeometry'

export type AltaraAppId =
  | 'altara-messenger'
  | 'altara-store'
  | 'altara-bank'
  | 'nova-bank'
  | 'altara-news'
  | 'altara-music'
  | 'altara-wave'
  | 'altara-settings'

export type AltaraAppStatus = 'functional' | 'placeholder' | 'system'

export interface AltaraAppDefinition {
  readonly id: AltaraAppId
  readonly name: string
  readonly subtitle: string
  readonly category: string
  readonly company: string
  readonly description: string
  readonly accentRgb: string
  readonly icon: LucideIcon
  readonly status: AltaraAppStatus
  readonly pinned: boolean
  readonly systemApp: boolean
  readonly window: NetWindowConstraints & {
    readonly width: number
    readonly height: number
  }
}

const altaraAppIds = [
  'altara-messenger',
  'altara-store',
  'altara-bank',
  'nova-bank',
  'altara-news',
  'altara-music',
  'altara-wave',
  'altara-settings',
] as const satisfies readonly AltaraAppId[]

function nativeApp(id: AltaraAppId): AltaraAppDefinition {
  const source = getNetAppDefinition(id as NetAppId)
  if (!source || !netAppScopeAllows(source.scope, 'altara')) {
    throw new Error(`ALTARA OS catalogue scope mismatch: ${id}`)
  }

  return {
    id,
    name: source.name,
    subtitle: source.subtitle ?? `${source.owner} // ${source.category}`,
    category: source.category,
    company: source.owner,
    description: source.shortDescription,
    accentRgb: source.accentRgb,
    icon: source.icon,
    status: source.systemApp ? 'system' : 'functional',
    pinned: true,
    systemApp: source.systemApp,
    window: source.defaultWindow,
  }
}

/**
 * ALTARA's presentation catalogue is a view over the canonical cross-OS app
 * registry. Server scopes remain authoritative; this list only controls shell
 * order and presentation.
 */
export const altaraAppCatalog: readonly AltaraAppDefinition[] = altaraAppIds.map(nativeApp)

export const altaraSystemAppIds = altaraAppCatalog
  .filter((app) => app.systemApp)
  .map((app) => app.id) as readonly AltaraAppId[]

export function getAltaraAppDefinition(id: AltaraAppId): AltaraAppDefinition {
  const app = altaraAppCatalog.find((candidate) => candidate.id === id)
  if (!app) throw new Error(`ALTARA OS catalogue entry is missing: ${id}`)
  return app
}
