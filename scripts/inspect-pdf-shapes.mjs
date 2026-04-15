/**
 * Decodes constructPath operators to find input boxes.
 * Run: node scripts/inspect-pdf-shapes.mjs pag1-blue
 */

import fs from 'node:fs'
import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

const fileName = process.argv[2] ?? 'pag1-blue'
const bytes = new Uint8Array(fs.readFileSync(`pdf-sources/${fileName}.pdf`))
const doc = await getDocument({ data: bytes }).promise
const page = await doc.getPage(1)
const { width: W, height: H } = page.getViewport({ scale: 1 })
const ops = await page.getOperatorList()

// Debug: show first few constructPath args structures
let debugCount = 0
const boxes = []

for (let i = 0; i < ops.fnArray.length; i++) {
  if (ops.fnArray[i] !== OPS.constructPath) continue
  const raw = ops.argsArray[i]

  if (debugCount < 3) {
    console.log(`constructPath[${i}] args type=${typeof raw}, isArray=${Array.isArray(raw)}, length=${raw?.length}`)
    if (Array.isArray(raw)) {
      for (let k = 0; k < raw.length; k++) {
        const item = raw[k]
        console.log(`  [${k}]: type=${typeof item} isArray=${Array.isArray(item)} value=${JSON.stringify(item)?.slice(0,100)}`)
      }
    }
    debugCount++
  }

  // Try to get all numeric coords regardless of structure
  let allCoords = []
  function collectNumbers(v) {
    if (typeof v === 'number') { allCoords.push(v); return }
    if (Array.isArray(v)) { v.forEach(collectNumbers); return }
    if (v && typeof v === 'object') { Object.values(v).forEach(collectNumbers) }
  }
  collectNumbers(raw)

  if (allCoords.length < 4) continue

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let k = 0; k < allCoords.length - 1; k += 2) {
    const x = allCoords[k], y = allCoords[k + 1]
    if (typeof x === 'number' && typeof y === 'number') {
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
  }

  if (!isFinite(minX)) continue
  const w = maxX - minX
  const h = maxY - minY
  if (w > 8 && h > 2 && h < 60 && w < W - 5) {
    boxes.push({ x: Math.round(minX), y: Math.round(minY), w: Math.round(w), h: Math.round(h) })
  }
}

const uniq = [...new Map(boxes.map(b => [`${b.x},${b.y},${b.w},${b.h}`, b])).values()]
uniq.sort((a, b) => (b.y + b.h) - (a.y + a.h) || a.x - b.x)

console.log(`\n${fileName}.pdf — ${uniq.length} shape bboxes\n`)
for (const r of uniq) {
  console.log(`  x=${String(r.x).padStart(4)}  y=${String(r.y).padStart(4)}  w=${String(r.w).padStart(4)}  h=${String(r.h).padStart(3)}`)
}
