import fs from 'node:fs'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'

const targetDir = process.argv[2] ?? 'e:\\FICHAS RPG SILVER\\a'

function normalizeKey(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
}

const files = fs
  .readdirSync(targetDir)
  .filter((entry) => entry.toLowerCase().endsWith('.pdf'))
  .sort((left, right) => left.localeCompare(right))

const output = []

for (const fileName of files) {
  const fullPath = path.join(targetDir, fileName)
  const pdf = await PDFDocument.load(fs.readFileSync(fullPath))
  const form = pdf.getForm()
  const fields = {}

  for (const field of form.getFields()) {
    let value = ''

    try {
      if (typeof field.getText === 'function') {
        value = field.getText() || ''
      } else if (typeof field.isChecked === 'function') {
        value = field.isChecked() ? 'true' : 'false'
      }
    } catch {
      value = ''
    }

    if (!value.trim()) {
      continue
    }

    fields[normalizeKey(field.getName())] = value.trim()
  }

  output.push({
    fileName,
    fields,
  })
}

console.log(JSON.stringify(output, null, 2))
