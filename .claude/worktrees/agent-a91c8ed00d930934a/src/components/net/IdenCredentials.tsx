import { Copy, Eye, EyeOff, Lock, PanelRight, Search, ShieldCheck, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { Credential, CredentialStatus } from './idenData'

const FILTERS: { id: CredentialStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'expiring', label: 'Expiring' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'expired', label: 'Expired' },
]

interface IdenCredentialsProps {
  credentials: Credential[]
  onToggleVisibility: (id: string) => void
  onVerifyNow: (id: string) => void
  onNotice: (message: string) => void
}

export function IdenCredentials({
  credentials,
  onToggleVisibility,
  onVerifyNow,
  onNotice,
}: IdenCredentialsProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<CredentialStatus | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(
    credentials[0]?.id ?? null,
  )
  const [detailOpen, setDetailOpen] = useState(true)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const q = search.trim().toLowerCase()

  const filtered = credentials.filter((credential) => {
    if (filter !== 'all' && credential.status !== filter) return false
    if (!q) return true

    return (
      credential.name.toLowerCase().includes(q) ||
      credential.issuer.toLowerCase().includes(q) ||
      credential.id.toLowerCase().includes(q)
    )
  })

  const selected = credentials.find((c) => c.id === selectedId) ?? null

  const handleCopy = async (id: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(id)
        onNotice('IDEN // CREDENTIAL ID COPIED')
      } else {
        onNotice('IDEN // CLIPBOARD UNAVAILABLE')
      }
    } catch {
      onNotice('IDEN // COPY FAILED')
    }
  }

  const handleVerify = (id: string) => {
    setVerifyingId(id)

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = window.setTimeout(() => {
      setVerifyingId(null)
      onVerifyNow(id)
    }, 600)
  }

  const handleToggleVisibility = (credential: Credential) => {
    if (credential.mandatory) {
      onNotice('IDEN // MANDATORY CREDENTIAL VISIBILITY IS LOCKED')
      return
    }

    onToggleVisibility(credential.id)
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
              placeholder="Search credentials"
              aria-label="Search credentials"
            />
            {search ? (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
                <X size={12} />
              </button>
            ) : null}
          </div>
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
            <p className="iden-empty">No credentials match your search.</p>
          ) : (
            filtered.map((credential) => (
              <button
                key={credential.id}
                type="button"
                className="iden-row"
                data-selected={selectedId === credential.id ? 'true' : 'false'}
                onClick={() => {
                  setSelectedId(credential.id)
                  setDetailOpen(true)
                }}
              >
                {credential.mandatory ? (
                  <Lock size={15} className="iden-row__risk-icon" />
                ) : (
                  <ShieldCheck size={15} className="iden-row__risk-icon" />
                )}

                <span className="iden-row__body">
                  <strong>{credential.name}</strong>
                  <small>{credential.issuer}</small>
                </span>

                <span className="iden-row__meta">
                  <em data-status={credential.status}>{credential.status}</em>
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
                <strong>Credential</strong>
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
                <h3>{selected.name}</h3>
                <span className="iden-inspect__owner">{selected.issuer}</span>

                <div className="iden-kv">
                  <span>Status</span>
                  <strong data-status={selected.status}>{selected.status}</strong>
                </div>
                <div className="iden-kv">
                  <span>Credential id</span>
                  <strong>{selected.id}</strong>
                </div>
                <div className="iden-kv">
                  <span>Issued</span>
                  <strong>{selected.issued}</strong>
                </div>
                <div className="iden-kv">
                  <span>Expires</span>
                  <strong>{selected.expires}</strong>
                </div>
                <div className="iden-kv">
                  <span>Access scope</span>
                  <strong>{selected.scope}</strong>
                </div>
                <div className="iden-kv">
                  <span>Last verified</span>
                  <strong>{selected.lastVerified}</strong>
                </div>
                <div className="iden-kv">
                  <span>Classification</span>
                  <strong>{selected.classification}</strong>
                </div>

                <div className="iden-inspect__actions">
                  <button type="button" onClick={() => handleCopy(selected.id)}>
                    <Copy size={13} /> Copy id
                  </button>

                  <button
                    type="button"
                    data-locked={selected.mandatory ? 'true' : 'false'}
                    onClick={() => handleToggleVisibility(selected)}
                  >
                    {selected.mandatory ? (
                      <>
                        <Lock size={13} /> Visibility locked
                      </>
                    ) : selected.publicVisible ? (
                      <>
                        <Eye size={13} /> Public
                      </>
                    ) : (
                      <>
                        <EyeOff size={13} /> Private
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    className="iden-verify-now"
                    disabled={verifyingId === selected.id}
                    onClick={() => handleVerify(selected.id)}
                  >
                    {verifyingId === selected.id ? 'Verifying…' : 'Verify Now'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="iden-empty-state">Select a credential to inspect it.</div>
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
