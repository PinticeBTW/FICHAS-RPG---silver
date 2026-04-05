/**
 * Junta as páginas separadas em PDFs combinados para o site.
 *
 * COMO USAR:
 *   node scripts/merge-sheets.mjs
 *
 * FICHEIROS FONTE (pasta pdf-sources/ na raiz do projeto):
 *   pag1-blue.pdf   pag1-grey.pdf   pag1-red.pdf
 *   pag2-blue.pdf   pag2-grey.pdf   pag2-red.pdf
 *   pag3-blue.pdf   pag3-grey.pdf   pag3-red.pdf
 *   pag4-blue-m.pdf pag4-blue-f.pdf
 *   pag4-grey-m.pdf pag4-grey-f.pdf
 *   pag4-red-m.pdf  pag4-red-f.pdf
 *
 * RESULTADO (pasta public/templates/):
 *   sheet-blue-m.pdf  sheet-blue-f.pdf
 *   sheet-grey-m.pdf  sheet-grey-f.pdf
 *   sheet-red-m.pdf   sheet-red-f.pdf
 */

import { PDFDocument } from 'pdf-lib'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const SRC = 'pdf-sources'
const DEST = 'public/templates'

const colors = ['blue', 'grey', 'red']
const sexes = ['m', 'f']

for (const color of colors) {
  for (const sex of sexes) {
    const merged = await PDFDocument.create()

    // Páginas 1, 2 e 3 (iguais para M e F)
    for (const page of [1, 2, 3]) {
      const bytes = readFileSync(join(SRC, `pag${page}-${color}.pdf`))
      const doc = await PDFDocument.load(bytes)
      const [copied] = await merged.copyPages(doc, [0])
      merged.addPage(copied)
    }

    // Página 4 (corpo — M ou F)
    const p4bytes = readFileSync(join(SRC, `pag4-${color}-${sex}.pdf`))
    const p4doc = await PDFDocument.load(p4bytes)
    const [p4copied] = await merged.copyPages(p4doc, [0])
    merged.addPage(p4copied)

    const outBytes = await merged.save()
    const outName = `sheet-${color}-${sex}.pdf`
    writeFileSync(join(DEST, outName), outBytes)
    console.log(`✓ ${outName}`)
  }
}

console.log('Pronto!')
