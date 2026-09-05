export type LoreScope = 'veil' | 'altara'
export type LoreKind = 'person' | 'event' | 'location' | 'organization' | 'object' | 'note'
export const loreKinds: Record<LoreKind, string> = {
  person: 'Personagem', event: 'Evento', location: 'Local', organization: 'Organização', object: 'Objeto', note: 'Nota',
}
export type LoreVisibility = 'private' | 'revealed'
export interface Versioned { revision: number; mutation_id: string; character_id?: string | null }
export interface LoreEntity extends Versioned {
  id: string; workspace_os_id: LoreScope; name: string; kind: LoreKind; summary: string; body: string;
  tags: string[]; canon: 'draft' | 'canonical'; visibility: LoreVisibility; fictional_date: string;
  image: string | null; archived: boolean; source_kind?: string | null;
  source_entry_id?: string | null; source_document_id?: string | null; created_at?: string; updated_at?: string;
}
export interface LoreNode extends Versioned {
  map_id: string; entity_id: string; workspace_os_id: LoreScope; x: number; y: number; hidden: boolean;
}
export interface LoreRelation extends Versioned {
  id: string; workspace_os_id: LoreScope; source: string; target: string; label: string;
  visibility: LoreVisibility; archived: boolean;
}
export interface LoreData {
  scope: LoreScope; role: 'gm' | 'player' | 'author'; map_id: string | null;
  character_id?: string | null; character_name?: string;
  entities: LoreEntity[]; nodes: LoreNode[]; relations: LoreRelation[];
}
export interface LoreRevision { id: number; saved_at: string; snapshot: LoreEntity }
export interface LoreCharacter {
  character_id: string; character_name: string; scope: LoreScope;
  subject_id: string; subject_kind: 'profile-sheet' | 'npc-card' | 'character';
}
export interface LoreSource { id: string; title: string; source_kind: string }
export const relationSuggestions = ['participou em', 'aconteceu em', 'pertence a', 'conhece', 'protege', 'desconfia de', 'procura']

export function filterLore(data: LoreData, query: string, kind: string, focus: string | null, archived = false) {
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt')
  const needle = normalize(query.trim())
  const nearby = new Set([focus])
  if (focus) for (const r of data.relations) {
    if (!r.archived && (r.source === focus || r.target === focus)) { nearby.add(r.source); nearby.add(r.target) }
  }
  return data.entities.filter(e => e.archived === archived && (!kind || e.kind === kind)
    && (!focus || nearby.has(e.id)) && (!needle || normalize([e.name, e.summary, e.body, ...e.tags].join(' ')).includes(needle)))
}
