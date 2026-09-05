import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useBlocker, useBeforeUnload, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookOpenText, Download, List, Network, Plus, Search, X } from 'lucide-react'
import type { XYPosition } from '@xyflow/react'
import { useAuth } from '../hooks/useAuth'
import { LoreMap, type LoreMapInstance } from '../components/lorelink/LoreMap'
import { LoreEditor } from '../components/lorelink/LoreEditor'
import { LoreCharacters } from '../components/lorelink/LoreCharacters'
import { createLoreApi, downloadLore, loreError, type LoreApi } from '../lib/lorelinkService'
import { LoreQueue } from '../lib/lorelinkQueue'
import { filterLore, loreKinds, relationSuggestions, type LoreKind, type LoreRelation,
  type LoreRevision, type LoreScope, type LoreSource } from '../lib/lorelinkTypes'
import { uploadSharedImage } from '../lib/media/mediaStorage'
import { NET_GM_WORKSPACE_CHANGED_EVENT, writeNetGmWorkspace } from '../lib/netGmWorkspaceStore'
import '../styles/lorelink.css'

export function HistoryPage() {
  const { profile } = useAuth()
  const [params] = useSearchParams()
  if (!profile) return null
  const character = params.get('character'), sheet = params.get('sheet')
  if (profile.role !== 'gm' || character || sheet || params.get('personal')) return <LoreCharacters key={profile.id} actor={profile.id}
    character={character} sheet={sheet} kind={params.get('kind')} gm={profile.role === 'gm'}>
    {id => <HistorySession key={`${profile.id}:${id}`} actor={profile.id} character={id} />}
  </LoreCharacters>
  return <HistorySession key={profile.id} actor={profile.id} />
}

function HistorySession({ actor, character }: { actor: string; character?: string }) {
  const api = useMemo(() => createLoreApi(actor, character), [actor, character])
  const [queue, setQueue] = useState<LoreQueue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    let session: LoreQueue | null = null
    void (async () => {
      const ctx = await api.context(abort.signal)
      const data = await api.read(ctx.scope, abort.signal)
      if (abort.signal.aborted) return
      if ((data.character_id ?? undefined) !== character) throw new Error('LORELINK_FORBIDDEN')
      session = new LoreQueue(data, api.save); setQueue(session); setError(null)
    })().catch(reason => { if (!abort.signal.aborted) setError(loreError(reason)) })
    return () => { abort.abort(); session?.dispose() }
  }, [api, reload, character])
  if (error) return <main className="lore-shell lore-unavailable"><BookOpenText size={32} /><h1>História</h1><p role="alert">{error}</p>
    <button className="signal-button" onClick={() => { setError(null); setReload(n => n + 1) }}>Tentar novamente</button><Link to="/app/sheets">Voltar às fichas RPG</Link></main>
  if (!queue) return <main className="lore-shell lore-unavailable"><p role="status">A abrir a História…</p></main>
  return <HistoryWorkspace key={`${queue.data.scope}:${reload}`} queue={queue} api={api} actor={actor}
    onReload={() => { setQueue(null); setReload(n => n + 1) }} />
}

function HistoryWorkspace({ queue, api, actor, onReload }: { queue: LoreQueue; api: LoreApi; actor: string; onReload: () => void }) {
  useSyncExternalStore(queue.subscribe, queue.snapshot)
  const data = queue.data
  const canEdit = data.role !== 'player'
  const personal = Boolean(data.character_id)
  const [view, setView] = useState<'map' | 'cards'>('map')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [archived, setArchived] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const selectedId = useRef<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [create, setCreate] = useState<XYPosition | null>(null)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<LoreKind>('person')
  const [relation, setRelation] = useState<LoreRelation | null>(null)
  const [revisions, setRevisions] = useState<LoreRevision[] | null>(null)
  const [sources, setSources] = useState<LoreSource[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [workspaceChanged, setWorkspaceChanged] = useState(false)
  const flow = useRef<LoreMapInstance | null>(null)
  const generation = useRef(0)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const dirty = queue.dirty || uploading || busy
  useBeforeUnload(event => { if (dirty) { event.preventDefault(); event.returnValue = '' } })
  const blocker = useBlocker(dirty)
  const modalOpen = Boolean(create || relation || sources || blocker.state === 'blocked')
  useEffect(() => {
    if (!modalOpen) return
    const previous = document.activeElement as HTMLElement | null
    const modal = () => [...document.querySelectorAll<HTMLElement>('.lore-modal')].at(-1)
    const controls = () => [...(modal()?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]') ?? [])]
    const frame = requestAnimationFrame(() => (modal()?.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled)') ?? controls()[0])?.focus())
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = controls(), first = items[0], last = items.at(-1)
      if (event.shiftKey && (document.activeElement === first || !modal()?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !modal()?.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown',trap)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown',trap); if (previous?.isConnected) previous.focus() }
  }, [modalOpen])
  const run = async (action: () => Promise<void>) => {
    setMessage(null)
    try { await action() } catch (reason) { if (active.current) setMessage(loreError(reason)) }
  }
  const select = (id: string | null) => { selectedId.current = id; setSelected(id); setRevisions(null) }
  const onReady = useCallback((instance: LoreMapInstance) => { flow.current = instance }, [])
  const visible = useMemo(() => filterLore(data, query, kind, focus, archived), [data, query, kind, focus, archived])
  const selectedEntity = data.entities.find(e => e.id === selected)
  useEffect(() => {
    const check = () => {
      if (!active.current) return
      const currentGeneration = ++generation.current
      void api.context().then(ctx => {
        if (!active.current || currentGeneration !== generation.current) return
        if (ctx.scope !== queue.data.scope || ctx.role !== queue.data.role || ctx.character_id !== queue.data.character_id) {
          setSelected(null); setQuery(''); setFocus(null); setRelation(null); setSources(null); setRevisions(null)
          setWorkspaceChanged(true)
        }
      }).catch(() => { if (active.current) setWorkspaceChanged(true) })
    }
    window.addEventListener('focus', check)
    window.addEventListener('storage', check)
    window.addEventListener(NET_GM_WORKSPACE_CHANGED_EVENT, check)
    window.addEventListener('net:active-identity-changed', check)
    window.addEventListener('net:gm-control-changed', check)
    return () => {
      window.removeEventListener('focus', check); window.removeEventListener('storage', check)
      window.removeEventListener(NET_GM_WORKSPACE_CHANGED_EVENT, check)
      window.removeEventListener('net:active-identity-changed', check); window.removeEventListener('net:gm-control-changed', check)
    }
  }, [api, queue])

  const place = (id: string, position: XYPosition, hidden = false) => {
    if (!data.map_id) return
    const previous = queue.data.nodes.find(n => n.entity_id === id)
    queue.edit('node', { map_id: data.map_id, entity_id: id, workspace_os_id: data.scope,
      ...position, hidden, revision: previous?.revision ?? 0, mutation_id: previous?.mutation_id ?? '' })
  }
  const editRelation = (id?: string, source?: string, target?: string) => {
    if (id) { setRelation(data.relations.find(r => r.id === id) ?? null); return }
    setRelation({ id: crypto.randomUUID(), workspace_os_id: data.scope, source: source ?? selected ?? '', target: target ?? '',
      label: 'conhece', visibility: 'private', archived: false, revision: 0, mutation_id: '' })
  }
  const startCreate = (position: XYPosition) => { setNewName(''); setCreate(position) }
  const exportDraft = () => downloadLore({ format: 'lorelink-draft-v1', scope: data.scope, unconfirmed: true, data: queue.data }, `historia-${data.scope}-rascunho.json`)
  const changeWorkspace = (scope: LoreScope) => void run(async () => {
    if (scope === data.scope || busy || uploading) return
    setBusy(true)
    try {
      await queue.flush()
      await api.switchScope(scope)
      try { writeNetGmWorkspace(actor, scope) } finally { onReload() }
    } finally { if (active.current) setBusy(false) }
  })
  const leaveDialog = blocker.state === 'blocked' && <div className="lore-modal-backdrop"><section className="lore-modal" role="dialog" aria-modal="true" aria-label="Alterações por guardar"><h2>Guardar antes de sair</h2><p>O teu trabalho ainda não foi confirmado pela base de dados.</p>
    <button className="signal-button" disabled={uploading || busy} onClick={() => void run(async () => { await queue.flush(); blocker.proceed() })}>Guardar e sair</button>
    <button onClick={() => blocker.reset()}>Continuar a escrever</button><button disabled={uploading || busy} onClick={() => { exportDraft(); blocker.proceed() }}>Exportar rascunho e sair</button>
  </section></div>
  if (workspaceChanged) return <main className="lore-shell lore-unavailable"><h1>O contexto de acesso mudou</h1>
    <p>Os dados do universo anterior foram ocultados. O trabalho por guardar continua preservado nesta sessão.</p>
    {queue.dirty ? <><button onClick={exportDraft}>Exportar rascunho preservado</button><button className="signal-button" onClick={() => void run(async () => {
      if (personal) {
        const ctx = await api.context()
        if (ctx.scope !== data.scope || ctx.character_id !== data.character_id) throw new Error('LORELINK_WORKSPACE_CHANGED')
      } else { await api.switchScope(data.scope); writeNetGmWorkspace(actor, data.scope) }
      await queue.flush(); setWorkspaceChanged(false)
    })}>{personal ? 'Verificar acesso e guardar' : `Regressar a ${data.scope === 'veil' ? 'VEIL / New Vega' : 'ALTARA'} e guardar`}</button>
      {personal && <p>Se a personagem mudou de universo, exporta primeiro o rascunho. As alterações não serão enviadas para outro universo.</p>}
    </> : <button className="signal-button" onClick={onReload}>Reabrir História</button>}
    <Link to="/app/history?personal=1">Escolher personagem</Link>
    {message && <p role="alert">{message}</p>}{leaveDialog}</main>

  return <main className="lore-shell">
    <header className="lore-header"><div className="lore-brand"><BookOpenText size={24} /><div><h1>História</h1><span>LORELINK / {data.scope === 'veil' ? 'NEW VEGA' : 'ALTARA'}</span>{personal && <strong className="lore-character-name">{data.character_name}</strong>}</div></div>
      <nav aria-label="Navegação do RPG"><Link to="/app/sheets"><ArrowLeft size={16} /> Fichas RPG</Link><Link to="/app/net">THE NET</Link><Link to="/app/history?personal=1">{personal ? 'Trocar personagem' : 'As minhas personagens'}</Link></nav>
      {personal ? <span className="lore-private-label">Privado · só tu</span> : <label className="lore-workspace-label">Universo<select aria-label="Universo" value={data.scope} disabled={!canEdit || busy || uploading} onChange={e => changeWorkspace(e.target.value as LoreScope)}>
        <option value="veil">VEIL / New Vega</option><option value="altara">ALTARA</option></select></label>}
    </header>
    <div className="lore-toolbar" inert={busy}><div className="lore-tabs" role="group" aria-label="Vista"><button aria-pressed={view === 'map'} onClick={() => setView('map')}><Network size={17} /> Mapa</button>
      <button aria-pressed={view === 'cards'} onClick={() => setView('cards')}><List size={17} /> Fichas</button></div>
      <label className="lore-search"><Search size={17} /><input aria-label="Pesquisar fichas" placeholder={personal ? "Pesquisar na história desta personagem…" : "Pesquisar neste universo…"} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <select aria-label="Filtrar por tipo" value={kind} onChange={e => setKind(e.target.value)}><option value="">Todos os tipos</option>{Object.entries(loreKinds).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>
      {canEdit && <button aria-pressed={archived} onClick={() => { setArchived(!archived); setFocus(null); setView('cards') }}>Arquivadas</button>}
      {canEdit && <button className="signal-button" onClick={() => startCreate(flow.current?.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 }) ?? { x: 0, y: 0 })}><Plus size={17} /> Criar</button>}
    </div>
    <div className="lore-subbar"><div><span className="lore-save" data-error={Boolean(queue.error)} role="status" aria-live="polite">
      {queue.error ? 'Não foi possível guardar' : queue.dirty ? 'A guardar…' : 'Guardado'}</span>
      {Boolean(queue.error) && <button onClick={() => void run(() => queue.flush())}>Tentar novamente</button>}
      {focus && <button onClick={() => { setFocus(null); setQuery(''); setKind('') }}>← Vista geral</button>}
      {view === 'map' && <button onClick={() => void flow.current?.fitView({ padding: 0.25, maxZoom: 1.1 })}>Enquadrar tudo</button>}</div>
      <div>{!personal && canEdit && <button onClick={() => void run(async () => { await queue.flush(); setSources(await api.sources(data.scope)) })}>Ligar lore existente</button>}
        <button disabled={busy || uploading} onClick={() => void run(async () => {
          setBusy(true); try { if (canEdit) await queue.flush(); const confirmed = await api.read(data.scope)
            downloadLore({ format: 'lorelink-v1', exported_at: new Date().toISOString(), ...confirmed }, `historia-${data.scope}.json`)
          } finally { setBusy(false) }
        })}><Download size={14} /> Exportar</button></div>
    </div>
    {Boolean(message || queue.error) && <div className="lore-error" role="alert">{message ?? loreError(queue.error)}
      {queue.dirty && <button onClick={exportDraft}>Exportar rascunho</button>}
      {Boolean(queue.error) && <button onClick={() => { if (window.confirm('Recarregar a versão do servidor e descartar as alterações locais? Exporta primeiro o rascunho para o preservar.')) onReload() }}>Comparar / recarregar servidor</button>}
      {message && <button aria-label="Fechar aviso" onClick={() => setMessage(null)}><X size={16} /></button>}
    </div>}
    <div className="lore-workarea" inert={busy} aria-busy={busy}>
      <section className="lore-canvas-area">
        <div className={view === 'map' ? 'lore-map-holder' : 'lore-hidden'}>
          <LoreMap data={data} entities={visible} selected={selected} onSelect={select} onCreate={startCreate} onReady={onReady}
            onMove={(id, position) => place(id,position)} onConnect={(source,target) => editRelation(undefined,source,target)} onRelation={editRelation} />
        </div>
        {view === 'cards' && <div className="lore-cards" aria-label="Lista de fichas">
          {!visible.length && <div className="lore-list-empty"><h2>{archived ? 'Sem fichas arquivadas.' : 'Ainda sem fichas nesta vista.'}</h2><p>Experimenta ajustar a pesquisa ou criar uma ficha.</p></div>}
          {visible.map(e => <button key={e.id} className="lore-card" data-selected={e.id === selected} onClick={() => select(e.id)}>
            <span className="lore-card-type">{loreKinds[e.kind]}</span><strong>{e.name}</strong><p>{e.summary || 'Sem resumo'}</p>
            <small>{e.visibility === 'private' ? 'Privado' : 'Revelado'}{data.nodes.some(n => n.entity_id === e.id && !n.hidden) ? ' · No mapa' : ''} · Ler ficha →</small>
          </button>)}
        </div>}
      </section>
      {selectedEntity && <LoreEditor key={selectedEntity.id} entity={selectedEntity} data={data} uploading={uploading} revisions={revisions}
        saveLabel={queue.error ? 'Não foi possível guardar' : queue.dirty ? 'A guardar…' : 'Guardado'} saveFailed={Boolean(queue.error)} onRetry={() => void run(() => queue.flush())}
        onChange={entity => queue.edit('entity',entity)} onClose={() => select(null)} onSelect={select} onRelation={editRelation}
        onFocus={() => { setFocus(selectedEntity.id); setKind(''); setQuery(''); setArchived(false); setView('map') }}
        onMap={() => { const n = data.nodes.find(n => n.entity_id === selectedEntity.id); place(selectedEntity.id, n ? { x:n.x, y:n.y } : { x:0,y:0 }, Boolean(n && !n.hidden)) }}
        onHistory={() => void run(async () => { await queue.flush(); const id = selectedEntity.id; const history = await api.history(data.scope,id); if (active.current && selectedId.current === id) setRevisions(history) })}
        onUpload={file => void run(async () => {
          if (file.size > 20 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 20 MB.')
          const id = selectedEntity.id
          setUploading(true)
          try {
            await queue.flush()
            const ctx = await api.context(); if (ctx.scope !== data.scope) throw new Error('LORELINK_WORKSPACE_CHANGED')
            const result = await uploadSharedImage({ subjectKind: 'lorelink-entity', subjectId: id, mediaKind: 'avatar', slot: data.scope }, file, 'avatar')
            if (!active.current) return
            const latest = queue.data.entities.find(e => e.id === id)
            if (latest) { queue.edit('entity', { ...latest, image: result.reference }); await queue.flush() }
          } finally { if (active.current) setUploading(false) }
        })} />}
    </div>

    {create && <div className="lore-modal-backdrop"><form className="lore-modal" role="dialog" aria-modal="true" aria-label="Criar ficha" onSubmit={event => {
      event.preventDefault(); if (!newName.trim()) return
      const id = crypto.randomUUID()
      queue.edit('entity',{ id,workspace_os_id:data.scope,name:newName.trim(),kind:newKind,summary:'',body:'',tags:[],canon:'draft',
        visibility:'private',fictional_date:'',image:null,archived:false,revision:0,mutation_id:'' })
      place(id,create); select(id); setCreate(null); setArchived(false); setQuery(''); setKind(''); setFocus(null)
    }}><header><h2>Criar ficha</h2><button type="button" aria-label="Cancelar criação" onClick={() => setCreate(null)}><X size={18} /></button></header>
      <label>Nome da nova ficha<input autoFocus required maxLength={160} value={newName} onChange={e => setNewName(e.target.value)} /></label>
      <label>Tipo da nova ficha<select value={newKind} onChange={e => setNewKind(e.target.value as LoreKind)}>{Object.entries(loreKinds).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <p>Esta ficha é privada. Podes escrever e organizar ao teu ritmo.</p><button className="signal-button" type="submit">Criar ficha</button>
    </form></div>}

    {relation && <div className="lore-modal-backdrop"><form className="lore-modal" role="dialog" aria-modal="true" aria-label="Relação" onSubmit={event => {
      event.preventDefault(); if (!canEdit) return
      queue.edit('relation',relation); setRelation(null)
    }}><header><h2>{relation.revision ? 'Editar relação' : 'Nova relação'}</h2><button type="button" aria-label="Fechar relação" onClick={() => setRelation(null)}><X size={18} /></button></header>
      <label>Origem<select required value={relation.source} disabled={!canEdit} onChange={e => setRelation({ ...relation,source:e.target.value })}><option value="">Escolher ficha</option>
        {data.entities.filter(e => !e.archived).map(e => <option value={e.id} key={e.id}>{e.name}</option>)}</select></label>
      <label>Nome da relação<input required maxLength={120} list="lore-relation-options" value={relation.label} readOnly={!canEdit} onChange={e => setRelation({ ...relation,label:e.target.value })} /></label>
      <datalist id="lore-relation-options">{relationSuggestions.map(s => <option key={s} value={s} />)}</datalist>
      <label>Destino<select required value={relation.target} disabled={!canEdit} onChange={e => setRelation({ ...relation,target:e.target.value })}><option value="">Escolher ficha</option>
        {data.entities.filter(e => !e.archived && e.id !== relation.source).map(e => <option value={e.id} key={e.id}>{e.name}</option>)}</select></label>
      <p>A direção é da origem para o destino. Não cria uma relação recíproca.</p>
      {!personal && <label>Visibilidade da relação<select disabled={!canEdit || !relation.revision} value={relation.visibility} onChange={e => {
        const visibility = e.target.value as LoreRelation['visibility']
        if (visibility === 'revealed' && !window.confirm('Revelar esta relação? Só fica visível aos jogadores se ambas as fichas também estiverem reveladas.')) return
        setRelation({ ...relation,visibility })
      }}><option value="private">Privada</option><option value="revealed">Revelada</option></select></label>}
      {canEdit && <div className="lore-actions"><button className="signal-button" type="submit">Guardar relação</button>
        {relation.revision > 0 && <button type="button" onClick={() => { queue.edit('relation',{ ...relation,archived:true }); setRelation(null) }}>Remover relação</button>}</div>}
    </form></div>}

    {sources && <div className="lore-modal-backdrop"><section className="lore-modal" role="dialog" aria-modal="true" aria-label="Lore existente"><header><h2>Ligar lore existente</h2><button aria-label="Fechar lore existente" onClick={() => setSources(null)}><X size={18} /></button></header>
      <p>Usa o ID e o texto da fonte. Não cria uma cópia do conteúdo. O texto continua editável no Search.</p>
      {!sources.length && <p>Não há fontes neste universo.</p>}
      {sources.map(source => <button className="lore-source" key={`${source.source_kind}:${source.id}`} onClick={() => void run(async () => {
        const entity = await api.attach(data.scope,source); queue.acceptEntity(entity); place(entity.id,{x:0,y:0}); select(entity.id); setSources(null)
      })}>{source.title}</button>)}
    </section></div>}

    {leaveDialog}
  </main>
}
