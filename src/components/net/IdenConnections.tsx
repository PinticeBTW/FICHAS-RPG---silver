import { ChevronDown, Lock, PanelRight, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import type { ConnectionStatus, IdenConnectionRecord } from './idenData'

const FILTERS: { id: ConnectionStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'connected', label: 'Connected' },
  { id: 'limited', label: 'Limited' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'revoked', label: 'Revoked' },
]

interface IdenConnectionsProps {
  connections: IdenConnectionRecord[]
  onRevoke: (id: string) => void
  onEnable: (id: string) => void
  onNotice: (message: string) => void
}

export function IdenConnections({
  connections,
  onRevoke,
  onEnable,
  onNotice,
}: IdenConnectionsProps) {
  const [filter, setFilter] = useState<ConnectionStatus | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(
    connections[0]?.id ?? null,
  )
  const [detailOpen, setDetailOpen] = useState(true)
  const [permissionsOpen, setPermissionsOpen] = useState(false)

  const filtered =
    filter === 'all' ? connections : connections.filter((c) => c.status === filter)

  const selected = connections.find((c) => c.id === selectedId) ?? null

  const handleRevoke = (connection: IdenConnectionRecord) => {
    if (connection.required) {
      onNotice(`IDEN // ${connection.service.toUpperCase()} IS REQUIRED AND CANNOT BE REVOKED`)
      return
    }
    onRevoke(connection.id)
  }

  return (
    <div className="iden-workspace">
      <div className="iden-main">
        <p className="iden-lead">
          Identity verification is authenticated through VEGA MESH where applicable.
        </p>

        <div className="iden-chip-row">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              data-active={filter === option.id ? 'true' : 'false'}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="iden-list">
          {filtered.length === 0 ? (
            <p className="iden-empty">No connections in this state.</p>
          ) : (
            filtered.map((connection) => (
              <button
                key={connection.id}
                type="button"
                className="iden-row"
                data-selected={selectedId === connection.id ? 'true' : 'false'}
                onClick={() => {
                  setSelectedId(connection.id)
                  setDetailOpen(true)
                  setPermissionsOpen(false)
                }}
              >
                {connection.required ? (
                  <Lock size={15} className="iden-row__risk-icon" />
                ) : (
                  <ShieldCheck size={15} className="iden-row__risk-icon" />
                )}

                <span className="iden-row__body">
                  <strong>{connection.service}</strong>
                  <small>{connection.owner}</small>
                </span>

                <span className="iden-row__meta">
                  <em data-status={connection.status}>{connection.status}</em>
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="iden-inspect" data-open={detailOpen ? 'true' : 'false'}>
        {detailOpen ? (
          selected ? (
            <>
              <header className="iden-inspect__head">
                <strong>Connection</strong>
                <button
                  type="button"
                  onClick={() => setDetailOpen(false)}
                  aria-label="Collapse inspection panel"
                  title="Collapse"
                >
                  <PanelRight size={14} />
                </button>
              </header>

              <div className="iden-inspect__body">
                <h3>{selected.service}</h3>
                <span className="iden-inspect__owner">{selected.owner}</span>
                <p className="iden-inspect__description">{selected.description}</p>

                <div className="iden-kv">
                  <span>Status</span>
                  <strong data-status={selected.status}>{selected.status}</strong>
                </div>
                <div className="iden-kv">
                  <span>Required</span>
                  <strong>{selected.required ? 'Yes' : 'Optional'}</strong>
                </div>
                <div className="iden-kv">
                  <span>Last access</span>
                  <strong>{selected.lastAccess}</strong>
                </div>
                <div className="iden-kv">
                  <span>Route</span>
                  <strong>{selected.route}</strong>
                </div>

                <div className="iden-kv-block">
                  <span>Data categories</span>
                  {selected.dataCategories.length === 0 ? (
                    <em>None</em>
                  ) : (
                    <ul>
                      {selected.dataCategories.map((category) => (
                        <li key={category}>{category}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <button
                  type="button"
                  className="iden-expand-toggle"
                  onClick={() => setPermissionsOpen((prev) => !prev)}
                  aria-expanded={permissionsOpen}
                >
                  <span>Permissions ({selected.permissions.length})</span>
                  <ChevronDown
                    size={13}
                    data-open={permissionsOpen ? 'true' : 'false'}
                  />
                </button>

                {permissionsOpen ? (
                  <ul className="iden-permission-list">
                    {selected.permissions.length === 0 ? (
                      <li className="iden-empty">No permissions granted.</li>
                    ) : (
                      selected.permissions.map((permission) => (
                        <li key={permission}>{permission}</li>
                      ))
                    )}
                  </ul>
                ) : null}

                <div className="iden-inspect__actions">
                  {selected.status === 'revoked' ? (
                    <button type="button" onClick={() => onEnable(selected.id)}>
                      Re-enable connection
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-locked={selected.required ? 'true' : 'false'}
                      onClick={() => handleRevoke(selected)}
                    >
                      {selected.required ? (
                        <>
                          <Lock size={13} /> Required — cannot revoke
                        </>
                      ) : (
                        'Revoke connection'
                      )}
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="iden-empty-state">Select a connection to inspect it.</div>
          )
        ) : (
          <button
            type="button"
            className="iden-inspect__reopen"
            onClick={() => setDetailOpen(true)}
            aria-label="Open inspection panel"
            title="Open inspection panel"
          >
            <PanelRight size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
