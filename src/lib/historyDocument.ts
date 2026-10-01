import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { JSONContent } from '@tiptap/react'
import type { RootContent } from 'mdast'

const prefix = 'ghostgrid:history-document:v1\n'
export const historyBodyLimit = 500000
const types = new Set(['doc', 'paragraph', 'heading', 'text', 'hardBreak', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'table', 'tableRow', 'tableCell', 'tableHeader', 'horizontalRule', 'codeBlock'])
const marks = new Set(['bold', 'italic', 'strike', 'underline', 'code', 'link'])
export function safeHistoryLink(href: string) {
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(href).protocol) && ![...href].some(c => c.charCodeAt(0) < 32) } catch { return false }
}
// Rebuild from an allowlist. Stored documents never supply HTML or arbitrary attributes.
export function cleanHistoryDocument(value: JSONContent): JSONContent {
  let count = 0
  function node(n: JSONContent, depth: number): JSONContent {
    if (++count > 100000 || depth > 64 || !n || !types.has(n.type ?? '')) throw new Error('Documento não suportado. O texto original foi preservado.')
    const out: JSONContent = { type: n.type }
    if (['text', 'hardBreak', 'horizontalRule'].includes(n.type!) && n.content?.length) throw new Error('Estrutura não suportada. O original foi preservado.')
    if (n.type === 'text') {
      if (typeof n.text !== 'string' || !n.text) throw new Error('Texto inválido.')
      out.text = n.text
      if (n.marks) out.marks = n.marks.map(m => {
        if (!marks.has(m.type)) throw new Error('Formatação não suportada.')
        if (m.type !== 'link') return { type: m.type }
        const href = m.attrs?.href
        if (typeof href !== 'string' || !safeHistoryLink(href)) throw new Error('Ligação não suportada.')
        return { type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } }
      })
    } else {
      if (n.content) {
        if (!Array.isArray(n.content)) throw new Error('Conteúdo inválido.')
        out.content = n.content.map(c => node(c, depth + 1))
      }
      const inline = ['text', 'hardBreak']
      const blocks = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'table', 'horizontalRule', 'codeBlock']
      const allowed = ['paragraph', 'heading', 'codeBlock'].includes(n.type!) ? (n.type === 'codeBlock' ? ['text'] : inline)
        : ['bulletList', 'orderedList'].includes(n.type!) ? ['listItem'] : n.type === 'taskList' ? ['taskItem']
          : n.type === 'table' ? ['tableRow'] : n.type === 'tableRow' ? ['tableCell', 'tableHeader'] : blocks
      if (out.content?.some(c => !allowed.includes(c.type!))) throw new Error('Estrutura não suportada. O original foi preservado.')
      if (['blockquote', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'table', 'tableRow', 'tableCell', 'tableHeader'].includes(n.type!) && !out.content?.length) throw new Error('Estrutura incompleta. O original foi preservado.')
      if (['listItem', 'taskItem'].includes(n.type!) && out.content?.[0]?.type !== 'paragraph') throw new Error('Lista inválida.')
      if (n.type === 'heading') out.attrs = { level: [1, 2, 3].includes(n.attrs?.level) ? n.attrs!.level : 2 }
      if (n.type === 'orderedList') out.attrs = { start: Number.isSafeInteger(n.attrs?.start) && n.attrs!.start > 0 ? n.attrs!.start : 1 }
      if (n.type === 'taskItem') out.attrs = { checked: n.attrs?.checked === true }
      if (n.type === 'tableCell' || n.type === 'tableHeader') out.attrs = {
        colspan: Math.min(100, Math.max(1, Number(n.attrs?.colspan) || 1)), rowspan: Math.min(100, Math.max(1, Number(n.attrs?.rowspan) || 1)), colwidth: null,
      }
      if (n.type === 'codeBlock') out.attrs = { language: null }
    }
    return out
  }
  if (value?.type !== 'doc') throw new Error('Documento inválido.')
  return node(value, 0)
}
export function encodeHistoryDocument(doc: JSONContent) {
  const body = prefix + JSON.stringify(cleanHistoryDocument(doc))
  if (body.length > historyBodyLimit) throw new Error('A página atingiu o limite de texto. Continua numa nova página.')
  return body
}
const text = (value: string): JSONContent[] => value ? [{ type: 'text', text: value }] : []
const paragraph = (value: string): JSONContent => ({ type: 'paragraph', content: text(value) })
function legacyDocument(body: string): JSONContent {
  const root = unified().use(remarkParse).parse(body)
  function convert(n: RootContent): JSONContent[] {
    const children = () => 'children' in n ? n.children.flatMap(c => convert(c as RootContent)) : []
    const raw = () => body.slice(n.position?.start.offset ?? 0, n.position?.end.offset ?? body.length)
    switch (n.type) {
      case 'text': return text(n.value)
      case 'paragraph': return [{ type: 'paragraph', content: children() }]
      case 'heading': return [{ type: 'heading', attrs: { level: Math.min(3, n.depth) }, content: children() }]
      case 'strong': case 'emphasis': {
        const mark = { type: n.type === 'strong' ? 'bold' : 'italic' }
        return children().map(c => c.type === 'text' ? { ...c, marks: [...(c.marks ?? []), mark] } : c)
      }
      case 'inlineCode': return [{ type: 'text', text: n.value || ' ', marks: [{ type: 'code' }] }]
      case 'break': return [{ type: 'hardBreak' }]
      case 'thematicBreak': return [{ type: 'horizontalRule' }]
      case 'blockquote': return [{ type: 'blockquote', content: children() }]
      case 'code': return [{ type: 'codeBlock', content: text(n.value) }]
      case 'list': return [{ type: n.ordered ? 'orderedList' : 'bulletList', attrs: n.ordered ? { start: n.start ?? 1 } : undefined, content: children() }]
      case 'listItem': {
        const content = children()
        if (content[0]?.type === 'heading') content[0] = { type: 'paragraph', content: content[0].content }
        if (content[0]?.type !== 'paragraph') content.unshift(paragraph(''))
        return [{ type: 'listItem', content }]
      }
      case 'link': return safeHistoryLink(n.url) ? children().map(c => c.type === 'text' ? { ...c, marks: [...(c.marks ?? []), { type: 'link', attrs: { href: n.url } }] } : c) : text(raw())
      // Unsupported legacy syntax (including images/HTML) remains literal text, without network loads.
      default: return text(raw())
    }
  }
  return { type: 'doc', content: root.children.length ? root.children.flatMap(n => ['html', 'definition'].includes(n.type) ? [paragraph(body.slice(n.position?.start.offset ?? 0, n.position?.end.offset ?? body.length))] : convert(n)) : [paragraph('')] }
}
export function decodeHistoryDocument(body: string): JSONContent {
  if (body.startsWith('ghostgrid:history-document:')) {
    if (!body.startsWith(prefix)) throw new Error('Esta versão do documento ainda não é suportada. O original está preservado.')
    return cleanHistoryDocument(JSON.parse(body.slice(prefix.length)) as JSONContent)
  }
  return cleanHistoryDocument(legacyDocument(body))
}
export function historyPlainText(body: string) {
  try {
    const walk = (n: JSONContent): string => n.type === 'text' ? n.text ?? '' : (n.content ?? []).map(walk).join(['doc', 'table', 'tableRow', 'bulletList', 'orderedList', 'taskList', 'blockquote'].includes(n.type ?? '') ? '\n' : '') + (['paragraph', 'heading', 'codeBlock', 'hardBreak'].includes(n.type ?? '') ? '\n' : '')
    return walk(decodeHistoryDocument(body)).trim()
  } catch { return body }
}
