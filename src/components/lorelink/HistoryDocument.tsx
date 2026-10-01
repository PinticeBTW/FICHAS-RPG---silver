import { lazy, Suspense, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { historyPlainText } from '../../lib/historyDocument'
import { SharedMediaImage } from '../shared/SharedMediaImage'
import { lorePeriod, lorePeriods, loreUserTags, withLorePeriod, type LorePeriod } from '../../lib/lorelinkPeriods'
import type { LoreEntity, LoreRevision } from '../../lib/lorelinkTypes'
const HistoryRichEditor = lazy(() => import('./HistoryRichEditor'))

interface Props {
  entity: LoreEntity; canEdit: boolean; personal: boolean; isDraft: boolean;
  revisions: LoreRevision[] | null; onChange: (entity: LoreEntity) => void; onHistory: () => void; onDelete: () => void;
}
export function HistoryDocument({ entity: e, canEdit, personal, isDraft, revisions, onChange, onHistory, onDelete }: Props) {
  const [reading, setReading] = useState(!canEdit || Boolean(e.source_kind))
  const [tagging, setTagging] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [error, setError] = useState<string | null>(null)
  const period = lorePeriod(e)
  const tags = loreUserTags(e.tags)
  const editable = canEdit && !e.source_kind
  const update = (patch: Partial<LoreEntity>) => onChange({ ...e, ...patch })
  const setPeriod = (value: LorePeriod) => {
    try { update({ tags: withLorePeriod(e.tags, value) }); setError(null) }
    catch (reason) { setError((reason as Error).message) }
  }
  const addTag = () => {
    const value = newTag.trim()
    if (!value) return
    if (tags.includes(value)) { setNewTag(''); setTagging(false); return }
    if (value.length > 60 || e.tags.length >= 30) { setError('Usa etiquetas até 60 caracteres e um máximo de 30, incluindo o período.'); return }
    try { update({ tags: withLorePeriod([...tags, value], period) }); setError(null); setNewTag(''); setTagging(false) }
    catch (reason) { setError((reason as Error).message) }
  }
  return <section className="history-paper" aria-label="Documento">
    <div className="history-paper-tools"><span>{e.archived ? 'Página arquivada' : isDraft ? 'Uma página em branco. Sem complicações.' : 'A tua história, ao teu ritmo.'}</span>
      {editable && <button aria-pressed={reading} onClick={() => setReading(!reading)}>{reading ? 'Escrever' : 'Ler'}</button>}
      {!isDraft && canEdit && <details className="history-options"><summary>•••</summary><div>
        <button onClick={onHistory}>Versões anteriores</button>
        {e.archived && <button onClick={() => update({ archived: false, visibility: 'private' })}>Restaurar página</button>}
        {!e.source_kind && <button className="history-delete" onClick={onDelete}>Apagar página</button>}
        {!personal && <label>Visibilidade<select aria-label="Visibilidade da página" value={e.visibility} onChange={event => {
          const visibility = event.target.value as LoreEntity['visibility']
          if (visibility === 'revealed' && !window.confirm('Partilhar esta página com os jogadores autorizados deste universo?')) return
          update({ visibility })
        }}><option value="private">Só mestre</option><option value="revealed">Partilhada</option></select></label>}
      </div></details>}
    </div>
    {reading ? <h2>{e.name || 'Sem título'}</h2> : <input className="history-title" aria-label="Título da página" placeholder="Sem título" value={e.name === 'Sem título' ? '' : e.name} maxLength={160} readOnly={!editable}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.closest('section')?.querySelector<HTMLElement>('[role=textbox]')?.focus() } }} onChange={event => update({ name: event.target.value })} />}
    <div className="history-organize" aria-label="Organização da página">
      <select aria-label="Período da página" value={period} disabled={!canEdit} onChange={event => setPeriod(event.target.value as LorePeriod)}>
        <option value="unassigned">Escolher período</option><option value="past">Passado</option><option value="campaign">Durante a campanha</option>
      </select>
      {tags.map((tag, index) => <span className="history-tag" key={`${index}:${tag}`}>{tag}{canEdit && <button aria-label={`Retirar etiqueta ${tag}`} onClick={() => update({ tags: withLorePeriod(tags.filter(t => t !== tag), period) })}><X size={12} /></button>}</span>)}
      {canEdit && (tagging ? <form className="history-add-tag" onSubmit={event => { event.preventDefault(); addTag() }}>
        <input autoFocus aria-label="Nova etiqueta" placeholder="Ex.: sessão 4, memórias…" value={newTag} maxLength={60} onChange={event => setNewTag(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setNewTag(''); setTagging(false) } }} />
        <button type="submit" aria-label="Adicionar etiqueta"><Plus size={14} /></button><button type="button" aria-label="Cancelar etiqueta" onClick={() => { setNewTag(''); setTagging(false) }}><X size={14} /></button>
      </form> : <button className="history-tag-trigger" onClick={() => setTagging(true)}><Plus size={13} /> Etiqueta</button>)}
      {!personal && e.visibility === 'revealed' && <span className="history-shared">Partilhada</span>}
    </div>
    {error && <p role="alert" className="history-inline-error">{error}</p>}
    {/* Legacy summaries, images and dates remain intact, without character UI. */}
    {!isDraft && (e.summary || e.image || e.fictional_date) && <details className="history-previous"><summary>Conteúdo anterior</summary>
      {e.image && <SharedMediaImage source={e.image} alt={e.name} />}{e.fictional_date && <p>{e.fictional_date}</p>}{e.summary && <p>{e.summary}</p>}
    </details>}
    {e.source_kind && <p className="history-source">Este texto está ligado ao arquivo original. A escrita continua no editor da fonte.</p>}
    <Suspense fallback={<p role="status">A preparar o texto…</p>}><HistoryRichEditor value={e.body} readOnly={reading || !editable} onChange={body => update({ body })} /></Suspense>
    {revisions !== null && <section className="history-versions"><h3>Versões anteriores</h3>{!revisions.length && <p>Ainda não há versões anteriores.</p>}
      {revisions.map(rev => <details key={rev.id}><summary>{new Date(rev.saved_at).toLocaleString('pt-PT')}</summary><pre>{historyPlainText(rev.snapshot.body)}</pre>
        <button onClick={() => { if (window.confirm('Recuperar esta versão? A versão atual fica no histórico.')) onChange({ ...rev.snapshot, id: e.id, workspace_os_id: e.workspace_os_id, character_id: e.character_id, revision: e.revision, mutation_id: e.mutation_id, source_kind: e.source_kind, visibility: 'private' }) }}>Recuperar versão</button>
      </details>)}
    </section>}
    <footer className="history-paper-footer">{canEdit ? 'Gravação automática' : 'Só leitura'}<span>{lorePeriods[period].label}</span></footer>
  </section>
}
