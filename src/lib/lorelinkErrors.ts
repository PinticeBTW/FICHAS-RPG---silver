export function isMissingLoreDelete(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /PGRST202/.test(message) && /Could not find.*function/.test(message) && /lorelink_delete_entity_v[12]/.test(message)
}

export function loreError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/LORELINK_CONFLICT/.test(message)) return 'Esta ficha ou posição mudou noutra sessão. O teu trabalho foi preservado. Exporta o rascunho e compara com a versão guardada antes de continuar.'
  if (/LORELINK_DELETED/.test(message)) return 'Esta página foi apagada noutra sessão. O rascunho local continua disponível para exportar.'
  if (/LORELINK_NOT_FOUND/.test(message)) return 'Esta página já não está disponível nesta coleção. O rascunho local foi preservado.'
  if (/WORKSPACE_CHANGED/.test(message)) return 'O universo ativo mudou noutra janela. O teu trabalho continua aqui; regressa ao universo anterior para guardar.'
  if (isMissingLoreDelete(error)) return 'A opção de apagar ainda não está ativada no servidor. A página foi preservada. Tenta novamente depois de atualizar o serviço.'
  if (/PGRST202|does not exist|Could not find.*function|LORELINK_BASE_REQUIRED/.test(message)) return 'A História ainda não está ativada nesta base de dados. A migração Lorelink precisa de ser aplicada pelo responsável do projeto.'
  if (/FORBIDDEN|42501|UNAVAILABLE|GM_SYSTEM_REQUIRED/.test(message)) return 'Sem acesso à História desta personagem neste universo. Escolhe uma personagem que te pertence.'
  return `Não foi possível guardar ou carregar. ${message}`
}
