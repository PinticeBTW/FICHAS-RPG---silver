import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpenText, UserRound } from 'lucide-react'
import { createLoreApi, loreError } from '../../lib/lorelinkService'
import type { LoreCharacter } from '../../lib/lorelinkTypes'

interface Props {
  actor: string; character: string | null; sheet: string | null; kind: string | null; gm: boolean;
  children: (character: string) => React.ReactNode;
}
export function LoreCharacters({ actor, character, sheet, kind, gm, children }: Props) {
  const api = useMemo(() => createLoreApi(actor), [actor])
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
  const selected = characters?.find(item => character ? item.character_id === character : sheet && item.subject_id === sheet && item.subject_kind === kind)
  if (selected) return children(selected.character_id)
  return <main className="lore-shell lore-character-picker">
    <header className="lore-header"><div className="lore-brand"><BookOpenText /><div><h1>História</h1><span>AS TUAS PERSONAGENS</span></div></div>
      <nav><Link to="/app/sheets">Fichas RPG</Link>{gm && <Link to="/app/history">Universo do GM</Link>}</nav></header>
    <section className="lore-character-intro"><h2>A tua personagem. A tua história.</h2>
      <p>Escolhe a personagem para escrever o seu passado, guardar notas e organizar pessoas, lugares e acontecimentos num mapa de bolhas.</p>
      <p className="lore-notice">Cada personagem tem o seu espaço privado. Só tu tens acesso através do site.</p>
      {error ? <><p role="alert">{error}</p><button onClick={() => setRetry(n => n + 1)}>Tentar novamente</button></>
        : !characters ? <p role="status">A procurar as tuas personagens…</p>
          : <>{(character || sheet) && <p role="alert">Esta personagem não está disponível para esta conta. Escolhe uma das tuas personagens.</p>}
            {!characters.length && <p>Ainda não tens personagens com um universo associado. Abre a tua ficha RPG e confirma a sua configuração em THE NET.</p>}
            <div className="lore-character-grid">{characters.map(item => <Link className="lore-character-card" key={item.character_id}
              to={`/app/history?character=${encodeURIComponent(item.character_id)}`}><UserRound size={30} />
              <strong>{item.character_name}</strong><span>{item.scope === 'veil' ? 'VEIL / New Vega' : 'ALTARA'}</span><small>Abrir a minha história →</small></Link>)}</div></>}
    </section>
  </main>
}
