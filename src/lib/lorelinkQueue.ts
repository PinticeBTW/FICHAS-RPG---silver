import type { LoreData, LoreEntity, LoreNode, LoreRelation } from './lorelinkTypes.ts'

type Value = LoreEntity | LoreNode | LoreRelation
type Kind = 'entity' | 'node' | 'relation'
type Job = { kind: Kind; key: string; value: Value; mutation: string; sequence: number }
type Persist = (kind: Kind, scope: LoreData['scope'], value: Value, mutation: string) => Promise<Value>

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
  constructor(data: LoreData, persist: Persist) { this.data = data; this.persist = persist }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.version
  get dirty() { return this.saving || this.pending.size > 0 || this.failed !== null }
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
    if (this.active) { await this.active; if (this.pending.size || this.failed) return this.flush(); return }
    this.error = null
    this.active = this.drain()
    try { await this.active } finally { this.active = null }
  }
  private async drain() {
    this.saving = true; this.emit()
    try {
      while (!this.disposed && (this.failed || this.pending.size)) {
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
