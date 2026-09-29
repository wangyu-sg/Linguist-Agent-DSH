import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
assert(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--managed'), 'usage: node scripts/test-browser-files-edge.mjs [--managed]')
const managed = process.argv[2] === '--managed'
const root = new URL('..', import.meta.url)
const current = JSON.parse(await readFile(join(homedir(), 'Library/Application Support/Linguist-Agent-DSH/current.json'), 'utf8'))
const baseline = JSON.parse(await readFile(new URL('integrations/browser-skill/BASELINE.json', root), 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
assert.equal(hash(await readFile(current.bskPath)), baseline.cliRelease.binarySha256)
const directory = new URL(`artifacts/evidence/browser-files-edge-${randomUUID()}/`, root)
await mkdir(directory, { recursive: true })
const evidence = { installationId: current.installationId, browserSkillSha256: current.plugins.browserSkill.sha256,
  lifecycle: managed ? 'DSH recoverable request protocol' : 'direct CLI stop',
  startedAt: new Date().toISOString(), synthetic: true, scope: 'Real pinned CLI/extension only; installed DSH tool cancellation and reload are not covered',
  status: 'FAILED', checks: {}, trace: [] }
const bsk = async args => {
  const { stdout } = await exec(current.bskPath, [...args, '--json'], {
    env: { ...process.env, BSK_HOME: current.bskHome, BSK_AUTO_START: '0' }, timeout: 20000, maxBuffer: 1024 * 1024,
  })
  return JSON.parse(stdout)
}
const bytes = Buffer.from('LA-DSH synthetic edge download\n')
const sessions = []
const starts = new Map()
const stop = async session => {
  if (!managed) return bsk(['session', 'stop', session])
  const requestId = starts.get(session)
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await bsk(['session', 'request', requestId, '--cancel'])
    evidence.trace.push({ action: 'request-cancel', session, requestId, result })
    if (result.state === 'closed') return result
    assert(['cancelling', 'cleanup_failed'].includes(result.state), `Unexpected cancellation state: ${result.state}`)
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 15000))
  }
  throw new Error('Managed cleanup did not close the owned session')
}
const requests = []
const timers = new Set()
const server = createServer((req, res) => {
  if (req.url === '/') {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<title>LA-DSH synthetic download edges</title><a id="fast" href="/fast">Fast</a><a id="delayed" href="/delayed">Delayed</a><a id="timeout" href="/timeout">Timeout</a>')
    return
  }
  if (!['/fast', '/delayed', '/timeout'].includes(req.url)) { res.writeHead(404); res.end(); return }
  requests.push(req.url)
  const send = () => { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="same-name.txt"' }); res.end(bytes) }
  if (req.url === '/fast') send()
  else {
    const timer = setTimeout(() => { timers.delete(timer); send() }, req.url === '/delayed' ? 500 : 5000)
    timers.add(timer)
  }
})
try {
  const status = await bsk(['status'])
  if (status.browsers.length !== 1) throw new Error('Expected one authorized BrowserSkill browser instance')
  evidence.browser = status.browsers[0].instance_id
  assert.equal(status.browsers[0].extension_version, baseline.extensionRelease.manifestVersion)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  evidence.fixtureUrl = url
  for (let i = 0; i < 2; i++) {
    const requestId = `${Date.now() + 300000}:${randomUUID()}`
    if (managed) assert.equal((await bsk(['session', 'request', requestId, '--prepare'])).state, 'prepared')
    const started = await bsk(['session', 'start', '--no-focus', '--browser', evidence.browser, ...(managed ? ['--request-id', requestId] : [])])
    sessions.push(started.session_id)
    starts.set(started.session_id, requestId)
    assert.equal(started.browser_instance_id, evidence.browser)
    if (managed) assert.equal((await bsk(['session', 'request', requestId, '--claim'])).state, 'active')
    await bsk(['navigate', url, '--session', started.session_id])
  }
  assert.notEqual(sessions[0], sessions[1])
  evidence.ownedSessions = [...sessions]
  evidence.checks.distinctOwnedSessions = 'PASS'
  for (const target of ['fast', 'delayed']) {
    const out = new URL(`${target}.txt`, directory)
    const result = await bsk(['download', `#${target}`, '--session', sessions[0], '--out', out.pathname, '--timeout', '10s'])
    assert.deepEqual(await readFile(out), bytes)
    evidence.trace.push({ action: target, result, sha256: hash(await readFile(out)) })
    evidence.checks[target] = 'PASS'
  }
  evidence.checks.sameSuggestedNameDistinctOutputs = 'PASS'
  const existing = new URL('source-preserved.txt', directory)
  const source = Buffer.from('synthetic original: do not overwrite\n')
  await writeFile(existing, source, { flag: 'wx' })
  const before = requests.length
  await assert.rejects(bsk(['download', '#fast', '--session', sessions[0], '--out', existing.pathname]), error => /exist/i.test(error.stdout + error.stderr))
  assert.deepEqual(await readFile(existing), source)
  assert.equal(requests.length, before, 'overwrite rejection must precede browser trigger')
  evidence.checks.existingOutputNotOverwrittenOrTriggered = 'PASS'
  await stop(sessions[1])
  sessions.pop()
  assert.match(JSON.stringify(await bsk(['observe', '--session', sessions[0]])), /synthetic download edges/)
  evidence.checks.stoppingOwnedSessionPreservesPeer = 'PASS'
  const timedOut = new URL('timeout.txt', directory)
  await assert.rejects(bsk(['download', '#timeout', '--session', sessions[0], '--out', timedOut.pathname, '--timeout', '200ms']), error => /tim(?:e|ed).*out|timeout/i.test(error.stdout + error.stderr))
  await assert.rejects(access(timedOut), { code: 'ENOENT' })
  evidence.checks.timeoutNoImmediateOutput = 'PASS'
  await stop(sessions[0])
  sessions.shift()
  evidence.checks.stopAfterDownloadTimeout = 'PASS'
  await assert.rejects(access(timedOut), { code: 'ENOENT' })
  assert.deepEqual(await readFile(existing), source)
  evidence.checks.outputStillAbsentAfterCleanup = 'PASS'
  const finalState = await bsk(['status'])
  assert(!finalState.sessions.some(session => evidence.ownedSessions.includes(session.session_id)))
  evidence.checks.ownedSessionsGone = 'PASS'
  evidence.status = 'CLI_EDGE_PASS'
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error)
  evidence.commandError = error.stdout || error.stderr
  process.exitCode = 1
} finally {
  for (const session of sessions) {
    try { evidence.trace.push({ action: 'cleanup', session, result: await stop(session) }) }
    catch (error) { evidence.status = 'FAILED'; evidence.cleanupError = String(error); process.exitCode = 1 }
  }
  for (const timer of timers) clearTimeout(timer)
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  evidence.requests = requests
  evidence.finishedAt = new Date().toISOString()
  await writeFile(new URL('receipt.json', directory), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ status: evidence.status, checks: evidence.checks, error: evidence.error, receipt: new URL('receipt.json', directory).pathname }))
}
