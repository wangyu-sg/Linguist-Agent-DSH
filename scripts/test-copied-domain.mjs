import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const toolchain = join(root, '.toolchain/bun-1.3.14')
const archive = join(toolchain, 'downloads/bun-darwin-aarch64.zip')
const bun = join(toolchain, 'bun-darwin-aarch64/bun')
const source = join(root, '.migration/source-snapshot')
const evidence = join(root, 'artifacts/evidence')
const release = {
  tag: 'bun-v1.3.14',
  metadata: 'https://api.github.com/repos/oven-sh/bun/releases/tags/bun-v1.3.14',
  url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-darwin-aarch64.zip',
  archiveSha256: 'd8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620',
  binarySha256: 'e0c90ec15d33363e6b70713d56bc3b2c7585c17f40a0fe0f8fd9305901d4e233',
}
const tests = [
  'packages/linguist-cat-core/src/hard-rules.test.ts',
  'packages/linguist-cat-core/src/proposal.test.ts',
  'packages/linguist-cat-core/src/qa-core.test.ts',
  'packages/linguist-cat-core/src/segment.test.ts',
  'packages/linguist-cat-core/src/serialization.test.ts',
  'packages/linguist-cat-core/src/stage-evidence.test.ts',
  'packages/linguist-cat-core/src/tm-matching-corpus.test.ts',
  'packages/linguist-cat-core/src/workflow.test.ts',
  'packages/linguist-cat-formats/src/context-extraction.test.ts',
  'packages/linguist-cat-formats/src/tmx.test.ts',
  'packages/linguist-cat-formats/src/adapters/mqxliff.test.ts',
  'packages/linguist-cat-formats/src/adapters/phrasemxliff.test.ts',
  'packages/linguist-cat-formats/src/adapters/sdlxliff.test.ts',
  'packages/linguist-cat-formats/src/adapters/xliff.test.ts',
  'packages/linguist-cat-formats/src/adapters/xlsx.test.ts',
]
const sha = value => createHash('sha256').update(value).digest('hex')
const fileSha = path => sha(readFileSync(path))
const assert = (condition, message) => { if (!condition) throw new Error(message) }

function atomic(path, content) {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, content)
  renameSync(temporary, path)
}

function ensureBun() {
  if (!existsSync(archive)) {
    mkdirSync(join(toolchain, 'downloads'), { recursive: true })
    const download = spawnSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '120', '--output', archive, release.url], { encoding: 'utf8' })
    assert(download.status === 0, `fixed Bun download failed: ${download.stderr?.trim() || download.error?.message || download.status}`)
  }
  assert(fileSha(archive) === release.archiveSha256, 'fixed Bun release ZIP SHA-256 differs from official release metadata')
  if (!existsSync(bun)) {
    const unpack = spawnSync('unzip', ['-q', archive, '-d', toolchain], { encoding: 'utf8' })
    assert(unpack.status === 0, `fixed Bun ZIP extraction failed: ${unpack.stderr?.trim() || unpack.error?.message || unpack.status}`)
  }
  assert(fileSha(bun) === release.binarySha256, 'fixed Bun executable SHA-256 differs from the verified ZIP')
  const version = spawnSync(bun, ['--version'], { encoding: 'utf8' })
  assert(version.status === 0 && version.stdout.trim() === '1.3.14', 'private Bun executable is not version 1.3.14')
}

function link(path, target) {
  mkdirSync(join(path, '..'), { recursive: true })
  symlinkSync(target, path, 'dir')
}

function isolatedSource() {
  assert(existsSync(source), 'read-only source snapshot is missing')
  const isolated = mkdtempSync(join(root, '.migration/source-domain-bun-'))
  for (const name of ['linguist-cat-core', 'linguist-cat-formats']) {
    const from = join(source, 'packages', name)
    const target = join(root, 'packages', name)
    assert(JSON.stringify(JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')).dependencies) === JSON.stringify(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).dependencies), `${name} source/target dependency declarations differ; shared installed dependencies cannot establish a fair baseline`)
    cpSync(from, join(isolated, 'packages', name), { recursive: true })
  }
  cpSync(join(source, 'tests/linguist-fixtures'), join(isolated, 'tests/linguist-fixtures'), { recursive: true })
  writeFileSync(join(isolated, 'package.json'), '{"private":true,"type":"module","workspaces":["packages/*"]}\n')
  const coreModules = join(isolated, 'packages/linguist-cat-core/node_modules')
  const formatModules = join(isolated, 'packages/linguist-cat-formats/node_modules')
  link(join(coreModules, '@formatjs/icu-messageformat-parser'), realpathSync(join(root, 'packages/linguist-cat-core/node_modules/@formatjs/icu-messageformat-parser')))
  link(join(formatModules, '@linguist/cat-core'), join(isolated, 'packages/linguist-cat-core'))
  for (const name of ['@xmldom/xmldom', 'jszip']) link(join(formatModules, name), realpathSync(join(root, 'packages/linguist-cat-formats/node_modules', name)))
  return isolated
}

function run(label, cwd) {
  const result = spawnSync(bun, ['test', ...tests], { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000 })
  const log = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\nrunner error: ${result.error.message}\n` : ''}`
  const logPath = join(evidence, `copied-domain-${label}.log`)
  atomic(logPath, log)
  const count = pattern => Number([...log.matchAll(pattern)].at(-1)?.[1] ?? 0)
  const passed = count(/\b(\d+) pass\b/g)
  const failed = count(/\b(\d+) fail\b/g)
  const skipped = count(/\b(\d+) skip\b/g)
  const receipt = {
    scope: label, command: '.toolchain/bun-1.3.14/bun-darwin-aarch64/bun test <15 explicit test files>',
    cwd, exitCode: result.status ?? 1, status: result.status === 0 && passed > 0 && failed === 0 && skipped === 0 ? 'PASS' : 'FAILED',
    passed, failed, skipped, logPath, logSha256: sha(log),
    files: tests.map(path => ({ path, sha256: fileSha(join(cwd, path)) })),
  }
  process.stdout.write(`${label}: ${receipt.status}; ${passed} pass, ${failed} fail, ${skipped} skip; ${logPath}\n`)
  return receipt
}

mkdirSync(evidence, { recursive: true })
try {
  assert(process.platform === 'darwin' && process.arch === 'arm64', 'fixed Bun artifact is macOS arm64 only')
  ensureBun()
  assert(tests.length === 15 && tests.every(path => existsSync(join(root, path)) && existsSync(join(source, path))), 'the 15 source/target test files are incomplete')
  const isolated = isolatedSource()
  const sourceBaseline = run('source-baseline', isolated)
  const target = run('target', root)
  const receipt = {
    schemaVersion: 1, generatedBy: 'scripts/test-copied-domain.mjs', evaluatedAt: new Date().toISOString(),
    release, archivePath: archive, binaryPath: bun, binarySha256: fileSha(bun),
    sourceSnapshot: source, isolatedSource: isolated, sourceBaselineDependencies: 'target node_modules with identical source/target package dependency declarations', sourceBaseline, target,
    status: sourceBaseline.status === 'PASS' && target.status === 'PASS' ? 'PASS' : 'FAILED',
  }
  const path = join(evidence, 'copied-domain-tests.json')
  atomic(path, `${JSON.stringify(receipt, null, 2)}\n`)
  process.stdout.write(`${receipt.status}: ${path}\n`)
  if (receipt.status !== 'PASS') process.exitCode = 1
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error)
  atomic(join(evidence, 'copied-domain-tests.json'), `${JSON.stringify({ schemaVersion: 1, generatedBy: 'scripts/test-copied-domain.mjs', evaluatedAt: new Date().toISOString(), status: 'FAILED', detail }, null, 2)}\n`)
  process.stderr.write(`FAILED: ${detail}\n`)
  process.exitCode = 1
}
