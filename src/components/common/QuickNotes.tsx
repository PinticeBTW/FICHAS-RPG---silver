import { BookOpenText, X } from 'lucide-react'
import { useId, useRef, useState, type ReactNode } from 'react'

// Keep the editor mounted when hidden so unsaved drafts survive.
export function QuickNotes({ children }: { children: ReactNode }) {
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  return <>
    <button ref={triggerRef} type="button" className="gg-quick-notes-trigger" aria-expanded={open} aria-controls={panelId} onClick={() => {
      setLoaded(true)
      setOpen((current) => !current)
    }}><BookOpenText size={16} /> Notas rápidas</button>
    <section id={panelId} hidden={!open} className="gg-quick-notes gg-native-tools" aria-label="Notas rápidas">
      <header className="gg-quick-notes-header"><h2>NOTAS RÁPIDAS</h2>
        <button type="button" aria-label="Fechar notas rápidas" onClick={() => { setOpen(false); triggerRef.current?.focus() }}><X size={18} /></button>
      </header>
      <div className="gg-quick-notes-body">{loaded ? children : null}</div>
    </section>
  </>
}
