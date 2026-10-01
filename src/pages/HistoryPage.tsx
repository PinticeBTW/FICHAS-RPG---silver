import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useBlocker, useBeforeUnload, useSearchParams } from 'react-router-dom'
import { BookOpenText, Download, PanelLeft, Plus, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { LoreCharacters } from '../components/lorelink/LoreCharacters'
import { HistoryDocument } from '../components/lorelink/HistoryDocument'
import { createLoreApi, downloadLore, loreError, type LoreApi } from '../lib/lorelinkService'
import { LoreQueue } from '../lib/lorelinkQueue'
import { lorePeriod, lorePeriods } from '../lib/lorelinkPeriods'
import type { LoreEntity, LoreRevision, LoreScope } from '../lib/lorelinkTypes'
import { NET_GM_WORKSPACE_CHANGED_EVENT, writeNetGmWorkspace } from '../lib/netGmWorkspaceStore'
import '../styles/lorelink.css'
import '../styles/historyDocuments.css'

export function HistoryPage() {
  const { profile } = useAuth()
  const [params] = useSearchParams()
  if (!profile) return null
  const character = params.get('character'), sheet = params.get('sheet')
  if (profile.role !== 'gm' || character || sheet || params.get('personal')) return <LoreCharacters key={profile.id} actor={profile.id}
    character={character} sheet={sheet} kind={params.get('kind')}>
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
      session = new LoreQueue(data, api.save, api.remove); setQueue(session); setError(null)
    })().catch(reason => { if (!abort.signal.aborted) setError(loreError(reason)) })
    return () => { abort.abort(); session?.dispose() }
  }, [api, reload, character])
  if (error) return <main className="lore-shell lore-unavailable"><BookOpenText size={32} /><h1>História</h1><p role="alert">{error}</p>
    <button className="signal-button" onClick={() => { setError(null); setReload(n => n + 1) }}>Tentar novamente</button><Link to="/app/sheets">Voltar ao início</Link></main>
  if (!queue) return <main className="lore-shell lore-unavailable"><p role="status">A abrir os teus textos…</p></main>
  return <HistoryWorkspace key={`${queue.data.scope}:${reload}`} queue={queue} api={api} actor={actor}
    onReload={() => { setQueue(null); setReload(n => n + 1) }} />
}

function blankPage(scope: LoreScope): LoreEntity {
  return { id: crypto.randomUUID(), workspace_os_id: scope, name: '', kind: 'note', summary: '', body: '', tags: [],
    canon: 'draft', visibility: 'private', fictional_date: '', image: null, archived: false, revision: 0, mutation_id: '' }
}

function HistoryWorkspace({ queue, api, actor, onReload }: { queue: LoreQueue; api: LoreApi; actor: string; onReload: () => void }) {
  useSyncExternalStore(queue.subscribe, queue.snapshot)
  const data = queue.data
  const canEdit = data.role !== 'player'
  const [draft, setDraft] = useState(() => blankPage(data.scope))
  const [selected, setSelected] = useState<string | null>(() => data.entities.find(e => !e.archived && e.kind === 'note')?.id ?? null)
  const [pagesOpen, setPagesOpen] = useState(() => window.matchMedia('(min-width:901px)').matches)
  const [archived, setArchived] = useState(false)
  const [revisions, setRevisions] = useState<{ entityId: string; items: LoreRevision[] } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [workspaceChanged, setWorkspaceChanged] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<LoreEntity | null>(null)
  const generation = useRef(0)
  const active = useRef(true)
  const selectedId = useRef(selected)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    if (!deleteTarget) return
    const previous = document.activeElement as HTMLElement | null
    const controls = [...document.querySelectorAll<HTMLButtonElement>('.history-delete-dialog button')]
    controls[0]?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setDeleteTarget(null) }
      if (event.key === 'Tab' && event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (event.key === 'Tab' && !event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus() }
  }, [deleteTarget])
  const dirty = queue.dirty || busy
  useBeforeUnload(event => { if (dirty) { event.preventDefault(); event.returnValue = '' } })
  const blocker = useBlocker(dirty)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    const previous = document.activeElement as HTMLElement | null
    const dialog = document.querySelector<HTMLElement>('.history-leave-dialog')
    const controls = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    controls[0]?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); blocker.reset(); return }
      if (event.key !== 'Tab') return
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus() }
  }, [blocker])
  useEffect(() => {
    const check = () => {
      const currentGeneration = ++generation.current
      void api.context().then(ctx => {
        if (!active.current || currentGeneration !== generation.current) return
        if (ctx.scope !== queue.data.scope || ctx.role !== queue.data.role || ctx.character_id !== queue.data.character_id) setWorkspaceChanged(true)
      }).catch(() => { if (active.current && currentGeneration === generation.current) setWorkspaceChanged(true) })
    }
    const events = ['focus', 'storage', NET_GM_WORKSPACE_CHANGED_EVENT, 'net:active-identity-changed', 'net:gm-control-changed']
    events.forEach(event => window.addEventListener(event, check))
    return () => events.forEach(event => window.removeEventListener(event, check))
  }, [api, queue])
  const run = async (action: () => Promise<void>) => {
    setMessage(null)
    try { await action() } catch (reason) { if (active.current) setMessage(loreError(reason)) }
  }
  const exportDraft = () => downloadLore({ format: 'lorelink-draft-v1', scope: data.scope, unconfirmed: true, data: queue.data }, `historia-${data.scope}-rascunho.json`)
  const select = (id: string | null) => { selectedId.current = id; setSelected(id); setRevisions(null); if (window.matchMedia('(max-width:900px)').matches) setPagesOpen(false) }
  const savedPage = data.entities.find(e => e.id === selected)
  const page = savedPage ?? draft
  const isDraft = !savedPage
  const change = (value: LoreEntity) => {
    if (!canEdit) return
    // Visiting or opening a blank page never writes an empty record.
    queue.edit('entity', { ...value, name: value.name.trim() ? value.name : 'Sem título' })
    if (isDraft) select(value.id)
  }
  const newPage = () => { setDraft(blankPage(data.scope)); setArchived(false); select(null) }
  const deleting = queue.isDeleting(page.id)
  const deleteDialog = deleteTarget && <div className="lore-modal-backdrop"><section className="lore-modal history-delete-dialog" role="dialog" aria-modal="true" aria-label="Apagar página">
    <h2>Apagar «{deleteTarget.name}»?</h2><p>A página e as suas versões anteriores serão apagadas definitivamente. Não podes recuperar este texto depois.</p>
    <button onClick={() => setDeleteTarget(null)}>Cancelar</button>
    <button className="history-delete" onClick={() => {
      const id = deleteTarget.id; setDeleteTarget(null)
      void run(async () => { setBusy(true); try { await queue.deleteEntity(id); if (active.current && selectedId.current === id) newPage() } finally { if (active.current) setBusy(false) } })
    }}>Apagar definitivamente</button>
  </section></div>
  const leaveDialog = blocker.state === 'blocked' && <div className="lore-modal-backdrop"><section className="lore-modal history-leave-dialog" role="dialog" aria-modal="true" aria-label="Alterações por guardar">
    <h2>Guardar antes de sair</h2><p>Há texto que ainda não foi confirmado pelo servidor.</p>
    <button disabled={busy} onClick={() => void run(async () => { await queue.flush(); blocker.proceed() })}>Guardar e sair</button>
    <button onClick={() => blocker.reset()}>Continuar a escrever</button><button disabled={busy} onClick={() => { exportDraft(); blocker.proceed() }}>Exportar rascunho e sair</button>
  </section></div>
  if (workspaceChanged) return <main className="lore-shell lore-unavailable"><h1>O acesso mudou</h1><p>O texto por guardar continua preservado nesta janela.</p>
    {queue.dirty ? <><button onClick={exportDraft}>Exportar rascunho</button><button onClick={() => void run(async () => {
      if (data.character_id) {
        const ctx = await api.context()
        if (ctx.scope !== data.scope || ctx.character_id !== data.character_id || ctx.role !== data.role) throw new Error('LORELINK_WORKSPACE_CHANGED')
      } else { await api.switchScope(data.scope); writeNetGmWorkspace(actor, data.scope) }
      await queue.flush(); setWorkspaceChanged(false)
    })}>Verificar acesso e guardar</button></> : <button onClick={onReload}>Reabrir textos</button>}
    {message && <p role="alert">{message}</p>}{leaveDialog}</main>
  const pages = data.entities.filter(e => e.archived === archived)
  return <main className={`lore-shell history-documents ${pagesOpen ? 'history-documents--pages-open' : ''}`}>
    <header className="history-topbar">
      <button aria-label="Mostrar páginas" aria-expanded={pagesOpen} aria-controls="history-pages" onClick={() => setPagesOpen(!pagesOpen)}><PanelLeft size={18} /></button>
      <h1>História</h1><span className="history-private">{data.character_id ? 'Só tu' : 'Arquivo do mestre'}</span>
      {!data.character_id && <select aria-label="Universo" value={data.scope} disabled={!canEdit || busy} onChange={event => {
        const scope = event.target.value as LoreScope
        void run(async () => { setBusy(true); try { await queue.flush(); await api.switchScope(scope); try { writeNetGmWorkspace(actor, scope) } finally { onReload() } } finally { if (active.current) setBusy(false) } })
      }}><option value="veil">VEIL</option><option value="altara">ALTARA</option></select>}
      <span className="lore-save" role="status" aria-live="polite" data-error={Boolean(queue.error)}>{queue.error ? 'Não foi possível guardar' : queue.dirty ? 'A guardar…' : isDraft ? 'Pronto para escrever' : 'Guardado'}</span>
      <details className="history-options"><summary>Mais</summary><div>
        <button onClick={exportDraft}><Download size={14} /> Exportar textos</button>
        <button aria-pressed={archived} onClick={() => { setArchived(!archived); setPagesOpen(true) }}>{archived ? 'Páginas ativas' : 'Páginas arquivadas'}</button>
      </div></details>
    </header>
    {Boolean(message || queue.error) && <div className="lore-error" role="alert">{message ?? loreError(queue.error)}
      <button onClick={() => void run(() => queue.flush())}>Repetir operação</button><button onClick={exportDraft}>Exportar rascunho</button>
      {message && <button aria-label="Fechar aviso" onClick={() => setMessage(null)}><X size={16} /></button>}
    </div>}
    <div className="history-layout" inert={busy || Boolean(deleteTarget)} aria-busy={busy}>
      <aside id="history-pages" className="history-pages" aria-label="Páginas">
        <header><span>{archived ? 'Arquivadas' : 'As tuas páginas'}</span></header>
        <nav aria-label="Lista de páginas">{isDraft && !archived && <button className="history-page-link" aria-current="page" onClick={() => setPagesOpen(false)}><BookOpenText size={15} /><span>Nova página</span></button>}
          {pages.map(e => <button className="history-page-link" key={e.id} aria-current={e.id === selected ? 'page' : undefined} onClick={() => select(e.id)}>
            <BookOpenText size={15} /><span>{e.name}<small>{lorePeriod(e) === 'unassigned' ? '' : lorePeriods[lorePeriod(e)].label}</small></span>
          </button>)}
          {!pages.length && <p>{archived ? 'Ainda não há páginas arquivadas.' : 'As páginas que escreveres ficam aqui.'}</p>}
        </nav>
        {canEdit && <button className="history-new-page" onClick={newPage}><Plus size={16} /> Nova página</button>}
      </aside>
      {canEdit || !isDraft ? <HistoryDocument key={page.id} entity={page} canEdit={canEdit && !deleting} personal={Boolean(data.character_id)} isDraft={isDraft}
        revisions={revisions?.entityId === page.id ? revisions.items : null} onChange={change}
        onDelete={() => setDeleteTarget(page)}
        onHistory={() => void run(async () => { await queue.flush(); const id = page.id; const items = await api.history(data.scope, id); if (active.current && selectedId.current === id) setRevisions({ entityId: id, items }) })} />
        : <section className="history-paper"><h2>Os teus textos</h2><p>Abre uma página da lista para ler.</p></section>}
    </div>{leaveDialog}{deleteDialog}
  </main>
}
