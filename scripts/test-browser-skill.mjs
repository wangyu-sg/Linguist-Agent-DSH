import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const productRoot = join(homedir(), 'Library/Application Support/Linguist-Agent-DSH')
const currentFile = join(productRoot, 'current.json')
const evidenceRoot = join(root, 'artifacts/evidence')
const cliReceiptPath = join(evidenceRoot, 'browser-skill-localhost.json')
const cliTracePath = join(evidenceRoot, 'browser-skill-action-trace.json')
const dshReceiptPath = join(evidenceRoot, 'browser-skill-dsh-fixture.json')
const dshTracePath = join(evidenceRoot, 'browser-skill-dsh-fixture-trace.json')
const fixture = readFileSync(join(root, 'tests/browser-skill/fixture.html'))
const uploadBytes = Buffer.from('LA-DSH synthetic browser upload\n', 'utf8')
const downloadBytes = Buffer.from('LA-DSH synthetic browser download\n', 'utf8')
const targetText = '打开设置菜单'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

async function body(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('synthetic request exceeds 64 KiB')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function bsk(current, args) {
  const result = await exec(current.bskPath, args, {
    env: { ...process.env, BSK_HOME: current.bskHome, BSK_AUTO_START: '0' },
    cwd: root, timeout: 150_000, maxBuffer: 1024 * 1024,
  })
  return result.stdout.trim()
}

async function waitFor(read, expected, label) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (read() === expected) return
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`${label} was not observed by the localhost fixture server`)
}

export async function testBrowserSkill({ serveDsh = false } = {}) {
  await mkdir(evidenceRoot, { recursive: true })
  const receiptPath = serveDsh ? dshReceiptPath : cliReceiptPath
  const tracePath = serveDsh ? dshTracePath : cliTracePath
  const trace = []
  const step = (action, outcome, detail) => trace.push({ at: new Date().toISOString(), action, outcome, ...(detail ? { detail } : {}) })
  const current = readJson(currentFile)
  const baseline = readJson(join(root, 'integrations/browser-skill/BASELINE.json'))
  const pack = readJson(join(root, 'artifacts/pack.json'))
  const extensionArchive = join(root, '.toolchain/browser-skill/downloads', baseline.extensionRelease.archive)
  const extensionManifest = readJson(join(productRoot, 'runtime/browser-skill/extension-v0.3.1/manifest.json'))
  const checks = {}
  const evidence = {
    schemaVersion: 1, generatedBy: 'scripts/test-browser-skill.mjs', startedAt: new Date().toISOString(),
    mode: serveDsh ? 'dsh-fixture' : 'cli-chain', currentSha256: hash(readFileSync(currentFile)),
    installationId: current.installationId, status: 'FAILED', checks,
    fixtureSha256: hash(fixture), synthetic: true, customerDataTouched: false,
    pluginSha256: current.plugins.browserSkill.sha256,
    cliSha256: hash(readFileSync(current.bskPath)),
    extensionArchiveSha256: hash(readFileSync(extensionArchive)),
    bskHome: current.bskHome,
    pluginToolInvocation: 'NOT_VERIFIED',
  }
  assert.equal(current.profile, 'desktop', 'BrowserSkill check must use the installed official Desktop profile')
  assert.equal(current.bskHome, join(productRoot, 'browser-skill/home'), 'BrowserSkill home is not the new product home')
  assert.equal(evidence.cliSha256, baseline.cliRelease.binarySha256, 'installed BrowserSkill CLI differs from the pinned binary')
  assert.equal(evidence.pluginSha256, baseline.adaptedTarballSha256, 'installed BrowserSkill plugin differs from pinned adapter')
  assert.equal(evidence.pluginSha256, pack.browserSkill.sha256, 'installed BrowserSkill plugin differs from current pack')
  assert.equal(evidence.extensionArchiveSha256, baseline.extensionRelease.archiveSha256, 'BrowserSkill extension ZIP differs from the pinned official release')
  assert.equal(extensionManifest.name, 'BrowserSkill')
  assert.equal(extensionManifest.version, baseline.extensionRelease.manifestVersion)
  assert.equal(hash(readFileSync(current.plugins.browserSkill.tarball)), pack.browserSkill.sha256, 'installed BrowserSkill tarball bytes differ from current pack')
  assert.equal(hash(readFileSync(pack.browserSkill.path)), pack.browserSkill.sha256, 'BrowserSkill build tarball bytes differ from current pack')
  const state = { saved: null, otherTarget: 'Einstellungen öffnen', uploadSha256: null, uploadFilename: null, downloadRequests: 0 }
  const serverEvents = []
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        response.end(fixture)
      } else if (request.method === 'GET' && request.url === '/download') {
        state.downloadRequests++
        serverEvents.push({ at: new Date().toISOString(), action: 'download', sha256: hash(downloadBytes), bytes: downloadBytes.length })
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': 'attachment; filename="la-dsh-synthetic-download.txt"' })
        response.end(downloadBytes)
      } else if (request.method === 'POST' && request.url === '/save') {
        const input = JSON.parse((await body(request)).toString('utf8'))
        if (input.taskId !== 'LA-001' || input.target !== targetText) { response.writeHead(400); response.end('wrong synthetic task'); return }
        state.saved = { taskId: input.taskId, target: input.target }
        serverEvents.push({ at: new Date().toISOString(), action: 'save', ...state.saved })
        response.writeHead(204); response.end()
      } else if (request.method === 'POST' && request.url === '/upload') {
        const bytes = await body(request)
        state.uploadSha256 = hash(bytes)
        state.uploadFilename = request.headers['x-synthetic-filename']
        serverEvents.push({ at: new Date().toISOString(), action: 'upload', filename: state.uploadFilename, sha256: state.uploadSha256, bytes: bytes.length })
        response.writeHead(204); response.end()
      } else if (request.method === 'GET' && request.url === '/state') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify(state))
      } else { response.writeHead(404); response.end() }
    } catch (error) { response.writeHead(500); response.end(error instanceof Error ? error.message : String(error)) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const url = `http://127.0.0.1:${server.address().port}/`
  evidence.fixtureUrl = url
  let sessionId
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    assert.equal(response.status, 200)
    assert.match(await response.text(), /LA-DSH BrowserSkill synthetic fixture/)
    checks.fixtureHttp = 'PASS'
    step('localhost fixture', 'PASS', url)

    assert.equal(await bsk(current, ['--version']), 'bsk 0.3.1')
    checks.cli = 'PASS'
    step('pinned BrowserSkill CLI', 'PASS', evidence.cliSha256)
    const daemon = JSON.parse(await bsk(current, ['status', '--json']))
    assert.equal(daemon.daemon_version, '0.3.1')
    assert.equal(daemon.protocol_version, '1.3')
    assert(Number.isInteger(daemon.ws_port) && daemon.ws_port > 0)
    checks.daemon = 'PASS'
    evidence.bskPort = daemon.ws_port
    evidence.daemonVersion = daemon.daemon_version
    evidence.protocol = daemon.protocol_version
    step('product daemon status', 'PASS', `v${daemon.daemon_version} protocol ${daemon.protocol_version} port ${daemon.ws_port}`)
    if (daemon.browsers.length === 0) {
      evidence.status = 'BLOCKED_ENV'
      evidence.blocker = `BrowserSkill extension 0.3.1 is not connected to the new product daemon on port ${daemon.ws_port}; load the unpacked extension from ${join(productRoot, 'runtime/browser-skill/extension-v0.3.1')} and connect it to this daemon with browser authorization`
      checks.extension = 'BLOCKED_ENV'
      step('extension-connected browser', 'BLOCKED_ENV', 'daemon reports zero connected browsers')
      return evidence
    }
    const selected = process.env.BSK_BROWSER_ID
      ? daemon.browsers.find(item => item.instance_id === process.env.BSK_BROWSER_ID)
      : daemon.browsers.length === 1 ? daemon.browsers[0] : null
    if (!selected) {
      evidence.status = 'BLOCKED_ENV'
      evidence.blocker = 'Multiple browser instances are connected; set BSK_BROWSER_ID to the intended instance after confirming it in the BrowserSkill extension'
      checks.extension = 'BLOCKED_ENV'
      step('extension-connected browser', 'BLOCKED_ENV', 'browser instance choice is ambiguous')
      return evidence
    }
    assert.equal(selected.extension_version, baseline.extensionRelease.manifestVersion)
    evidence.extensionVersion = selected.extension_version
    evidence.browserInstanceId = selected.instance_id
    checks.extension = 'PASS'
    step('extension-connected browser', 'PASS', `instance ${selected.instance_id}; extension ${selected.extension_version}`)

    if (serveDsh) {
      const staging = join(current.dataRoot, 'staging')
      await mkdir(staging, { recursive: true })
      const uploadPath = join(staging, `browser-skill-dsh-upload-${randomUUID()}.txt`)
      const downloadPath = join(staging, `browser-skill-dsh-download-${randomUUID()}.txt`)
      await writeFile(uploadPath, uploadBytes, { flag: 'wx' })
      assert(!existsSync(downloadPath), 'synthetic download destination already exists')
      evidence.uploadInputPath = uploadPath
      evidence.uploadInputSha256 = hash(uploadBytes)
      evidence.downloadPath = downloadPath
      evidence.downloadSha256 = hash(downloadBytes)
      evidence.expectedTarget = targetText
      evidence.expectedUploadFilename = uploadPath.split('/').at(-1)
      step('DSH fixture ready', 'PASS', url)
      process.stdout.write(`${JSON.stringify({ fixtureUrl: url, browserInstanceId: selected.instance_id, extensionVersion: selected.extension_version, uploadPath, downloadPath, receiptPath })}\n`)
      const deadline = Date.now() + 15 * 60_000
      let interrupted = false
      const interrupt = () => { interrupted = true }
      process.once('SIGINT', interrupt)
      process.once('SIGTERM', interrupt)
      try {
        while (!interrupted && Date.now() < deadline && !(state.saved?.target === targetText && state.uploadSha256 === hash(uploadBytes) && state.downloadRequests > 0)) {
          await new Promise(resolve => setTimeout(resolve, 250))
        }
      } finally {
        process.off('SIGINT', interrupt)
        process.off('SIGTERM', interrupt)
      }
      evidence.serverEvents = serverEvents
      evidence.serverState = state
      checks.serverSideSave = state.saved?.target === targetText && state.saved.taskId === 'LA-001' ? 'PASS' : 'BLOCKED_ENV'
      checks.serverSideUpload = state.uploadSha256 === hash(uploadBytes) && state.uploadFilename === evidence.expectedUploadFilename ? 'PASS' : 'BLOCKED_ENV'
      checks.serverSideDownload = state.downloadRequests > 0 ? 'PASS' : 'BLOCKED_ENV'
      evidence.status = Object.values(checks).every(value => value === 'PASS') ? 'FIXTURE_OBSERVED' : 'BLOCKED_ENV'
      if (evidence.status === 'BLOCKED_ENV') evidence.blocker = 'The installed DSH Agent did not complete the localhost BrowserSkill save, upload and download before the fixture closed'
      step('DSH fixture server effects', evidence.status, JSON.stringify({ save: checks.serverSideSave, upload: checks.serverSideUpload, download: checks.serverSideDownload }))
      return evidence
    }

    const started = JSON.parse(await bsk(current, ['session', 'start', '--no-focus', '--browser', selected.instance_id, '--json']))
    sessionId = started.session_id
    assert(sessionId && started.browser_instance_id === selected.instance_id)
    evidence.agentWindow = { sessionId, browserInstanceId: selected.instance_id }
    checks.agentWindow = 'PASS'
    step('owned AgentWindow session start', 'PASS', `session ${sessionId}`)

    await bsk(current, ['navigate', url, '--session', sessionId, '--json'])
    assert.match(await bsk(current, ['observe', '--session', sessionId]), /LA-001.*English.*Chinese/s)
    checks.navigationAndObservation = 'PASS'
    step('AgentWindow navigate and observe', 'PASS', url)

    await bsk(current, ['fill', '#target-la-001', '--value', targetText, '--session', sessionId, '--json'])
    await bsk(current, ['click', '#save-la-001', '--session', sessionId, '--json'])
    await waitFor(() => state.saved?.target, targetText, 'server-side save')
    assert.equal(state.saved.taskId, 'LA-001')
    assert.equal(state.otherTarget, 'Einstellungen öffnen')
    checks.taskIdentityAndSave = 'PASS'
    step('edit and server-side save', 'PASS', 'LA-001 Chinese target saved; LA-002 German target untouched')

    const uploadPath = join(evidenceRoot, 'browser-skill-upload.txt')
    await writeFile(uploadPath, uploadBytes)
    await bsk(current, ['upload', '#upload', '--file', uploadPath, '--session', sessionId, '--json'])
    await waitFor(() => state.uploadSha256, hash(uploadBytes), 'server-side upload')
    assert.equal(state.uploadFilename, 'browser-skill-upload.txt')
    const uploadReceiptPath = join(evidenceRoot, `browser-skill-upload-receipt-${randomUUID()}.json`)
    await writeFile(uploadReceiptPath, `${JSON.stringify({ filename: state.uploadFilename, sha256: state.uploadSha256, bytes: uploadBytes.length, fixtureUrl: url, sessionId }, null, 2)}\n`)
    evidence.uploadReceiptPath = uploadReceiptPath
    evidence.uploadReceiptSha256 = hash(readFileSync(uploadReceiptPath))
    checks.upload = 'PASS'
    step('AgentWindow upload', 'PASS', `${uploadBytes.length} synthetic bytes observed by fixture server`)

    const downloadPath = join(evidenceRoot, `browser-skill-download-${randomUUID()}.txt`)
    assert(!existsSync(downloadPath), 'download destination already exists')
    await bsk(current, ['download', '#download', '--out', downloadPath, '--session', sessionId, '--json'])
    assert.deepEqual(readFileSync(downloadPath), downloadBytes)
    evidence.downloadPath = downloadPath
    evidence.downloadSha256 = hash(downloadBytes)
    checks.download = 'PASS'
    step('AgentWindow download', 'PASS', `${downloadBytes.length} exact synthetic bytes saved without overwrite`)

    evidence.status = 'CLI_CHAIN_PASS'
    evidence.blocker = 'The localhost AgentWindow CLI chain passed; an installed DSH Agent browser_* tool invocation and native skill discovery trace are still required for G08'
    return evidence
  } catch (error) {
    evidence.status = 'FAILED'
    evidence.error = error instanceof Error ? error.message : String(error)
    step('browser chain', 'FAILED', evidence.error)
    return evidence
  } finally {
    if (sessionId) {
      try {
        await bsk(current, ['session', 'stop', sessionId, '--json'])
        checks.ownedSessionStop = 'PASS'
        step('owned AgentWindow session stop', 'PASS', `session ${sessionId}`)
      } catch (error) {
        checks.ownedSessionStop = 'FAIL'
        evidence.status = 'FAILED'
        evidence.stopError = error instanceof Error ? error.message : String(error)
        step('owned AgentWindow session stop', 'FAILED', evidence.stopError)
      }
    }
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    if (hash(readFileSync(currentFile)) !== evidence.currentSha256) {
      evidence.status = 'FAILED'
      evidence.error = 'current installation changed while BrowserSkill test was running'
      step('installation identity', 'FAILED', evidence.error)
    }
    evidence.finishedAt = new Date().toISOString()
    await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`)
    evidence.actionTracePath = tracePath
    evidence.actionTraceSha256 = hash(readFileSync(tracePath))
    await writeFile(receiptPath, `${JSON.stringify(evidence, null, 2)}\n`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--serve-dsh'), 'usage: node scripts/test-browser-skill.mjs [--serve-dsh]')
  const serveDsh = process.argv[2] === '--serve-dsh'
  const result = await testBrowserSkill({ serveDsh })
  process.stdout.write(`${result.status}: ${Object.entries(result.checks).map(([key, value]) => `${key}=${value}`).join(', ')}\n${serveDsh ? dshReceiptPath : cliReceiptPath}\n`)
  if (result.blocker) process.stdout.write(`${result.blocker}\n`)
  process.exitCode = ['CLI_CHAIN_PASS', 'FIXTURE_OBSERVED'].includes(result.status) ? 0 : result.status === 'BLOCKED_ENV' ? 2 : 1
}
