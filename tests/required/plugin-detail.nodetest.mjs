import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { DetailFailure, languageChain, localFiles, readPackageDocument } from '@deepseek-ai/dsh-plugin-detail'
import { checkPluginDetail } from '../../scripts/check-plugin-detail.mjs'

const maxBytes = 1024 * 1024
const english = '# Linguist Agent\n\nUse this plugin for game localization with CAT tools.\n'
const chinese = '# Linguist Agent · 游戏本地化\n\n使用插件进行游戏本地化、翻译与审校。\n'
const locale = detail => JSON.stringify({ meta: { detail } })
const documents = {
  'README.md': english,
  'README.zh.md': chinese,
  'locale/en.json': locale('README.md'),
  'locale/zh.json': locale('README.zh.md'),
}
const readDetail = (root, language) => readPackageDocument(localFiles(root, 'synthetic'), '', languageChain(language), maxBytes, AbortSignal.timeout(5000))

async function fixture(t, files) {
  const parent = await realpath(tmpdir())
  const directory = await realpath(await mkdtemp(join(parent, 'la-dsh-detail-test-')))
  t.after(async () => {
    const target = await realpath(directory)
    assert.equal(target, directory)
    assert.equal(dirname(target), parent)
    assert(basename(target).startsWith('la-dsh-detail-test-'))
    await rm(target, { recursive: true, force: true })
  })
  const root = join(directory, 'package')
  const manifest = { name: '@linguist/detail-fixture', version: '0.0.0', type: 'module', exports: { '.': './lib/index.mjs', './locale/*.json': './locale/*.json' } }
  for (const [file, contents] of Object.entries({ 'package.json': JSON.stringify(manifest), ...files })) {
    assert(!file.startsWith('/') && !file.split('/').some(part => part === '..' || part === '.') && !file.includes('\\'))
    const destination = join(root, file)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, contents)
  }
  const tarball = join(directory, 'fixture.tgz')
  const pack = () => {
    execFileSync('tar', ['-czf', tarball, '-C', directory, 'package'])
    return tarball
  }
  return { root, pack }
}

function assertDocument(document, origin, path, markdown) {
  assert(document)
  assert.equal(document.origin, origin)
  assert.equal(document.path, path)
  assert.equal(document.markdown, markdown)
}

function missingTarget(error) {
  return error instanceof DetailFailure && error.reason === 'invalid'
    && error.message.includes('README.missing.md, named by meta.detail, does not exist')
}

test('current Linguist package docs use physical localized meta.detail through the native reader', async () => {
  const root = await realpath(fileURLToPath(new URL('../../packages/dsh-linguist/', import.meta.url)))
  for (const [language, path] of [['zh-CN', 'README.zh.md'], ['en-US', 'README.md'], ['de-DE', 'README.md']]) {
    const markdown = await readFile(join(root, path), 'utf8')
    assert(markdown.trim())
    assertDocument(await readDetail(root, language), 'locale', path, markdown)
  }
})

test('native reader ignores export aliases and uses physical locale, English and README fallbacks', async t => {
  const { root } = await fixture(t, {
    'package.json': JSON.stringify({ name: '@linguist/alias-fixture', exports: { './locale/*.json': './resources/locale/*.json' } }),
    'resources/locale/en.json': locale('README.md'),
    'resources/locale/zh.json': locale('README.zh.md'),
  })
  assert.equal(await readDetail(root, 'zh-CN'), undefined, 'No physical locale or root README means empty native details')
  await writeFile(join(root, 'README.md'), english)
  await writeFile(join(root, 'README.zh.md'), chinese)
  assertDocument(await readDetail(root, 'zh-CN'), 'readme', 'README.md', english)
  await mkdir(join(root, 'locale'))
  await writeFile(join(root, 'locale/en.json'), locale('README.md'))
  await writeFile(join(root, 'locale/zh.json'), locale('README.zh.md'))
  assertDocument(await readDetail(root, 'zh-CN'), 'locale', 'README.zh.md', chinese)
  assertDocument(await readDetail(root, 'en-US'), 'locale', 'README.md', english)
  assertDocument(await readDetail(root, 'de-DE'), 'locale', 'README.md', english)
  await writeFile(join(root, 'locale/zh.json'), JSON.stringify({ meta: { title: '中文标题' } }))
  await writeFile(join(root, 'locale/en.json'), JSON.stringify({ meta: { title: 'English title' } }))
  assertDocument(await readDetail(root, 'zh-CN'), 'readme', 'README.md', english)
})

test('a named missing Markdown target fails natively and in the tarball checker despite an existing README', async t => {
  const { root, pack } = await fixture(t, { ...documents, 'locale/en.json': locale('README.missing.md') })
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), english)
  await assert.rejects(readDetail(root, 'en-US'), missingTarget)
  await assert.rejects(checkPluginDetail(pack()), missingTarget)
  await writeFile(join(root, 'locale/en.json'), locale('./README.md'))
  await assert.rejects(readDetail(root, 'en-US'), error => error instanceof DetailFailure && error.reason === 'invalid' && /relative path inside the package/u.test(error.message))
})

test('the tarball checker reads localized docs without activation and rejects empty or wrong-language Markdown', async t => {
  const { root, pack } = await fixture(t, { ...documents, 'lib/index.mjs': 'throw new Error("Plugin runtime must not be activated")\n' })
  const tarball = pack()
  const result = await checkPluginDetail(tarball)
  const cli = execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/check-plugin-detail.mjs', import.meta.url)), tarball], { encoding: 'utf8' })
  assert.deepEqual(JSON.parse(cli), result)
  assert.equal(result.name, '@linguist/detail-fixture')
  assert.equal(result.version, '0.0.0')
  assert.deepEqual(result.documents, {
    'zh-CN': { origin: 'locale', path: 'README.zh.md', bytes: Buffer.byteLength(chinese) },
    'en-US': { origin: 'locale', path: 'README.md', bytes: Buffer.byteLength(english) },
    'de-DE': { origin: 'locale', path: 'README.md', bytes: Buffer.byteLength(english) },
  })
  await writeFile(join(root, 'README.zh.md'), '\n')
  await assert.rejects(checkPluginDetail(pack()), /Empty plugin detail Markdown for zh-CN/u)
  await writeFile(join(root, 'README.zh.md'), english)
  await assert.rejects(checkPluginDetail(pack()), /README\.zh\.md must contain Chinese prose/u)
  await writeFile(join(root, 'README.zh.md'), chinese)
  await writeFile(join(root, 'README.md'), chinese)
  await assert.rejects(checkPluginDetail(pack()), /README\.md must contain English prose/u)
})

test('the tarball checker refuses a linked detail resource before copying files', async t => {
  const files = { ...documents }
  delete files['README.zh.md']
  const { root, pack } = await fixture(t, files)
  await symlink('README.md', join(root, 'README.zh.md'))
  await assert.rejects(checkPluginDetail(pack()), /regular archive files, not links/u)
})
