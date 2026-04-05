import type { PdfArchiveFile, PdfArchiveViewer } from '../types/domain'
import { supabase, SUPABASE_CONFIG_ERROR } from './supabase'

const PDF_BUCKET = 'campaign-pdfs'
const PDF_FOLDER = 'imports'
const SIGNED_URL_TTL_SECONDS = 60 * 60

type PdfDocumentRow = {
  id: string
  storage_path: string
  file_name: string
  display_name: string
  file_size: number | null
  created_at: string | null
  updated_at: string | null
}

type PdfDocumentAccessRow = {
  document_id: string
  profile:
    | {
        id: string
        email: string
        display_name: string
        handle: string
        role: PdfArchiveViewer['role']
      }
    | {
        id: string
        email: string
        display_name: string
        handle: string
        role: PdfArchiveViewer['role']
      }[]
    | null
}

function ensureSupabase() {
  if (!supabase) {
    throw new Error(SUPABASE_CONFIG_ERROR)
  }

  return supabase
}

function sanitizeFileName(fileName: string) {
  return fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function toDisplayName(fileName: string) {
  return fileName.replace(/^\d+-\d+-/, '')
}

function unwrapProfile(row: PdfDocumentAccessRow['profile']) {
  if (!row) {
    return null
  }

  return Array.isArray(row) ? row[0] ?? null : row
}

function mapViewer(row: NonNullable<ReturnType<typeof unwrapProfile>>) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    handle: row.handle,
    role: row.role,
  } satisfies PdfArchiveViewer
}

function mapPdfDocument(row: PdfDocumentRow, viewers: PdfArchiveViewer[]): PdfArchiveFile {
  return {
    id: row.id,
    path: row.storage_path,
    name: row.file_name,
    displayName: row.display_name,
    size: row.file_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    viewers,
  }
}

export async function listPdfArchiveFiles(includeAccess = false): Promise<PdfArchiveFile[]> {
  const client = ensureSupabase()
  const { data, error } = await client
    .from('pdf_documents')
    .select(
      `
        id,
        storage_path,
        file_name,
        display_name,
        file_size,
        created_at,
        updated_at
      `,
    )
    .order('display_name', { ascending: true })

  if (error) {
    throw error
  }

  const documents = (data ?? []) as PdfDocumentRow[]

  if (!includeAccess || !documents.length) {
    return documents.map((entry) => mapPdfDocument(entry, []))
  }

  const { data: accessData, error: accessError } = await client
    .from('pdf_document_access')
    .select(
      `
        document_id,
        profile:profiles (
          id,
          email,
          display_name,
          handle,
          role
        )
      `,
    )
    .in(
      'document_id',
      documents.map((entry) => entry.id),
    )

  if (accessError) {
    throw accessError
  }

  const viewerMap = new Map<string, PdfArchiveViewer[]>()

  for (const accessEntry of (accessData ?? []) as unknown as PdfDocumentAccessRow[]) {
    const profile = unwrapProfile(accessEntry.profile)

    if (!profile) {
      continue
    }

    const currentViewers = viewerMap.get(accessEntry.document_id) ?? []
    currentViewers.push(mapViewer(profile))
    viewerMap.set(accessEntry.document_id, currentViewers)
  }

  return documents.map((entry) => mapPdfDocument(entry, viewerMap.get(entry.id) ?? []))
}

export async function createPdfArchiveViewUrl(path: string) {
  const client = ensureSupabase()
  const { data, error } = await client.storage
    .from(PDF_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

  if (error) {
    throw error
  }

  return data.signedUrl
}

export async function uploadPdfArchiveFiles(files: File[]) {
  const client = ensureSupabase()
  const uploadedRows: {
    storage_path: string
    file_name: string
    display_name: string
    file_size: number
  }[] = []

  for (const [index, file] of files.entries()) {
    const safeName = sanitizeFileName(file.name)
    const storagePath = `${PDF_FOLDER}/${Date.now()}-${index}-${safeName}`
    const { error } = await client.storage.from(PDF_BUCKET).upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: 'application/pdf',
    })

    if (error) {
      throw error
    }

    uploadedRows.push({
      storage_path: storagePath,
      file_name: safeName,
      display_name: toDisplayName(file.name),
      file_size: file.size,
    })
  }

  if (!uploadedRows.length) {
    return
  }

  const { error } = await client.from('pdf_documents').upsert(uploadedRows, {
    onConflict: 'storage_path',
  })

  if (error) {
    throw error
  }
}

export async function syncPdfArchiveDocuments() {
  const client = ensureSupabase()
  const { data, error } = await client.storage.from(PDF_BUCKET).list(PDF_FOLDER, {
    limit: 500,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' },
  })

  if (error) {
    throw error
  }

  const rows = (data ?? [])
    .filter((entry) => entry.name.toLowerCase().endsWith('.pdf'))
    .map((entry) => ({
      storage_path: `${PDF_FOLDER}/${entry.name}`,
      file_name: entry.name,
      display_name: toDisplayName(entry.name),
      file_size:
        entry.metadata && typeof entry.metadata === 'object' && 'size' in entry.metadata
          ? Number(entry.metadata.size)
          : null,
    }))

  if (!rows.length) {
    return
  }

  const { error: upsertError } = await client.from('pdf_documents').upsert(rows, {
    onConflict: 'storage_path',
  })

  if (upsertError) {
    throw upsertError
  }
}

export async function listArchiveProfiles() {
  const client = ensureSupabase()
  const { data, error } = await client
    .from('profiles')
    .select('id, email, display_name, handle, role')
    .order('display_name', { ascending: true })

  if (error) {
    throw error
  }

  return ((data ?? []) as Array<{
    id: string
    email: string
    display_name: string
    handle: string
    role: PdfArchiveViewer['role']
  }>).map((entry) => ({
    id: entry.id,
    email: entry.email,
    displayName: entry.display_name,
    handle: entry.handle,
    role: entry.role,
  }))
}

export async function updatePdfArchiveAccess(documentId: string, viewerIds: string[]) {
  const client = ensureSupabase()

  const { error: deleteError } = await client
    .from('pdf_document_access')
    .delete()
    .eq('document_id', documentId)

  if (deleteError) {
    throw deleteError
  }

  if (!viewerIds.length) {
    return
  }

  const { error: insertError } = await client.from('pdf_document_access').insert(
    viewerIds.map((profileId) => ({
      document_id: documentId,
      profile_id: profileId,
    })),
  )

  if (insertError) {
    throw insertError
  }
}
