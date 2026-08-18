import {
  AlertTriangle,
  Check,
  Download,
  Globe2,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useState, type CSSProperties } from 'react'

import { getAltaraAppDefinition, type AltaraAppId } from './altaraAppCatalog'

export interface AltaraStoreProduct {
  readonly id: Extract<AltaraAppId, 'altara-bank' | 'nova-bank' | 'altara-news' | 'altara-music' | 'altara-wave'>
  readonly installed: boolean
  readonly running: boolean
  readonly disclosure: string
  readonly onInstall: () => Promise<void>
  readonly onUninstall: () => Promise<void>
  readonly onOpen: () => void
}

interface AltaraStoreAppProps {
  readonly products: readonly AltaraStoreProduct[]
  readonly disabled: boolean
  readonly error?: string
}

export function AltaraStoreApp({
  products,
  disabled,
  error,
}: AltaraStoreAppProps) {
  const [confirmingRemoval, setConfirmingRemoval] = useState<AltaraStoreProduct['id'] | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const run = async (operation: () => Promise<void>) => {
    try {
      setLocalError(null)
      await operation()
    } catch (operationError) {
      setLocalError(operationError instanceof Error
        ? operationError.message
        : 'The catalogue update could not be completed.')
    }
  }

  return (
    <section className="altara-store" aria-label="ALTARA STORE catalogue">
      <header className="altara-store__header">
        <span><Globe2 size={19} aria-hidden="true" /></span>
        <div>
          <p>ALTARA OS // VERIFIED CATALOGUE</p>
          <h2>ALTARA STORE</h2>
        </div>
        <small><ShieldCheck size={13} aria-hidden="true" /> OS-COMPATIBLE</small>
      </header>

      <div className="altara-store__body">
        <aside>
          <p>CATALOGUE</p>
          <strong>ALTARA APPLICATIONS</strong>
          <span>{products.length} products available</span>
          <small>System applications are included with ALTARA OS and cannot be removed.</small>
        </aside>

        {products.map((product) => {
          const app = getAltaraAppDefinition(product.id)
          const Icon = app.icon
          return (
            <article key={product.id} className="altara-store__product" style={{ '--app-rgb': app.accentRgb } as CSSProperties}>
              <div className="altara-store__product-icon"><Icon size={30} strokeWidth={1.5} aria-hidden="true" /></div>
              <div className="altara-store__product-copy">
                <p>{app.category} // ALTARA</p>
                <h3>{app.name}</h3>
                <span>{app.description}</span>
                <div>
                  <small>{product.installed ? <><Check size={12} aria-hidden="true" /> INSTALLED</> : 'AVAILABLE'}</small>
                  <small>{app.category === 'NEWS'
                    ? 'GLOBAL EDITION'
                    : app.category === 'MUSIC'
                      ? 'GLOBAL CATALOGUE'
                      : app.category === 'SOCIAL'
                        ? 'GLOBAL COMMUNITY'
                      : 'PERSONAL BANKING'}</small>
                </div>
              </div>

              <div className="altara-store__actions">
                {product.installed ? (
                  <>
                    <button type="button" className="altara-store__primary" disabled={disabled} onClick={product.onOpen}>
                      {product.running ? 'FOCUS' : 'OPEN'}
                    </button>
                    {confirmingRemoval === product.id ? (
                      <div className="altara-store__confirm" role="group" aria-label={`Confirm ${app.name} removal`}>
                        <span>{product.disclosure}</span>
                        <button type="button" disabled={disabled} onClick={() => { void run(async () => { await product.onUninstall(); setConfirmingRemoval(null) }) }}>CONFIRM</button>
                        <button type="button" disabled={disabled} onClick={() => setConfirmingRemoval(null)}>CANCEL</button>
                      </div>
                    ) : (
                      <button type="button" className="altara-store__secondary" disabled={disabled} onClick={() => setConfirmingRemoval(product.id)}><Trash2 size={13} aria-hidden="true" /> UNINSTALL</button>
                    )}
                  </>
                ) : (
                  <button type="button" className="altara-store__primary" disabled={disabled} onClick={() => { void run(product.onInstall) }}><Download size={14} aria-hidden="true" /> {disabled ? 'UPDATING…' : 'INSTALL'}</button>
                )}
              </div>
            </article>
          )
        })}

        {(localError ?? error) ? (
          <p className="altara-store__error" role="alert"><AlertTriangle size={13} aria-hidden="true" /> {localError ?? error}</p>
        ) : (
          <p className="altara-store__disclosure">Installation adds only the selected application launcher state. Removing an app never deletes accounts, saved articles, music libraries, social history, or world content.</p>
        )}
      </div>
    </section>
  )
}
