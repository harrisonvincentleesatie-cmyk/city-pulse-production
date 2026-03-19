/**
 * City Pulse — Icon Generator
 *
 * Generates valid placeholder PNG icons for the PWA manifest.
 * Uses only Node.js built-ins (no dependencies).
 *
 * These are solid #080a0f (app background color) placeholder icons.
 * Replace with properly designed icons before production launch.
 *
 * Run: node scripts/generate-icons.cjs
 */

const { writeFileSync, mkdirSync } = require('fs')
const { deflateSync } = require('zlib')
const path = require('path')

// ── CRC32 (required for valid PNG chunks) ───────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c
  }
  return t
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ── PNG chunk writer ─────────────────────────────────────────────────────────
function chunk(type, data) {
  const len = Buffer.allocUnsafe(4)
  len.writeUInt32BE(data.length)
  const typeBytes = Buffer.from(type, 'ascii')
  const crcInput = Buffer.concat([typeBytes, data])
  const crcBuf = Buffer.allocUnsafe(4)
  crcBuf.writeUInt32BE(crc32(crcInput))
  return Buffer.concat([len, typeBytes, data, crcBuf])
}

// ── Build a solid-color RGBA PNG ─────────────────────────────────────────────
// Uses RGBA (color type 6) so we can add a tiny off-center dot for the
// pulse centre — makes it a real branded placeholder, not blank black square.
function buildPNG(size, bg, dot) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR
  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8]  = 8   // bit depth
  ihdr[9]  = 6   // color type: RGBA
  ihdr[10] = 0   // compression: deflate
  ihdr[11] = 0   // filter: adaptive
  ihdr[12] = 0   // interlace: none

  const cx = Math.floor(size / 2)
  const cy = Math.floor(size / 2)
  const dotR = Math.floor(size * 0.09)  // dot radius = 9% of icon size

  // Scanlines: 1 filter byte + (RGBA × width) per row
  const stride = 1 + size * 4
  const raw = Buffer.allocUnsafe(stride * size)

  for (let y = 0; y < size; y++) {
    const base = y * stride
    raw[base] = 0  // filter type: None
    for (let x = 0; x < size; x++) {
      const px = base + 1 + x * 4
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)

      if (dist <= dotR) {
        // Centre dot: #ff2d78
        raw[px]     = dot[0]
        raw[px + 1] = dot[1]
        raw[px + 2] = dot[2]
        raw[px + 3] = 255
      } else if (dist <= dotR * 2.8) {
        // Inner ring: semi-transparent pink
        const alpha = Math.max(0, 80 - (dist - dotR) * 12)
        raw[px]     = dot[0]
        raw[px + 1] = dot[1]
        raw[px + 2] = dot[2]
        raw[px + 3] = Math.floor(alpha)
      } else {
        // Background
        raw[px]     = bg[0]
        raw[px + 1] = bg[1]
        raw[px + 2] = bg[2]
        raw[px + 3] = 255
      }
    }
  }

  const idat = deflateSync(raw, { level: 6 })

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Generate icons ───────────────────────────────────────────────────────────
const outDir = path.join(__dirname, '../public/icons')
mkdirSync(outDir, { recursive: true })

const BG  = [8, 10, 15]      // #080a0f — app background
const DOT = [255, 45, 120]   // #ff2d78 — City Pulse pink

const icons = [
  { name: 'icon-192.png',          size: 192 },
  { name: 'icon-512.png',          size: 512 },
  { name: 'icon-512-maskable.png', size: 512 },
]

for (const { name, size } of icons) {
  const buf = buildPNG(size, BG, DOT)
  writeFileSync(path.join(outDir, name), buf)
  console.log(`  ✓  public/icons/${name}  (${buf.length} bytes)`)
}

console.log()
console.log('Placeholder PNG icons generated.')
console.log('Replace with properly designed icons before launch.')
