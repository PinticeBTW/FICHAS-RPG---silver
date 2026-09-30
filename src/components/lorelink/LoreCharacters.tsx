import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpenText } from 'lucide-react'
import { createLoreApi, loreError } from '../../lib/lorelinkService'
import type { LoreCharacter } from '../../lib/lorelinkTypes'

interface Props {
  actor: string; character: string | null; sheet: string | null; kind: string | null;
  children: (character: string) => React.ReactNode;
}
export function LoreCharacters({ actor, character, sheet, kind, children }: Props) {
  const api = useMemo(() => createLoreApi(actor), [actor])
  const preferenceKey = `history-private-archive:${actor}`
  const lastArchive = (() => {
    try { return window.sessionStorage.getItem(preferenceKey) } catch { return null }
  })()
  const [retry, setRetry] = useState(0)
  const requestKey = JSON.stringify([character, sheet, kind, retry])
  const [result, setResult] = useState<{ key: string; characters: LoreCharacter[] | null; error: string | null } | null>(null)
  const characters = result?.key === requestKey ? result.characters : null
  const error = result?.key === requestKey ? result.error : null
  useEffect(() => {
    const abort = new AbortController()
    void api.characters(abort.signal).then(items => {
      if (!abort.signal.aborted) setResult({ key: requestKey, characters: items, error: null })
    }).catch(reason => { if (!abort.signal.aborted) setResult({ key: requestKey, characters: null, error: loreError(reason) }) })
    return () => abort.abort()
  }, [api, requestKey])
  // Keep the existing server-authorised private storage, without a character
  // picker in the writing flow. Explicit inaccessible links never fall back.
  const selected = characters?.find(item => character ? item.character_id === character : sheet ? item.subject_id === sheet && item.subject_kind === kind : item.character_id === lastArchive)
    ?? (!character && !sheet ? characters?.find(item => item.subject_id === actor) : undefined)
    ?? (!character && !sheet ? characters?.[0] : undefined)
  useEffect(() => {
    // This is only a navigation preference. An ID is used only after matching
    // the current server-authorised list; it never grants access to an archive.
    if (selected) {
      try { window.sessionStorage.setItem(preferenceKey, selected.character_id) } catch { /* Writing still works with storage disabled. */ }
    }
  }, [preferenceKey, selected])
  if (selected) return children(selected.character_id)
  return <main className="lore-shell lore-unavailable"><BookOpenText /><h1>História</h1>
    {error ? <><p role="alert">{error}</p><button onClick={() => setRetry(n => n + 1)}>Tentar novamente</button></>
      : !characters ? <p role="status">A abrir os teus textos…</p>
        : <p role="alert">{characters.length ? 'Este arquivo não está disponível para esta conta.' : 'Ainda não há um arquivo associado à tua conta. Confirma a configuração da tua ficha em THE NET.'}</p>}
    <Link to="/app/sheets">Voltar ao início</Link>
  </main>
}
