import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Synthetic data ONLY: the isolated server runs the actual Lorelink SQL in PGlite.
// These addresses deliberately cannot be overridden to point at an existing DB.
const origin='http://127.0.0.1:5176', backend='http://127.0.0.1:9179'
const character='10000000-0000-4000-8000-000000000002'
const shots=process.env.LORELINK_SCREENSHOTS ?? join(tmpdir(),'lorelink-reading-evidence')

test('reading and dense graph: player browser → HTTP → isolated PostgreSQL',async t=>{
  await mkdir(shots,{recursive:true})
  const browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1560,height:1040}})
  t.after(async()=>{await page.screenshot({path:join(shots,'qa-last-state.png')}).catch(()=>{});await browser.close()})
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(message.text().includes('[React Flow]'))errors.push(message.text())})
  const step=async(name,action)=>{
    let failure
    await t.test(name,async()=>{try{await action()}catch(error){failure=error;throw error}})
    if(failure)throw failure
  }
  await page.request.post(`${backend}/__test/reset`)
  await page.goto(origin)
  await page.getByLabel(/^email$/i).fill('player@example.test')
  await page.getByLabel(/^palavra-passe$/i).fill('test-only')
  const tokenResponse=page.waitForResponse(r=>r.url().includes('/auth/v1/token')&&r.status()===200)
  const profileResponse=page.waitForResponse(r=>r.url().includes('/rest/v1/profiles')&&r.status()===200)
  await page.getByRole('button',{name:/entrar no arquivo/i}).click()
  const token=(await (await tokenResponse).json()).access_token
  await profileResponse
  const call=async(name,args)=>{
    const response=await page.request.post(`${backend}/rest/v1/rpc/${name}`,{headers:{Authorization:`Bearer ${token}`},data:args})
    assert.equal(response.ok(),true,await response.text())
    return response.json()
  }
  const read=()=>call('lorelink_read_v2',{expected_scope:'veil',requested_character:character})
  const save=(kind,payload)=>call(`lorelink_save_${kind}_v2`,{expected_scope:'veil',requested_character:character,
    expected_revision:payload.revision,mutation:crypto.randomUUID(),payload})
  const map=(await read()).map_id
  const longText='## Antes da viagem\n\nEste é um texto sintético, criado apenas para verificar o modo de leitura. **Uma memória importante** merece espaço para ser lida.\n\n## Pessoas e lugares\n\nO mapa ajuda a organizar notas e relações. Cada bolha abre uma parte da história.\n\n> Uma frase guardada no caderno.\n\n- Recordar uma conversa\n- Regressar a um lugar\n\n## O próximo capítulo\n\n'+('Há espaço para continuar a escrever, com parágrafos legíveis e sem perder as ideias.\n\n'.repeat(12))
  const cards=[]
  const names=['Caderno da personagem','Companheira','Família','Mentor','Amizade','Rival','Grupo','Refúgio','Viagem','Encontro','Lembrança','Objeto','Uma pista']
  for(let i=0;i<names.length;i++){
    const card=await save('entity',{id:crypto.randomUUID(),workspace_os_id:'veil',name:names[i],kind:i===0?'person':i===7?'location':i===8||i===9?'event':i===11?'object':'person',
      body:i===0?longText:'## Uma nota\n\nConteúdo sintético para testar a navegação entre fichas.',summary:i===0?'Memórias, pessoas e acontecimentos, organizados num só lugar.':'',
      tags:i===0?['memórias','viagem']:[],canon:'canonical',visibility:'private',fictional_date:i===8?'Antes do inverno':'',image:null,archived:false,revision:0})
    cards.push(card)
    const angle=(i-1)*Math.PI*2/12
    await save('node',{map_id:map,entity_id:card.id,workspace_os_id:'veil',x:i===0?0:Math.round(Math.cos(angle)*600),y:i===0?0:Math.round(Math.sin(angle)*360),hidden:false,revision:0})
  }
  for(let i=1;i<cards.length;i++)await save('relation',{id:crypto.randomUUID(),workspace_os_id:'veil',source:cards[0].id,target:cards[i].id,
    label:['conhece','protege','procura','recorda'][i%4],visibility:'private',archived:false,revision:0})
  await save('relation',{id:crypto.randomUUID(),workspace_os_id:'veil',source:cards[1].id,target:cards[0].id,label:'confia em',visibility:'private',archived:false,revision:0})
  await save('relation',{id:crypto.randomUUID(),workspace_os_id:'veil',source:cards[0].id,target:cards[1].id,label:'viajou com',visibility:'private',archived:false,revision:0})
  const initial=await read(), node=id=>page.locator(`.react-flow__node[data-id="${id}"]`)
  const saved=()=>expect(page.locator('.lore-save')).toHaveText('Guardado',{timeout:10000})
  await page.goto(`${origin}/app/history?character=${character}`)
  await expect(page.locator('.react-flow__node')).toHaveCount(13)
  await page.getByRole('button',{name:'Enquadrar tudo'}).click()

  await step('many handles, distinct parallel/reverse curves; keyboard focus follows the stroke',async()=>{
    await expect(node(cards[0].id).locator('.react-flow__handle')).toHaveCount(16)
    await expect(node(cards[1].id).locator('.react-flow__handle')).toHaveCount(12)
    const paths=await page.locator('.react-flow__edge-path').evaluateAll(elements=>elements.map(e=>e.getAttribute('d')))
    assert.equal(paths.length,14);assert.equal(new Set(paths).size,14)
    assert.ok(paths.every(path=>path&&!path.includes('NaN')))
    const parallel=initial.relations.filter(r=>[cards[0].id,cards[1].id].includes(r.source)&&[cards[0].id,cards[1].id].includes(r.target))
    const labels=[]
    for(const relation of parallel){
      const specific=page.getByRole('button',{name:`Relação: ${cards.find(c=>c.id===relation.source).name} → ${relation.label} → ${cards.find(c=>c.id===relation.target).name}`,exact:true})
      labels.push(await specific.boundingBox())
    }
    for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
      const a=labels[i],b=labels[j]
      const overlap=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))
      assert.equal(overlap,0,'parallel relation labels must not overlap')
    }
    await page.locator('.react-flow__edge').first().focus()
    assert.equal(await page.locator('.react-flow__edge').first().evaluate(el=>getComputedStyle(el).outlineStyle),'none')
    await page.screenshot({path:join(shots,'historia-muitas-ligacoes.png')})
  })

  await step('bubble opens safe formatted reading; expanded layout and related-card navigation',async()=>{
    const viewport=await page.locator('.react-flow__viewport').getAttribute('style')
    await node(cards[0].id).click()
    assert.equal(await page.locator('.react-flow__viewport').getAttribute('style'),viewport)
    await expect(page.locator('.lore-reader h2').first()).toHaveText(names[0])
    await expect(page.locator('.lore-reader strong')).toHaveText('Uma memória importante')
    await expect(page.locator('.lore-reader blockquote')).toContainText('Uma frase guardada')
    await expect(page.locator('.lore-editor input,.lore-editor textarea,.lore-editor select')).toHaveCount(0)
    await page.getByRole('button',{name:'Expandir leitura'}).click()
    await expect(page.locator('.lore-editor--expanded')).toBeVisible()
    await page.screenshot({path:join(shots,'historia-leitura-expandida.png')})
    await page.getByRole('button',{name:'Recolher leitura'}).click()
    await page.locator('.lore-relation-row button').filter({hasText:names[1]}).first().click()
    await expect(page.locator('.lore-reader h2').first()).toHaveText(names[1])
  })

  await step('read/edit preserves draft and legacy state; failure can be read and retried without loss',async()=>{
    await page.getByRole('button',{name:'Editar',exact:true}).click()
    await expect(page.getByRole('combobox',{name:'Estado',exact:true})).toHaveCount(0)
    await expect(page.locator('.lore-editor')).not.toContainText('Canónico')
    await expect(page.locator('.lore-editor')).not.toContainText('Rascunho')
    await page.request.post(`${backend}/__test/fail-next`)
    const text='## Texto preservado\n\n**Escrito pelo jogador** durante o teste.\n\n<script>window.__reader_xss=1</script>\n\n[link](javascript:alert(1))'
    await page.getByPlaceholder('Escreve livremente a história desta ficha…').fill(text)
    await page.getByRole('button',{name:'Ler',exact:true}).click()
    await expect(page.locator('.lore-reader strong')).toHaveText('Escrito pelo jogador')
    await expect(page.locator('.lore-save')).toHaveText('Não foi possível guardar')
    assert.equal(await page.evaluate(()=>window.__reader_xss),undefined)
    await expect(page.locator('.lore-reader script,.lore-reader a[href^="javascript:"]')).toHaveCount(0)
    await page.getByRole('button',{name:'Editar',exact:true}).click()
    await expect(page.getByPlaceholder('Escreve livremente a história desta ficha…')).toHaveValue(text)
    await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();await saved()
    const data=await read()
    assert.equal(data.entities.find(e=>e.id===cards[1].id).body,text)
    assert.equal(data.entities.find(e=>e.id===cards[1].id).canon,'canonical','removing the selector preserves existing stored state')
  })

  await step('connect from top to bottom handle; direction persists and map is never rearranged',async()=>{
    await page.getByRole('button',{name:'Fechar ficha'}).click()
    const from=node(cards[10].id).locator('[data-handleid="port-9"]'),to=node(cards[2].id).locator('[data-handleid="port-3"]')
    const a=await from.boundingBox(),b=await to.boundingBox()
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down()
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:24});await page.mouse.up()
    const dialog=page.getByRole('dialog',{name:'Relação',exact:true})
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('combobox',{name:'Origem',exact:true})).toHaveValue(cards[10].id)
    await expect(dialog.getByRole('combobox',{name:'Destino',exact:true})).toHaveValue(cards[2].id)
    await dialog.getByLabel('Nome da relação').fill('nova ligação pelos pontos')
    await dialog.getByRole('button',{name:'Guardar relação'}).click();await saved()
    await page.reload();await expect(page.locator('.react-flow__edge-path')).toHaveCount(15)
    const data=await read(),r=data.relations.find(r=>r.label==='nova ligação pelos pontos')
    assert.equal(r.source,cards[10].id);assert.equal(r.target,cards[2].id)
    assert.deepEqual(data.nodes.map(n=>[n.entity_id,n.x,n.y]),initial.nodes.map(n=>[n.entity_id,n.x,n.y]))
  })

  await step('mobile reading stays inside screen; content scrolls and closing returns to the map',async()=>{
    await node(cards[0].id).click()
    await page.setViewportSize({width:390,height:844})
    await expect(page.getByRole('button',{name:'Fechar ficha'})).toBeVisible()
    const box=await page.locator('.lore-editor').boundingBox()
    assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=390&&box.y+box.height<=844)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:join(shots,'historia-leitura-mobile.png')})
    await page.locator('.lore-reader .net-search-markdown p').last().scrollIntoViewIfNeeded()
    assert.ok(await page.locator('.lore-editor__body').evaluate(el=>el.scrollTop>0))
    await page.getByRole('button',{name:'Fechar ficha'}).click()
    await expect(page.locator('.lore-map')).toBeVisible()
  })
  assert.deepEqual(errors,[],'No runtime errors or React Flow handle warnings')
})
