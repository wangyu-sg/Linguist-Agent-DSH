import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { classifyReceipt } from '../../scripts/notify.mjs'
import { runInstalledSmoke } from '../../scripts/smoke-installed.mjs'
import { privatePushProof } from '../../scripts/verify-ready.mjs'
import { validateUiEvidence } from '../../scripts/test-ui.mjs'

const now = Date.parse('2026-09-28T15:00:00.000Z')
const pack = { dshVersion: '0.2.0-rc.1', linguist: { sha256: 'a'.repeat(64) }, browserSkill: { sha256: 'b'.repeat(64) } }
const desktopArtifact = { path: '/synthetic/official.dmg', sha256: '2'.repeat(64), appPath: '/synthetic/DeepSeek Harness.app', bundleId: 'synthetic.official.desktop', version: '0.2.0-rc.1', teamId: 'SYNTHETIC' }
const current = { installationId: 'synthetic-install', dshVersion: desktopArtifact.version, profile: 'desktop', home: '/synthetic/.dsh', dataRoot: '/synthetic', desktopUserDataDir: '/synthetic/electron', appPath: desktopArtifact.appPath, desktopArtifact }
const receipt = {
  schemaVersion: 1, status: 'READY', evaluatedAt: new Date(now).toISOString(),
  currentSha256: 'c'.repeat(64), packSha256: 'd'.repeat(64),
  acceptanceSha256: 'f'.repeat(64), smokeSha256: '1'.repeat(64),
  installed: { installationId: current.installationId, dshVersion: current.dshVersion, desktopProfile: 'desktop', desktopArtifactSha256: desktopArtifact.sha256, pluginHash: pack.linguist.sha256, browserSkill: { plugin: pack.browserSkill.sha256 }, desktopArtifact },
  targetCodeIdentity: { treeHash: 'e'.repeat(64) },
  gates: [...Array.from({ length: 13 }, (_, index) => ({ id: `G${String(index + 1).padStart(2, '0')}`, outcome: 'pass' })), { id: 'V30', outcome: 'pass' }],
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
  assert.equal(classifyReceipt({ ...input, receipt: { ...receipt, launch: { ...receipt.launch, appPath: '/synthetic/wrong.app' } } }).status, 'FAILED')
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

test('authorized private push requires hashed evidence of the exact repository and current local/remote commit', () => {
  const dir = mkdtempSync(new URL('../../artifacts/evidence/private-push-test-', import.meta.url))
  const commit = '3'.repeat(40)
  const authorization = { repository: 'https://github.com/wangyu-sg/Linguist-Agent-DSH', visibility: 'private', userAuthorized: true }
  const pushed = { schemaVersion: 1, status: 'PUSHED', repository: authorization.repository, visibility: 'private', pushExitCode: 0, localCommit: commit, remoteCommit: commit }
  const path = join(dir, 'push.json')
  const proofFor = value => {
    writeFileSync(path, JSON.stringify(value))
    return { receiptPath: path, receiptSha256: createHash('sha256').update(readFileSync(path)).digest('hex') }
  }
  try {
    const proof = proofFor(pushed)
    const published = { ...receipt, remotePublished: true, remotePushAuthorization: authorization, privatePush: proof, targetCodeIdentity: { ...receipt.targetCodeIdentity, commit } }
    const check = extra => classifyReceipt({ ...input, codeCommit: commit, receipt: published, ...extra })
    assert.deepEqual(privatePushProof(false, undefined, undefined, undefined), [])
    assert.deepEqual(privatePushProof(true, authorization, proof, commit), [path])
    assert.equal(check().status, 'READY')
    assert.equal(check({ receipt: { ...published, status: 'BLOCKED_ENV', blockers: [{ code: 'G08', detail: 'extension missing' }] } }).status, 'BLOCKED_ENV')
    assert.equal(check({ receipt: { ...published, customerDataTouched: true } }).status, 'FAILED')
    assert.equal(check({ receipt: { ...published, gates: receipt.gates.map(gate => gate.id === 'G09' ? { ...gate, outcome: 'fail' } : gate) } }).status, 'FAILED')
    assert.equal(check({ receipt: { ...published, remotePushAuthorization: { ...authorization, userAuthorized: false } } }).status, 'FAILED')
    assert.equal(check({ receipt: { ...published, targetCodeIdentity: { ...published.targetCodeIdentity, commit: '4'.repeat(40) } } }).status, 'FAILED')
    assert.equal(check({ codeCommit: undefined }).status, 'FAILED')
    assert.equal(check({ codeCommit: '4'.repeat(40) }).status, 'FAILED')
    for (const change of [{ visibility: 'public' }, { repository: 'https://github.com/wangyu-sg/another-repo' }, { localCommit: '4'.repeat(40) }, { remoteCommit: '4'.repeat(40) }, { pushExitCode: 1 }, { status: 'CREATED' }]) {
      const invalid = proofFor({ ...pushed, ...change })
      assert.throws(() => privatePushProof(true, authorization, invalid, commit))
      assert.equal(check({ receipt: { ...published, privatePush: invalid } }).status, 'FAILED')
    }
    const valid = proofFor(pushed)
    writeFileSync(path, JSON.stringify({ ...pushed, visibility: 'public' }))
    assert.throws(() => privatePushProof(true, authorization, valid, commit), /hash changed/)
    assert.equal(check({ receipt: { ...published, privatePush: valid } }).status, 'FAILED')
  } finally { rmSync(dir, { recursive: true, force: true }) }
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

test('UI evidence keeps CUA actions separate from authorized macOS screenshot capture', () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-ui-evidence-test-'))
  const evidence = join(root, 'artifacts/evidence')
  mkdirSync(evidence, { recursive: true })
  const currentPath = join(root, 'synthetic-current.json')
  const current = { installationId: 'synthetic-ui', profile: 'desktop', dshVersion: 'synthetic-rc2', desktopArtifact: { sha256: 'd'.repeat(64) }, plugins: { linguist: { sha256: 'a'.repeat(64) }, browserSkill: { sha256: 'b'.repeat(64) } } }
  const pack = { dshVersion: current.dshVersion, createdAt: '2026-01-01T00:00:00Z', ...current.plugins }
  const fileSha = path => createHash('sha256').update(readFileSync(path)).digest('hex')
  writeFileSync(currentPath, JSON.stringify(current))
  writeFileSync(join(root, 'artifacts/pack.json'), JSON.stringify(pack))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGekAAAAASUVORK5CYII=', 'base64')
  const views = ['projects', 'cat', 'qa', 'proposal', 'references', 'conflict', 'browser', 'settings']
  const ids = ['ime', 'emoji-combining', 'tag-atomic', 'locked-segment', 'line-break', 'undo-redo', 'shortcut', 'virtual-scroll', 'side-by-side', 'fullscreen', 'floating', 'two-projects', 'light-theme', 'dark-theme', 'narrow-window', 'keyboard-navigation', 'no-zombie-slot']
  const raw = {
    schemaVersion: 1, generatedBy: 'mcp__cua_repl', installationId: current.installationId,
    currentSha256: fileSha(currentPath), desktopArtifactSha256: current.desktopArtifact.sha256,
    pluginHashes: { linguist: pack.linguist.sha256, browserSkill: pack.browserSkill.sha256 },
    url: 'dsh-app://app/', capturedAt: new Date().toISOString(), actionTracePath: 'artifacts/evidence/trace.json',
    screenshots: views.map((view, i) => {
      const path = `artifacts/evidence/${view}.png`
      writeFileSync(join(root, path), png)
      return { path, sha256: fileSha(join(root, path)), view, theme: i ? 'light' : 'dark', widthMode: i ? 'normal' : 'narrow', ...(i === 0 ? { capturedBy: 'macos-screencapture' } : {}) }
    }),
    actions: ids.map(id => ({ id, result: 'observed', detail: 'Synthetic validator fixture; not installed UI evidence', at: new Date().toISOString() })),
  }
  const trace = { source: 'mcp__cua_repl', installationId: raw.installationId, url: raw.url, screenshots: raw.screenshots, actions: raw.actions }
  const check = (index = raw, actions = trace) => {
    writeFileSync(join(root, raw.actionTracePath), JSON.stringify(actions))
    writeFileSync(join(evidence, 'ui-cua.json'), JSON.stringify({ ...index, actionTraceSha256: fileSha(join(root, raw.actionTracePath)) }))
    return validateUiEvidence({ root, currentPath })
  }
  try {
    const report = check()
    assert.equal(report.status, 'PASS')
    assert.equal(report.ui.actionsPerformedBy, 'mcp__cua_repl')
    assert.equal(report.ui.screenshots[0].capturedBy, 'macos-screencapture')
    assert.equal(report.ui.screenshots[1].capturedBy, 'mcp__cua_repl')
    assert.match(readFileSync(join(evidence, 'ui-validation.log'), 'utf8'), /screenshot source=macos-screencapture/)
    assert.throws(() => check({ ...raw, generatedBy: 'macos-screencapture' }), /UI actions must identify/)
    assert.throws(() => check({ ...raw, actions: raw.actions.map((action, i) => i ? action : { ...action, performedBy: 'macos-screencapture' }) }), /must be performed by mcp__cua_repl/)
    assert.throws(() => check({ ...raw, screenshots: raw.screenshots.map((item, i) => i ? item : { ...item, capturedBy: 'html-render' }) }), /source is unsupported/)
    assert.throws(() => check(raw, { ...trace, screenshots: [] }), /omits screenshot source or path/)
    assert.throws(() => check({ ...raw, installationId: 'another-install' }), /another installation/)
    assert.throws(() => check({ ...raw, pluginHashes: { ...raw.pluginHashes, linguist: '0'.repeat(64) } }), /differs from installed package/)
    assert.throws(() => check({ ...raw, screenshots: raw.screenshots.map((item, i) => i ? item : { ...item, sha256: '0'.repeat(64) }) }), /hash or freshness/)
    assert.throws(() => check({ ...raw, actions: raw.actions.slice(1) }), /was not observed/)
    assert.throws(() => check(raw, { ...trace, actions: [] }), /action trace omits ime/)
    const firstPng = join(root, raw.screenshots[0].path)
    utimesSync(firstPng, 1, 1)
    assert.throws(() => check(), /hash or freshness/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
