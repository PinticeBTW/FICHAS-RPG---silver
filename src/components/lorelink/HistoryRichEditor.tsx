import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { decodeHistoryDocument, encodeHistoryDocument, safeHistoryLink } from '../../lib/historyDocument'

export default function HistoryRichEditor({ value, onChange, readOnly = false }: { value: string; onChange: (body: string) => void; readOnly?: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const [inserting, setInserting] = useState(false)
  const last = useRef(value)
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  const parsed = useMemo(() => { try { return { doc: decodeHistoryDocument(value), error: null } } catch (reason) { return { doc: undefined, error: (reason as Error).message } } }, [value])
  const editor = useEditor({
    extensions: [StarterKit.configure({ trailingNode: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: safeHistoryLink } }), TableKit.configure({ table: { resizable: false, renderWrapper: true } }), TaskList, TaskItem.configure({ nested: true, a11y: { checkboxLabel: node => `Concluir tarefa: ${node.textContent || 'sem título'}` } }),
      Extension.create({ name: 'historyLimit', addProseMirrorPlugins() { return [new Plugin({ filterTransaction(tr) {
        if (!tr.docChanged) return true
        try { encodeHistoryDocument(tr.doc.toJSON()); return true } catch (reason) { queueMicrotask(() => setError((reason as Error).message)); return false }
      } })] } })],
    content: parsed.doc,
    editable: !readOnly && !parsed.error,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { role: 'textbox', 'aria-label': 'Texto da página', 'aria-multiline': 'true', spellcheck: 'true' }, handleDrop: (_view, event) => Boolean(event.dataTransfer?.files.length) },
    onUpdate: ({ editor: current }) => {
      try { const body = encodeHistoryDocument(current.getJSON()); last.current = body; setError(null); onChangeRef.current(body) }
      catch (reason) { setError((reason as Error).message) }
    },
  })
  useEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly && !parsed.error, false)
    // Server acknowledgements and tag edits must not reset the typing cursor.
    if (value !== last.current && parsed.doc) { editor.commands.setContent(parsed.doc, { emitUpdate: false }); last.current = value }
  }, [value, editor, parsed, readOnly])
  if (parsed.error) return <div><p className="history-inline-error" role="alert">{parsed.error}</p><pre className="history-preserved">{value}</pre></div>
  if (!editor) return <p role="status">A preparar o texto…</p>
  const button = (label: string, command: () => void, active = false, disabled = false) => <button type="button" aria-label={label === '↶' ? 'Desfazer' : label === '↷' ? 'Refazer' : undefined} aria-pressed={active} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={command}>{label}</button>
  return <div className="history-rich-editor" data-empty={!readOnly && editor.isEmpty ? 'true' : undefined}>
    {!readOnly && <div className="history-format-bar" aria-label="Ferramentas de texto">
      <select aria-label="Estilo do texto" value={editor.isActive('heading') ? editor.getAttributes('heading').level : 'paragraph'} onChange={e => { if (e.target.value === 'paragraph') editor.chain().focus().setParagraph().run(); else editor.chain().focus().setHeading({ level: Number(e.target.value) as 1 | 2 | 3 }).run() }}>
        <option value="paragraph">Texto</option><option value="1">Título</option><option value="2">Subtítulo</option><option value="3">Secção</option>
      </select>
      {button('Negrito', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
      {button('Itálico', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
      {button('Sublinhar', () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'))}
      {button('Lista', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
      {button('Numerada', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
      {button('Tarefas', () => editor.chain().focus().toggleTaskList().run(), editor.isActive('taskList'))}
      <button type="button" aria-expanded={inserting} onClick={() => setInserting(!inserting)}>+ Inserir</button>
      {button('↶', () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
      {button('↷', () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
      {inserting && <div className="history-insert-tools" aria-label="Inserir conteúdo">
        {button('Caixa de texto', () => { editor.chain().focus().toggleBlockquote().run(); setInserting(false) }, editor.isActive('blockquote'))}
        {button('Tabela', () => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); setInserting(false) })}
        {button('Separador', () => { editor.chain().focus().setHorizontalRule().run(); setInserting(false) })}
        {button('Código', () => { editor.chain().focus().toggleCodeBlock().run(); setInserting(false) }, editor.isActive('codeBlock'))}
      </div>}
      {editor.isActive('table') && <div className="history-insert-tools" aria-label="Ferramentas da tabela">
        {button('+ Linha', () => editor.chain().focus().addRowAfter().run())}{button('+ Coluna', () => editor.chain().focus().addColumnAfter().run())}
        {button('Apagar linha', () => editor.chain().focus().deleteRow().run())}{button('Apagar coluna', () => editor.chain().focus().deleteColumn().run())}
        {button('Apagar tabela', () => editor.chain().focus().deleteTable().run())}
      </div>}
    </div>}
    {error && <p role="alert" className="history-inline-error">{error}</p>}
    <EditorContent editor={editor} className="history-rich-content" />
    {!readOnly && <p className="history-edit-hint">Escreve livremente. Seleciona texto para formatar, ou usa «Inserir» para organizar a página.</p>}
  </div>
}
