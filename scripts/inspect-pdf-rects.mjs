/**
 * Extracts rectangles/paths from PDFs to find input box coordinates.
 * Run: node scripts/inspect-pdf-rects.mjs
 */

import fs from 'node:fs'
import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

async function getRects(filePath) {
  const bytes = new Uint8Array(fs.readFileSync(filePath))
  const pdfjsDoc = await getDocument({ data: bytes }).promise
  const page = await pdfjsDoc.getPage(1)
  const viewport = page.getViewport({ scale: 1 })
  const W = viewport.width
  const H = viewport.height

  const ops = await page.getOperatorList()
  const rects = []

  // Walk all ops looking for rect + stroke/fill patterns
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i]

    // re = rectangle operator: args = [x, y, w, h]
    if (fn === OPS.rectangle) {
      const [x, y, w, h] = args
      rects.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) })
    }
  }

  return { W, H, rects }
}

const files = [
  'pdf-sources/pag1-blue.pdf',
  'pdf-sources/pag2-blue.pdf',
  'pdf-sources/pag3-blue.pdf',
  'pdf-sources/pag4-blue-m.pdf',
]

for (const file of files) {
  const { W, H, rects } = await getRects(file)
  console.log(`\n=== ${file} (${W} x ${H}) — ${rects.length} rects ===`)
  // Sort by y descending (top of page first), then x
  const sorted = rects.slice().sort((a, b) => (b.y + b.h) - (a.y + a.h) || a.x - b.x)
  for (const r of sorted) {
    const pct_x = ((r.x / W) * 100).toFixed(1)
    const pct_y = (((H - r.y - r.h) / H) * 100).toFixed(1)  // top % from top
    console.log(`  x=${String(r.x).padStart(4)} y=${String(r.y).padStart(4)}  w=${String(r.w).padStart(4)}  h=${String(r.h).padStart(4)}   (left=${pct_x}% top=${pct_y}%)`)
  }
}
