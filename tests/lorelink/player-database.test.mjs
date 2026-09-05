import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createFixture, rpc, asActor, entity, gm, player, otherPlayer, outsider, secondCharacter, thirdCharacter } from './fixture.mjs'

test('player stories: actual PostgreSQL ownership, character and universe boundaries',async t=>{
  const db=await createFixture();t.after(()=>db.close())
  const read=(character=player,scope='veil',actor=player)=>rpc(db,actor,'lorelink_read_v2',[scope,character])
  const save=(value,kind='entity',character=player,actor=player,mutation=crypto.randomUUID())=>
    rpc(db,actor,`lorelink_save_${kind}_v2`,[value.workspace_os_id,character,value.revision,mutation,value])
  let a,b,relation,node,map
  await t.test('all players author their own character; multiple owned sheets appear without GM promotion',async()=>{
    const list=await rpc(db,player,'lorelink_characters_v2')
    assert.deepEqual(list.map(c=>c.character_name),['Personagem A','Personagem B','Personagem C'])
    assert.deepEqual(list.map(c=>c.scope),['veil','altara','veil'])
    assert.equal((await rpc(db,otherPlayer,'lorelink_characters_v2')).length,1)
    assert.equal((await db.query('select role from profiles where id=$1',[player])).rows[0].role,'player')
    assert.equal((await read()).role,'author');map=(await read()).map_id
    assert.equal((await read()).map_id,map,'opening is idempotent')
    a=await save({...entity('Privada A'),body:'História pessoal '.repeat(4000)})
    b=await save({...entity('Evento privado'),kind:'event',fictional_date:'Antes do inverno'})
    await save(entity('Outra conta'),'entity',otherPlayer,otherPlayer)
    assert.equal(a.character_id,player);assert.equal(a.visibility,'private');assert.equal(a.created_by,player)
    assert.equal((await read()).entities.find(e=>e.id===a.id).body,a.body)
  })
  await t.test('relations and positions persist; removing a node preserves its entity',async()=>{
    relation=await save({id:crypto.randomUUID(),workspace_os_id:'veil',source:a.id,target:b.id,label:'participou em',visibility:'private',archived:false,revision:0},'relation')
    relation=await save({...relation,label:'investigou'},'relation')
    node=await save({map_id:map,entity_id:a.id,workspace_os_id:'veil',x:123,y:456,hidden:false,revision:0},'node')
    node=await save({...node,x:654,y:-12},'node')
    assert.equal((await read()).nodes[0].x,654)
    node=await save({...node,hidden:true},'node')
    assert.ok((await read()).entities.some(e=>e.id===a.id));assert.ok((await read()).nodes[0].hidden)
    assert.equal((await read()).relations[0].label,'investigou')
    await save({...relation,archived:true},'relation');assert.equal((await read()).relations.length,0)
  })
  await t.test('same account characters in same and different universes are separate',async()=>{
    for(const [character,scope] of [[secondCharacter,'altara'],[thirdCharacter,'veil']]){
      const data=await read(character,scope)
      assert.equal(data.entities.length,0);assert.equal(data.nodes.length,0);assert.equal(data.relations.length,0)
      assert.notEqual(data.map_id,map)
      await assert.rejects(save({...a,workspace_os_id:scope},'entity',character),/NOT_FOUND/)
      await assert.rejects(save({...node,map_id:data.map_id,workspace_os_id:scope},'node',character),/NOT_FOUND/)
      await assert.rejects(rpc(db,player,'lorelink_history_v2',[scope,character,a.id]),/NOT_FOUND/)
      const e=await save(entity('Segredo da personagem B',scope),'entity',character)
      await assert.rejects(save({...relation,id:crypto.randomUUID(),revision:0,source:a.id,target:e.id},'relation'),/NOT_FOUND/)
    }
    assert.equal((await read()).entities.length,2)
  })
  await t.test('other players, GM, outsiders and anonymous calls cannot read or mutate personal data',async()=>{
    for(const actor of [otherPlayer,gm,outsider]){
      await assert.rejects(read(player,'veil',actor),/FORBIDDEN/)
      await assert.rejects(save(a,'entity',player,actor),/FORBIDDEN/)
      await assert.rejects(rpc(db,actor,'lorelink_history_v2',['veil',player,a.id]),/FORBIDDEN/)
    }
    for(const name of ['lorelink_characters_v2','lorelink_context_v2','lorelink_read_v2'])
      await assert.rejects(rpc(db,null,name,name.includes('characters')?[]:name.includes('context')?[player]:['veil',player],'anon'),/permission denied/)
    for(const table of ['entities','maps','nodes','relations','revisions'])
      await assert.rejects(asActor(db,player,tx=>tx.query(`select * from public.lorelink_${table}`)),/permission denied/)
    const playerData=await read(otherPlayer,'veil',otherPlayer)
    assert.equal(playerData.entities.length,1);assert.equal(playerData.nodes.length,0)
    assert.ok(!JSON.stringify(playerData).includes(a.name));assert.ok(!JSON.stringify(playerData).includes(b.name))
  })
  await t.test('legacy GM APIs cannot bypass the personal boundary',async()=>{
    const data=await rpc(db,gm,'lorelink_read_v1',['veil'])
    assert.equal(data.entities.length,0);assert.equal(data.nodes.length,0);assert.equal(data.relations.length,0)
    for(const [kind,value] of [['entity',a],['relation',relation],['node',node]])
      await assert.rejects(rpc(db,gm,`lorelink_save_${kind}_v1`,['veil',value.revision,crypto.randomUUID(),value]),/NOT_FOUND/)
    await assert.rejects(rpc(db,gm,'lorelink_history_v1',['veil',a.id]),/NOT_FOUND/)
    await assert.rejects(rpc(db,player,'lorelink_save_entity_v2',['veil',null,a.revision,crypto.randomUUID(),a]),/FORBIDDEN/)
  })
  await t.test('spoofed ownership, visibility and revision cannot grant access or silently overwrite',async()=>{
    a=await save({...a,body:'Texto atualizado',created_by:gm,character_id:thirdCharacter,role:'gm'})
    assert.equal(a.character_id,player);assert.equal(a.created_by,player)
    await assert.rejects(save({...a,visibility:'revealed'}),/PRIVATE_REQUIRED/)
    const mutation=crypto.randomUUID(),updated=await save({...a,body:'Confirmação perdida'},'entity',player,player,mutation)
    assert.deepEqual(await save({...a,body:'Confirmação perdida'},'entity',player,player,mutation),updated)
    await assert.rejects(save({...a,body:'Pedido antigo'}),/CONFLICT/)
    a=updated
    const history=await rpc(db,player,'lorelink_history_v2',['veil',player,a.id])
    assert.equal(history[0].snapshot.body,'Texto atualizado')
    a=await save({...a,archived:true});assert.ok((await read()).entities.find(e=>e.id===a.id).archived)
    a=await save({...a,archived:false});assert.equal(a.archived,false)
  })
  await t.test('private images use existing guarded storage; GM broad policy cannot expose them',async()=>{
    const path=`lorelink-entity/${a.id}/avatar/veil/${'a'.repeat(32)}/display.webp`
    assert.equal(await rpc(db,player,'lorelink_media_allowed_v1',[path,true]),true)
    await asActor(db,player,tx=>tx.query('insert into storage.objects(bucket_id,name) values($1,$2)',['rpg-media',path]))
    for(const actor of [gm,otherPlayer,outsider]){
      assert.equal(await rpc(db,actor,'lorelink_media_allowed_v1',[path,false]),false)
      assert.equal((await asActor(db,actor,tx=>tx.query('select name from storage.objects where name=$1',[path]))).rows.length,0)
    }
    assert.equal(await rpc(db,player,'lorelink_media_allowed_v1',[path.replace('/veil/','/altara/'),false]),false)
    assert.equal((await asActor(db,player,tx=>tx.query('select name from storage.objects where name=$1',[path]))).rows.length,1)
  })
  await t.test('authoritative universe/ownership changes reject stale requests and retain original rows',async()=>{
    await db.query('update net_identity_os_assignments set primary_os_id=$1 where identity_link_id=$2',['altara',player])
    await assert.rejects(save({...a,body:'Wrong universe'}),/WORKSPACE_CHANGED/)
    assert.equal((await read(player,'altara')).entities.length,0)
    await db.query('update net_identity_os_assignments set primary_os_id=$1 where identity_link_id=$2',['veil',player])
    assert.equal((await read()).entities.find(e=>e.id===a.id).body,a.body)
    await db.query('update npc_cards set owner_profile_id=$1 where id=$2',[otherPlayer,secondCharacter])
    await assert.rejects(read(secondCharacter,'altara'),/FORBIDDEN/)
    assert.ok(!(await rpc(db,player,'lorelink_characters_v2')).some(c=>c.character_id===secondCharacter))
  })
  await t.test('existing character deletion remains possible and never turns private stories into GM lore',async()=>{
    const before=await read(thirdCharacter)
    assert.equal(before.entities.length,1)
    await db.query('delete from net_identity_links where id=$1',[thirdCharacter])
    await assert.rejects(read(thirdCharacter),/FORBIDDEN/)
    assert.equal((await rpc(db,gm,'lorelink_read_v1',['veil'])).entities.length,0)
    assert.equal((await db.query('select count(*)::int as count from lorelink_entities where character_id=$1',[thirdCharacter])).rows[0].count,1)
  })
  await t.test('installation verification and reversible deactivation preserve private content',async()=>{
    const verification=await db.exec(await readFile(new URL('../../supabase/lorelink-player-stories-v2.verify.sql',import.meta.url),'utf8'))
    assert.ok(Object.values(verification[0].rows[0]).every(Boolean))
    assert.ok(verification[1].rows.every(r=>r.rls_ativo&&!r.leitura_direta_anonima&&!r.leitura_direta_autenticada))
    assert.ok(verification[2].rows.every(r=>!r.acesso_anonimo&&r.acesso_autenticado))
    await db.exec(await readFile(new URL('../../supabase/lorelink-player-stories-v2.rollback.sql',import.meta.url),'utf8'))
    await assert.rejects(read(),/permission denied/)
    assert.equal((await rpc(db,gm,'lorelink_read_v1',['veil'])).entities.length,0)
    assert.equal((await db.query('select body from lorelink_entities where id=$1',[a.id])).rows[0].body,a.body)
  })
})
