/**
 * Extracts text positions from the new Figma PDFs.
 * Run: node scripts/inspect-pdf-fields.mjs
 */

import fs from 'node:fs'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'

GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

const files = [
  'pdf-sources/pag1-blue.pdf',
  'pdf-sources/pag2-blue.pdf',
  'pdf-sources/pag3-blue.pdf',
  'pdf-sources/pag4-blue-m.pdf',
]

for (const file of files) {
  const bytes = new Uint8Array(fs.readFileSync(file))
  const pdfjsDoc = await getDocument({ data: bytes }).promise
  const page = await pdfjsDoc.getPage(1)
  const viewport = page.getViewport({ scale: 1 })
  const W = viewport.width
  const H = viewport.height

  console.log(`\n=== ${file} (${W.toFixed(1)} x ${H.toFixed(1)}) ===`)

  const content = await page.getTextContent()
  const items = content.items
    .filter(i => i.str && i.str.trim().length > 0)
    .map(i => ({
      str: i.str.trim(),
      x: Math.round(i.transform[4]),
      y: Math.round(i.transform[5]),
      w: Math.round(i.width),
      h: Math.round(i.height),
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x)

  for (const item of items) {
    console.log(`  "${item.str.padEnd(22)}" x=${String(item.x).padStart(4)} y=${String(item.y).padStart(4)}  w=${String(item.w).padStart(4)}  h=${String(item.h).padStart(3)}`)
  }
}
