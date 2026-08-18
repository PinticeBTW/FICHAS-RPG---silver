import { BadgeCheck, MapPin, Search, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'

import type { Identity, IdentityType, TrustBand } from './idenData'

type TypeFilter = 'all' | IdentityType | 'verified' | 'flagged'

const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'citizen', label: 'Citizens' },
  { id: 'corporation', label: 'Corporations' },
  { id: 'authority', label: 'Authorities' },
  { id: 'organisation', label: 'Organisations' },
  { id: 'unresolved', label: 'Anomalous' },
  { id: 'verified', label: 'Verified only' },
  { id: 'flagged', label: 'Flagged only' },
]

const TRUST_FILTERS: { id: TrustBand | 'all'; label: string }[] = [
  { id: 'all', label: 'Any band' },
  { id: 'high', label: 'High' },
  { id: 'stable', label: 'Stable' },
  { id: 'review', label: 'Review' },
  { id: 'restricted', label: 'Restricted' },
  { id: 'unknown', label: 'Unknown' },
]

const VERIFICATION_EXPLANATIONS: Record<string, string> = {
  verified: 'Identity confirmed against NetWatch civic records.',
  'infrastructure-authority': 'Licensed infrastructure operator authorised by NetWatch.',
  'authority-verified': 'Verified government or public-safety authority.',
  anomalous: 'Verification could not be completed. Identity origin is unresolved.',
  pending: 'Verification currently in progress.',
  unverified: 'No verification on record.',
}

interface IdenDirectoryProps {
  identities: Identity[]
  onOpenProfile: (id: string) => void
  onNotice: (message: string) => void
}

export function IdenDirectory({ identities, onOpenProfile, onNotice }: IdenDirectoryProps) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [trustFilter, setTrustFilter] = useState<TrustBand | 'all'>('all')
  const [districtFilter, setDistrictFilter] = useState<string | null>(null)

  const q = search.trim().toLowerCase()

  const filtered = identities.filter((identity) => {
    if (districtFilter && identity.district !== districtFilter) return false

    if (trustFilter !== 'all' && identity.trustBand !== trustFilter) return false

    if (typeFilter === 'verified') {
      const isVerified =
        identity.verification === 'verified' ||
        identity.verification === 'authority-verified' ||
        identity.verification === 'infrastructure-authority'
      if (!isVerified) return false
    } else if (typeFilter === 'flagged') {
      if (!identity.flags?.length) return false
    } else if (typeFilter !== 'all' && identity.type !== typeFilter) {
      return false
    }

    if (!q) return true

    return (
      identity.name.toLowerCase().includes(q) ||
      identity.handle.toLowerCase().includes(q) ||
      identity.displayId.toLowerCase().includes(q) ||
      identity.district?.toLowerCase().includes(q) ||
      identity.organisations?.some((org) => org.name.toLowerCase().includes(q))
    )
  })

  const handleVerificationClick = (identity: Identity) => {
    onNotice(
      VERIFICATION_EXPLANATIONS[identity.verification] ??
        'No verification detail on record.',
    )
  }

  return (
    <div className="iden-main iden-main--full">
      <div className="iden-toolbar">
        <div className="iden-search">
          <Search size={13} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, handle, IDEN id, organisation or district"
            aria-label="Search identity directory"
          />
          {search ? (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
              <X size={12} />
            </button>
          ) : null}
        </div>

        {districtFilter ? (
          <button
            type="button"
            className="iden-clear-filters"
            onClick={() => setDistrictFilter(null)}
          >
            <MapPin size={12} /> {districtFilter} <X size={11} />
          </button>
        ) : null}
      </div>

      <div className="iden-chip-row">
        {TYPE_FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            data-active={typeFilter === option.id ? 'true' : 'false'}
            onClick={() => setTypeFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="iden-chip-row iden-chip-row--compact">
        {TRUST_FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            data-active={trustFilter === option.id ? 'true' : 'false'}
            onClick={() => setTrustFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="iden-directory-results">
        {filtered.length === 0 ? (
          <p className="iden-empty">No identities match your search.</p>
        ) : (
          filtered.map((identity) => (
            <div key={identity.id} className="iden-directory-row">
              <button
                type="button"
                className="iden-directory-row__main"
                onClick={() => onOpenProfile(identity.id)}
                data-corrupted={identity.corrupted ? 'true' : 'false'}
              >
                <span className="iden-directory-row__avatar" data-type={identity.type}>
                  {identity.name.slice(0, 1).toUpperCase()}
                </span>

                <span className="iden-directory-row__body">
                  <strong>{identity.name}</strong>
                  <small>@{identity.handle}</small>
                </span>

                <span className="iden-directory-row__type">{identity.type}</span>

                {identity.district ? (
                  <button
                    type="button"
                    className="iden-directory-row__district"
                    onClick={(event) => {
                      event.stopPropagation()
                      setDistrictFilter(identity.district ?? null)
                    }}
                  >
                    <MapPin size={10} /> {identity.district}
                  </button>
                ) : (
                  <span className="iden-directory-row__district iden-directory-row__district--none">
                    —
                  </span>
                )}

                <span className="iden-directory-row__trust">
                  {identity.trustScore !== undefined ? (
                    <em data-band={identity.trustBand}>{identity.trustScore}</em>
                  ) : identity.corporateTrust ? (
                    <em data-band="high">{identity.corporateTrust.replace('-', ' ')}</em>
                  ) : (
                    <em data-band="unknown">—</em>
                  )}
                </span>

                <span className="iden-directory-row__risk" data-risk={identity.securityRisk}>
                  {identity.securityRisk}
                </span>
              </button>

              <button
                type="button"
                className="iden-directory-row__verification"
                onClick={() => handleVerificationClick(identity)}
                aria-label={`Verification details for ${identity.name}`}
                title="Verification details"
              >
                {identity.verification === 'anomalous' ? (
                  <ShieldAlert size={13} />
                ) : (
                  <BadgeCheck size={13} />
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
