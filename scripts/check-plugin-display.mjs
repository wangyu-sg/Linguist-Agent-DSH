import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

/** Validate the root-plugin resource exports used by both local bundles, without activating code. */
export function inspectPluginDisplay(manifest, readResource) {
  const resourcePath = value => {
    assert.equal(typeof value, 'string', 'Display exports must be relative string paths')
    assert(value.startsWith('./') && !value.split('/').includes('..') && !value.includes('\\'), 'Display resource must stay inside the package')
    return value.slice(2)
  }
  const locales = {}
  const pattern = manifest.exports?.['./locale/*.json']
  assert.equal(typeof pattern, 'string', 'Export ./locale/*.json')
  assert(pattern.includes('*'), 'Locale export must retain its wildcard')
  for (const locale of ['en', 'zh']) {
    const path = resourcePath(pattern.replaceAll('*', locale))
    const { meta } = JSON.parse(readResource(path).toString('utf8'))
    for (const key of ['title', 'description']) assert.equal(typeof meta?.[key] === 'string' && meta[key].trim().length > 0, true, `Missing ${locale} meta.${key}`)
    assert.notEqual(meta.title, manifest.name, 'Use a display title rather than the package identifier')
    locales[locale] = { title: meta.title, description: meta.description }
  }
  const iconPath = resourcePath(manifest.exports?.['./icon'])
  const png = readResource(iconPath)
  assert(png.length <= 256 * 1024, 'Plugin icon exceeds the native 256 KiB limit')
  assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Plugin icon must contain PNG bytes')
  assert.equal(png.toString('ascii', 12, 16), 'IHDR')
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
  assert(width > 0 && height > 0 && width <= 2048 && height <= 2048, 'Invalid icon dimensions')
  assert.deepEqual([...png.subarray(24, 29)], [8, 6, 0, 0, 0], 'Local icons use non-interlaced 8-bit RGBA PNG')
  const data = []
  let offset = 8, ended = false
  while (offset + 12 <= png.length) {
    const size = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8)
    assert(offset + 12 + size <= png.length, 'Truncated PNG chunk')
    if (type === 'IDAT') data.push(png.subarray(offset + 8, offset + 8 + size))
    offset += 12 + size
    if (type === 'IEND') { ended = true; break }
  }
  assert(ended && offset === png.length && data.length > 0, 'PNG must include image data and its terminator')
  const pixels = inflateSync(Buffer.concat(data)), stride = width * 4 + 1
  assert.equal(pixels.length, stride * height, 'PNG image data does not match its dimensions')
  for (let row = 0; row < height; row++) assert(pixels[row * stride] <= 4, 'Invalid PNG row filter')
  return { name: manifest.name, version: manifest.version, locales, icon: { path: iconPath, width, height, bytes: png.length } }
}

export function checkPluginDisplay(tarball) {
  const path = resolve(tarball)
  const read = entry => execFileSync('tar', ['-xOzf', path, `package/${entry}`], { maxBuffer: 1024 * 1024 })
  return inspectPluginDisplay(JSON.parse(read('package.json')), read)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Pass the actual plugin tarball path')
  process.stdout.write(`${JSON.stringify(checkPluginDisplay(process.argv[2]), null, 2)}\n`)
}
