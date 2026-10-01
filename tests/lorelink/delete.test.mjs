import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixture, rpc, asActor, entity, gm, player, otherPlayer, thirdCharacter, entryId } from './fixture.mjs'
import { LoreQueue } from '../../src/lib/lorelinkQueue.ts'

test('permanent deletion: actual SQL removes only the authorized page, versions and graph references',async t=>{
  const db=await createFixture();t.after(()=>db.close())
  const save=(e,kind='entity')=>rpc(db,player,`lorelink_save_${kind}_v2`,['veil',player,e.revision,crypto.randomUUID(),e])
  const data=await rpc(db,player,'lorelink_read_v2',['veil',player])
  let a=await save({...entity('Apagar apenas esta'),body:'Primeira versão'})
  a=await save({...a,body:'Segunda versão'})
  const b=await save(entity('Preservar esta'))
  await save({entity_id:a.id,map_id:data.map_id,workspace_os_id:'veil',x:0,y:0,hidden:false,revision:0},'node')
  await save({id:crypto.randomUUID(),source:a.id,target:b.id,workspace_os_id:'veil',label:'Conhece',visibility:'private',archived:false,revision:0},'relation')
  const args=['veil',player,a.id,a.revision,crypto.randomUUID()]
  await t.test('wrong actors, character, scope, stale revision and anonymous requests cannot delete',async()=>{
    for(const actor of [gm,otherPlayer])await assert.rejects(rpc(db,actor,'lorelink_delete_entity_v2',args),/FORBIDDEN/)
    await assert.rejects(rpc(db,player,'lorelink_delete_entity_v2',['veil',thirdCharacter,...args.slice(2)]),/NOT_FOUND/)
    await assert.rejects(rpc(db,player,'lorelink_delete_entity_v2',['altara',...args.slice(1)]),/WORKSPACE_CHANGED/)
    await assert.rejects(rpc(db,player,'lorelink_delete_entity_v2',['veil',player,a.id,a.revision-1,args[4]]),/CONFLICT/)
    await assert.rejects(rpc(db,null,'lorelink_delete_entity_v2',args,'anon'),/permission denied/)
    await assert.rejects(rpc(db,gm,'lorelink_delete_entity_v1',['veil',a.id,a.revision,args[4]]),/NOT_FOUND/)
    assert.equal((await rpc(db,player,'lorelink_read_v2',['veil',player])).entities.length,2)
  })
  await t.test('delete, retry lost acknowledgement, and reject delayed resurrection',async()=>{
    const ack=await rpc(db,player,'lorelink_delete_entity_v2',args)
    assert.equal(ack.deleted,true);assert.equal(ack.id,a.id)
    assert.deepEqual(await rpc(db,player,'lorelink_delete_entity_v2',args),ack)
    const remaining=await rpc(db,player,'lorelink_read_v2',['veil',player])
    assert.deepEqual(remaining.entities.map(e=>e.id),[b.id]);assert.deepEqual(remaining.nodes,[]);assert.deepEqual(remaining.relations,[])
    assert.equal((await db.query('select count(*)::int n from lorelink_revisions where entity_id=$1',[a.id])).rows[0].n,0)
    await assert.rejects(save({...a,revision:0}),/DELETED/)
    await assert.rejects(rpc(db,player,'lorelink_delete_entity_v2',[...args.slice(0,4),crypto.randomUUID()]),/NOT_FOUND/)
    await assert.rejects(asActor(db,player,tx=>tx.exec('select * from lorelink_private.entity_deletions')),/permission denied/)
  })
  await t.test('GM can delete their universe page but attached sources are preserved',async()=>{
    const e=await rpc(db,gm,'lorelink_save_entity_v1',['veil',0,crypto.randomUUID(),entity('Mestre')])
    assert.equal((await rpc(db,gm,'lorelink_delete_entity_v1',['veil',e.id,e.revision,crypto.randomUUID()])).deleted,true)
    const attached=await rpc(db,gm,'lorelink_attach_v1',['veil',entryId,'knowledge'])
    await assert.rejects(rpc(db,gm,'lorelink_delete_entity_v1',['veil',attached.id,attached.revision,crypto.randomUUID()]),/SOURCE_REQUIRED/)
  })
})

const dataset=e=>({scope:'veil',role:'author',character_id:player,entities:[e],nodes:[{entity_id:e.id}],relations:[{source:e.id,target:'other'}]})
const saveAck=(v,m)=>({...v,revision:v.revision+1,mutation_id:m})
const deleteAck=(v,m)=>({id:v.id,workspace_os_id:v.workspace_os_id,character_id:v.character_id,revision:v.revision,mutation_id:m,deleted:true})

test('missing delete RPC leaves the page editable and never retries deletion during later saves',async()=>{
  const e={...entity(),revision:3,character_id:player,body:'Preservar'}, requests=[]
  const q=new LoreQueue(dataset(e),async(_k,_s,v,m)=>saveAck(v,m),async()=>{requests.push('delete');throw Error('PGRST202: Could not find the function public.lorelink_delete_entity_v2 in the schema cache')})
  await assert.rejects(q.deleteEntity(e.id),/PGRST202/)
  assert.equal(q.isDeleting(e.id),false);assert.equal(q.dirty,false);assert.equal(q.error,null)
  assert.equal(q.data.entities[0].body,'Preservar')
  q.edit('entity',{...e,body:'Continuar a escrever'});await q.flush()
  assert.equal(q.data.entities[0].body,'Continuar a escrever');assert.equal(q.data.entities[0].revision,4)
  assert.deepEqual(requests,['delete']);q.dispose()
})
test('queue completes delayed edits before delete and blocks further edits to the target',async()=>{
  const e={...entity(),character_id:player},order=[];let release
  const q=new LoreQueue(dataset(e),async(_k,_s,v,m)=>{order.push('save');await new Promise(resolve=>{release=resolve});return saveAck(v,m)},async(_s,v,m)=>{order.push('delete');assert.equal(v.revision,1);return deleteAck(v,m)})
  q.edit('entity',{...e,body:'Final'});const saving=q.flush();const deleting=q.deleteEntity(e.id)
  q.edit('entity',{...e,body:'Ignored after delete requested'});release();await Promise.all([saving,deleting])
  assert.deepEqual(order,['save','delete']);assert.deepEqual(q.data.entities,[]);assert.deepEqual(q.data.nodes,[]);assert.deepEqual(q.data.relations,[]);assert.equal(q.dirty,false);q.dispose()
})
test('lost delete acknowledgement retries the same revision and UUID without losing local text',async()=>{
  const e={...entity(),revision:3,character_id:player,body:'Keep until confirmed'},requests=[]
  const q=new LoreQueue(dataset(e),async(_k,_s,v,m)=>saveAck(v,m),async(_s,v,m)=>{requests.push({v:structuredClone(v),m});if(requests.length===1)throw Error('Offline');return deleteAck(v,m)})
  await assert.rejects(q.deleteEntity(e.id),/Offline/);assert.equal(q.data.entities[0].body,e.body);assert.equal(q.isDeleting(e.id),true)
  await q.flush();assert.deepEqual(requests[0],requests[1]);assert.equal(q.dirty,false);q.dispose()
})
test('wrong deletion acknowledgement and late response after disposal never clear local content',async()=>{
  const e={...entity(),character_id:player,revision:2}
  const q=new LoreQueue(dataset(e),async(_k,_s,v,m)=>saveAck(v,m),async(_s,v,m)=>({...deleteAck(v,m),character_id:otherPlayer}))
  await assert.rejects(q.deleteEntity(e.id),/inválida/);assert.equal(q.data.entities.length,1);assert.equal(q.dirty,true);q.dispose()
  let release;const late=new LoreQueue(dataset(e),async(_k,_s,v,m)=>saveAck(v,m),async(_s,v,m)=>{await new Promise(resolve=>{release=resolve});return deleteAck(v,m)})
  const pending=late.deleteEntity(e.id);late.dispose();release();await pending;assert.equal(late.data.entities.length,1)
})
