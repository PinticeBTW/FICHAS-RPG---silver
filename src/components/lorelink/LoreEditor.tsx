import { useState } from 'react'
import { Archive, BookOpenText, Expand, Focus, History, ImagePlus, Link2, Minimize2, Pencil, X } from 'lucide-react'
import { NetSearchMarkdownEditor } from '../net/NetSearchMarkdownEditor'
import NetSearchMarkdown from '../net/NetSearchMarkdown'
import { SharedMediaImage } from '../shared/SharedMediaImage'
import { loreKinds, type LoreData, type LoreEntity, type LoreKind, type LoreRevision } from '../../lib/lorelinkTypes'

const sections: Partial<Record<LoreKind, string[]>> = {
  person: ['Descrição', 'Personalidade', 'Passado', 'Objetivos', 'Notas'],
  event: ['O que aconteceu', 'Participantes', 'Local', 'Consequências'],
  location: ['Descrição', 'História', 'Pessoas', 'Acontecimentos associados'],
  organization: ['Descrição', 'História', 'Pessoas', 'Acontecimentos associados'],
}
interface Props {
  entity: LoreEntity; data: LoreData; uploading: boolean; revisions: LoreRevision[] | null;
  saveLabel: string; saveFailed: boolean; onRetry: () => void;
  onChange: (entity: LoreEntity) => void; onClose: () => void; onFocus: () => void; onMap: () => void;
  onRelation: (id?: string) => void; onSelect: (id: string) => void;
  onHistory: () => void; onUpload: (file: File) => void;
}
export function LoreEditor({ entity: e, data, uploading, revisions, saveLabel, saveFailed, onRetry, onChange, onClose, onFocus, onMap,
  onRelation, onSelect, onHistory, onUpload }: Props) {
  const [expanded, setExpanded] = useState(false)
  const canEdit = data.role !== 'player'
  const [mode, setMode] = useState<'read' | 'edit'>(() => e.revision === 0 && canEdit ? 'edit' : 'read')
  const reading = mode === 'read' || !canEdit
  const personal = Boolean(data.character_id)
  const source = Boolean(e.source_kind)
  const update = (patch: Partial<LoreEntity>) => onChange({ ...e, ...patch })
  const onMapNow = data.nodes.some(n => n.entity_id === e.id && !n.hidden)
  const expandLabel = reading ? expanded ? 'Recolher leitura' : 'Expandir leitura' : expanded ? 'Recolher editor' : 'Expandir editor'
  return <aside className={`lore-editor ${reading ? 'lore-editor--reading' : ''} ${expanded ? 'lore-editor--expanded' : ''}`} aria-label="Ficha selecionada">
    <header className="lore-editor__header"><div className="lore-editor__heading"><span>{loreKinds[e.kind]}</span><small role="status">{saveLabel}</small>
      {saveFailed && <button onClick={onRetry}>Repetir gravação</button>}</div><div>
      <button title={expandLabel} aria-label={expandLabel} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={18} /> : <Expand size={18} />}</button>
      <button aria-label="Fechar ficha" onClick={onClose}><X size={18} /></button></div></header>
    <div className="lore-reader-tabs" role="group" aria-label="Modo da ficha">
      <button aria-pressed={reading} onClick={() => setMode('read')}><BookOpenText size={16} /> Ler</button>
      {canEdit && <button aria-pressed={!reading} onClick={() => setMode('edit')}><Pencil size={16} /> Editar</button>}
    </div>
    <div className="lore-editor__body">
      {e.image && <SharedMediaImage className="lore-editor__image" source={e.image} alt={`Retrato de ${e.name}`} />}
      {reading ? <article className="lore-reader" aria-label={`História de ${e.name}`}>
        <h2>{e.name}</h2>
        <div className="lore-reader-meta"><span>{loreKinds[e.kind]}</span>{e.fictional_date && <span>{e.fictional_date}</span>}
          {e.archived && <span>Arquivada</span>}</div>
        {e.summary && <p className="lore-reader-summary">{e.summary}</p>}
        {e.tags.length > 0 && <ul className="lore-reader-tags" aria-label="Etiquetas">{e.tags.map((tag, index) => <li key={`${index}:${tag}`}>{tag}</li>)}</ul>}
        {e.body ? <NetSearchMarkdown content={e.body} /> : <div className="lore-reader-empty"><p>Esta ficha ainda não tem texto.</p>
          {canEdit && !source && <button onClick={() => setMode('edit')}>Escrever história</button>}</div>}
      </article> : <>
      {canEdit && !e.archived && <div className="lore-actions"><label className="lore-upload"><ImagePlus size={16} />{uploading ? 'A enviar imagem…' : 'Imagem privada'}
        <input type="file" aria-label="Imagem da ficha" accept="image/png,image/jpeg,image/webp,image/avif" disabled={uploading || e.revision === 0}
          onChange={event => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = '' }} /></label>
        {e.image && <button onClick={() => update({ image: null })}>Retirar imagem</button>}</div>}
      <label>Nome<input value={e.name} maxLength={160} readOnly={!canEdit || source} onChange={event => update({ name: event.target.value })} /></label>
      <label>Tipo<select value={e.kind} disabled={!canEdit} onChange={event => update({ kind: event.target.value as LoreKind })}>
        {Object.entries(loreKinds).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {personal ? <p className="lore-notice">Privado · só tu. Esta ficha faz parte da história de {data.character_name}.</p> : <label>Visibilidade<select value={e.visibility} disabled={!canEdit || e.revision === 0} onChange={event => {
        const visibility = event.target.value as LoreEntity['visibility']
        if (visibility === 'revealed' && !window.confirm('Revelar esta ficha aos jogadores autorizados deste universo? As outras fichas e as relações continuam com a sua própria visibilidade.')) return
        update({ visibility })
      }}><option value="private">Privado · só GM</option><option value="revealed">Revelado aos jogadores</option></select></label>}
      {e.kind === 'event' && <label>Data ou período no universo<input value={e.fictional_date} maxLength={200} readOnly={!canEdit}
        placeholder="Ex.: inverno do ano 42 / antes da queda" onChange={event => update({ fictional_date: event.target.value })} /></label>}
      <label>Resumo<textarea rows={3} value={e.summary} maxLength={2000} readOnly={!canEdit || source} onChange={event => update({ summary: event.target.value })} /></label>
      <label>Etiquetas <small>separadas por vírgulas</small><input key={`${e.id}:tags`} defaultValue={e.tags.join(', ')} readOnly={!canEdit}
        onChange={event => update({ tags: event.target.value.split(',').map(t => t.trim()).filter(Boolean).slice(0,30) })} /></label>
      {source && <p className="lore-notice">Conteúdo ligado ao lore existente, com o mesmo ID. Edita o texto no editor original do Search; as alterações aparecem aqui ao recarregar.</p>}
      <div className="lore-body-label">História</div>
      {canEdit && !source ? <>
        {sections[e.kind] && <details className="lore-suggestions"><summary>Adicionar uma secção sugerida</summary><div className="lore-actions">
          {sections[e.kind]!.map(section => <button key={section} onClick={() => update({ body: `${e.body}${e.body ? '\n\n' : ''}## ${section}\n\n` })}>{section}</button>)}
        </div></details>}
        <NetSearchMarkdownEditor value={e.body} onChange={body => update({ body })} maxLength={500000} placeholder="Escreve livremente a história desta ficha…" />
      </> : <NetSearchMarkdown content={e.body || 'Ainda sem texto.'} />}
      </>}
      <section className="lore-relations"><h3>Relações</h3>
        {data.relations.filter(r => !r.archived && (r.source === e.id || r.target === e.id)).map(r => {
          const otherId = r.source === e.id ? r.target : r.source
          const other = data.entities.find(item => item.id === otherId)
          return <div key={r.id} className="lore-relation-row"><button onClick={() => onSelect(otherId)}>{r.source === e.id ? '→' : '←'} {other?.name}</button>
            <button onClick={() => onRelation(r.id)}>{r.label} <small>{r.visibility === 'private' ? 'Privada' : 'Revelada'}</small></button></div>
        })}
        {canEdit && !e.archived && <button onClick={() => onRelation()}><Link2 size={16} /> Nova relação</button>}
      </section>
      <div className="lore-actions"><button disabled={e.archived} onClick={onFocus}><Focus size={16} /> Focar nesta ficha</button>
        {canEdit && !e.archived && <button onClick={onMap}>{onMapNow ? 'Retirar do mapa' : 'Colocar no mapa'}</button>}
        {canEdit && !reading && <button onClick={onHistory}><History size={16} /> Versões anteriores</button>}
      </div>
      {!reading && revisions !== null && <section className="lore-revisions"><h3>Versões guardadas</h3>{!revisions.length && <p>Ainda sem versões anteriores.</p>}
        {revisions.map(rev => <details key={rev.id}><summary>{new Date(rev.saved_at).toLocaleString('pt-PT')} · v{rev.snapshot.revision}</summary>
          <p>{rev.snapshot.name}</p><pre>{rev.snapshot.body}</pre>
          <button onClick={() => { if (window.confirm('Recuperar esta versão? A versão atual ficará no histórico. A ficha recuperada ficará privada.')) {
            onChange({ ...rev.snapshot, id: e.id, workspace_os_id: e.workspace_os_id, revision: e.revision, mutation_id: e.mutation_id,
              visibility: 'private', source_kind: e.source_kind })
          } }}>Recuperar versão</button></details>)}
      </section>}
      {canEdit && !reading && <button className="lore-archive" onClick={() => {
        if (window.confirm(e.archived ? 'Recuperar esta ficha? Ficará privada e as relações anteriores voltarão a estar disponíveis.' : 'Arquivar esta ficha? Sai do mapa e oculta as relações. Podes recuperá-la em Arquivadas.'))
          update({ archived: !e.archived, ...(e.archived ? { visibility: 'private' } : {}) })
      }}><Archive size={16} /> {e.archived ? 'Recuperar ficha' : 'Arquivar ficha'}</button>}
      <p className="lore-metadata">{e.updated_at ? `Editada em ${new Date(e.updated_at).toLocaleString('pt-PT')} · versão ${e.revision}` : 'Primeira gravação pendente'}</p>
    </div>
  </aside>
}
