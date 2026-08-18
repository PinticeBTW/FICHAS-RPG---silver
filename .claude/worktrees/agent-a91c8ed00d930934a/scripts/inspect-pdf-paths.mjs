/**
 * Extracts path/line drawing operations from PDF to find input box areas.
 * Run: node scripts/inspect-pdf-paths.mjs pag1-blue
 */

import fs from 'node:fs'
import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

const fileName = process.argv[2] ?? 'pag1-blue'
const filePath = `pdf-sources/${fileName}.pdf`
const bytes = new Uint8Array(fs.readFileSync(filePath))
const pdfjsDoc = await getDocument({ data: bytes }).promise
const page = await pdfjsDoc.getPage(1)
const viewport = page.getViewport({ scale: 1 })
const W = viewport.width
const H = viewport.height

console.log(`${filePath} (${W} x ${H})`)

const ops = await page.getOperatorList()

// Collect all path segments as bounding boxes
const boxes = []
let curX = 0, curY = 0
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
let inPath = false

function commitPath() {
  if (inPath && minX < maxX && minY < maxY) {
    const w = maxX - minX
    const h = maxY - minY
    // Only collect small-ish boxes (likely input boxes)
    if (w > 10 && h > 3 && w < W * 0.95 && h < H * 0.5) {
      boxes.push({ x: Math.round(minX), y: Math.round(minY), w: Math.round(w), h: Math.round(h) })
    }
  }
  inPath = false
  minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity
}

for (let i = 0; i < ops.fnArray.length; i++) {
  const fn = ops.fnArray[i]
  const args = ops.argsArray[i]

  if (fn === OPS.moveTo || fn === OPS.lineTo) {
    const [x, y] = args
    curX = x; curY = y
    inPath = true
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  } else if (fn === OPS.curveTo || fn === OPS.curveTo1 || fn === OPS.curveTo2) {
    const pts = args
    for (let j = 0; j < pts.length; j += 2) {
      minX = Math.min(minX, pts[j]); minY = Math.min(minY, pts[j+1])
      maxX = Math.max(maxX, pts[j]); maxY = Math.max(maxY, pts[j+1])
    }
    inPath = true
  } else if (fn === OPS.stroke || fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke || fn === OPS.eoFillStroke) {
    commitPath()
  } else if (fn === OPS.closePath || fn === OPS.endPath) {
    commitPath()
  }
}

// Sort by y descending (top of page first)
boxes.sort((a, b) => (b.y + b.h) - (a.y + a.h) || a.x - b.x)

console.log(`\n${boxes.length} path bounding boxes:\n`)
for (const r of boxes) {
  const topPct = (((H - r.y - r.h) / H) * 100).toFixed(1)
  console.log(`  x=${String(r.x).padStart(4)} y=${String(r.y).padStart(4)}  w=${String(r.w).padStart(4)}  h=${String(r.h).padStart(3)}   top=${topPct}%`)
}
