import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

// Synthetic data ONLY: browser -> isolated HTTP shim -> production SQL in PGlite.
// These addresses cannot be overridden to target a live project.
const origin='http://127.0.0.1:5176',backend='http://127.0.0.1:9179'
const personal=process.env.LORELINK_PLAYER_QA==='1'
const character='10000000-0000-4000-8000-000000000002'
const version=personal?'v2':'v1',binding=personal?{requested_character:character}:{}

test('documents: write, organise, retry, reload and preserve private boundaries',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1440,height:960}})
  t.after(()=>browser.close())
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.request.post(`${backend}/__test/reset`)
  await page.goto(origin)
  await page.getByLabel(/^email$/i).fill(personal?'player@example.test':'gm@example.test')
  await page.getByLabel(/^palavra-passe$/i).fill('test-only')
  const tokenResponse=page.waitForResponse(r=>r.url().includes('/auth/v1/token')&&r.status()===200)
  const profileReady=page.waitForResponse(r=>r.url().includes('/rest/v1/profiles')&&r.status()===200)
  await page.getByRole('button',{name:/entrar no arquivo/i}).click()
  const token=(await (await tokenResponse).json()).access_token
  await profileReady
  const call=async(name,args={})=>{
    const response=await page.request.post(`${backend}/rest/v1/rpc/${name}`,{headers:{Authorization:`Bearer ${token}`},data:args})
    if(!response.ok())throw new Error(JSON.stringify(await response.json()))
    return response.json()
  }
  const read=()=>call(`lorelink_read_${version}`,{expected_scope:'veil',...binding})
  const saved=()=>expect(page.locator('.lore-save')).toHaveText('Guardado',{timeout:10000})
  const title=page.getByRole('textbox',{name:'Título da página',exact:true})
  const body=page.getByRole('textbox',{name:'Texto da página',exact:true})
  await page.goto(`${origin}/app/history`)
  await expect(body).toBeVisible()
  assert.equal((await read()).entities.length,0,'opening a blank writer must not create data')
  await expect(page.getByRole('button',{name:'Mapa de relações'})).toHaveCount(0)
  await expect(page.getByRole('combobox',{name:'Filtrar por tipo'})).toHaveCount(0)
  await expect(page.locator('.lore-card,.lore-character-card')).toHaveCount(0)

  await body.pressSequentially('Uma memória antes da campanha.')
  await title.fill('Antes da campanha')
  await page.getByRole('combobox',{name:'Período da página'}).selectOption('past')
  await page.getByRole('button',{name:'Etiqueta',exact:true}).click()
  await page.getByRole('textbox',{name:'Nova etiqueta'}).fill('memórias')
  await page.getByRole('button',{name:'Adicionar etiqueta',exact:true}).click()
  await saved()
  const first=(await read()).entities.find(e=>e.name==='Antes da campanha')
  assert.equal(first.kind,'note')
  assert.equal(first.visibility,'private')
  assert.deepEqual(first.tags,['memórias','lorelink:period:v1:past'])
  assert.equal((await read()).nodes.length,0)
  await page.reload()
  await expect(body).toHaveValue('Uma memória antes da campanha.')
  await expect(page.getByRole('combobox',{name:'Período da página'})).toHaveValue('past')

  await page.locator('.history-new-page').click()
  await title.fill('Sessão 1')
  await page.getByRole('combobox',{name:'Período da página'}).selectOption('campaign')
  await body.fill('A sessão começou com uma mensagem inesperada.')
  await saved()
  const second=(await read()).entities.find(e=>e.name==='Sessão 1')
  await page.request.post(`${backend}/__test/delay-next`)
  const delayed=page.waitForRequest(r=>r.url().includes(`lorelink_save_entity_${version}`))
  await body.fill('Texto durante o pedido em curso.')
  await delayed
  await body.fill('Texto mais recente, preservado depois da resposta atrasada.')
  await saved()
  assert.equal((await read()).entities.find(e=>e.id===second.id).body,'Texto mais recente, preservado depois da resposta atrasada.')

  await page.request.post(`${backend}/__test/fail-next`)
  await body.fill('Este texto não se pode perder se a rede falhar.')
  await expect(page.locator('.lore-save')).toHaveText('Não foi possível guardar')
  await page.getByRole('link',{name:'Operativos',exact:true}).click()
  await expect(page.getByRole('dialog',{name:'Alterações por guardar'})).toBeVisible()
  await page.getByRole('button',{name:'Continuar a escrever'}).click()
  await expect(body).toHaveValue('Este texto não se pode perder se a rede falhar.')
  await page.getByRole('button',{name:'Tentar guardar',exact:true}).click()
  await saved()
  await page.getByRole('button',{name:'Antes da campanha Passado',exact:true}).click()
  await expect(body).toHaveValue('Uma memória antes da campanha.')
  await page.getByRole('button',{name:'Sessão 1 Durante a campanha',exact:true}).click()
  await expect(body).toHaveValue('Este texto não se pode perder se a rede falhar.')

  await body.fill('**Texto formatado**\n\n<script>alert(1)</script>\n\n[link](javascript:alert(1))')
  await saved()
  await page.getByRole('button',{name:'Ler',exact:true}).click()
  await expect(page.locator('.history-reading strong')).toHaveText('Texto formatado')
  await expect(page.locator('.history-reading script,.history-reading a[href^="javascript:"]')).toHaveCount(0)
  await page.getByRole('button',{name:'Escrever',exact:true}).click()
  await page.setViewportSize({width:390,height:844})
  await page.reload()
  await expect(body).toBeVisible()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.getByRole('button',{name:'Mostrar páginas',exact:true}).click()
  await page.getByRole('button',{name:'Sessão 1 Durante a campanha',exact:true}).click()
  await expect(body).toHaveValue('**Texto formatado**\n\n<script>alert(1)</script>\n\n[link](javascript:alert(1))')
  await expect(page.locator('.history-pages')).not.toBeVisible()

  if(personal){
    await page.goto(`${origin}/app/history?character=10000000-0000-4000-8000-000000000007`)
    await expect(body).toHaveValue('')
    await expect(page.getByText('Sessão 1',{exact:true})).toHaveCount(0)
    await page.goto(`${origin}/app/history?character=10000000-0000-4000-8000-000000000001`)
    await expect(page.getByRole('alert')).toContainText('não está disponível')
    await expect(body).toHaveCount(0)
  }
  assert.deepEqual(errors,[])
})
