export type NoteHighlightColor = 'yellow' | 'red' | 'blue'

export const NOTE_HIGHLIGHT_CLASS = 'note-highlight'

export const NOTE_HIGHLIGHT_CLASS_BY_COLOR: Record<NoteHighlightColor, string> = {
  yellow: 'highlight-yellow',
  red: 'highlight-red',
  blue: 'highlight-blue',
}

const ALLOWED_TAGS = new Set(['BR', 'DIV', 'P', 'EM', 'I', 'STRONG', 'B', 'SPAN'])

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value)
}

export function escapeRichTextHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function stripRichTextHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function buildHighlightClassName(color: NoteHighlightColor) {
  return `${NOTE_HIGHLIGHT_CLASS} ${NOTE_HIGHLIGHT_CLASS_BY_COLOR[color]}`
}

export function getHighlightColorFromElement(element: Element | null): NoteHighlightColor | null {
  if (!element || !(element instanceof HTMLElement)) {
    return null
  }

  const explicitColor = element.dataset.highlightColor as NoteHighlightColor | undefined

  if (explicitColor && explicitColor in NOTE_HIGHLIGHT_CLASS_BY_COLOR) {
    return explicitColor
  }

  return (Object.entries(NOTE_HIGHLIGHT_CLASS_BY_COLOR).find(([, className]) =>
    element.classList.contains(className),
  )?.[0] ?? null) as NoteHighlightColor | null
}

function unwrapElement(element: HTMLElement) {
  const parent = element.parentNode

  if (!parent) {
    return
  }

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }

  parent.removeChild(element)
}

function sanitizeHighlightElement(element: HTMLElement, color: NoteHighlightColor) {
  element.className = buildHighlightClassName(color)
  element.dataset.highlightColor = color
}

function sanitizeRichTextNode(node: Node) {
  if (!(node instanceof HTMLElement)) {
    return
  }

  Array.from(node.childNodes).forEach((child) => sanitizeRichTextNode(child))

  if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') {
    node.remove()
    return
  }

  if (!ALLOWED_TAGS.has(node.tagName)) {
    unwrapElement(node)
    return
  }

  if (node.tagName === 'SPAN') {
    const color = getHighlightColorFromElement(node)

    if (!color) {
      unwrapElement(node)
      return
    }

    sanitizeHighlightElement(node, color)
    return
  }

  Array.from(node.attributes).forEach((attribute) => node.removeAttribute(attribute.name))
}

function sanitizeRichTextHtml(html: string) {
  if (typeof document === 'undefined') {
    return html.trim()
  }

  const container = document.createElement('div')
  container.innerHTML = html

  Array.from(container.childNodes).forEach((child) => sanitizeRichTextNode(child))

  return container.innerHTML.trim()
}

export function normaliseNoteHtmlForEditor(value: string) {
  if (!value.trim()) {
    return ''
  }

  if (!looksLikeHtml(value)) {
    return escapeRichTextHtml(value).replace(/\n/g, '<br>')
  }

  return sanitizeRichTextHtml(value)
}

export function normaliseNoteHtmlForStorage(value: string) {
  const sanitized = sanitizeRichTextHtml(value)

  if (!sanitized || sanitized === '<br>' || sanitized === '<div><br></div>') {
    return ''
  }

  return sanitized
}
