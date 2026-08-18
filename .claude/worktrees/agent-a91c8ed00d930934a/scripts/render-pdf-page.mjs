/**
 * Renders a PDF page to a PNG so we can see exact input box positions.
 * Run: node scripts/render-pdf-page.mjs pag1-blue
 * Output: scripts/render-pag1-blue.png
 */
import fs from 'node:fs'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'

GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

const fileName = process.argv[2] ?? 'pag1-blue'
const bytes = new Uint8Array(fs.readFileSync(`pdf-sources/${fileName}.pdf`))
const doc = await getDocument({ data: bytes }).promise
const page = await doc.getPage(1)

const SCALE = 2  // render at 2x for clarity
const viewport = page.getViewport({ scale: SCALE })
const canvas = createCanvas(viewport.width, viewport.height)
const ctx = canvas.getContext('2d')

await page.render({
  canvasContext: ctx,
  viewport,
}).promise

const buf = canvas.toBuffer('image/png')
const outPath = `scripts/render-${fileName}.png`
fs.writeFileSync(outPath, buf)
console.log(`Saved ${outPath} (${viewport.width}x${viewport.height})`)
