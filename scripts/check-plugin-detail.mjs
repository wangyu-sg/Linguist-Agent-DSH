import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { languageChain, localFiles, readPackageDocument } from '@deepseek-ai/dsh-plugin-detail'

const maxBytes = 1024 * 1024
const temporaryPrefix = 'la-dsh-plugin-detail-'
const expectedDocuments = { 'zh-CN': 'README.zh.md', 'en-US': 'README.md', 'de-DE': 'README.md' }

/** Read packed detail resources through the native SDK, without loading any plugin runtime code. */
export async function checkPluginDetail(tarball) {
  const archive = await realpath(resolve(tarball))
  // Copy only physical root documents/locales. Package export aliases are deliberately not resolved.
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 4 * maxBytes }).trim().split('\n').filter(entry => entry === 'package/package.json'
    || /^package\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:md|markdown)$/iu.test(entry)
    || /^package\/locale\/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\.json$/u.test(entry))
  assert(entries.includes('package/package.json'), 'Plugin tarball omits package/package.json')
  assert(entries.length <= 64, 'Too many plugin detail resources')
  assert.equal(new Set(entries).size, entries.length, 'Duplicate plugin detail archive entries')
  const types = execFileSync('tar', ['-tvzf', archive, '--', ...entries], { encoding: 'utf8', maxBuffer: 4 * maxBytes }).trim().split('\n')
  assert(types.length === entries.length && types.every(line => line.startsWith('-') && entries.some(entry => line.endsWith(` ${entry}`))), 'Plugin detail resources must be regular archive files, not links')

  const parent = await realpath(tmpdir())
  const temporary = await realpath(await mkdtemp(join(parent, temporaryPrefix)))
  try {
    let manifest, totalBytes = 0
    for (const entry of entries) {
      const destination = resolve(temporary, entry.slice('package/'.length))
      assert(destination.startsWith(`${temporary}${sep}`), `Plugin detail path escapes its temporary package: ${entry}`)
      const bytes = execFileSync('tar', ['-xOzf', archive, '--', entry], { maxBuffer: maxBytes + 1 })
      assert(bytes.length <= maxBytes, `Plugin detail resource exceeds ${maxBytes} bytes: ${entry}`)
      totalBytes += bytes.length
      assert(totalBytes <= 8 * maxBytes, 'Plugin detail resources exceed 8 MiB')
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, bytes, { flag: 'wx' })
      if (entry === 'package/package.json') manifest = JSON.parse(bytes.toString('utf8'))
    }
    const files = localFiles(temporary, manifest.version)
    const documents = {}
    for (const [language, path] of Object.entries(expectedDocuments)) {
      const document = await readPackageDocument(files, '', languageChain(language), maxBytes, AbortSignal.timeout(5000))
      assert(document, `Native plugin detail is empty for ${language}`)
      assert.equal(document.origin, 'locale', `${language} must use physical locale meta.detail, not README fallback`)
      assert.equal(document.path, path, `Wrong native detail document for ${language}`)
      assert(document.markdown.trim(), `Empty plugin detail Markdown for ${language}: ${path}`)
      assert.match(document.markdown, language === 'zh-CN' ? /[\p{Script=Han}]{2,}/u : /\b[A-Za-z]+\s+[A-Za-z]+\s+[A-Za-z]+\b/u, `${path} must contain ${language === 'zh-CN' ? 'Chinese' : 'English'} prose`)
      documents[language] = { origin: document.origin, path: document.path, bytes: Buffer.byteLength(document.markdown) }
    }
    return { name: manifest.name, version: manifest.version, documents }
  } finally {
    const target = await realpath(temporary)
    assert.equal(target, temporary, 'Temporary plugin detail directory changed location')
    assert.equal(dirname(target), parent, 'Refuse to remove a directory outside the temporary parent')
    assert(basename(target).startsWith(temporaryPrefix), 'Refuse to remove a directory not owned by this checker')
    await rm(target, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Pass the actual Linguist plugin tarball path')
  process.stdout.write(`${JSON.stringify(await checkPluginDetail(process.argv[2]), null, 2)}\n`)
}
