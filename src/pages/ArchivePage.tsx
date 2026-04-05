import { FileText, RefreshCcw, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../components/common/EmptyState'
import { LoadingScreen } from '../components/common/LoadingScreen'
import { useAuth } from '../hooks/useAuth'
import {
  createPdfArchiveViewUrl,
  listArchiveProfiles,
  listPdfArchiveFiles,
  syncPdfArchiveDocuments,
  updatePdfArchiveAccess,
  uploadPdfArchiveFiles,
} from '../lib/pdfArchiveService'
import { formatTimestamp } from '../lib/utils'
import type { PdfArchiveFile, PdfArchiveViewer } from '../types/domain'

function formatSize(size: number | null) {
  if (!size) {
    return '--'
  }

  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  return `${Math.ceil(size / 1024)} KB`
}

function normaliseArchiveError(message: string) {
  const normalized = message.toLowerCase()

  if (normalized.includes('bucket not found')) {
    return 'O bucket "campaign-pdfs" ainda nao existe no Supabase.'
  }

  if (normalized.includes('row-level security')) {
    return 'As politicas do bucket nao deixam aceder aos PDFs. Corre o schema atualizado.'
  }

  return message
}

export function ArchivePage() {
  const { profile } = useAuth()
  const [files, setFiles] = useState<PdfArchiveFile[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null)
  const [people, setPeople] = useState<PdfArchiveViewer[]>([])
  const [selectedViewerIds, setSelectedViewerIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [opening, setOpening] = useState(false)
  const [savingAccess, setSavingAccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedFile = useMemo(
    () => files.find((entry) => entry.path === selectedPath) ?? null,
    [files, selectedPath],
  )
  const selectablePeople = useMemo(
    () => people.filter((entry) => entry.role !== 'gm'),
    [people],
  )
  const selectedViewerUrl = selectedUrl ? `${selectedUrl}#toolbar=1&navpanes=0&zoom=page-fit` : null

  const openFile = useCallback(async (file: PdfArchiveFile) => {
    setOpening(true)
    setError(null)

    try {
      const signedUrl = await createPdfArchiveViewUrl(file.path)
      setSelectedPath(file.path)
      setSelectedUrl(signedUrl)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? normaliseArchiveError(caughtError.message)
          : 'Nao foi possivel abrir o PDF.'
      setError(message)
    } finally {
      setOpening(false)
    }
  }, [])

  const refreshFiles = useCallback(async (nextSelectedPath?: string) => {
    setLoading(true)
    setError(null)

    try {
      if (profile?.role === 'gm') {
        await syncPdfArchiveDocuments()
      }

      const [nextFiles, nextPeople] = await Promise.all([
        listPdfArchiveFiles(profile?.role === 'gm'),
        profile?.role === 'gm' ? listArchiveProfiles() : Promise.resolve([]),
      ])

      setFiles(nextFiles)
      setPeople(nextPeople)

      const target =
        nextFiles.find((entry) => entry.path === nextSelectedPath) ??
        nextFiles.find((entry) => entry.path === selectedPath) ??
        nextFiles[0] ??
        null

      if (target) {
        const signedUrl = await createPdfArchiveViewUrl(target.path)
        setSelectedPath(target.path)
        setSelectedUrl(signedUrl)
      } else {
        setSelectedPath(null)
        setSelectedUrl(null)
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? normaliseArchiveError(caughtError.message)
          : 'Nao foi possivel carregar o arquivo de PDFs.'
      setError(message)
      setFiles([])
      setPeople([])
      setSelectedPath(null)
      setSelectedUrl(null)
    } finally {
      setLoading(false)
    }
  }, [profile?.role, selectedPath])

  useEffect(() => {
    void refreshFiles()
  }, [refreshFiles])

  useEffect(() => {
    setSelectedViewerIds(selectedFile?.viewers.map((entry) => entry.id) ?? [])
  }, [selectedFile])

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []).filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    )

    event.target.value = ''

    if (!selectedFiles.length) {
      return
    }

    setUploading(true)
    setError(null)

    try {
      await uploadPdfArchiveFiles(selectedFiles)
      await refreshFiles()
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? normaliseArchiveError(caughtError.message)
          : 'Nao foi possivel importar os PDFs.'
      setError(message)
    } finally {
      setUploading(false)
    }
  }

  const toggleViewer = (profileId: string) => {
    setSelectedViewerIds((current) =>
      current.includes(profileId)
        ? current.filter((entry) => entry !== profileId)
        : [...current, profileId],
    )
  }

  const handleSaveAccess = async () => {
    if (!selectedFile) {
      return
    }

    setSavingAccess(true)
    setError(null)

    try {
      await updatePdfArchiveAccess(selectedFile.id, selectedViewerIds)
      await refreshFiles(selectedFile.path)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? normaliseArchiveError(caughtError.message)
          : 'Nao foi possivel guardar os acessos da ficha.'
      setError(message)
    } finally {
      setSavingAccess(false)
    }
  }

  if (loading) {
    return <LoadingScreen label="A carregar arquivo de PDFs..." />
  }

  return (
    <main className="mx-auto max-w-[1680px]">
      <section className="hud-panel rounded-[28px] px-5 py-4 md:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="panel-title">Arquivo central</p>
            <h1 className="mt-3 text-[2.2rem] text-white md:text-[2.8rem]">Fichas em PDF</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-300">
              Importa as fichas e abre tudo aqui com leitor embutido, num unico sitio.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {profile?.role === 'gm' ? (
              <label className="signal-button inline-flex cursor-pointer items-center gap-2 px-4 py-2 text-sm">
                <Upload size={16} />
                {uploading ? 'A importar...' : 'Importar PDFs'}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="hidden"
                  onChange={(event) => void handleUpload(event)}
                  disabled={uploading}
                />
              </label>
            ) : null}

            <button
              type="button"
              onClick={() => void refreshFiles()}
              className="signal-button inline-flex items-center gap-2 px-4 py-2 text-sm"
              data-variant="ghost"
              disabled={loading || opening}
            >
              <RefreshCcw size={16} />
              Atualizar
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="mt-4 border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[300px_1fr]">
        <aside className="hud-panel rounded-[28px] p-4">
          <div>
            <p className="panel-title">Lista</p>
            <p className="mt-2 text-lg font-semibold text-white">{files.length} PDF(s)</p>
          </div>

          <div className="mt-4 max-h-[calc(100vh-12rem)] space-y-2 overflow-auto pr-1">
            {!files.length ? (
              <EmptyState
                title="Sem PDFs importados"
                detail="Importa as fichas em PDF para aparecerem nesta lista."
              />
            ) : (
              files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => void openFile(file)}
                  className={`w-full border px-4 py-3 text-left transition ${
                    file.path === selectedPath
                      ? 'border-[#f3e600] bg-[#f3e600]/10'
                      : 'border-white/10 bg-black/25 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <FileText size={18} className="mt-0.5 text-stone-300" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{file.displayName}</p>
                      <p className="mt-1 text-xs text-stone-400">
                        {file.updatedAt ? formatTimestamp(file.updatedAt) : 'Sem data'}
                      </p>
                      <p className="mt-1 text-xs text-stone-500">{formatSize(file.size)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="hud-panel rounded-[28px] p-3">
          {selectedFile && selectedUrl ? (
            <>
              <div className="mb-3 flex items-center justify-between gap-3 px-2">
                <div>
                  <p className="panel-title">Leitor</p>
                  <p className="mt-2 text-xl font-semibold text-white">{selectedFile.displayName}</p>
                </div>
                <a
                  href={selectedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="signal-button px-4 py-2 text-sm"
                  data-variant="ghost"
                >
                  Abrir em nova aba
                </a>
              </div>

              <div className="overflow-hidden rounded-[18px] border border-white/10 bg-white">
                <iframe
                  key={selectedViewerUrl}
                  src={selectedViewerUrl ?? selectedUrl}
                  title={selectedFile.displayName}
                  className="h-[calc(100vh-12rem)] w-full"
                />
              </div>

              {profile?.role === 'gm' ? (
                <div className="mt-4 rounded-[18px] border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="panel-title">Permissoes</p>
                      <p className="mt-2 text-lg font-semibold text-white">
                        Quem pode ver esta ficha
                      </p>
                      <p className="mt-1 text-sm text-stone-400">
                        O Silver ve sempre tudo. Marca os jogadores que podem abrir este PDF.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleSaveAccess()}
                      className="signal-button px-4 py-2 text-sm"
                      disabled={savingAccess || loading || opening}
                    >
                      {savingAccess ? 'A guardar...' : 'Guardar acessos'}
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {!selectablePeople.length ? (
                      <div className="border border-white/10 bg-black/25 px-4 py-3 text-sm text-stone-300">
                        Ainda nao ha jogadores registados para atribuir.
                      </div>
                    ) : (
                      selectablePeople.map((person) => {
                        const checked = selectedViewerIds.includes(person.id)

                        return (
                          <label
                            key={person.id}
                            className={`flex cursor-pointer items-start gap-3 border px-4 py-3 transition ${
                              checked
                                ? 'border-[#f3e600]/60 bg-[#f3e600]/10'
                                : 'border-white/10 bg-black/25 hover:border-white/20'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleViewer(person.id)}
                              className="mt-1 h-4 w-4 accent-[#f3e600]"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-white">
                                {person.displayName}
                              </p>
                              <p className="truncate text-xs text-stone-400">{person.email}</p>
                            </div>
                          </label>
                        )
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center">
              <EmptyState
                title="Seleciona um PDF"
                detail="Escolhe uma ficha na lista para a abrir no leitor."
              />
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
