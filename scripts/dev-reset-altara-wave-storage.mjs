#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'

const BUCKET = 'rpg-media'
const PREFIX = 'altara-wave-account'
const PAGE_SIZE = 1000
const DELETE_BATCH_SIZE = 100
const DELETE_CONFIRMATION = 'DELETE-ALTARA-WAVE-TEST-MEDIA'

const command = process.argv[2] ?? 'scan'
if (!['scan', 'delete'].includes(command)) {
  throw new Error('Usage: node scripts/dev-reset-altara-wave-storage.mjs [scan|delete]')
}

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the command environment.')
}
if (command === 'delete'
  && process.env.CONFIRM_ALTARA_WAVE_STORAGE_RESET !== DELETE_CONFIRMATION) {
  throw new Error(
    `Set CONFIRM_ALTARA_WAVE_STORAGE_RESET=${DELETE_CONFIRMATION} to delete WAVE test media.`,
  )
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const storage = supabase.storage.from(BUCKET)

function checkedChildPath(parent, name) {
  if (typeof name !== 'string'
    || !name
    || name === '.'
    || name === '..'
    || name.includes('/')
    || name.includes('\\')) {
    throw new Error(`Unsafe Storage list entry below ${parent}.`)
  }
  const path = `${parent}/${name}`
  if (!path.startsWith(`${PREFIX}/`) || path.includes('/../')) {
    throw new Error(`Refusing path outside ${PREFIX}/: ${path}`)
  }
  return path
}

async function listWaveObjects() {
  const directories = [PREFIX]
  const visitedDirectories = new Set()
  const objects = []

  while (directories.length) {
    const directory = directories.shift()
    if (!directory || visitedDirectories.has(directory)) continue
    visitedDirectories.add(directory)

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await storage.list(directory, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (error) throw new Error(`Could not list ${directory}: ${error.message}`)
      const entries = data ?? []
      for (const entry of entries) {
        const path = checkedChildPath(directory, entry.name)
        if (typeof entry.id === 'string' && entry.id) {
          objects.push({
            path,
            byteSize: Number.isSafeInteger(Number(entry.metadata?.size))
              ? Number(entry.metadata.size)
              : 0,
          })
        } else {
          directories.push(path)
        }
      }
      if (entries.length < PAGE_SIZE) break
    }
  }

  return objects.sort((left, right) => left.path.localeCompare(right.path))
}

function summary(objects) {
  return {
    bucket: BUCKET,
    exactPrefix: `${PREFIX}/`,
    objectCount: objects.length,
    totalBytes: objects.reduce((total, object) => total + object.byteSize, 0),
    objects,
  }
}

const before = await listWaveObjects()
console.log(JSON.stringify({ mode: command, before: summary(before) }, null, 2))

if (command === 'delete') {
  for (let index = 0; index < before.length; index += DELETE_BATCH_SIZE) {
    const paths = before.slice(index, index + DELETE_BATCH_SIZE)
      .map((object) => object.path)
    const { error } = await storage.remove(paths)
    if (error) throw new Error(`WAVE Storage cleanup failed: ${error.message}`)
  }

  const after = await listWaveObjects()
  if (after.length) {
    throw new Error(`WAVE Storage cleanup incomplete: ${after.length} objects remain.`)
  }
  console.log(JSON.stringify({ mode: command, after: summary(after) }, null, 2))
}
