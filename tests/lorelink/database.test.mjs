import test from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFixture,gm,player,outsider,entryId,documentId,asActor,rpc,entity,save } from './fixture.mjs'

test('real PostgreSQL: complete Lorelink migration, persistence, authorization and isolation',async t => {
  const db = await createFixture()
  t.after(() => db.close())
  let a,b,r,node
  await t.test('create blank private drafts, edit long Markdown, fictional date and recover history',async () => {
    a = await save(db,gm,entity('A synthetic character'))
    b = await save(db,gm,{...entity('B synthetic event'),kind:'event',fictional_date:'Antes do inverno 42'})
    a = await save(db,gm,{...a,body:'# Corpo\n\n'+ 'Texto longo. '.repeat(5000),canon:'canonical'})
    const read = await rpc(db,gm,'lorelink_read_v1',['veil'])
    assert.equal(read.entities.find(e=>e.id===a.id).body,a.body)
    assert.equal(a.visibility,'private')
    assert.equal(read.entities.find(e=>e.id===b.id).fictional_date,'Antes do inverno 42')
    const history = await rpc(db,gm,'lorelink_history_v1',['veil',a.id])
    assert.equal(history[0].snapshot.body,'')
    assert.equal(history[0].snapshot.revision,1)
  })
  await t.test('idempotent retry after lost acknowledgement; concurrent stale revision fails',async () => {
    const mutation=crypto.randomUUID(), previous=a
    a=await save(db,gm,{...a,summary:'Nova versão'},'entity',mutation)
    assert.deepEqual(await save(db,gm,{...previous,summary:'Nova versão'},'entity',mutation),a)
    await assert.rejects(save(db,gm,{...previous,body:'stale'}),/LORELINK_CONFLICT/)
    const rows=await db.query('select count(*)::integer n from public.lorelink_entities where id=$1',[a.id])
    assert.equal(rows.rows[0].n,1)
  })
  await t.test('directional relationships create, rename and remove; positions persist independently',async () => {
    const data=await rpc(db,gm,'lorelink_read_v1',['veil'])
    node=await save(db,gm,{map_id:data.map_id,entity_id:a.id,workspace_os_id:'veil',x:120,y:-340,hidden:false,revision:0},'node')
    node=await save(db,gm,{...node,x:555,y:212},'node')
    r=await save(db,gm,{id:crypto.randomUUID(),workspace_os_id:'veil',source:a.id,target:b.id,label:'participou em',visibility:'private',archived:false,revision:0},'relation')
    r=await save(db,gm,{...r,label:'protege'},'relation')
    let read=await rpc(db,gm,'lorelink_read_v1',['veil'])
    assert.equal(read.relations.length,1);assert.equal(read.relations[0].source,a.id);assert.equal(read.nodes[0].x,555)
    node=await save(db,gm,{...node,hidden:true},'node')
    read=await rpc(db,gm,'lorelink_read_v1',['veil'])
    assert.equal(read.entities.length,2);assert.equal(read.nodes[0].hidden,true)
    r=await save(db,gm,{...r,archived:true},'relation')
    assert.equal((await rpc(db,gm,'lorelink_read_v1',['veil'])).relations.length,0)
    r=await save(db,gm,{...r,archived:false},'relation')
  })
  await t.test('private names, relations, nodes, counts and sources never reach player responses',async () => {
    const hidden=await rpc(db,player,'lorelink_read_v1',['veil'])
    assert.deepEqual(hidden.entities,[]);assert.deepEqual(hidden.relations,[]);assert.deepEqual(hidden.nodes,[])
    await assert.rejects(rpc(db,player,'lorelink_sources_v1',['veil']),/FORBIDDEN/)
    await assert.rejects(rpc(db,player,'lorelink_history_v1',['veil',a.id]),/FORBIDDEN/)
    a=await save(db,gm,{...a,visibility:'revealed'})
    let read=await rpc(db,player,'lorelink_read_v1',['veil'])
    assert.equal(read.entities.length,1);assert.equal(read.relations.length,0)
    r=await save(db,gm,{...r,visibility:'revealed'},'relation')
    assert.equal((await rpc(db,player,'lorelink_read_v1',['veil'])).relations.length,0)
    b=await save(db,gm,{...b,visibility:'revealed'})
    assert.equal((await rpc(db,player,'lorelink_read_v1',['veil'])).relations.length,1)
    r=await save(db,gm,{...r,visibility:'private'},'relation')
    read=await rpc(db,player,'lorelink_read_v1',['veil'])
    assert.equal(read.entities.length,2);assert.equal(read.relations.length,0)
  })
  await t.test('archive removes endpoints and connections; restore preserves content',async () => {
    a=await save(db,gm,{...a,archived:true})
    assert.equal((await rpc(db,player,'lorelink_read_v1',['veil'])).entities.length,1)
    assert.equal((await rpc(db,gm,'lorelink_read_v1',['veil'])).relations.length,0)
    a=await save(db,gm,{...a,archived:false,visibility:'private'})
    assert.equal((await rpc(db,gm,'lorelink_read_v1',['veil'])).relations.length,1)
  })
  await t.test('workspace transition rejects stale writes, reads and cross-scope IDs',async () => {
    await rpc(db,gm,'set_net_gm_system_workspace_v1',['altara'])
    assert.equal((await rpc(db,gm,'lorelink_read_v1',['altara'])).entities.length,0)
    await assert.rejects(save(db,gm,{...a,body:'late write'}),/WORKSPACE_CHANGED/)
    await assert.rejects(save(db,gm,{...a,workspace_os_id:'altara'}),/NOT_FOUND/)
    await assert.rejects(save(db,gm,{...r,workspace_os_id:'altara'},'relation'),/NOT_FOUND/)
    await assert.rejects(save(db,gm,{...node,workspace_os_id:'altara'},'node'),/NOT_FOUND/)
    await assert.rejects(rpc(db,player,'lorelink_read_v1',['altara']),/WORKSPACE_CHANGED/)
    await assert.rejects(rpc(db,gm,'lorelink_attach_v1',['altara',entryId,'knowledge']),/NOT_FOUND/)
    await rpc(db,gm,'set_net_gm_system_workspace_v1',['veil'])
    assert.equal((await rpc(db,gm,'lorelink_read_v1',['veil'])).entities.find(e=>e.id===a.id).body,a.body)
  })
  await t.test('existing lore is referenced by original ID, no content copies, source secrecy retained',async () => {
    let linked=await rpc(db,gm,'lorelink_attach_v1',['veil',entryId,'knowledge'])
    assert.equal(linked.id,entryId);assert.equal(linked.body,'Texto original')
    assert.equal((await db.query('select body from public.lorelink_entities where id=$1',[entryId])).rows[0].body,'')
    await db.query('update public.net_search_knowledge_entries set content=$1 where id=$2',['Mudou na origem',entryId])
    assert.equal((await rpc(db,gm,'lorelink_read_v1',['veil'])).entities.find(e=>e.id===entryId).body,'Mudou na origem')
    linked=await save(db,gm,{...linked,visibility:'revealed',body:'Attempt source overwrite'})
    assert.equal(linked.body,'Mudou na origem')
    assert.ok(!(await rpc(db,player,'lorelink_read_v1',['veil'])).entities.some(e=>e.id===entryId))
    assert.ok(!(await rpc(db,gm,'lorelink_sources_v1',['veil'])).some(e=>e.id===documentId))
  })
  await t.test('direct tables, spoofed roles, unauthorized RPCs and anonymous access denied',async () => {
    for (const table of ['entities','nodes','maps','relations','revisions']) {
      await assert.rejects(asActor(db,player,tx=>tx.query(`select * from public.lorelink_${table}`)),/permission denied/)
      await assert.rejects(asActor(db,gm,tx=>tx.query(`select * from public.lorelink_${table}`)),/permission denied/)
    }
    await assert.rejects(save(db,player,{...a,role:'gm'}),/FORBIDDEN/)
    await assert.rejects(save(db,player,node,'node'),/FORBIDDEN/)
    await assert.rejects(save(db,player,r,'relation'),/FORBIDDEN/)
    await assert.rejects(rpc(db,outsider,'lorelink_context_v1'),/FORBIDDEN/)
    await assert.rejects(rpc(db,null,'lorelink_context_v1',[],'anon'),/permission denied/)
    await assert.rejects(save(db,gm,{...entity(),visibility:'revealed'}),/NEW_PRIVATE_REQUIRED/)
  })
  await t.test('images use private bucket, validate scope, guard broad existing storage policies',async () => {
    const path=`lorelink-entity/${a.id}/avatar/veil/${'a'.repeat(32)}/display.webp`
    const descriptor={v:1,h:'a'.repeat(64),d:{p:path,m:'image/webp',w:320,h:320,b:1000}}
    const image='rpg-media:v1:'+Buffer.from(JSON.stringify(descriptor)).toString('base64url')
    a=await save(db,gm,{...a,image})
    await asActor(db,gm,tx=>tx.query('insert into storage.objects(bucket_id,name) values($1,$2)',['rpg-media',path]))
    assert.equal((await asActor(db,player,tx=>tx.query('select * from storage.objects'))).rows.length,0)
    assert.equal(await rpc(db,player,'lorelink_media_allowed_v1',[path,false]),false)
    await assert.rejects(save(db,gm,{...a,image:'https://public.invalid/portrait.png'}),/IMAGE_INVALID/)
    await rpc(db,gm,'set_net_gm_system_workspace_v1',['altara'])
    assert.equal((await asActor(db,gm,tx=>tx.query('select * from storage.objects'))).rows.length,0)
    await assert.rejects(asActor(db,gm,tx=>tx.query('insert into storage.objects(bucket_id,name) values($1,$2)',['rpg-media',path])),/row-level security/)
    await rpc(db,gm,'set_net_gm_system_workspace_v1',['veil'])
    a=await save(db,gm,{...a,visibility:'revealed'})
    assert.equal(await rpc(db,player,'lorelink_media_allowed_v1',[path,false]),true)
  })
  await t.test('existing player entitlement remains authoritative; GM authoring is independent',async()=>{
    await db.exec(`create or replace function public.current_net_search_scope_v1() returns text
      language plpgsql stable security definer set search_path=public,pg_temp as $$
      begin raise exception 'NET_SEARCH_UNAVAILABLE' using errcode='42501'; end $$;`)
    await assert.rejects(rpc(db,player,'lorelink_context_v1'),/NET_SEARCH_UNAVAILABLE/)
    assert.equal((await rpc(db,gm,'lorelink_context_v1')).role,'gm')
  })
  await t.test('rollback disables only the API and retains authored records',async()=>{
    const before=(await db.query('select count(*)::integer n from public.lorelink_entities')).rows[0].n
    await db.exec(await readFile(new URL('../../supabase/lorelink-v1.rollback.sql',import.meta.url),'utf8'))
    await assert.rejects(rpc(db,gm,'lorelink_read_v1',['veil']),/permission denied/)
    assert.equal((await db.query('select count(*)::integer n from public.lorelink_entities')).rows[0].n,before)
  })
})

test('PostgreSQL data survives closing and reopening the disk-backed database',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lorelink-persistence-'))
  let db=await createFixture(directory)
  const e=await save(db,gm,{...entity('Persistência em disco'),body:'Sobrevive ao reinício do processo.'})
  const data=await rpc(db,gm,'lorelink_read_v1',['veil'])
  await save(db,gm,{map_id:data.map_id,entity_id:e.id,workspace_os_id:'veil',x:120,y:300,hidden:false,revision:0},'node')
  await db.close()
  db=new PGlite(directory)
  try {
    const reloaded=await rpc(db,gm,'lorelink_read_v1',['veil'])
    assert.equal(reloaded.entities[0].body,e.body)
    assert.equal(reloaded.nodes[0].y,300)
  } finally {await db.close()}
})
