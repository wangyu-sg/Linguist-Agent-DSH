import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentPath, productRoot, runInstalledSmoke, smokePath } from './smoke-installed.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const evidenceRoot = join(root, 'artifacts/evidence')
const acceptancePath = join(evidenceRoot, 'acceptance.json')
export const readyPath = join(root, 'artifacts/READY.json')

const sha = value => createHash('sha256').update(value).digest('hex')
const fileSha = path => sha(readFileSync(path))
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const assert = (condition, detail) => { if (!condition) throw new Error(detail) }
class ExternalPrerequisiteError extends Error {}
const pathIn = (path, parent) => resolve(path) === resolve(parent) || resolve(path).startsWith(`${resolve(parent)}${sep}`)
const proofPath = path => resolve(root, path)

function readSessionEvents(logPath) {
  const bun = join(root, '.toolchain/bun-1.3.14/bun-darwin-aarch64/bun')
  const code = `const bytes = await Bun.file(process.argv[1]).arrayBuffer()
    const text = new TextDecoder().decode(Bun.zstdDecompressSync(new Uint8Array(bytes)))
    console.log(JSON.stringify(text.trim().split('\\n').map(JSON.parse)))`
  return JSON.parse(execFileSync(bun, ['-e', code, logPath], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }))
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, path)
}

function sourceFiles(dir, files = []) {
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'lib', 'dist', '.scratch'].includes(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(path, files)
    else if (entry.isFile() && !/\.(?:nodetest|test|spec)\.[cm]?[jt]sx?$/.test(path)) files.push(path)
  }
  return files
}

export function targetCodeIdentity() {
  const runtimePaths = [
    ...sourceFiles(join(root, 'packages')),
    ...sourceFiles(join(root, 'integrations/browser-skill/patches')),
    join(root, 'integrations/browser-skill/BASELINE.json'),
    join(root, 'integrations/browser-skill/pnpm-lock.yaml'),
    join(root, 'integrations/browser-skill/build-adapted-plugin.mjs'),
    join(root, 'scripts/build.mjs'), join(root, 'scripts/pack.mjs'),
    join(root, 'package.json'), join(root, 'pnpm-lock.yaml'), join(root, 'pnpm-workspace.yaml'),
  ].filter(existsSync).sort()
  const paths = [...new Set([...runtimePaths, ...sourceFiles(join(root, 'scripts'))])].sort()
  const hash = createHash('sha256')
  for (const path of paths) hash.update(`${path.slice(root.length)}\0${fileSha(path)}\n`)
  let commit
  let dirty = true
  let gitStatus = 'unavailable'
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().length > 0
    gitStatus = 'checked'
  } catch { /* Xcode Git may be unavailable; true is the conservative dirty state. */ }
  return { ...(commit ? { commit } : {}), treeHash: hash.digest('hex'), dirty, gitStatus, latestRuntimeInputAt: Math.max(...runtimePaths.map(path => statSync(path).mtimeMs)) }
}

function checkFileProof(path, expectedSha) {
  assert(typeof path === 'string' && path.length > 0 && typeof expectedSha === 'string' && /^[a-f0-9]{64}$/.test(expectedSha), 'evidence path or SHA-256 is missing')
  const resolved = proofPath(path)
  assert(pathIn(resolved, evidenceRoot) || pathIn(resolved, join(productRoot, 'receipts')), `evidence lies outside receipts: ${path}`)
  assert(existsSync(resolved), `evidence file missing: ${path}`)
  assert(fileSha(resolved) === expectedSha, `evidence file hash changed: ${path}`)
  return resolved
}

function boundAcceptance(acceptance, current, pack) {
  assert(current.profile === 'desktop' && current.desktopUserDataDir && current.desktopArtifact?.sha256 && current.desktopArtifact?.path && current.desktopArtifact?.appPath, 'official DSH Desktop carrier and reserved desktop profile are required')
  assert(current.dshVersion === pack.dshVersion && current.desktopArtifact.version === current.dshVersion, 'official Desktop version differs from pinned DSH pack')
  assert(current.appPath === '/Applications/DeepSeek Harness.app' && current.appPath === current.desktopArtifact.appPath, 'official Desktop application identity is incomplete')
  assert(acceptance?.schemaVersion === 1, 'acceptance index is missing or has an invalid schema')
  assert(acceptance.installationId === current.installationId, 'acceptance belongs to a different installation')
  assert(acceptance.desktopArtifactSha256 === current.desktopArtifact.sha256, 'acceptance belongs to a different official Desktop artifact')
  assert(acceptance.currentSha256 === fileSha(currentPath), 'acceptance belongs to an older current.json')
  assert(acceptance.pluginHashes?.linguist === pack.linguist.sha256 && acceptance.pluginHashes?.browserSkill === pack.browserSkill.sha256, 'acceptance plugin hashes differ from the installed pack')
  assert(Date.parse(acceptance.generatedAt) >= Date.parse(pack.createdAt), 'acceptance predates the current pack')
}

function runsFor(acceptance, current, pack, ids) {
  const paths = []
  for (const id of ids) {
    const run = acceptance.testRuns?.find(item => item.id === id || item.ids?.includes(id))
    assert(run, `${id} has no executed test-run evidence`)
    assert(typeof run.command === 'string' && run.command.trim() && run.exitCode === 0 && Number.isInteger(run.passed) && run.passed > 0 && run.skipped === 0, `${id} runner did not pass with zero skips`)
    assert(run.installationId === current.installationId && run.pluginHashes?.linguist === pack.linguist.sha256 && run.pluginHashes?.browserSkill === pack.browserSkill.sha256, `${id} runner identity differs from the installation`)
    const path = checkFileProof(run.logPath, run.logSha256)
    assert(statSync(path).mtimeMs >= Date.parse(pack.createdAt), `${id} test log predates the current pack`)
    paths.push(path)
  }
  return [...new Set(paths)]
}

function mappedFeatures(map) {
  assert(map.sourceInventory?.fileCount === map.sourceInventory?.files?.length, 'source inventory is incomplete')
  assert(map.sourceInventory.files.length >= 300, 'source inventory unexpectedly shrank')
  for (const item of map.sourceInventory.files) {
    assert(['complete', 'host-replaced', 'excluded'].includes(item.status), `source inventory ${item.sourcePath} is ${item.status}`)
    if (item.status === 'complete') assert(item.targetPath && existsSync(join(root, item.targetPath)), `source inventory target missing: ${item.sourcePath}`)
    else assert(item.reason && item.evidencePaths?.length, `source inventory replacement lacks reason/evidence: ${item.sourcePath}`)
  }
  for (const item of [...map.featureSurfaces, ...map.tools]) {
    if (!item.required) continue
    assert(item.status === 'complete', `${item.id} remains ${item.status}`)
    assert(item.targetEntry && existsSync(join(root, item.targetEntry)), `${item.id} target entry is missing`)
    assert(item.evidencePaths?.length, `${item.id} lacks execution evidence`)
    for (const path of item.evidencePaths) assert(existsSync(proofPath(path)), `${item.id} evidence is missing: ${path}`)
  }
  return [join(root, 'docs/migration/FEATURE_MAP.json')]
}

function validationMap(map) {
  for (const item of map.validationFamilies.filter(item => item.required)) {
    assert(item.status === 'complete', `${item.id} validation remains ${item.status}`)
    assert(item.evidencePaths?.length, `${item.id} validation has no evidence`)
    for (const path of item.evidencePaths) assert(existsSync(proofPath(path)), `${item.id} evidence is missing: ${path}`)
  }
  return [join(root, 'docs/migration/FEATURE_MAP.json')]
}

/** Source capabilities and UI actions must each appear in current installed acceptance. */
export function requireCapabilityCoverage(domain, ui, observations) {
  const excluded = new Set(['source-unwired-not-current-requirement', 'host-specific-excluded-from-la-domain'])
  const required = new Set([...domain.features.map(item => item.id), ...ui.actions.filter(item => !excluded.has(item.implementationStatus)).map(item => item.id)])
  assert(Array.isArray(observations), 'per-capability installed acceptance is missing')
  const covered = new Set()
  const blocked = []
  for (const observation of observations) {
    assert((observation.result === 'passed' || observation.result === 'BLOCKED_ENV' && observation.prerequisite?.trim()) && observation.detail?.trim() && observation.featureIds?.length, 'capability observation lacks a passed result or an explicit external prerequisite, detail or feature IDs')
    for (const id of observation.featureIds) {
      assert(required.has(id), `unknown or excluded capability in acceptance: ${id}`)
      covered.add(id)
    }
    if (observation.result === 'BLOCKED_ENV') blocked.push(`${observation.featureIds.join(', ')}: ${observation.prerequisite}`)
  }
  const missing = [...required].filter(id => !covered.has(id))
  assert(missing.length === 0, `capabilities without installed acceptance: ${missing.join(', ')}`)
  if (blocked.length) throw new ExternalPrerequisiteError(blocked.join('; '))
}

function traceContains(path, values, label) {
  const text = readFileSync(path, 'utf8')
  for (const value of values) assert(text.includes(value), `${label} trace omits observed ${value}`)
}

function uiProof(acceptance, current) {
  const ui = acceptance.ui
  assert(ui?.installationId === current.installationId && ui.url === 'dsh-app://app/', 'UI evidence is not from the installed official Desktop app')
  const required = ['projects', 'cat', 'qa', 'proposal', 'references', 'conflict', 'browser', 'settings']
  for (const view of required) assert(ui.views?.includes(view), `installed UI view ${view} was not exercised`)
  assert(ui.themes?.includes('light') && ui.themes?.includes('dark') && ui.widths?.includes('narrow'), 'installed UI theme or narrow layout was not exercised')
  assert(ui.screenshots?.length >= required.length, 'installed UI screenshots are incomplete')
  const paths = ui.screenshots.map(item => {
    const path = checkFileProof(item.path, item.sha256)
    const png = readFileSync(path)
    assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `UI screenshot is not a PNG: ${item.path}`)
    assert(item.width === png.readUInt32BE(16) && item.height === png.readUInt32BE(20) && item.width > 0 && item.height > 0, `UI screenshot dimensions differ from PNG bytes: ${item.path}`)
    return path
  })
  const trace = checkFileProof(ui.actionTracePath, ui.actionTraceSha256)
  traceContains(trace, [current.installationId, 'dsh-app://app/'], 'UI action')
  return [...paths, trace]
}

function providerProof(acceptance, current, pack) {
  const model = acceptance.provider
  if (!model || model.status === 'BLOCKED_ENV') throw new ExternalPrerequisiteError(model?.blocker ?? 'genuine Provider smoke has not run on the configured route')
  assert(model?.installationId === current.installationId && model.synthetic === true && model.mock === false, 'genuine synthetic Provider evidence is missing')
  for (const field of ['provider', 'model', 'effort', 'sessionId', 'requestId', 'responseId']) assert(typeof model[field] === 'string' && model[field].length > 0, `Provider ${field} identity is missing`)
  assert(!/mock|fixture|fake/i.test(`${model.provider} ${model.model}`), 'Provider route is a mock or fixture')
  const path = checkFileProof(model.tracePath, model.traceSha256)
  const observation = readJson(path)
  assert(observation.installationId === current.installationId && observation.synthetic === true && observation.mock === false, 'Provider observation belongs to another installation or uses a mock')
  assert(observation.sessionId === model.sessionId && observation.requestId === model.requestId && observation.responseId === model.responseId, 'Provider request/response identities differ from the observed session')
  assert(observation.requestEvent?.provider === model.provider && observation.requestEvent?.model === model.model && observation.requestEvent?.effort === model.effort, 'Provider observation differs from the configured route')
  assert(observation.requestId === `${model.sessionId}:event:${observation.requestEvent.seq}` && observation.requestEvent.seq < observation.responseEvent?.seq && observation.responseEvent.seq < observation.turnEnd?.seq, 'Provider event sequence is incomplete')
  assert(typeof observation.responseEvent.text === 'string' && observation.responseEvent.text.startsWith('LA-DSH-SMOKE-') && observation.responseEvent.usage?.totalTokens > 0, 'Provider response lacks model-visible synthetic content or usage')
  assert(typeof observation.sourceLog === 'string' && pathIn(observation.sourceLog, join(current.home, 'sessions')) && observation.sourceLog.includes(model.sessionId) && existsSync(observation.sourceLog), 'Provider observation has no persisted installed Desktop session log')
  assert(observation.sourceLogSha256 === fileSha(observation.sourceLog), 'Provider observation differs from the persisted installed Desktop session log')
  const events = readSessionEvents(observation.sourceLog)
  const request = events.find(event => event.seq === observation.requestEvent.seq)
  const response = events.find(event => event.seq === observation.responseEvent.seq)
  const end = events.find(event => event.seq === observation.turnEnd.seq)
  const visibleText = Array.isArray(response?.data?.message?.content) ? response.data.message.content.filter(part => part.type === 'text').map(part => part.text).join('') : response?.data?.message?.content
  assert(request?.type === 'request/header' && request.data?.header?.config?.provider === model.provider && request.data.header.config.model === model.model && request.data.header.config.reasoningEffort === model.effort && request.time === observation.requestEvent.time, 'persisted DSH request event differs from Provider observation')
  assert(response?.type === 'assistant/message' && response.data?.message?.id === model.responseId && visibleText === observation.responseEvent.text && response.time === observation.responseEvent.time && response.data.usage?.totalTokens === observation.responseEvent.usage.totalTokens, 'persisted model-visible DSH response differs from Provider observation')
  assert(end?.type === 'turn/end' && end.data?.reason?.kind === 'completed' && end.time === observation.turnEnd.time, 'persisted Provider turn did not complete')
  assert(statSync(path).mtimeMs >= Date.parse(pack.createdAt), 'Provider trace predates the current pack')
  return [path]
}

function browserProof(acceptance, current, pack) {
  const browser = acceptance.browser
  const baseline = readJson(join(root, 'integrations/browser-skill/BASELINE.json'))
  if (!browser || browser.status === 'BLOCKED_ENV') throw new ExternalPrerequisiteError(browser?.blocker ?? 'BrowserSkill extension chain has not connected to the installed product')
  assert(browser.status === 'PASS' && browser.installationId === current.installationId && browser.pluginSha256 === pack.browserSkill.sha256, 'BrowserSkill evidence is from another install or incomplete')
  assert(baseline.adaptedTarballSha256 === pack.browserSkill.sha256 && fileSha(current.bskPath) === baseline.cliRelease.binarySha256, 'installed BrowserSkill adapter or CLI differs from the pinned identity')
  const cliPath = checkFileProof(browser.cliReceiptPath, browser.cliReceiptSha256)
  const cli = readJson(cliPath)
  if (cli.status === 'BLOCKED_ENV') throw new ExternalPrerequisiteError(cli.blocker)
  assert(cli.generatedBy === 'scripts/test-browser-skill.mjs' && cli.mode === 'cli-chain' && cli.status === 'CLI_CHAIN_PASS', 'installed BrowserSkill CLI AgentWindow chain did not pass')
  const fixturePath = checkFileProof(browser.fixtureReceiptPath, browser.fixtureReceiptSha256)
  const fixture = readJson(fixturePath)
  if (fixture.status === 'BLOCKED_ENV') throw new ExternalPrerequisiteError(fixture.blocker)
  assert(fixture.generatedBy === 'scripts/test-browser-skill.mjs' && fixture.mode === 'dsh-fixture' && fixture.status === 'FIXTURE_OBSERVED', 'installed DSH localhost fixture did not observe all browser effects')
  for (const item of [cli, fixture]) {
    assert(item.installationId === current.installationId && item.currentSha256 === fileSha(currentPath) && item.pluginSha256 === pack.browserSkill.sha256 && item.cliSha256 === baseline.cliRelease.binarySha256 && item.bskHome === current.bskHome, 'BrowserSkill raw receipt is from another installation')
    assert(item.daemonVersion === '0.3.1' && item.protocol === '1.3' && item.extensionArchiveSha256 === baseline.extensionRelease.archiveSha256 && item.fixtureSha256 === fileSha(join(root, 'tests/browser-skill/fixture.html')) && item.synthetic === true && item.customerDataTouched === false, 'BrowserSkill raw receipt identity or synthetic scope is incomplete')
    assert(/^http:\/\/127\.0\.0\.1:\d+\/$/.test(item.fixtureUrl), 'BrowserSkill fixture was not loopback')
    assert(statSync(item === cli ? cliPath : fixturePath).mtimeMs >= Date.parse(pack.createdAt), 'BrowserSkill raw receipt predates the current pack')
    assert(Object.values(item.checks).every(value => value === 'PASS'), 'BrowserSkill raw receipt contains an unpassed check')
  }
  const extensionArchive = join(root, '.toolchain/browser-skill/downloads', baseline.extensionRelease.archive)
  const extensionManifest = readJson(join(root, '.toolchain/browser-skill/extension-v0.3.1/manifest.json'))
  assert(fileSha(extensionArchive) === baseline.extensionRelease.archiveSha256 && extensionManifest.name === 'BrowserSkill' && extensionManifest.version === baseline.extensionRelease.manifestVersion, 'pinned BrowserSkill extension package or unpacked manifest changed')
  if (!cli.browserInstanceId || !fixture.browserInstanceId || cli.extensionVersion !== baseline.extensionRelease.manifestVersion || fixture.extensionVersion !== baseline.extensionRelease.manifestVersion) throw new ExternalPrerequisiteError('BrowserSkill daemon did not observe a connected v0.3.1 extension instance')
  assert(cli.browserInstanceId === fixture.browserInstanceId && cli.bskPort === fixture.bskPort && cli.agentWindow?.browserInstanceId === cli.browserInstanceId, 'BrowserSkill CLI and DSH fixture used different extension-connected browsers')
  const cliTrace = checkFileProof(cli.actionTracePath, cli.actionTraceSha256)
  const fixtureTrace = checkFileProof(fixture.actionTracePath, fixture.actionTraceSha256)
  assert(readJson(cliTrace).some(item => item.action === 'owned AgentWindow session stop' && item.outcome === 'PASS'), 'BrowserSkill CLI AgentWindow cleanup was not observed')
  assert(readJson(fixtureTrace).some(item => item.action === 'DSH fixture server effects' && item.outcome === 'FIXTURE_OBSERVED'), 'DSH fixture server effects were not recorded')
  const cliDownload = checkFileProof(cli.downloadPath, cli.downloadSha256)
  const cliUpload = checkFileProof(cli.uploadReceiptPath, cli.uploadReceiptSha256)
  const cliUploadReceipt = readJson(cliUpload)
  assert(cliUploadReceipt.sha256 === sha(Buffer.from('LA-DSH synthetic browser upload\n')) && cliUploadReceipt.fixtureUrl === cli.fixtureUrl && cliUploadReceipt.sessionId === cli.agentWindow.sessionId, 'BrowserSkill CLI upload was not observed by the fixture server')
  const staging = join(current.dataRoot, 'staging')
  assert(pathIn(fixture.uploadInputPath, staging) && pathIn(fixture.downloadPath, staging), 'DSH BrowserSkill files are outside the product staging directory')
  assert(existsSync(fixture.uploadInputPath) && fileSha(fixture.uploadInputPath) === fixture.uploadInputSha256 && readFileSync(fixture.uploadInputPath, 'utf8') === 'LA-DSH synthetic browser upload\n', 'DSH BrowserSkill upload input bytes differ from the synthetic fixture')
  assert(existsSync(fixture.downloadPath) && fileSha(fixture.downloadPath) === fixture.downloadSha256 && readFileSync(fixture.downloadPath, 'utf8') === 'LA-DSH synthetic browser download\n', 'DSH BrowserSkill download bytes differ from the synthetic fixture')
  assert(fixture.expectedTarget === '打开设置菜单' && fixture.serverState?.saved?.taskId === 'LA-001' && fixture.serverState.saved.target === fixture.expectedTarget && fixture.serverState.otherTarget === 'Einstellungen öffnen', 'DSH browser edit did not save the intended synthetic job')
  assert(fixture.expectedUploadFilename === fixture.uploadInputPath.split(sep).at(-1) && fixture.serverState.uploadFilename === fixture.expectedUploadFilename && fixture.serverState.uploadSha256 === fixture.uploadInputSha256 && fixture.serverState.downloadRequests > 0, 'DSH browser file transfer was not observed by the fixture server')
  for (const action of ['save', 'upload', 'download']) assert(fixture.serverEvents.some(item => item.action === action && Date.parse(item.at) >= Date.parse(fixture.startedAt) && Date.parse(item.at) <= Date.parse(fixture.finishedAt)), `DSH fixture has no timed server-side ${action} event`)
  assert(typeof browser.dshSessionId === 'string' && pathIn(browser.dshSessionLogPath, join(current.home, 'sessions')) && browser.dshSessionLogPath.includes(browser.dshSessionId) && existsSync(browser.dshSessionLogPath) && fileSha(browser.dshSessionLogPath) === browser.dshSessionLogSha256, 'BrowserSkill DSH session log is missing or differs from the acceptance index')
  const events = readSessionEvents(browser.dshSessionLogPath)
  assert(events[0]?.type === 'session' && events[0].id === browser.dshSessionId && events[0].cwd === join(current.dataRoot, 'workspaces/synthetic-e2e'), 'BrowserSkill tool calls were not persisted in the isolated synthetic DSH workspace')
  const calls = events.filter(event => event.type === 'tool/call').map(event => ({ event, args: JSON.parse(event.data.arguments) }))
  const take = (name, action, predicate, after = -1) => {
    const call = calls.find(item => item.event.data.name === name && item.args.action === action && item.event.seq > after && predicate(item.args))
    assert(call, `persisted DSH ${name}/${action ?? 'invoke'} call is missing`)
    const result = events.find(item => item.type === 'tool/result' && item.data?.message?.source?.callId === call.event.data.callId)
    assert(result?.seq > call.event.seq && result.data.message.source.kind === 'tool' && result.data.message.toolCallId === call.event.data.callId && result.data.message.isError === false, `persisted DSH ${name}/${action ?? 'invoke'} result did not succeed`)
    return { ...call, result, text: result.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') }
  }
  const skill = calls.some(item => item.event.data.name === 'skill' && item.args.name === 'browser-skill')
    ? take('skill', undefined, args => args.name === 'browser-skill').result.seq
    : events.find(item => item.type === 'user/message' && item.data?.source?.kind === 'skill-invocation' && item.data.source.name === 'browser-skill')?.seq
  assert(Number.isInteger(skill), 'the installed DSH Session did not record native BrowserSkill skill discovery')
  const start = take('browser_session', 'start', args => args.browser === fixture.browserInstanceId, skill)
  const agentSession = start.text.match(/started browser session ([A-Za-z0-9._-]+)/)?.[1]
  assert(agentSession, 'DSH browser_session start result lacks the owned AgentWindow identity')
  const navigate = take('browser_page', 'navigate', args => args.session === agentSession && args.url === fixture.fixtureUrl, start.event.seq)
  const inspect = take('browser_inspect', 'observe', args => args.session === agentSession, navigate.event.seq)
  assert(inspect.text.includes('LA-001') && inspect.text.includes('LA-002'), 'DSH model-visible BrowserSkill observation omitted a synthetic job')
  const fill = take('browser_interact', 'fill', args => args.session === agentSession && args.value === fixture.expectedTarget, inspect.event.seq)
  const click = take('browser_interact', 'click', args => args.session === agentSession, fill.event.seq)
  const upload = take('browser_files', 'upload', args => args.session === agentSession && args.files?.length === 1 && args.files[0] === fixture.uploadInputPath && typeof args.requestId === 'string', click.event.seq)
  const download = take('browser_files', 'download', args => args.session === agentSession && args.out === fixture.downloadPath && typeof args.requestId === 'string' && args.requestId !== upload.args.requestId, upload.event.seq)
  assert(upload.text.includes('attached') && download.text.includes('downloaded'), 'DSH browser_files model-visible results did not confirm both transfers')
  take('browser_session', 'stop', args => args.session === agentSession, download.event.seq)
  for (const [action, call] of [['save', click], ['upload', upload], ['download', download]]) {
    assert(fixture.serverEvents.some(item => item.action === action && Date.parse(item.at) >= call.event.time && Date.parse(item.at) <= call.result.time + 60_000), `DSH ${action} tool call has no matching localhost server effect`)
  }
  for (const item of [start, navigate, inspect, fill, click, upload, download]) assert(item.event.time >= Date.parse(fixture.startedAt) && item.event.time <= Date.parse(fixture.finishedAt), 'DSH browser tool call did not occur during the localhost fixture run')
  let daemon
  try {
    daemon = JSON.parse(execFileSync(current.bskPath, ['status', '--json'], { encoding: 'utf8', timeout: 150_000, env: { ...process.env, BSK_HOME: current.bskHome, BSK_AUTO_START: '0' } }))
  } catch (error) {
    throw new ExternalPrerequisiteError(`installed BrowserSkill daemon is not reachable now: ${error instanceof Error ? error.message : String(error)}`)
  }
  assert(daemon.daemon_version === '0.3.1' && daemon.protocol_version === '1.3' && daemon.ws_port === fixture.bskPort, 'current BrowserSkill daemon differs from the observed chain')
  if (!daemon.browsers?.some(item => item.instance_id === fixture.browserInstanceId && item.extension_version === fixture.extensionVersion)) throw new ExternalPrerequisiteError('the verified BrowserSkill extension-connected browser is no longer connected to the product daemon')
  return [cliPath, cliTrace, cliDownload, cliUpload, fixturePath, fixtureTrace, fixture.uploadInputPath, fixture.downloadPath, browser.dshSessionLogPath, extensionArchive]
}

function desktopProof(acceptance, current, pack) {
  const desktop = acceptance.desktop
  const artifact = current.desktopArtifact
  assert(desktop?.installationId === current.installationId && desktop.appPath === current.appPath && desktop.officialAppPath === artifact.appPath && desktop.url === 'dsh-app://app/', 'desktop verification is from another installation or UI origin')
  assert(desktop.artifactSha256 === artifact.sha256 && desktop.bundleId === artifact.bundleId && desktop.version === artifact.version && desktop.teamId === artifact.teamId, 'desktop verification does not match the signed official app identity')
  assert(desktop.profile === 'desktop' && desktop.dshHome === current.home && desktop.userDataDir === current.desktopUserDataDir, 'desktop runtime did not use the recorded official desktop profile and user-data directory')
  for (const name of ['@linguist/dsh-plugin', '@wxg-prc-cpg/browser-skill-dsh-plugin']) assert(desktop.activeBundles?.includes(name), `desktop runtime did not observe the active ${name} bundle after reopening`)
  assert(desktop.fromDesktop === true && desktop.nonInteractivePath === true && desktop.shellClosed === true, 'desktop entry was not exercised independently of the construction shell')
  assert(Date.parse(desktop.firstOpenAt) < Date.parse(desktop.stoppedAt) && Date.parse(desktop.stoppedAt) < Date.parse(desktop.reopenedAt), 'desktop open/stop/reopen sequence was not observed')
  assert(existsSync(current.appPath) && existsSync(artifact.appPath), 'desktop double-click launcher or copied official app is missing')
  const trace = checkFileProof(desktop.tracePath, desktop.traceSha256)
  assert(statSync(trace).mtimeMs >= Date.parse(pack.createdAt), 'desktop trace predates the current pack')
  traceContains(trace, [current.installationId, current.appPath, artifact.appPath, 'dsh-app://app/', current.home, current.desktopUserDataDir, '@linguist/dsh-plugin', '@wxg-prc-cpg/browser-skill-dsh-plugin'], 'desktop')
  return [trace, current.appPath, artifact.appPath]
}

/** The user's one authorized private GitHub push; this does not grant publication elsewhere. */
export function privatePushProof(remotePublished, authorization, proof, commit) {
  assert(remotePublished === false || remotePublished === true, 'remote publication state is unverified')
  if (remotePublished === false) return []
  const repository = 'https://github.com/wangyu-sg/Linguist-Agent-DSH'
  assert(authorization?.repository === repository && authorization.visibility === 'private' && authorization.userAuthorized === true, 'private repository push lacks the explicit user authorization')
  const path = checkFileProof(proof?.receiptPath, proof?.receiptSha256)
  const receipt = readJson(path)
  assert(receipt.schemaVersion === 1 && receipt.status === 'PUSHED' && receipt.pushExitCode === 0, 'private repository push did not succeed')
  assert(receipt.repository === repository && receipt.visibility === 'private', 'push receipt is not for the authorized private repository')
  assert(typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit) && receipt.localCommit === commit && receipt.remoteCommit === commit, 'private repository push does not match the current local and remote commit')
  return [path]
}

function privacyProof(acceptance, source, state, commit) {
  const privacy = acceptance.privacy
  assert(privacy?.sourceUntouched === true && privacy.oldDataUntouched === true && privacy.customerDataTouched === false, 'privacy scope was not confirmed')
  assert(state.customerDataTouched === false && state.remotePublished === privacy.remotePublished, 'migration state records customer data or differs from the remote publication evidence')
  const push = privatePushProof(privacy.remotePublished, state.remotePushAuthorization, privacy.privatePush, commit)
  for (const item of source.files) {
    const path = join(source.sourcePath, item.path)
    assert(existsSync(path) && fileSha(path) === item.sha256, `read-only source changed: ${item.path}`)
  }
  const trace = checkFileProof(privacy.tracePath, privacy.traceSha256)
  return [trace, join(root, '.migration/source-snapshot-manifest.json'), ...push]
}

export async function verifyReady() {
  const smoke = await runInstalledSmoke()
  const current = existsSync(currentPath) ? readJson(currentPath) : null
  const pack = existsSync(join(root, 'artifacts/pack.json')) ? readJson(join(root, 'artifacts/pack.json')) : null
  const acceptance = existsSync(acceptancePath) ? readJson(acceptancePath) : null
  const map = readJson(join(root, 'docs/migration/FEATURE_MAP.json'))
  const state = readJson(join(root, 'docs/migration/STATE.json'))
  const source = readJson(join(root, '.migration/source-snapshot-manifest.json'))
  const code = targetCodeIdentity()
  const gates = []
  const blockers = []
  const gate = (id, test, external = false) => {
    try {
      const evidencePaths = test()
      gates.push({ id, outcome: 'pass', evidencePaths })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const isExternal = external && error instanceof ExternalPrerequisiteError
      gates.push({ id, outcome: isExternal ? 'blocked' : 'fail', evidencePaths: [] })
      blockers.push({ code: id, detail, external: isExternal })
    }
  }
  const accept = () => { assert(current && pack, 'current install or pack manifest is missing'); boundAcceptance(acceptance, current, pack) }
  const tests = ids => { accept(); return runsFor(acceptance, current, pack, ids) }
  gate('G01', () => mappedFeatures(map))
  gate('G02', () => {
    for (const id of ['FEATURE-04', 'FEATURE-05', 'FEATURE-06', 'FEATURE-07', 'FEATURE-08', 'FEATURE-09', 'FEATURE-10', 'FEATURE-11', 'FEATURE-12', 'FEATURE-13', 'FEATURE-15', 'FEATURE-16']) {
      assert(map.featureSurfaces.some(item => item.id === id && item.status === 'complete'), `${id} role/path surface is incomplete`)
    }
    return tests(['V15', 'V22'])
  })
  gate('G03', () => tests(['V03', 'V06', 'V07', 'V08', 'V09', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V26', 'V27']))
  gate('G04', () => {
    assert(smoke.status === 'PASS', `installed smoke ${smoke.status}: ${smoke.checks.filter(item => item.outcome !== 'pass').map(item => `${item.id}: ${item.detail}`).join('; ')}`)
    assert(current && smoke.installationId === current.installationId && smoke.currentSha256 === fileSha(currentPath), 'installed smoke was superseded by a different current.json')
    return [smokePath, ...tests(['V02', 'V04'])]
  })
  gate('G05', () => tests(['V05', 'V16', 'V17', 'V18', 'V28']))
  gate('G06', () => { accept(); return [...uiProof(acceptance, current), ...tests(['V19', 'V20'])] })
  gate('G07', () => { accept(); return providerProof(acceptance, current, pack) }, true)
  gate('G08', () => {
    accept()
    const build = readJson(join(root, 'integrations/browser-skill/dist/BUILD.json'))
    const local = readJson(join(root, 'integrations/browser-skill/dist/LOCALHOST_SMOKE.json'))
    assert(build.sha256 === pack.browserSkill.sha256 && build.unitTests === '383 passed', 'adapted BrowserSkill build or regression evidence differs from installed pack')
    assert(local.checks?.cli === 'PASS' && local.checks?.daemon === 'PASS' && local.checks?.fixtureHttp === 'PASS', 'BrowserSkill CLI/daemon localhost baseline did not pass')
    return [join(root, 'integrations/browser-skill/dist/BUILD.json'), join(root, 'integrations/browser-skill/dist/LOCALHOST_SMOKE.json'), ...browserProof(acceptance, current, pack), ...tests(['V21', 'V23', 'V24'])]
  }, true)
  gate('G09', () => { accept(); return [...privacyProof(acceptance, source, state, code.commit), ...tests(['V01', 'V25'])] })
  gate('G10', () => { accept(); return [...desktopProof(acceptance, current, pack), ...tests(['V29'])] })
  gate('G11', () => {
    accept()
    assert(smoke.status === 'PASS', 'current installed artifact verification did not pass')
    assert(smoke.installationId === current.installationId && smoke.currentSha256 === fileSha(currentPath), 'installed smoke was superseded by a different current.json')
    assert(code.latestRuntimeInputAt <= Date.parse(pack.createdAt), 'runtime source changed after the current tgz was packed')
    assert(acceptance.codeTreeHash === code.treeHash, 'acceptance code tree differs from current implementation')
    return [join(root, 'artifacts/pack.json'), smokePath, acceptancePath]
  })
  gate('G12', () => {
    accept()
    if (gates.find(item => item.id === 'G07')?.outcome === 'blocked' || gates.find(item => item.id === 'G08')?.outcome === 'blocked') throw new ExternalPrerequisiteError('genuine Provider or extension prerequisite remains unverified')
    assert(gates.find(item => item.id === 'G07')?.outcome === 'pass' && gates.find(item => item.id === 'G08')?.outcome === 'pass', 'Provider or BrowserSkill gate failed')
    assert(gates.find(item => item.id === 'G09')?.outcome === 'pass', 'privacy prerequisite is unverified')
    return [acceptancePath]
  }, true)
  gate('G13', () => {
    accept()
    assert(map.capabilityAudit?.domain && map.capabilityAudit?.ui, 'complete source capability inventory is missing')
    const domainPath = join(root, map.capabilityAudit.domain)
    const uiPath = join(root, map.capabilityAudit.ui)
    assert(Array.isArray(acceptance.capabilities), 'per-capability installed acceptance is missing')
    const paths = acceptance.capabilities.map(observation => {
      const path = checkFileProof(observation.evidencePath, observation.evidenceSha256)
      assert(statSync(path).mtimeMs >= Date.parse(pack.createdAt), 'capability evidence predates the installed package')
      traceContains(path, [current.installationId, ...observation.featureIds], 'capability acceptance')
      return path
    })
    requireCapabilityCoverage(readJson(domainPath), readJson(uiPath), acceptance.capabilities)
    return [domainPath, uiPath, ...new Set(paths)]
  }, true)
  gate('V30', () => { validationMap(map); return tests(['V30']) })
  const requiredGates = gates.filter(item => /^G\d\d$/.test(item.id))
  const status = requiredGates.some(item => item.outcome === 'fail') || gates.find(item => item.id === 'V30')?.outcome === 'fail' ? 'FAILED'
    : requiredGates.some(item => item.outcome === 'blocked') ? 'BLOCKED_ENV' : 'READY'
  const browser = acceptance?.browser
  const receipt = {
    schemaVersion: 1, status, evaluatedAt: new Date().toISOString(), sourceSnapshotHash: source.sourceTree,
    targetCodeIdentity: { ...(code.commit ? { commit: code.commit } : {}), treeHash: code.treeHash, dirty: code.dirty },
    installed: {
      installationId: current?.installationId ?? 'uninstalled', dshVersion: current?.dshVersion ?? 'uninstalled',
      desktopArtifactSha256: current?.desktopArtifact?.sha256 ?? 'uninstalled',
      desktopProfile: current?.profile === 'desktop' ? 'desktop' : 'unverified',
      pluginHash: current?.plugins?.linguist?.sha256 ?? 'uninstalled',
      desktopArtifact: current?.desktopArtifact ?? null,
      browserSkill: {
        cli: existsSync(join(root, '.toolchain/browser-skill/bin/bsk')) ? fileSha(join(root, '.toolchain/browser-skill/bin/bsk')) : 'unverified',
        daemon: browser?.daemonVersion ?? 'unverified', extension: browser?.extensionId ?? 'unverified',
        plugin: current?.plugins?.browserSkill?.sha256 ?? 'uninstalled',
      },
    },
    launch: {
      appPath: current?.appPath ?? '',
      url: current?.profile === 'desktop' ? 'dsh-app://app/' : '', dataRoot: current?.dataRoot ?? productRoot,
      reopenVerified: gates.find(item => item.id === 'G10')?.outcome === 'pass',
    },
    gates, blockers, customerDataTouched: state.customerDataTouched, remotePublished: state.remotePublished,
    ...(state.remotePublished === true ? { remotePushAuthorization: state.remotePushAuthorization, privatePush: acceptance?.privacy?.privatePush } : {}),
    currentSha256: current ? fileSha(currentPath) : null,
    packSha256: pack ? fileSha(join(root, 'artifacts/pack.json')) : null,
    acceptancePath: existsSync(acceptancePath) ? acceptancePath : null,
    acceptanceSha256: existsSync(acceptancePath) ? fileSha(acceptancePath) : null,
    smokeSha256: fileSha(smokePath),
    codeGitStatus: code.gitStatus,
  }
  await atomicJson(readyPath, receipt)
  return receipt
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt = await verifyReady()
  process.stdout.write(`${receipt.status}: ${receipt.gates.map(item => `${item.id}=${item.outcome}`).join(', ')}\n${readyPath}\n`)
  for (const blocker of receipt.blockers) process.stdout.write(`${blocker.code}: ${blocker.detail}\n`)
  if (receipt.status !== 'READY') process.exitCode = receipt.status === 'BLOCKED_ENV' ? 2 : 1
}
