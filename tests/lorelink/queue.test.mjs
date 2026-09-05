import test from 'node:test'
import assert from 'node:assert/strict'
import { LoreQueue } from '../../src/lib/lorelinkQueue.ts'
import { filterLore } from '../../src/lib/lorelinkTypes.ts'
import { entity } from './fixture.mjs'
const dataset = (entities=[]) => ({scope:'veil',role:'gm',map_id:'test-map',entities,nodes:[],relations:[]})
const ack = (value,mutation) => ({...value,mutation_id:mutation,revision:value.revision+1})

test('personal queue binds new records and rejects acknowledgements from another character or entity',async()=>{
  for(const wrong of [{character_id:'another-character'},{id:'another-entity'}]){
    const e=entity()
    const queue=new LoreQueue({...dataset([e]),role:'author',character_id:'character-a'},async(_kind,_scope,value,mutation)=>({...ack(value,mutation),...wrong}))
    queue.edit('entity',{...e,body:'Texto pessoal'})
    await assert.rejects(queue.flush(),/Confirmação/)
    assert.equal(queue.data.entities[0].body,'Texto pessoal');assert.equal(queue.dirty,true)
    assert.equal(queue.data.entities[0].character_id,'character-a');queue.dispose()
  }
})

test('typing during a delayed save does not get overwritten by the response',async () => {
  const e=entity(), requests=[]
  let release
  const queue=new LoreQueue(dataset([e]),async (_kind,_scope,value,mutation) => {
    requests.push(value)
    if (requests.length===1) await new Promise(resolve=>{release=resolve})
    return ack(value,mutation)
  })
  queue.edit('entity',{...e,body:'First'})
  const saving=queue.flush()
  queue.edit('entity',{...e,body:'More text while saving'})
  release();await saving
  assert.equal(queue.data.entities[0].body,'More text while saving')
  assert.equal(requests[1].revision,1)
  assert.equal(queue.dirty,false)
  queue.dispose()
})
test('failed save retains text and reuses the exact request UUID on retry before newer edits',async () => {
  const e=entity(),requests=[]
  const queue=new LoreQueue(dataset([e]),async (_kind,scope,value,mutation) => {
    requests.push({scope,value:structuredClone(value),mutation})
    if (requests.length===1) throw new Error('offline')
    return ack(value,mutation)
  })
  queue.edit('entity',{...e,body:'Texto preservado'})
  await assert.rejects(queue.flush(),/offline/)
  assert.equal(queue.data.entities[0].body,'Texto preservado');assert.equal(queue.dirty,true)
  queue.edit('entity',{...e,body:'Ainda mais texto'})
  await queue.flush()
  assert.deepEqual(requests[0],requests[1])
  assert.equal(requests[2].value.revision,1)
  assert.equal(queue.data.entities[0].body,'Ainda mais texto')
  queue.dispose()
})
test('creation is ordered before map placement; flushing concurrent callers waits for everything',async () => {
  const e=entity(),order=[]
  const queue=new LoreQueue(dataset(),async (kind,_scope,value,mutation)=>{order.push(kind);return ack(value,mutation)})
  queue.edit('entity',e)
  queue.edit('node',{entity_id:e.id,map_id:'test-map',workspace_os_id:'veil',x:30,y:40,revision:0,hidden:false})
  await Promise.all([queue.flush(),queue.flush()])
  assert.deepEqual(order,['entity','node']);assert.equal(queue.dirty,false)
  queue.dispose()
})
test('conflicts and wrong-scope acknowledgements are not marked saved',async () => {
  const e=entity()
  const queue=new LoreQueue(dataset([e]),async (_kind,_scope,value,mutation)=>({...ack(value,mutation),workspace_os_id:'altara'}))
  queue.edit('entity',{...e,body:'Must keep'})
  await assert.rejects(queue.flush(),/inválida/)
  assert.equal(queue.dirty,true);assert.equal(queue.data.entities[0].body,'Must keep')
  queue.dispose()
})
test('disposed sessions ignore late responses and cannot write to a new universe',async () => {
  const e=entity();let release
  const queue=new LoreQueue(dataset([e]),async (_kind,scope,value,mutation)=>{
    assert.equal(scope,'veil');await new Promise(resolve=>{release=resolve});return ack(value,mutation)
  })
  queue.edit('entity',{...e,body:'Old universe'})
  const p=queue.flush();queue.dispose();release();await p
  assert.equal(queue.data.entities[0].revision,0)
  await assert.rejects(queue.flush(),/terminou/)
})
test('search accents, type filters, one-hop directional focus and archive filters',()=>{
  const a={...entity('Proteção'),kind:'person'},b={...entity('Porto'),kind:'location'},c=entity('Oculta')
  const data={...dataset([a,b,c]),relations:[{source:a.id,target:b.id,archived:false}]}
  assert.deepEqual(filterLore(data,'protecao','',null).map(e=>e.id),[a.id])
  assert.deepEqual(filterLore(data,'','location',null).map(e=>e.id),[b.id])
  assert.deepEqual(filterLore(data,'','',a.id).map(e=>e.id),[a.id,b.id])
  assert.equal(filterLore(data,'','',null,true).length,0)
})
