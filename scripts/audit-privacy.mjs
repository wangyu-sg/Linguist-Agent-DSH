import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifestPath = join(root, '.migration/source-snapshot-manifest.json')
const currentPath = join(homedir(), 'Library/Application Support/Linguist-Agent-DSH/current.json')
const providerPath = join(root, 'artifacts/evidence/provider-observation.json')
const reportPath = join(root, 'artifacts/evidence/privacy-readonly.json')
const logPath = join(root, 'artifacts/evidence/privacy-readonly.log')
const fixtureNames = ['mini_game_ui.xliff', 'placeholder_cases.xliff', 'sample.mqxliff']
const oldPaths = [
  '/Applications/Linguist Agent.app',
  join(homedir(), 'Library/Application Support/com.linguistagent.app'),
  join(homedir(), 'Library/Application Support/com.linguistagent.app-data'),
  join(homedir(), 'Library/Application Support/com.linguistagent.app.dev'),
  join(homedir(), 'Library/Application Support/@proma'),
  join(homedir(), '.dsh'),
]
const sha = value => createHash('sha256').update(value).digest('hex')
const fileSha = path => sha(readFileSync(path))
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const inside = (path, parent) => path === parent || path.startsWith(`${parent}${sep}`)

function record(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, content)
  renameSync(temporary, path)
}

const checks = []
function check(id, inspect) {
  try {
    checks.push({ id, outcome: 'pass', ...inspect() })
  } catch (error) {
    checks.push({ id, outcome: 'fail', detail: error instanceof Error ? error.message : String(error) })
  }
}
const requireFact = (condition, message) => { if (!condition) throw new Error(message) }

const manifest = readJson(manifestPath)
const current = readJson(currentPath)
const snapshot = resolve(root, manifest.snapshotPath)
const source = resolve(manifest.sourcePath)

check('source-manifested-files', () => {
  requireFact(manifest.schemaVersion === 1 && manifest.files.length === manifest.snapshotFileCount, 'source manifest count differs from its file list')
  const mismatches = []
  for (const item of manifest.files) {
    for (const [label, base] of [['source', source], ['snapshot', snapshot]]) {
      const path = join(base, item.path)
      if (!existsSync(path) || statSync(path).size !== item.bytes || fileSha(path) !== item.sha256) mismatches.push(`${label}:${item.path}`)
    }
  }
  requireFact(mismatches.length === 0, `${mismatches.length} manifested source/snapshot files differ: ${mismatches.slice(0, 12).join(', ')}`)
  return { detail: `${manifest.files.length} manifested repository files match both read-only source and isolated snapshot by size and SHA-256`, verifiedCount: manifest.files.length, manifestSha256: fileSha(manifestPath), excludedPathsNotRead: manifest.excluded.map(item => item.path) }
})

check('product-path-isolation', () => {
  const dataRoot = realpathSync(current.dataRoot)
  const home = realpathSync(current.home)
  const userData = realpathSync(current.desktopUserDataDir)
  requireFact(current.profile === 'desktop' && current.dataRoot === join(homedir(), 'Library/Application Support/Linguist-Agent-DSH'), 'current product is not the reserved isolated Desktop carrier')
  requireFact(inside(home, dataRoot) && inside(userData, dataRoot) && current.home !== join(homedir(), '.dsh'), 'Desktop home or Chromium user data is outside the product data root')
  requireFact(current.appPath !== '/Applications/Linguist Agent.app' && current.desktopArtifact.appPath !== '/Applications/Linguist Agent.app', 'product launcher or official app reuses the old LA app')
  const observed = oldPaths.map(path => ({ path, exists: existsSync(path) }))
  for (const old of observed.filter(item => item.exists)) {
    const resolved = realpathSync(old.path)
    requireFact(!inside(dataRoot, resolved) && !inside(resolved, dataRoot), `new product root overlaps old path: ${old.path}`)
  }
  return { detail: 'current Desktop home, Chromium data and app paths are separate from observed old LA/Proma and default DSH roots', dataRoot, home, userData, oldPathMetadataOnly: observed }
})

check('three-copied-fixtures', () => {
  const fileHashes = fixtureNames.map(name => {
    const relative = `tests/linguist-fixtures/${name}`
    const expected = manifest.files.find(item => item.path === relative)
    requireFact(expected, `source manifest has no provenance for ${relative}`)
    const target = join(root, relative)
    requireFact(existsSync(target) && fileSha(target) === expected.sha256, `copied fixture differs from read-only source snapshot: ${relative}`)
    return { path: relative, sha256: expected.sha256 }
  })
  const attributionPath = join(snapshot, 'docs/attribution/SOURCE_PROVENANCE.md')
  const attribution = readFileSync(attributionPath, 'utf8')
  requireFact(attribution.includes('sample.mqxliff') && attribution.includes('合成 fixture'), 'source attribution does not identify the memoQ fixture as synthetic')
  const testHeader = readFileSync(join(snapshot, 'packages/linguist-cat-formats/src/adapters/xliff.test.ts'), 'utf8').slice(0, 500)
  requireFact(testHeader.includes('Synthetic fixtures only') && testHeader.includes('mini_game_ui.xliff'), 'source test does not declare the XLIFF fixtures synthetic')
  return { detail: 'three copied CAT fixtures are byte-identical to manifested source fixtures; source test/attribution documents declare them synthetic', files: fileHashes, sourceDeclarationPaths: ['packages/linguist-cat-formats/src/adapters/xliff.test.ts', 'docs/attribution/SOURCE_PROVENANCE.md'] }
})

check('selected-provider-trace-scope', () => {
  const provider = readJson(providerPath)
  requireFact(provider.installationId === current.installationId && provider.synthetic === true && provider.mock === false, 'selected Provider observation is not bound to this synthetic product installation')
  requireFact(provider.sessionId && typeof provider.sourceLog === 'string' && existsSync(provider.sourceLog), 'selected Provider observation has no existing session log')
  requireFact(inside(resolve(provider.sourceLog), join(current.home, 'sessions')) && provider.sourceLog.includes(provider.sessionId), 'selected Provider log path is outside this product session store')
  return { detail: 'the selected synthetic Provider observation points to a session log inside the isolated product home; log payload was not opened', observationPath: providerPath, observationSha256: fileSha(providerPath), sessionId: provider.sessionId, sourceLogPath: provider.sourceLog }
})

check('extra-logging-config', () => {
  const patchPath = join(current.home, 'cordis.patch.yml')
  const patch = readFileSync(patchPath, 'utf8')
  for (const id of ['session-log-deepseek', 'session-telemetry-otel']) {
    requireFact(new RegExp(`^- id: ${id}\\n  disabled: true$`, 'm').test(patch), `${id} is not disabled in the isolated Desktop home patch`)
  }
  return { detail: 'isolated Desktop home patch declares both extra session logging and OTel telemetry disabled; effective runtime logging was not inspected', patchPath, patchSha256: fileSha(patchPath) }
})

checks.push({ id: 'old-path-historical-writes', outcome: 'unverified', detail: 'no pre-migration content manifest or complete filesystem write log exists for the old LA/Proma directories; only path separation was checked, and their contents were not opened' })
checks.push({ id: 'global-customer-log-absence', outcome: 'unverified', detail: 'a selected synthetic session log and disabled extra logger configuration cannot prove that no customer content was written anywhere; customer logs and model payloads were not read' })
checks.push({ id: 'remote-publication-absence', outcome: 'unverified', detail: 'this read-only local audit does not establish a complete network or remote publication history' })

const status = checks.some(item => item.outcome === 'fail') ? 'FAILED' : 'PARTIAL'
const log = [
  `read-only privacy audit ${new Date().toISOString()} status=${status}`,
  ...checks.map(item => `${item.id} ${item.outcome}: ${item.detail}`),
].join('\n') + '\n'
record(logPath, log)
const report = { schemaVersion: 1, generatedBy: 'scripts/audit-privacy.mjs', evaluatedAt: new Date().toISOString(), status, currentSha256: fileSha(currentPath), installationId: current.installationId, checks, logPath, logSha256: sha(log) }
record(reportPath, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`${status}: ${checks.filter(item => item.outcome === 'pass').length} scoped checks passed; ${checks.filter(item => item.outcome === 'unverified').length} remain unverified; ${reportPath}\n`)
process.exitCode = status === 'FAILED' ? 1 : 2
