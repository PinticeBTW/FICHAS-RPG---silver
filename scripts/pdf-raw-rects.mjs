/**
 * Parses raw PDF content streams to find all rectangle/box coordinates.
 * Run: node scripts/pdf-raw-rects.mjs pag1-blue
 */

import fs from 'node:fs'
import zlib from 'node:zlib'

const fileName = process.argv[2] ?? 'pag1-blue'
const buf = fs.readFileSync(`pdf-sources/${fileName}.pdf`)
const str = buf.toString('latin1')

// Find page dimensions
const mediaMatch = str.match(/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/)
const W = mediaMatch ? parseFloat(mediaMatch[3]) : 475
const H = mediaMatch ? parseFloat(mediaMatch[4]) : 675
console.log(`Page: ${W} x ${H}`)

// Extract all compressed and uncompressed streams
const streams = []

// Find all stream...endstream blocks
const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g
let m
while ((m = streamRegex.exec(str)) !== null) {
  const raw = Buffer.from(m[1], 'latin1')
  // Try to decompress (FlateDecode)
  try {
    const decompressed = zlib.inflateSync(raw).toString('latin1')
    streams.push(decompressed)
  } catch {
    streams.push(m[1])
  }
}

console.log(`Found ${streams.length} streams`)

// Parse each stream for drawing commands
const allRects = []

for (const stream of streams) {
  const lines = stream.split(/\n|\r/)
  let stack = []
  let currentPath = []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let inPath = false

  function pushCoords(x, y) {
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    inPath = true
  }

  function collectRect() {
    if (inPath && maxX > minX && maxY > minY) {
      const w = maxX - minX
      const h = maxY - minY
      if (w > 5 && h > 2 && h < H * 0.3 && w < W * 0.99) {
        allRects.push({ x: minX, y: minY, w, h })
      }
    }
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity
    inPath = false
  }

  for (const line of lines) {
    const tokens = line.trim().split(/\s+/)
    const op = tokens[tokens.length - 1]
    const nums = tokens.slice(0, -1).map(Number).filter(n => !isNaN(n))

    if (op === 'm' && nums.length >= 2) {
      collectRect()
      pushCoords(nums[0], nums[1])
    } else if (op === 'l' && nums.length >= 2) {
      pushCoords(nums[0], nums[1])
    } else if (op === 're' && nums.length >= 4) {
      // rectangle: x y w h re
      collectRect()
      const [x, y, rw, rh] = nums
      allRects.push({ x, y, w: rw, h: rh })
      collectRect()
    } else if (op === 'c' && nums.length >= 6) {
      pushCoords(nums[4], nums[5])
    } else if (op === 'S' || op === 's' || op === 'F' || op === 'f' || op === 'B' || op === 'b' || op === 'f*' || op === 'B*') {
      collectRect()
    } else if (op === 'n') {
      collectRect()
    }
  }
  collectRect()
}

// Deduplicate and filter
const seen = new Set()
const uniq = []
for (const r of allRects) {
  const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`
  if (!seen.has(key)) {
    seen.add(key)
    uniq.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })
  }
}

uniq.sort((a, b) => (b.y + b.h) - (a.y + a.h) || a.x - b.x)
console.log(`\n${uniq.length} unique rects:\n`)
for (const r of uniq) {
  const topPct = (((H - r.y - r.h) / H) * 100).toFixed(1)
  const leftPct = ((r.x / W) * 100).toFixed(1)
  console.log(`  x=${String(r.x).padStart(5)} y=${String(r.y).padStart(5)}  w=${String(r.w).padStart(5)}  h=${String(r.h).padStart(4)}   left=${leftPct}% top=${topPct}%`)
}
