import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { applyDisplayMetadata, verifyMetadataOnlyPackage } from '../../integrations/browser-skill/build-adapted-plugin.mjs'

const integration = new URL('../../integrations/browser-skill/', import.meta.url)
const baseline = JSON.parse(await readFile(new URL('BASELINE.json', integration), 'utf8'))

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'browser-skill-metadata-test-'))
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    assert(basename(directory).startsWith('browser-skill-metadata-test-'))
    await rm(directory, { recursive: true, force: true })
  })
  const original = join(directory, 'original')
  const adapted = join(directory, 'adapted')
  const manifest = {
    name: baseline.upstreamPlugin.name,
    version: baseline.metadataBase.version,
    description: 'Developer package description stays unchanged.',
    license: 'MIT',
    repository: { type: 'git', directory: 'packages/dsh-plugin-browserskill' },
    exports: { '.': { default: './lib/index.mjs' }, './client': { default: './lib/client.cjs' }, './package.json': './package.json' },
    files: ['lib', 'skill', 'cordis.patch.yml', 'LICENSE'],
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
    scripts: { prepack: 'must-not-run' },
    peerDependencies: { '@deepseek-ai/cordis': '4.1.0' },
    devDependencies: { typescript: '5.8.3' },
  }
  const files = {
    'package.json': JSON.stringify(manifest, null, 2) + '\n',
    'lib/index.mjs': 'export const runtime = "unchanged";\n',
    'lib/client.cjs': 'module.exports = "unchanged";\n',
    'skill/SKILL.md': '# Synthetic BrowserSkill instructions\n',
    'cordis.patch.yml': '- insert: []\n',
    LICENSE: 'Synthetic MIT license fixture\n',
  }
  for (const [file, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(original, file)), { recursive: true })
    await writeFile(join(original, file), bytes)
  }
  await cp(original, adapted, { recursive: true })
  await applyDisplayMetadata(adapted)
  return { original, adapted, manifest }
}

test('BrowserSkill display overlay preserves runtime, configuration and developer metadata', async t => {
  const { original, adapted, manifest } = await fixture(t)
  const expected = structuredClone(manifest)
  expected.version = baseline.adaptedPluginVersion
  expected.exports['./locale/*.json'] = './locale/*.json'
  expected.exports['./icon'] = './icon.png'
  expected.files.push('locale/*.json', 'icon.png')
  assert.deepEqual(JSON.parse(await readFile(join(adapted, 'package.json'), 'utf8')), expected)
  assert.equal(await verifyMetadataOnlyPackage(original, adapted), 5)
  for (const locale of ['en', 'zh']) {
    const source = await readFile(new URL(`metadata/locale/${locale}.json`, integration))
    assert.deepEqual(await readFile(join(adapted, `locale/${locale}.json`)), source)
  }
  const firstManifest = await readFile(join(adapted, 'package.json'))
  await applyDisplayMetadata(adapted)
  assert.deepEqual(await readFile(join(adapted, 'package.json')), firstManifest, 'reapplying the overlay must not duplicate files declarations')
  assert.equal(await verifyMetadataOnlyPackage(original, adapted), 5)
})

test('BrowserSkill metadata-only verification rejects changed runtime bytes', async t => {
  const { original, adapted } = await fixture(t)
  await writeFile(join(adapted, 'lib/index.mjs'), 'export const runtime = "changed";\n')
  await assert.rejects(verifyMetadataOnlyPackage(original, adapted), /lib\/index\.mjs changed/)
})

test('BrowserSkill metadata-only verification rejects dependency or configuration changes', async t => {
  const { original, adapted } = await fixture(t)
  const manifest = JSON.parse(await readFile(join(adapted, 'package.json'), 'utf8'))
  manifest.peerDependencies['@deepseek-ai/cordis'] = '99.0.0'
  manifest.dsh.bundle.patch = './other.yml'
  await writeFile(join(adapted, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  await assert.rejects(verifyMetadataOnlyPackage(original, adapted), /non-display package metadata changed/)
})

test('BrowserSkill metadata-only verification rejects extra files and altered display resources', async t => {
  const { original, adapted } = await fixture(t)
  await writeFile(join(adapted, 'locale/zh.json'), '{"meta":{"title":"unexpected"}}\n')
  await assert.rejects(verifyMetadataOnlyPackage(original, adapted), /locale\/zh\.json differs from the metadata overlay/)
  await writeFile(join(adapted, 'extra.mjs'), 'export {}\n')
  await assert.rejects(verifyMetadataOnlyPackage(original, adapted), /only display assets may be added/)
})
