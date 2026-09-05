import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'
import type { LoreCharacter, LoreData, LoreEntity, LoreNode, LoreRelation, LoreRevision, LoreScope, LoreSource } from './lorelinkTypes'

export function loreError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/LORELINK_CONFLICT/.test(message)) return 'Esta ficha ou posição mudou noutra sessão. O teu trabalho foi preservado. Exporta o rascunho e compara com a versão guardada antes de continuar.'
  if (/WORKSPACE_CHANGED/.test(message)) return 'O universo ativo mudou noutra janela. O teu trabalho continua aqui; regressa ao universo anterior para guardar.'
  if (/PGRST202|does not exist|Could not find.*function|LORELINK_BASE_REQUIRED/.test(message)) return 'A História ainda não está ativada nesta base de dados. A migração Lorelink precisa de ser aplicada pelo responsável do projeto.'
  if (/FORBIDDEN|42501|UNAVAILABLE|GM_SYSTEM_REQUIRED/.test(message)) return 'Sem acesso à História desta personagem neste universo. Escolhe uma personagem que te pertence.'
  return `Não foi possível guardar ou carregar. ${message}`
}

export function createLoreApi(actor: string, character?: string) {
  // Immutable character binding: delayed requests cannot follow a later selection.
  const version = character ? 'v2' : 'v1'
  const binding = character ? { requested_character: character } : {}
  async function rpc<T>(name: string, args = {}, signal?: AbortSignal): Promise<T> {
    if (!supabase) throw new Error(SUPABASE_CONFIG_ERROR)
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user.id !== actor) throw new Error('LORELINK_FORBIDDEN: a sessão mudou.')
    const request = supabase.rpc(name, args)
    const { data, error } = await (signal ? request.abortSignal(signal) : request)
    if (error) throw new Error(`${error.code}: ${error.message}`)
    if (data === null) throw new Error('A base de dados não confirmou a operação.')
    return data as T
  }
  return {
    characters: (signal?: AbortSignal) => rpc<LoreCharacter[]>('lorelink_characters_v2', {}, signal),
    context: (signal?: AbortSignal) => rpc<Pick<LoreData, 'scope' | 'role' | 'character_id'>>(`lorelink_context_${version}`, binding, signal),
    read: (scope: LoreScope, signal?: AbortSignal) => rpc<LoreData>(`lorelink_read_${version}`, { expected_scope: scope, ...binding }, signal),
    save: async (kind: 'entity' | 'node' | 'relation', scope: LoreScope, value: LoreEntity | LoreNode | LoreRelation, mutation: string) =>
      rpc<LoreEntity | LoreNode | LoreRelation>(`lorelink_save_${kind}_${version}`, {
        expected_scope: scope, ...binding, expected_revision: value.revision, mutation, payload: value,
      }),
    history: (scope: LoreScope, entity: string) => rpc<LoreRevision[]>(`lorelink_history_${version}`, { expected_scope: scope, ...binding, entity }),
    sources: (scope: LoreScope) => rpc<LoreSource[]>('lorelink_sources_v1', { expected_scope: scope }),
    attach: (scope: LoreScope, source: LoreSource) => rpc<LoreEntity>('lorelink_attach_v1', {
      expected_scope: scope, source_id: source.id, source_kind: source.source_kind,
    }),
    switchScope: (scope: LoreScope) => rpc<LoreScope>('set_net_gm_system_workspace_v1', { requested_workspace_os_id: scope }),
  }
}
export type LoreApi = ReturnType<typeof createLoreApi>

export function downloadLore(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
