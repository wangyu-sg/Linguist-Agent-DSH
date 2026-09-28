import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { classifyReceipt } from '../../scripts/notify.mjs'
import { runInstalledSmoke } from '../../scripts/smoke-installed.mjs'

const now = Date.parse('2026-09-28T15:00:00.000Z')
const pack = { dshVersion: '0.1.7-rc.2', linguist: { sha256: 'a'.repeat(64) }, browserSkill: { sha256: 'b'.repeat(64) } }
const desktopArtifact = { path: '/synthetic/official.dmg', sha256: '2'.repeat(64), appPath: '/synthetic/DeepSeek Harness.app', bundleId: 'synthetic.official.desktop', version: '0.1.7-rc.2', teamId: 'SYNTHETIC' }
const current = { installationId: 'synthetic-install', dshVersion: desktopArtifact.version, profile: 'desktop', home: '/synthetic/desktop-home', dataRoot: '/synthetic', desktopUserDataDir: '/synthetic/electron', appPath: '/synthetic/Desktop/Linguist Agent DSH.app', desktopArtifact }
const receipt = {
  schemaVersion: 1, status: 'READY', evaluatedAt: new Date(now).toISOString(),
  currentSha256: 'c'.repeat(64), packSha256: 'd'.repeat(64),
  acceptanceSha256: 'f'.repeat(64), smokeSha256: '1'.repeat(64),
  installed: { installationId: current.installationId, dshVersion: current.dshVersion, desktopProfile: 'desktop', desktopArtifactSha256: desktopArtifact.sha256, pluginHash: pack.linguist.sha256, browserSkill: { plugin: pack.browserSkill.sha256 }, desktopArtifact },
  targetCodeIdentity: { treeHash: 'e'.repeat(64) },
  gates: [...Array.from({ length: 12 }, (_, index) => ({ id: `G${String(index + 1).padStart(2, '0')}`, outcome: 'pass' })), { id: 'V30', outcome: 'pass' }],
  blockers: [], customerDataTouched: false, remotePublished: false, launch: { appPath: current.appPath, url: 'dsh-app://app/', dataRoot: current.dataRoot, reopenVerified: true },
}
const input = {
  receipt, current, pack, currentSha256: receipt.currentSha256, packSha256: receipt.packSha256,
  installedTarballHashes: { linguist: pack.linguist.sha256, browserSkill: pack.browserSkill.sha256 },
  desktopArtifactSha256: desktopArtifact.sha256,
  codeTreeHash: receipt.targetCodeIdentity.treeHash, acceptanceSha256: receipt.acceptanceSha256, smokeSha256: receipt.smokeSha256, now,
}

test('success notification requires the matching current receipt and every mandatory gate', () => {
  assert.equal(classifyReceipt(input).status, 'READY')
  assert.equal(classifyReceipt({ ...input, receipt: { ...receipt, gates: receipt.gates.slice(1) } }).status, 'FAILED')
  assert.equal(classifyReceipt({ ...input, receipt: { ...receipt, gates: receipt.gates.filter(item => item.id !== 'V30') } }).status, 'FAILED')
  assert.equal(classifyReceipt({ ...input, receipt: { ...receipt, gates: receipt.gates.map(item => item.id === 'G08' ? { ...item, outcome: 'blocked' } : item) } }).status, 'FAILED')
  assert.equal(classifyReceipt({ ...input, receipt: { ...receipt, blockers: [{ code: 'G07', detail: 'missing Provider' }] } }).status, 'FAILED')
  assert.equal(classifyReceipt({ ...input, installedTarballHashes: { ...input.installedTarballHashes, linguist: 'f'.repeat(64) } }).status, 'FAILED')
  assert.equal(classifyReceipt({ ...input, current: { ...current, profile: 'web' } }).status, 'FAILED')
  assert.equal(classifyReceipt({ ...input, pack: { ...pack, dshVersion: '0.1.7-rc.1' } }).status, 'FAILED')
  assert.equal(classifyReceipt({ ...input, receipt: { ...receipt, installed: { ...receipt.installed, desktopProfile: 'web' } } }).status, 'FAILED')
  assert.equal(classifyReceipt({ ...input, desktopArtifactSha256: '0'.repeat(64) }).status, 'FAILED')
  assert.equal(classifyReceipt({ ...input, receipt: { ...receipt, launch: { ...receipt.launch, appPath: desktopArtifact.appPath } } }).status, 'FAILED')
  assert.equal(classifyReceipt({ ...input, receipt: { ...receipt, launch: { ...receipt.launch, url: 'http://127.0.0.1:39080/' } } }).status, 'FAILED')
  assert.equal(classifyReceipt({ ...input, currentSha256: 'f'.repeat(64) }).status, 'FAILED')
  assert.equal(classifyReceipt({ ...input, acceptanceSha256: '0'.repeat(64) }).status, 'FAILED')
  assert.equal(classifyReceipt({ ...input, smokeSha256: '0'.repeat(64) }).status, 'FAILED')
  assert.equal(classifyReceipt({ ...input, now: now + 16 * 60_000 }).status, 'FAILED')
})

test('blocked environment receipt never becomes a success notification', () => {
  const blocked = { ...receipt, status: 'BLOCKED_ENV', gates: receipt.gates.map(item => item.id === 'G08' ? { ...item, outcome: 'blocked' } : item), blockers: [{ code: 'G08', detail: 'extension is disconnected' }] }
  assert.equal(classifyReceipt({ ...input, receipt: blocked }).status, 'BLOCKED_ENV')
})

test('installed smoke rejects missing or Web carrier installations without fabricating Desktop evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'la-dsh-smoke-test-'))
  try {
    const outputFile = join(dir, 'installed-smoke.json')
    const result = await runInstalledSmoke({ currentFile: join(dir, 'missing-current.json'), outputFile, root: dir })
    assert.equal(result.status, 'FAILED')
    assert.deepEqual(result.checks.find(item => item.id === 'current')?.outcome, 'fail')
    const webCurrent = join(dir, 'web-current.json')
    writeFileSync(webCurrent, JSON.stringify({ ...current, profile: 'web' }))
    const webResult = await runInstalledSmoke({ currentFile: webCurrent, outputFile, root: dir })
    assert.equal(webResult.status, 'FAILED')
    assert.match(webResult.checks.find(item => item.id === 'current')?.detail, /official DSH Desktop/)
    assert.equal(webResult.checks.some(item => item.id === 'http'), false)
    assert.equal(JSON.parse(readFileSync(outputFile, 'utf8')).status, 'FAILED')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
