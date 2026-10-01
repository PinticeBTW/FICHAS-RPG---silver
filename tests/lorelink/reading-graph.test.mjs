import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { historyPlainText } from '../../src/lib/historyDocument.ts'

const origin='http://127.0.0.1:5176',backend='http://127.0.0.1:9179'
const character='10000000-0000-4000-8000-000000000002'

// Existing map fixtures remain in storage. The document UX never edits them.
test('legacy stories: long reading and editing preserve summaries, tags, graph and ownership',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1440,height:960}})
  t.after(()=>browser.close())
  await page.request.post(`${backend}/__test/reset`)
  await page.goto(origin)
  await page.getByLabel(/^email$/i).fill('player@example.test')
  await page.getByLabel(/^palavra-passe$/i).fill('test-only')
  const response=page.waitForResponse(r=>r.url().includes('/auth/v1/token')&&r.status()===200)
  const profileReady=page.waitForResponse(r=>r.url().includes('/rest/v1/profiles')&&r.status()===200)
  await page.getByRole('button',{name:/entrar no arquivo/i}).click()
  const token=(await (await response).json()).access_token
  await profileReady
  const call=async(name,args)=>{
    const result=await page.request.post(`${backend}/rest/v1/rpc/${name}`,{headers:{Authorization:`Bearer ${token}`},data:args})
    if(!result.ok())throw new Error(JSON.stringify(await result.json()))
    return result.json()
  }
  const read=()=>call('lorelink_read_v2',{expected_scope:'veil',requested_character:character})
  const save=(kind,payload)=>call(`lorelink_save_${kind}_v2`,{expected_scope:'veil',requested_character:character,expected_revision:payload.revision,mutation:crypto.randomUUID(),payload})
  const map=(await read()).map_id
  const text='## Memórias\n\n**Uma memória importante**\n\n'+Array.from({length:70},(_,i)=>`Parágrafo ${i}: um texto antigo que continua preservado.\n\n`).join('')
  const cards=[]
  for(let i=0;i<13;i++){
    const card=await save('entity',{id:crypto.randomUUID(),workspace_os_id:'veil',name:`Texto antigo ${i}`,kind:'person',summary:'Resumo anterior preservado.',body:i===0?text:'Outro texto.',tags:['memórias'],canon:'canonical',visibility:'private',fictional_date:'Antes da campanha',image:null,archived:false,revision:0})
    cards.push(card)
    await save('node',{map_id:map,entity_id:card.id,workspace_os_id:'veil',x:i*200,y:i*20,hidden:false,revision:0})
  }
  await save('relation',{id:crypto.randomUUID(),workspace_os_id:'veil',source:cards[0].id,target:cards[1].id,label:'conhece',visibility:'private',archived:false,revision:0})
  const before=await read()
  await page.goto(`${origin}/app/history?character=${character}`)
  await expect(page.getByRole('textbox',{name:'Texto da página'})).toHaveText('')
  await page.getByRole('button',{name:'Texto antigo 0',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Texto da página'})).toContainText('Parágrafo 69: um texto antigo que continua preservado.')
  await page.getByRole('button',{name:'Ler',exact:true}).click()
  await expect(page.locator('.history-rich-content strong')).toHaveText('Uma memória importante')
  await page.locator('.history-rich-content p').last().scrollIntoViewIfNeeded()
  assert.ok(await page.locator('.history-paper').evaluate(el=>el.scrollTop)>0)
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.getByRole('button',{name:'Escrever',exact:true}).click()
  await page.getByRole('combobox',{name:'Período da página'}).selectOption('past')
  await page.getByRole('textbox',{name:'Texto da página'}).press('ControlOrMeta+End')
  await page.getByRole('textbox',{name:'Texto da página'}).press('Enter')
  await page.getByRole('textbox',{name:'Texto da página'}).pressSequentially('Texto acrescentado pelo autor.')
  await expect(page.locator('.lore-save')).toHaveText('Guardado',{timeout:10000})
  const after=await read(),entity=after.entities.find(e=>e.id===cards[0].id)
  assert.equal(entity.summary,cards[0].summary)
  assert.equal(entity.canon,'canonical')
  assert.equal(entity.kind,'person')
  assert.equal(entity.fictional_date,cards[0].fictional_date)
  assert.equal(entity.character_id,character)
  assert.ok(historyPlainText(entity.body).includes('Parágrafo 69: um texto antigo que continua preservado.'))
  assert.ok(historyPlainText(entity.body).endsWith('Texto acrescentado pelo autor.'))
  assert.deepEqual(entity.tags,['memórias','lorelink:period:v1:past'])
  assert.deepEqual(after.nodes,before.nodes)
  assert.deepEqual(after.relations,before.relations)
})
