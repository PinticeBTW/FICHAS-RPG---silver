/**
 * Lists all unique operator types in a PDF page.
 */
import fs from 'node:fs'
import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

const bytes = new Uint8Array(fs.readFileSync('pdf-sources/pag1-blue.pdf'))
const doc = await getDocument({ data: bytes }).promise
const page = await doc.getPage(1)
const ops = await page.getOperatorList()

const opNames = Object.entries(OPS).reduce((m, [k, v]) => { m[v] = k; return m }, {})
const counts = {}
for (const fn of ops.fnArray) {
  const name = opNames[fn] ?? `op_${fn}`
  counts[name] = (counts[name] ?? 0) + 1
}

console.log('Operator counts:')
for (const [name, count] of Object.entries(counts).sort((a,b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(5)}  ${name}`)
}
