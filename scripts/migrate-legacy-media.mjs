#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const BUCKET = 'rpg-media'
const CACHE_CONTROL = '31536000'
const PREFIX = 'rpg-media:v1:'
const command = process.argv[2] ?? 'scan'
const argument = process.argv[3]
const JSON_PAGE_SIZE = 5
const SCALAR_PAGE_SIZE = 40
const MIN_PAGE_SIZE = 1
const MAX_PAGE_ATTEMPTS = 4
const RETRY_DELAYS_MS = [400, 900, 1600]

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the command environment.')
}
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const SOURCES = [
  { table: 'character_sheet_forms', idColumn: 'id', select: 'id,profile_id,field_data', column: 'field_data', jsonHeavy: true, subjectKind: 'profile-sheet', subjectId: (row) => row.profile_id },
  { table: 'npc_cards', idColumn: 'id', select: 'id,field_data', column: 'field_data', jsonHeavy: true, subjectKind: 'npc-card', subjectId: (row) => row.id },
  { table: 'profiles', idColumn: 'id', select: 'id,avatar_url', column: 'avatar_url', jsonHeavy: false, subjectKind: 'profile', subjectId: (row) => row.id },
  { table: 'characters', idColumn: 'id', select: 'id,portrait_url', column: 'portrait_url', jsonHeavy: false, subjectKind: 'character', subjectId: (row) => row.id },
  { table: 'net_universal_profiles', idColumn: 'identity_link_id', select: 'identity_link_id,avatar_url_override', column: 'avatar_url_override', jsonHeavy: false, subjectKind: 'universal-profile', subjectId: (row) => row.identity_link_id },
  { table: 'net_app_accounts', idColumn: 'id', select: 'id,avatar_url_override', column: 'avatar_url_override', jsonHeavy: false, subjectKind: 'app-account', subjectId: (row) => row.id },
  { table: 'cyberware_catalog_settings', idColumn: 'id', select: 'id,catalog', column: 'catalog', jsonHeavy: true, pageSize: 1, subjectKind: 'global', subjectId: () => 'global' },
]

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isMissingSourceError(error) {
  const text = [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase()
  return text.includes('does not exist') || text.includes('schema cache') || text.includes('pgrst205') || text.includes('42p01')
}

function isStatementTimeout(error) {
  const text = [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase()
  return error?.code === '57014' || text.includes('57014') || text.includes('statement timeout') || text.includes('canceling statement') || text.includes('cancelling statement')
}

function createStats() {
  return {
    found: 0,
    originalBytes: 0,
    outputBytes: 0,
    findings: [],
    scannedRows: new Map(),
    records: new Map(),
    failedRows: [],
  }
}

function recordScanFinding(source, row, jsonPath, value, stats) {
  const encodedBytes = Buffer.byteLength(value)
  const recordId = String(row[source.idColumn])
  const sourceRecords = stats.records.get(source.table) ?? new Set()
  sourceRecords.add(recordId)
  stats.records.set(source.table, sourceRecords)
  stats.originalBytes += encodedBytes
  stats.findings.push({
    source: source.table,
    recordId,
    fieldPath: jsonPath.join('.'),
    encodedBytes,
    mediaKind: mediaKindFor(jsonPath, source),
  })
}

function isDataImage(value) {
  return typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)
}

function compactReference(hash, display, thumbnail) {
  const compact = {
    v: 1,
    h: hash,
    d: { p: display.path, m: display.mimeType, w: display.width, h: display.height, b: display.byteSize },
    ...(thumbnail ? { t: { p: thumbnail.path, m: thumbnail.mimeType, w: thumbnail.width, h: thumbnail.height, b: thumbnail.byteSize } } : {}),
  }
  return PREFIX + Buffer.from(JSON.stringify(compact)).toString('base64url')
}

function mediaProfile(jsonPath) {
  const last = jsonPath.at(-1)?.toLowerCase() ?? ''
  if (['foto', 'foto2', 'avatar_url', 'avatar_url_override', 'portrait_url'].includes(last)) return 'avatar'
  if (last === 'icon' || jsonPath.some((part) => part.toLowerCase().includes('cyberware'))) return 'small-ui'
  if (last === 'imagedata') return 'general'
  if (last === 'image') return 'avatar'
  return 'general'
}

function mediaKindFor(jsonPath, source) {
  if (source.table === 'cyberware_catalog_settings') return 'cyberware'
  const last = jsonPath.at(-1)?.toLowerCase() ?? ''
  if (['foto', 'foto2', 'avatar_url', 'avatar_url_override', 'portrait_url'].includes(last)) return 'avatar'
  if (last === 'imagedata') return 'notebook'
  if (last === 'image') return 'relation'
  return mediaProfile(jsonPath) === 'small-ui' ? 'small-ui' : 'general'
}

function safeSlot(jsonPath) {
  const readable = jsonPath.at(-1)?.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40) || 'legacy'
  const suffix = createHash('sha256').update(jsonPath.join('.')).digest('hex').slice(0, 10)
  return `${readable}-${suffix}`
}

function decodeDataUrl(value) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(value)
  if (!match) throw new Error('Invalid image data URL.')
  const mimeType = match[1].toLowerCase()
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(mimeType)) {
    throw new Error(`Unsupported or unsafe legacy image type: ${mimeType}`)
  }
  return { mimeType, bytes: Buffer.from(match[2], 'base64') }
}

function extensionFor(mimeType) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' })[mimeType] ?? 'bin'
}

async function imageProperties(inputPath) {
  const { stdout } = await execFileAsync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', inputPath])
  const width = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1])
  const height = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1])
  const hasAlpha = /hasAlpha:\s*yes/i.test(stdout)
  if (!width || !height) throw new Error('sips could not decode image dimensions.')
  if (width * height > 64_000_000) throw new Error(`Decoded image exceeds 64 megapixels (${width}x${height}).`)
  return { width, height, hasAlpha }
}

async function encodeWithSips(inputPath, outputPath, maxLongEdge, mimeType, quality) {
  const format = mimeType === 'image/png' ? 'png' : 'jpeg'
  const args = ['-s', 'format', format, '-Z', String(maxLongEdge)]
  if (format === 'jpeg') args.push('-s', 'formatOptions', String(Math.round(quality * 100)))
  args.push(inputPath, '--out', outputPath)
  await execFileAsync('/usr/bin/sips', args)
}

async function optimizeLegacyDataUrl(value, profile, tempRoot) {
  const decoded = decodeDataUrl(value)
  if (decoded.bytes.byteLength > 20 * 1024 * 1024) throw new Error('Legacy image exceeds 20 MB.')
  const inputPath = path.join(tempRoot, `input-${crypto.randomUUID()}.${extensionFor(decoded.mimeType)}`)
  await writeFile(inputPath, decoded.bytes)
  const properties = await imageProperties(inputPath)

  if (decoded.mimeType === 'image/gif') {
    const hash = createHash('sha256').update(decoded.bytes).digest('hex')
    return { hash, display: { bytes: decoded.bytes, mimeType: decoded.mimeType, extension: 'gif', ...properties }, thumbnail: null }
  }

  const rules = profile === 'avatar'
    ? { display: 512, thumb: 224, quality: 0.88, thumbQuality: 0.84 }
    : profile === 'small-ui'
      ? { display: 512, quality: 0.94 }
      : { display: 1800, quality: 0.88 }
  const outputMime = properties.hasAlpha ? 'image/png' : 'image/jpeg'
  const displayPath = path.join(tempRoot, `display-${crypto.randomUUID()}.${extensionFor(outputMime)}`)
  await encodeWithSips(inputPath, displayPath, rules.display, outputMime, rules.quality)
  const displayBytes = await readFile(displayPath)
  const displayProperties = await imageProperties(displayPath)
  let thumbnail = null
  if (rules.thumb) {
    const thumbnailPath = path.join(tempRoot, `thumb-${crypto.randomUUID()}.${extensionFor(outputMime)}`)
    await encodeWithSips(inputPath, thumbnailPath, rules.thumb, outputMime, rules.thumbQuality)
    const thumbnailBytes = await readFile(thumbnailPath)
    thumbnail = { bytes: thumbnailBytes, mimeType: outputMime, extension: extensionFor(outputMime), ...(await imageProperties(thumbnailPath)) }
  }
  return {
    hash: createHash('sha256').update(displayBytes).digest('hex'),
    display: { bytes: displayBytes, mimeType: outputMime, extension: extensionFor(outputMime), ...displayProperties },
    thumbnail,
  }
}

async function uploadVariant(storagePath, variant) {
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, variant.bytes, {
    contentType: variant.mimeType,
    cacheControl: CACHE_CONTROL,
    upsert: false,
  })
  if (error && !/already exists|duplicate/i.test(error.message)) throw error
  const { data, error: verifyError } = await supabase.storage.from(BUCKET).download(storagePath)
  if (verifyError || !data || data.size !== variant.bytes.byteLength) {
    throw new Error(`Storage verification failed for ${storagePath}.`)
  }
  return {
    path: storagePath,
    mimeType: variant.mimeType,
    width: variant.width,
    height: variant.height,
    byteSize: variant.bytes.byteLength,
  }
}

async function migrateValue(value, source, row, jsonPath, tempRoot, stats) {
  if (isDataImage(value)) {
    stats.found += 1
    if (command === 'scan') {
      recordScanFinding(source, row, jsonPath, value, stats)
      return value
    }
    const profile = mediaProfile(jsonPath)
    const optimized = await optimizeLegacyDataUrl(value, profile, tempRoot)
    const subjectId = source.subjectId(row)
    const mediaKind = mediaKindFor(jsonPath, source)
    const base = `${source.subjectKind}/${subjectId}/${mediaKind}/${safeSlot(jsonPath)}/${optimized.hash.slice(0, 32)}`
    const display = await uploadVariant(`${base}/display.${optimized.display.extension}`, optimized.display)
    const thumbnail = optimized.thumbnail
      ? await uploadVariant(`${base}/thumbnail.${optimized.thumbnail.extension}`, optimized.thumbnail)
      : null
    stats.originalBytes += Buffer.byteLength(value)
    stats.outputBytes += display.byteSize + (thumbnail?.byteSize ?? 0)
    return compactReference(optimized.hash, display, thumbnail)
  }

  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try {
      const parsed = JSON.parse(value)
      const migrated = await migrateValue(parsed, source, row, [...jsonPath, '$json'], tempRoot, stats)
      return JSON.stringify(migrated)
    } catch {
      return value
    }
  }
  if (Array.isArray(value)) {
    const output = []
    for (let index = 0; index < value.length; index += 1) {
      output.push(await migrateValue(value[index], source, row, [...jsonPath, String(index)], tempRoot, stats))
    }
    return output
  }
  if (value && typeof value === 'object') {
    const output = {}
    for (const [key, entry] of Object.entries(value)) {
      output[key] = await migrateValue(entry, source, row, [...jsonPath, key], tempRoot, stats)
    }
    return output
  }
  return value
}

function initialPageSize(source) {
  return source.pageSize ?? (source.jsonHeavy ? JSON_PAGE_SIZE : SCALAR_PAGE_SIZE)
}

function pageQuery(source, cursor, batchSize, select = source.select) {
  let query = supabase
    .from(source.table)
    .select(select)
    .order(source.idColumn, { ascending: true })
    .limit(batchSize)
  if (cursor !== null) query = query.gt(source.idColumn, cursor)
  return query
}

async function identifyTimedOutRecord(source, cursor) {
  const { data, error } = await pageQuery(source, cursor, 1, source.idColumn)
  if (error) return { id: null, error }
  const id = data?.[0]?.[source.idColumn]
  return { id: id === undefined || id === null ? null : String(id), error: null }
}

async function fetchPageAdaptive(source, cursor, requestedBatchSize) {
  let batchSize = Math.max(MIN_PAGE_SIZE, requestedBatchSize)
  let attempt = 0
  let lastError = null

  while (attempt < MAX_PAGE_ATTEMPTS) {
    const { data, error } = await pageQuery(source, cursor, batchSize)
    if (!error) return { kind: 'page', rows: data ?? [], batchSize }
    if (isMissingSourceError(error)) return { kind: 'missing', error }
    if (!isStatementTimeout(error)) return { kind: 'error', error }

    lastError = error
    attempt += 1
    if (attempt >= MAX_PAGE_ATTEMPTS) break
    const nextBatchSize = Math.max(MIN_PAGE_SIZE, Math.floor(batchSize / 2))
    const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]
    console.warn(
      `[media ${command}] ${source.table}: statement timeout; retry ${attempt}/${MAX_PAGE_ATTEMPTS - 1} with batch ${nextBatchSize} after ${delay}ms`,
    )
    batchSize = nextBatchSize
    await sleep(delay)
  }

  const isolated = await identifyTimedOutRecord(source, cursor)
  return {
    kind: 'timeout',
    error: lastError,
    recordId: isolated.id,
    identifyError: isolated.error,
    batchSize: MIN_PAGE_SIZE,
  }
}

function printScanSummary(stats) {
  console.log('[media scan] summary')
  for (const source of SOURCES) {
    const rows = stats.scannedRows.get(source.table) ?? 0
    const records = stats.records.get(source.table)?.size ?? 0
    const media = stats.findings.filter((finding) => finding.source === source.table).length
    console.log(`[media scan] ${source.table}: ${rows} rows scanned; ${records} records; ${media} legacy media values`)
  }
  for (const finding of stats.findings) {
    console.log(
      `[media scan] found ${finding.source}:${finding.recordId} ${finding.fieldPath} `
      + `${finding.mediaKind} ~${finding.encodedBytes} encoded bytes`,
    )
  }
  for (const failure of stats.failedRows) {
    console.warn(`[media scan] unavailable ${failure.source}:${failure.recordId ?? 'next-row-unknown'} — ${failure.reason}`)
  }
}

async function stageOrScan() {
  const tempRoot = command === 'scan' ? null : await mkdtemp(path.join(tmpdir(), 'rpgsilver-media-'))
  const manifest = { version: 1, createdAt: new Date().toISOString(), bucket: BUCKET, changes: [] }
  const stats = createStats()
  try {
    for (const source of SOURCES) {
      let cursor = null
      let batchSize = initialPageSize(source)
      let sourceComplete = false
      console.log(`[media ${command}] ${source.table}: starting with batch ${batchSize}`)

      while (!sourceComplete) {
        const result = await fetchPageAdaptive(source, cursor, batchSize)
        if (result.kind === 'missing') {
          console.warn(`[media ${command}] ${source.table}: source is not installed; skipped`)
          break
        }
        if (result.kind === 'error') {
          if (command !== 'scan') throw result.error
          console.warn(`[media scan] ${source.table}: read failed; continuing with next source — ${result.error.message}`)
          break
        }
        if (result.kind === 'timeout') {
          const reason = result.error?.message ?? 'statement timeout after bounded retries'
          stats.failedRows.push({ source: source.table, recordId: result.recordId, reason })
          console.warn(`[media ${command}] ${source.table}: single-row read timed out for ${result.recordId ?? 'unknown row'}`)
          if (command !== 'scan') throw result.error
          if (!result.recordId) break
          cursor = result.recordId
          batchSize = MIN_PAGE_SIZE
          continue
        }

        batchSize = result.batchSize
        if (!result.rows.length) break
        for (const row of result.rows) {
          const originalValue = row[source.column]
          const nextValue = await migrateValue(originalValue, source, row, [source.column], tempRoot, stats)
          if (command === 'stage' && JSON.stringify(originalValue) !== JSON.stringify(nextValue)) {
            manifest.changes.push({
              table: source.table,
              idColumn: source.idColumn,
              id: row[source.idColumn],
              column: source.column,
              originalValue,
              nextValue,
            })
          }
        }
        cursor = String(result.rows.at(-1)[source.idColumn])
        const scannedRows = (stats.scannedRows.get(source.table) ?? 0) + result.rows.length
        stats.scannedRows.set(source.table, scannedRows)
        console.log(`[media ${command}] ${source.table}: ${scannedRows} rows scanned`)
        sourceComplete = result.rows.length < batchSize
      }
    }
  } finally {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  }
  if (command === 'stage') {
    const fileName = argument ?? `media-migration-manifest-${Date.now()}.json`
    await writeFile(fileName, JSON.stringify(manifest, null, 2), { mode: 0o600 })
    console.log(`Staged ${stats.found} images. Verified uploads; database unchanged.`)
    console.log(`Manifest/rollback backup: ${path.resolve(fileName)}`)
    console.log(`Legacy JSON bytes: ${stats.originalBytes}; optimized variant bytes: ${stats.outputBytes}`)
  } else {
    printScanSummary(stats)
    console.log(
      `Found ${stats.found} legacy data images across ${[...stats.records.values()].reduce((sum, records) => sum + records.size, 0)} records `
      + `(~${stats.originalBytes} encoded bytes). No uploads or database writes performed.`,
    )
  }
}

async function applyManifest() {
  if (!argument) throw new Error('Usage: node scripts/migrate-legacy-media.mjs apply <manifest.json>')
  const manifest = JSON.parse(await readFile(argument, 'utf8'))
  if (manifest.version !== 1 || manifest.bucket !== BUCKET || !Array.isArray(manifest.changes)) throw new Error('Invalid migration manifest.')
  let applied = 0
  for (const change of manifest.changes) {
    const { data: current, error: readError } = await supabase.from(change.table)
      .select(change.column).eq(change.idColumn, change.id).maybeSingle()
    if (readError) throw readError
    if (!current) throw new Error(`${change.table}:${change.id} no longer exists.`)
    if (JSON.stringify(current[change.column]) !== JSON.stringify(change.originalValue)) {
      throw new Error(`${change.table}:${change.id} changed after staging; refusing stale overwrite.`)
    }
    const { error } = await supabase.from(change.table).update({ [change.column]: change.nextValue }).eq(change.idColumn, change.id)
    if (error) throw error
    applied += 1
  }
  console.log(`Applied ${applied} verified record updates. Keep ${path.resolve(argument)} as rollback data until smoke testing passes.`)
}

if (!['scan', 'stage', 'apply'].includes(command)) throw new Error('Use scan, stage, or apply.')
if (command === 'apply') await applyManifest()
else await stageOrScan()
