import test from 'node:test'
import assert from 'node:assert/strict'
import { lorePeriod, loreUserTags, withLorePeriod } from '../../src/lib/lorelinkPeriods.ts'
import { LoreQueue } from '../../src/lib/lorelinkQueue.ts'
import { entity } from './fixture.mjs'

test('legacy records remain unclassified without changing their text or tags', () => {
  const tags = ['passado', 'sessão 4', 'lorelink:other']
  assert.equal(lorePeriod({ tags }), 'unassigned')
  assert.deepEqual(loreUserTags(tags), tags)
  assert.deepEqual(withLorePeriod(tags, 'unassigned'), tags)
})

test('period changes preserve user tags and remove only known period markers', () => {
  const tags = ['família', 'lorelink:period:v2:future']
  const past = withLorePeriod(tags, 'past')
  const campaign = withLorePeriod(past, 'campaign')
  assert.equal(lorePeriod({tags:campaign}), 'campaign')
  assert.deepEqual(loreUserTags(campaign), tags)
  assert.deepEqual(withLorePeriod(campaign, 'campaign'), campaign)
  assert.deepEqual(withLorePeriod(campaign, 'unassigned'), tags)
  assert.equal(lorePeriod({tags:past}), 'past')
})

test('full tag sets cannot be silently truncated to add a period', () => {
  const tags = Array.from({length:30},(_,i)=>`tag-${i}`)
  assert.throws(()=>withLorePeriod(tags,'past'), /preservadas/)
  assert.equal(tags.length,30)
  assert.equal(withLorePeriod(tags.slice(0,29),'past').length,30)
})

test('a period edit survives a delayed save and keeps body and character ownership', async () => {
  const e = {...entity(), tags:['família'], body:'História anterior', character_id:'character-a'}
  let release
  const queue = new LoreQueue({scope:'veil', role:'author', character_id:'character-a', map_id:'map', entities:[e], nodes:[], relations:[]},
    async (_kind,_scope,value,mutation) => {
      if (!release) await new Promise(resolve=>{release=resolve})
      return {...value, revision:value.revision+1, mutation_id:mutation}
    })
  queue.edit('entity',{...e, tags:withLorePeriod(e.tags,'past')})
  const saving = queue.flush()
  queue.edit('entity',{...queue.data.entities[0], body:'História e mais uma memória'})
  release(); await saving
  assert.equal(lorePeriod(queue.data.entities[0]),'past')
  assert.equal(queue.data.entities[0].body,'História e mais uma memória')
  assert.equal(queue.data.entities[0].character_id,'character-a')
  assert.equal(queue.dirty,false)
  queue.dispose()
})
