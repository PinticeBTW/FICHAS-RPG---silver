import {
  Grid2X2,
  Search,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react'
import { SharedMediaImage } from '../shared/SharedMediaImage'
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'

import '../../styles/netLauncher.css'

export type NetLauncherAppState = 'closed' | 'running' | 'minimized'

export interface NetLauncherApp {
  id: string
  name: string
  owner: string
  category: string
  accentRgb: string
  icon: LucideIcon
  searchAliases: readonly string[]
  state: NetLauncherAppState
}

type SystemToolId = 'settings'

type LauncherItem =
  | { id: string; kind: 'app'; app: NetLauncherApp }
  | {
      id: SystemToolId
      kind: 'system'
      label: string
      description: string
      icon: LucideIcon
      aliases: readonly string[]
      unavailable?: boolean
    }

interface NetLauncherProps {
  apps: readonly NetLauncherApp[]
  recentAppIds: readonly string[]
  user: {
    displayName: string
    handle: string
    avatarUrl?: string | null
    initials: string
  }
  launcherButtonRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onActivateApp: (id: string) => void
  onActivateSystem: (id: SystemToolId) => void
}

const SYSTEM_TOOLS: readonly Extract<LauncherItem, { kind: 'system' }>[] = [
  {
    id: 'settings',
    kind: 'system',
    label: 'Settings',
    description: 'Personalisation & system',
    icon: Settings,
    aliases: ['wallpaper', 'personalisation', 'personalization', 'system'],
  },
]

function matchesQuery(value: string, query: string) {
  return value.toLocaleLowerCase().includes(query)
}

export function NetLauncher({
  apps,
  recentAppIds,
  user,
  launcherButtonRef,
  onClose,
  onActivateApp,
  onActivateSystem,
}: NetLauncherProps) {
  const panelRef = useRef<HTMLElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const normalizedQuery = query.trim().toLocaleLowerCase()

  const appItems = useMemo<LauncherItem[]>(
    () => apps.map((app) => ({ id: app.id, kind: 'app', app })),
    [apps],
  )
  const recentItems = useMemo(
    () =>
      recentAppIds
        .map((id) => appItems.find((item) => item.id === id))
        .filter((item): item is LauncherItem => Boolean(item)),
    [appItems, recentAppIds],
  )
  const filteredApps = useMemo(
    () =>
      appItems.filter((item) => {
        if (item.kind !== 'app') return false
        const terms = [
          item.app.name,
          item.app.owner,
          item.app.category,
          ...item.app.searchAliases,
        ]
        return terms.some((term) => matchesQuery(term, normalizedQuery))
      }),
    [appItems, normalizedQuery],
  )
  const filteredSystem = useMemo(
    () =>
      SYSTEM_TOOLS.filter((tool) =>
        [tool.label, tool.description, ...tool.aliases].some((term) =>
          matchesQuery(term, normalizedQuery),
        ),
      ),
    [normalizedQuery],
  )
  const selectableItems = useMemo(
    () => normalizedQuery
      ? [...filteredApps, ...filteredSystem]
      : [...recentItems, ...appItems, ...SYSTEM_TOOLS],
    [appItems, filteredApps, filteredSystem, normalizedQuery, recentItems],
  )
  const effectiveSelectedIndex = selectableItems.length === 0
    ? -1
    : Math.min(Math.max(selectedIndex, 0), selectableItems.length - 1)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const closeAndRestoreFocus = useCallback(() => {
    onClose()
    window.requestAnimationFrame(() => launcherButtonRef.current?.focus())
  }, [launcherButtonRef, onClose])

  const activate = useCallback((item: LauncherItem) => {
    if (item.kind === 'app') {
      onActivateApp(item.app.id)
    } else {
      onActivateSystem(item.id)
    }
    onClose()
  }, [onActivateApp, onActivateSystem, onClose])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) || launcherButtonRef.current?.contains(target)) return
      onClose()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeAndRestoreFocus()
        return
      }

      if (document.activeElement !== inputRef.current) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((current) =>
          selectableItems.length === 0 ? -1 : Math.min(current + 1, selectableItems.length - 1),
        )
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((current) =>
          selectableItems.length === 0 ? -1 : Math.max(current - 1, 0),
        )
      } else if (event.key === 'Enter') {
        const selected = selectableItems[effectiveSelectedIndex]
        if (!selected) return
        event.preventDefault()
        activate(selected)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [activate, closeAndRestoreFocus, effectiveSelectedIndex, launcherButtonRef, onClose, selectableItems])

  const renderItem = (item: LauncherItem, index: number) => {
    const selected = index === effectiveSelectedIndex

    if (item.kind === 'app') {
      const Icon = item.app.icon
      return (
        <button
          key={`${item.id}-${index}`}
          id={`net-launcher-result-${index}`}
          type="button"
          className="net-launcher__item net-launcher__item--app"
          data-selected={selected ? 'true' : 'false'}
          role="option"
          aria-selected={selected}
          style={{ '--launcher-app-rgb': item.app.accentRgb } as CSSProperties}
          onMouseEnter={() => setSelectedIndex(index)}
          onClick={() => activate(item)}
        >
          <span className="net-launcher__app-icon"><Icon size={18} /></span>
          <span className="net-launcher__item-copy">
            <strong>{item.app.name}</strong>
            <small>{item.app.category}</small>
          </span>
          <span className="net-launcher__state" data-state={item.app.state}>
            {item.app.state}
          </span>
        </button>
      )
    }

    const Icon = item.icon
    return (
      <button
        key={`${item.id}-${index}`}
        id={`net-launcher-result-${index}`}
        type="button"
        className="net-launcher__item net-launcher__item--system"
        data-selected={selected ? 'true' : 'false'}
        role="option"
        aria-selected={selected}
        onMouseEnter={() => setSelectedIndex(index)}
        onClick={() => activate(item)}
      >
        <span className="net-launcher__app-icon"><Icon size={18} /></span>
        <span className="net-launcher__item-copy">
          <strong>{item.label}</strong>
          <small>{item.description}</small>
        </span>
        {item.unavailable ? <span className="net-launcher__soon">SOON</span> : null}
      </button>
    )
  }

  const renderSection = (label: string, items: readonly LauncherItem[], offset: number) => {
    if (items.length === 0) return null
    return (
      <section className="net-launcher__section" aria-label={label}>
        <h2>{label}</h2>
        <div className="net-launcher__results" role="listbox">
          {items.map((item, index) => renderItem(item, offset + index))}
        </div>
      </section>
    )
  }

  return (
    <section id="net-launcher" className="net-launcher" ref={panelRef} role="dialog" aria-label="VEIL OS application launcher">
      <div className="net-launcher__topline">
        <span><Grid2X2 size={13} /> VEIL OS</span>
        <small>VEGA MESH</small>
      </div>

      <label className="net-launcher__search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Search applications and system tools</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelectedIndex(0)
          }}
          placeholder="Search applications & system"
          aria-label="Search applications and system tools"
          aria-activedescendant={effectiveSelectedIndex >= 0 ? `net-launcher-result-${effectiveSelectedIndex}` : undefined}
        />
        {query ? (
          <button type="button" onClick={() => { setQuery(''); setSelectedIndex(0); inputRef.current?.focus() }} aria-label="Clear launcher search">
            <X size={14} />
          </button>
        ) : null}
      </label>

      <div className="net-launcher__content">
        {normalizedQuery ? (
          selectableItems.length > 0 ? (
            <>
              {renderSection('APPLICATIONS', filteredApps, 0)}
              {renderSection('SYSTEM', filteredSystem, filteredApps.length)}
            </>
          ) : (
            <div className="net-launcher__empty"><Search size={18} /><strong>No matching services</strong><span>Try an application, category, or system tool.</span></div>
          )
        ) : (
          <>
            {renderSection('RECENT', recentItems, 0)}
            {renderSection('INSTALLED APPLICATIONS', appItems, recentItems.length)}
            {renderSection('SYSTEM', SYSTEM_TOOLS, recentItems.length + appItems.length)}
          </>
        )}
      </div>

      <footer className="net-launcher__user">
        {user.avatarUrl ? <SharedMediaImage source={user.avatarUrl} variant="thumbnail" alt="" /> : <span className="net-launcher__avatar">{user.initials}</span>}
        <span><strong>{user.displayName}</strong><small>{user.handle}</small></span>
        <i>MESH NODE ONLINE</i>
      </footer>
    </section>
  )
}
