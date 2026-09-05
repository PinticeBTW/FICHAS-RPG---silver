// Explicit isolated QA server. NEVER forwards requests to a real Supabase project.
// Auth and the pre-existing profile directory are a test shim; Lorelink RPCs
// execute the migration's actual PostgreSQL functions and storage RLS.
import { createServer } from 'node:http'
import { createServer as createViteServer } from 'vite'
import { createFixture,gm,player,outsider,rpc } from './fixture.mjs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testRoot=process.env.LORELINK_TEST_WORKDIR ?? join(tmpdir(),'lorelink-isolated-tests')
await mkdir(testRoot,{recursive:true})
const dataDir=await mkdtemp(join(testRoot,'database-'))
const db=await createFixture(dataDir)
const users={gm:{id:gm,role:'gm'},player:{id:player,role:'player'},outsider:{id:outsider,role:'outsider'}}
const token = role => `${Buffer.from(JSON.stringify({alg:'none'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:users[role].id,role:'authenticated',exp:4102444800})).toString('base64url')}.test-only`
const actors=new Map(Object.keys(users).map(role=>[token(role),users[role].id]))
let failNext=false,delayNext=0
const args = {
  lorelink_context_v1:[], lorelink_read_v1:['expected_scope'], lorelink_save_entity_v1:['expected_scope','expected_revision','mutation','payload'],
  lorelink_save_node_v1:['expected_scope','expected_revision','mutation','payload'],lorelink_save_relation_v1:['expected_scope','expected_revision','mutation','payload'],
  lorelink_history_v1:['expected_scope','entity'],lorelink_sources_v1:['expected_scope'],lorelink_attach_v1:['expected_scope','source_id','source_kind'],
  set_net_gm_system_workspace_v1:['requested_workspace_os_id'],
  lorelink_characters_v2:[],lorelink_context_v2:['requested_character'],lorelink_read_v2:['expected_scope','requested_character'],
  lorelink_save_entity_v2:['expected_scope','requested_character','expected_revision','mutation','payload'],
  lorelink_save_node_v2:['expected_scope','requested_character','expected_revision','mutation','payload'],
  lorelink_save_relation_v2:['expected_scope','requested_character','expected_revision','mutation','payload'],
  lorelink_history_v2:['expected_scope','requested_character','entity'],
}
const server=createServer(async (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5176')
  res.setHeader('Access-Control-Allow-Headers',req.headers['access-control-request-headers'] ?? 'authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,range')
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS')
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}
  res.setHeader('Content-Type','application/json')
  const send=(status,value)=>{res.writeHead(status);res.end(JSON.stringify(value))}
  const url=new URL(req.url,'http://127.0.0.1:9179')
  let body={}
  try {
    let text='';for await(const chunk of req)text+=chunk
    if(text)body=JSON.parse(text)
    if(url.pathname==='/__test/reset'){
      await db.exec('truncate public.lorelink_revisions,public.lorelink_relations,public.lorelink_nodes,public.lorelink_maps,public.lorelink_entities,public.net_gm_persona_sessions restart identity')
      await db.query('update public.net_identity_os_assignments set primary_os_id=$1 where identity_link_id=$2',['veil',player])
      failNext=false;delayNext=0;return send(200,{ok:true})
    }
    if(url.pathname==='/__test/fail-next'){failNext=true;return send(200,{ok:true})}
    if(url.pathname==='/__test/delay-next'){delayNext=1500;return send(200,{ok:true})}
    if(url.pathname==='/__test/character-scope'){
      if(body.character!==player||!['veil','altara'].includes(body.scope))return send(400,{message:'Fixture character only'})
      await db.query('update public.net_identity_os_assignments set primary_os_id=$1 where identity_link_id=$2',[body.scope,player])
      return send(200,{ok:true})
    }
    if(url.pathname==='/auth/v1/token'){
      const role=(body.email??'').split('@')[0]
      if(!users[role] || body.password!=='test-only')return send(400,{msg:'Test credentials required'})
      return send(200,{access_token:token(role),refresh_token:`test-${role}`,token_type:'bearer',expires_in:3600,
        user:{id:users[role].id,email:`${role}@example.test`,app_metadata:{provider:'email'},user_metadata:{},aud:'authenticated'}})
    }
    const actor=actors.get((req.headers.authorization??'').replace(/^Bearer /,''))
    if(url.pathname==='/auth/v1/logout')return send(200,{})
    if(!actor)return send(401,{code:'42501',message:'Authentication required'})
    if(url.pathname==='/auth/v1/user')return send(200,{id:actor,aud:'authenticated'})
    if(url.pathname==='/rest/v1/profiles'){
      const rows=await db.query('select * from public.profiles where id=$1',[actor])
      return send(200,(req.headers.accept??'').includes('object')?rows.rows[0]:rows.rows)
    }
    const name=url.pathname.split('/rest/v1/rpc/')[1]
    if(name && args[name]){
      if(failNext && name.startsWith('lorelink_save_')){failNext=false;return send(503,{code:'TEST_OFFLINE',message:'Falha de rede sintética'})}
      if(delayNext && name.startsWith('lorelink_save_')){const delay=delayNext;delayNext=0;await new Promise(resolve=>setTimeout(resolve,delay))}
      const result=await rpc(db,actor,name,args[name].map(key=>body[key]))
      return send(200,result)
    }
    // Other application endpoints are unavailable in the isolated harness.
    return send(404,{code:'PGRST202',message:'Endpoint outside isolated Lorelink fixture'})
  }catch(error){return send(error.code==='42501'?403:400,{code:error.code??'TEST_ERROR',message:error.message})}
})
await new Promise(resolve=>server.listen(9179,'127.0.0.1',resolve))
const vite=await createViteServer({
  define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://127.0.0.1:9179'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('lorelink-isolated-test-key')},
  server:{host:'127.0.0.1',port:5176,strictPort:true},
})
await vite.listen()
console.log(`Isolated QA: http://127.0.0.1:5176/app/history (GM: gm@example.test / test-only). PostgreSQL data: ${dataDir}`)
async function close(){await vite.close();server.close();await db.close();process.exit()}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close())
