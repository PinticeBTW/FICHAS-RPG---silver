import {
  AlertTriangle,
  Check,
  Flag,
  PanelRight,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react'
import { useState } from 'react'

import type {
  AccessEvent,
  AccessEventType,
  IdenConnectionRecord,
} from './idenData'

type LogFilter = 'all' | AccessEventType | 'suspicious'

const FILTERS: { id: LogFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'identity-check', label: 'Identity checks' },
  { id: 'credential', label: 'Credentials' },
  { id: 'location', label: 'Location' },
  { id: 'trust', label: 'Trust' },
  { id: 'security', label: 'Security' },
  { id: 'suspicious', label: 'Suspicious' },
]

interface IdenAccessLogProps {
  events: AccessEvent[]
  connections: IdenConnectionRecord[]
  onMarkReviewed: (id: string) => void
  onFlag: (id: string) => void
  onRevokeConnection: (connectionId: string) => void
  onNotice: (message: string) => void
}

export function IdenAccessLog({
  events,
  connections,
  onMarkReviewed,
  onFlag,
  onRevokeConnection,
  onNotice,
}: IdenAccessLogProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<LogFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(true)

  const q = search.trim().toLowerCase()

  const filtered = events.filter((event) => {
    const matchesFilter =
      filter === 'all'
        ? true
        : filter === 'suspicious'
          ? event.risk === 'suspicious'
          : event.type === filter

    if (!matchesFilter) return false
    if (!q) return true

    return (
      event.service.toLowerCase().includes(q) ||
      event.owner.toLowerCase().includes(q) ||
      event.dataRequested.toLowerCase().includes(q) ||
      event.auditId.toLowerCase().includes(q)
    )
  })

  const selected = events.find((event) => event.id === selectedId) ?? null
  const relatedConnection = selected?.relatedConnectionId
    ? connections.find((c) => c.id === selected.relatedConnectionId)
    : undefined

  const handleClearFilters = () => {
    setSearch('')
    setFilter('all')
    onNotice('IDEN // FILTERS CLEARED')
  }

  return (
    <div className="iden-workspace">
      <div className="iden-main">
        <div className="iden-toolbar">
          <div className="iden-search">
            <Search size={13} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search access events"
              aria-label="Search access events"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>

          <button type="button" className="iden-clear-filters" onClick={handleClearFilters}>
            Clear filters
          </button>
        </div>

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
            <p className="iden-empty">No access events match your filters.</p>
          ) : (
            filtered.map((event) => (
              <button
                key={event.id}
                type="button"
                className="iden-row"
                data-selected={selectedId === event.id ? 'true' : 'false'}
                data-risk={event.risk}
                onClick={() => {
                  setSelectedId(event.id)
                  setDetailOpen(true)
                }}
              >
                {event.risk === 'suspicious' ? (
                  <ShieldAlert size={15} className="iden-row__risk-icon" />
                ) : (
                  <Check size={15} className="iden-row__risk-icon" />
                )}

                <span className="iden-row__body">
                  <strong>
                    {event.service}
                    {event.reviewed ? <em className="iden-row__tag">REVIEWED</em> : null}
                    {event.flaggedLocally ? (
                      <em className="iden-row__tag iden-row__tag--flag">FLAGGED</em>
                    ) : null}
                  </strong>
                  <small>{event.dataRequested}</small>
                </span>

                <span className="iden-row__meta">
                  <time>{event.timestamp}</time>
                  <em data-result={event.result}>{event.result}</em>
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
                <strong>Access event</strong>
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

                {selected.risk === 'suspicious' ? (
                  <div className="iden-warning">
                    <AlertTriangle size={13} />
                    <span>Suspicious access pattern — review recommended.</span>
                  </div>
                ) : null}

                <div className="iden-kv">
                  <span>Timestamp</span>
                  <strong>{selected.timestamp}</strong>
                </div>
                <div className="iden-kv">
                  <span>Type</span>
                  <strong>{selected.type.replace('-', ' ')}</strong>
                </div>
                <div className="iden-kv">
                  <span>Data requested</span>
                  <strong>{selected.dataRequested}</strong>
                </div>
                <div className="iden-kv">
                  <span>Result</span>
                  <strong data-result={selected.result}>{selected.result}</strong>
                </div>
                <div className="iden-kv">
                  <span>Relay / node</span>
                  <strong>{selected.relay}</strong>
                </div>
                <div className="iden-kv">
                  <span>Risk</span>
                  <strong data-risk={selected.risk}>{selected.risk}</strong>
                </div>
                <div className="iden-kv">
                  <span>Audit id</span>
                  <strong>{selected.auditId}</strong>
                </div>

                <div className="iden-inspect__actions">
                  <button
                    type="button"
                    data-active={selected.reviewed ? 'true' : 'false'}
                    onClick={() => onMarkReviewed(selected.id)}
                  >
                    <Check size={13} />
                    {selected.reviewed ? 'Reviewed' : 'Mark reviewed'}
                  </button>

                  <button
                    type="button"
                    data-active={selected.flaggedLocally ? 'true' : 'false'}
                    onClick={() => onFlag(selected.id)}
                  >
                    <Flag size={13} />
                    {selected.flaggedLocally ? 'Flagged' : 'Flag event'}
                  </button>
                </div>

                {relatedConnection ? (
                  <div className="iden-related-connection">
                    <span>Related connection</span>
                    <strong>{relatedConnection.service}</strong>
                    <button
                      type="button"
                      disabled={
                        relatedConnection.required ||
                        relatedConnection.status === 'revoked'
                      }
                      onClick={() => onRevokeConnection(relatedConnection.id)}
                    >
                      {relatedConnection.status === 'revoked'
                        ? 'Already revoked'
                        : relatedConnection.required
                          ? 'Required — cannot revoke'
                          : 'Revoke connection'}
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="iden-empty-state">Select an event to inspect it.</div>
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
