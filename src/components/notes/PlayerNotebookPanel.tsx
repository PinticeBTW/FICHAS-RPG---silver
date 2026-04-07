import { Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type PlayerNotebookPage = {
  id: string
  title: string
  content: string
  pinned: boolean
}

type PlayerNotebookPanelProps = {
  value: string
  pagesValue: string
  onChange: (value: string) => void
  onPagesChange: (value: string) => void
  canEdit: boolean
}

function buildDefaultPage(content = '', pageNumber = 1): PlayerNotebookPage {
  return {
    id: crypto.randomUUID(),
    title: `Pagina ${pageNumber}`,
    content,
    pinned: false,
  }
}

function parseStoredTitle(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback
}

function parseNotebookPages(pagesValue: string, legacyValue: string) {
  if (!pagesValue.trim()) {
    return [buildDefaultPage(legacyValue)]
  }

  try {
    const parsed = JSON.parse(pagesValue)

    if (!Array.isArray(parsed) || !parsed.length) {
      return [buildDefaultPage(legacyValue)]
    }

    const pages = parsed
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry, index) => {
        const page = entry as Record<string, unknown>

        return {
          id: typeof page.id === 'string' ? page.id : crypto.randomUUID(),
          title: parseStoredTitle(page.title, `Pagina ${index + 1}`),
          content: typeof page.content === 'string' ? page.content : '',
          pinned: Boolean(page.pinned),
        }
      })

    return pages.length ? pages : [buildDefaultPage(legacyValue)]
  } catch {
    return [buildDefaultPage(legacyValue)]
  }
}

function serializeNotebookPages(pages: PlayerNotebookPage[]) {
  return JSON.stringify(pages)
}

export function PlayerNotebookPanel({
  value,
  pagesValue,
  onChange,
  onPagesChange,
  canEdit,
}: PlayerNotebookPanelProps) {
  const notePages = useMemo(() => parseNotebookPages(pagesValue, value), [pagesValue, value])
  const [activePageId, setActivePageId] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')

  const resolvedActivePageId = notePages.some((page) => page.id === activePageId)
    ? activePageId
    : (notePages[0]?.id ?? '')
  const activePage =
    notePages.find((page) => page.id === resolvedActivePageId) ??
    notePages[0] ??
    buildDefaultPage(value)

  useEffect(() => {
    if (!activePageId && notePages[0]) {
      setActivePageId(notePages[0].id)
    }
  }, [activePageId, notePages])

  const filteredPages = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    const visiblePages = query
      ? notePages.filter((page) =>
          `${page.title} ${page.content}`.toLowerCase().includes(query),
        )
      : notePages

    return [...visiblePages].sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1
      }

      return notePages.findIndex((page) => page.id === left.id) - notePages.findIndex((page) => page.id === right.id)
    })
  }, [notePages, searchQuery])

  const updatePages = (nextPages: PlayerNotebookPage[], nextActivePageId?: string) => {
    const resolvedNextActivePageId = nextActivePageId ?? resolvedActivePageId
    const nextActivePage =
      nextPages.find((page) => page.id === resolvedNextActivePageId) ?? nextPages[0] ?? null

    onPagesChange(serializeNotebookPages(nextPages))
    onChange(nextActivePage?.content ?? '')
    setActivePageId(nextActivePage?.id ?? '')
  }

  const createPage = () => {
    const nextPage = buildDefaultPage('', notePages.length + 1)
    updatePages([...notePages, nextPage], nextPage.id)
    setSearchQuery('')
  }

  const deletePage = (pageId: string) => {
    if (notePages.length <= 1) {
      const resetPage = buildDefaultPage('')
      updatePages([resetPage], resetPage.id)
      return
    }

    const nextPages = notePages.filter((page) => page.id !== pageId)
    updatePages(nextPages, nextPages[0]?.id)
  }

  const togglePinPage = (pageId: string) => {
    updatePages(
      notePages.map((page) =>
        page.id === pageId ? { ...page, pinned: !page.pinned } : page,
      ),
      pageId,
    )
  }

  const updateActivePage = (updater: (page: PlayerNotebookPage) => PlayerNotebookPage) => {
    updatePages(
      notePages.map((page) => (page.id === activePage.id ? updater(page) : page)),
      activePage.id,
    )
  }

  return (
    <section className="mt-4 rounded-[22px] border border-white/10 bg-black/25 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="panel-title">Bloco de notas</p>
          <p className="mt-2 text-xs leading-6 text-stone-500">
            Organiza pistas, ideias e lembretes privados em varias paginas.
          </p>
        </div>

        <button
          type="button"
          onClick={createPage}
          disabled={!canEdit}
          className="signal-button inline-flex items-center gap-2 px-3 py-2 text-xs"
          title="Nova pagina"
        >
          <Plus size={13} />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={activePage.title}
          readOnly={!canEdit}
          onChange={(event) =>
            updateActivePage((page) => ({
              ...page,
              title: event.target.value,
            }))
          }
          placeholder="Titulo da pagina"
          className="min-w-0 flex-1 border border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-[#f3e600]/45"
        />

        <button
          type="button"
          onClick={() => togglePinPage(activePage.id)}
          disabled={!canEdit}
          className="signal-button inline-flex items-center gap-2 px-3 py-2 text-xs"
          data-variant="ghost"
          title={activePage.pinned ? 'Desafixar pagina' : 'Fixar pagina'}
        >
          {activePage.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
      </div>

      <div className="relative mt-3">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Pesquisar paginas ou notas"
          className="w-full border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-[#f3e600]/45"
        />
      </div>

      <div className="mt-3 max-h-[180px] space-y-2 overflow-y-auto pr-1">
        {filteredPages.length ? (
          filteredPages.map((page) => {
            const selected = page.id === resolvedActivePageId

            return (
              <div
                key={page.id}
                className={`border px-3 py-2 transition ${
                  selected
                    ? 'border-[#f3e600] bg-[#f3e600]/10'
                    : 'border-white/10 bg-black/25'
                }`}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => setActivePageId(page.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-white">{page.title}</p>
                      {page.pinned ? <Pin size={11} className="shrink-0 text-[#f3e600]" /> : null}
                    </div>
                    <p className="mt-1 text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
                      {page.content.trim() ? 'com notas' : 'vazia'}
                    </p>
                  </button>

                  {notePages.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => deletePage(page.id)}
                      disabled={!canEdit}
                      className="p-1 text-stone-600 transition hover:text-rose-400"
                      title="Apagar pagina"
                    >
                      <Trash2 size={11} />
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })
        ) : (
          <p className="py-5 text-center text-xs text-stone-500">
            Nada encontrado nessa pesquisa.
          </p>
        )}
      </div>

      <textarea
        value={activePage.content}
        readOnly={!canEdit}
        onChange={(event) =>
          updateActivePage((page) => ({
            ...page,
            content: event.target.value,
          }))
        }
        placeholder="Escreve aqui as tuas notas privadas..."
        className="mt-3 min-h-[240px] w-full resize-none border border-white/10 bg-black/30 px-4 py-4 font-mono text-sm leading-7 text-stone-100 outline-none focus:border-[#f3e600]/45"
      />
    </section>
  )
}
