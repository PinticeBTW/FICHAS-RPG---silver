import type { LoreData, LoreDeletion, LoreEntity, LoreNode, LoreRelation } from './lorelinkTypes.ts'
import { isMissingLoreDelete } from './lorelinkErrors.ts'

type Value = LoreEntity | LoreNode | LoreRelation
type Kind = 'entity' | 'node' | 'relation'
type Job = { kind: Kind; key: string; value: Value; mutation: string; sequence: number }
type Persist = (kind: Kind, scope: LoreData['scope'], value: Value, mutation: string) => Promise<Value>
type Remove = (scope: LoreData['scope'], value: LoreEntity, mutation: string) => Promise<LoreDeletion>
type DeleteJob = { id: string; value: LoreEntity | null; mutation: string }

/** A single ordered writer per workspace. Failed requests retain the exact
 * mutation UUID and payload, including after edits arrive during a request. */
export class LoreQueue {
  data: LoreData
  error: unknown = null
  saving = false
  private timer?: ReturnType<typeof setTimeout>
  private pending = new Map<string, Job>()
  private failed: Job | null = null
  private active: Promise<void> | null = null
  private sequence = 0
  private version = 0
  private disposed = false
  private listeners = new Set<() => void>()
  private persist: Persist
  private remove?: Remove
  private deletions = new Map<string, DeleteJob>()
  private failedDeletion: DeleteJob | null = null
  constructor(data: LoreData, persist: Persist, remove?: Remove) { this.data = data; this.persist = persist; this.remove = remove }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.version
  get dirty() { return this.saving || this.pending.size > 0 || this.failed !== null || this.deletions.size > 0 }
  isDeleting(id: string) { return this.deletions.has(id) }
  async deleteEntity(id: string) {
    if (this.disposed || this.data.role === 'player' || !this.remove) throw new Error('Sem acesso para apagar.')
    const entity = this.data.entities.find(e => e.id === id)
    if (!entity || entity.source_kind) throw new Error('Esta página não pode ser apagada aqui.')
    if (!this.deletions.has(id)) this.deletions.set(id, { id, value: null, mutation: crypto.randomUUID() })
    this.emit()
    await this.flush()
  }
  private emit() { this.version++; for (const listener of this.listeners) listener() }
  private replace(kind: Kind, value: Value) {
    if (kind === 'entity') {
      const entity = value as LoreEntity
      this.data = { ...this.data, entities: this.data.entities.some(e => e.id === entity.id)
        ? this.data.entities.map(e => e.id === entity.id ? entity : e) : [...this.data.entities, entity] }
    } else if (kind === 'node') {
      const node = value as LoreNode
      this.data = { ...this.data, nodes: [...this.data.nodes.filter(n => n.entity_id !== node.entity_id), node] }
    } else {
      const relation = value as LoreRelation
      this.data = { ...this.data, relations: [...this.data.relations.filter(r => r.id !== relation.id), relation] }
    }
  }
  acceptEntity(entity: LoreEntity) { this.replace('entity', entity); this.emit() }
  edit(kind: Kind, value: Value) {
    if (this.disposed || this.data.role === 'player' || value.workspace_os_id !== this.data.scope) return
    const ids = kind === 'entity' ? [(value as LoreEntity).id] : kind === 'node' ? [(value as LoreNode).entity_id] : [(value as LoreRelation).source, (value as LoreRelation).target]
    if (ids.some(id => this.deletions.has(id))) return
    if (value.character_id && value.character_id !== this.data.character_id) return
    value = { ...value, character_id: this.data.character_id ?? null }
    const key = `${kind}:${kind === 'node' ? (value as LoreNode).entity_id : (value as LoreEntity).id}`
    this.replace(kind, value)
    this.pending.set(key, { kind, key, value: structuredClone(value), mutation: crypto.randomUUID(), sequence: ++this.sequence })
    clearTimeout(this.timer)
    if (!this.error) this.timer = setTimeout(() => { void this.flush().catch(() => undefined) }, 750)
    this.emit()
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    if (this.disposed) throw new Error('A sessão de edição terminou.')
    if (this.active) { await this.active; if (this.pending.size || this.failed || this.deletions.size) return this.flush(); return }
    this.error = null
    this.active = this.drain()
    try { await this.active } finally { this.active = null }
  }
  private async drain() {
    this.saving = true; this.emit()
    try {
      while (!this.disposed && (this.failed || this.pending.size || this.deletions.size)) {
        // Finish existing edits before the first delete. Retries keep its exact
        // revision and mutation, even if the server already committed the delete.
        if (!this.failed && (this.failedDeletion || !this.pending.size)) {
          const deletion = this.failedDeletion ?? this.deletions.values().next().value as DeleteJob
          try {
            deletion.value ??= structuredClone(this.data.entities.find(e => e.id === deletion.id)!)
            const value = deletion.value
            if (!value || !this.remove) throw new Error('Página indisponível para apagar.')
            const ack = await this.remove(this.data.scope, value, deletion.mutation)
            if (this.disposed) return
            if (ack.deleted !== true || ack.id !== value.id || ack.workspace_os_id !== this.data.scope
              || (ack.character_id ?? null) !== (this.data.character_id ?? null) || ack.mutation_id !== deletion.mutation || ack.revision !== value.revision) throw new Error('Confirmação de eliminação inválida.')
            this.data = { ...this.data, entities: this.data.entities.filter(e => e.id !== value.id), nodes: this.data.nodes.filter(n => n.entity_id !== value.id), relations: this.data.relations.filter(r => r.source !== value.id && r.target !== value.id) }
            this.deletions.delete(deletion.id); this.failedDeletion = null
          } catch (error) {
            // PGRST202 confirms the RPC was not resolved or executed. Unlike a
            // lost response, this can safely unlock writing without retrying a delete.
            if (isMissingLoreDelete(error)) {
              this.deletions.delete(deletion.id); this.failedDeletion = null; this.error = null
            } else { this.failedDeletion = deletion; this.error = error }
            throw error
          }
          this.emit(); continue
        }
        const job = this.failed ?? this.pending.values().next().value as Job
        if (!this.failed) this.pending.delete(job.key)
        try {
          const saved = await this.persist(job.kind, this.data.scope, job.value, job.mutation)
          if (this.disposed) return
          if (saved.workspace_os_id !== this.data.scope || (saved.character_id ?? null) !== (this.data.character_id ?? null) || saved.mutation_id !== job.mutation
            || (job.kind === 'node' ? (saved as LoreNode).entity_id !== (job.value as LoreNode).entity_id || (saved as LoreNode).map_id !== (job.value as LoreNode).map_id
              : (saved as LoreEntity).id !== (job.value as LoreEntity).id)
            || saved.revision !== job.value.revision + 1) throw new Error('Confirmação de gravação inválida.')
          const newer = this.pending.get(job.key)
          if (newer) {
            newer.value = { ...newer.value, revision: saved.revision, mutation_id: saved.mutation_id }
            this.replace(job.kind, { ...newer.value, revision: saved.revision, mutation_id: saved.mutation_id })
          } else this.replace(job.kind, saved)
          this.failed = null
        } catch (error) { this.failed = job; this.error = error; throw error }
        this.emit()
      }
    } finally { this.saving = false; this.emit() }
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.listeners.clear() }
}
