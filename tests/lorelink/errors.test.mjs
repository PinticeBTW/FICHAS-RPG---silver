import test from 'node:test'
import assert from 'node:assert/strict'
import { loreError } from '../../src/lib/lorelinkErrors.ts'

test('a missing delete RPC preserves the page and does not claim all History is unavailable', () => {
  for (const version of ['v1', 'v2']) {
    const message = loreError(new Error(`PGRST202: Could not find the function public.lorelink_delete_entity_${version}(entity, mutation) in the schema cache`))
    assert.match(message, /opção de apagar/)
    assert.match(message, /página foi preservada/)
    assert.doesNotMatch(message, /História ainda não está ativada/)
  }
})

test('a missing base RPC and a deletion conflict keep their distinct recovery messages', () => {
  assert.match(loreError(new Error('PGRST202: Could not find the function public.lorelink_read_v2')), /História ainda não está ativada/)
  assert.match(loreError(new Error('LORELINK_CONFLICT: lorelink_delete_entity_v2')), /mudou noutra sessão/)
  assert.match(loreError(new Error('LORELINK_FORBIDDEN: lorelink_delete_entity_v2')), /Sem acesso/)
})
