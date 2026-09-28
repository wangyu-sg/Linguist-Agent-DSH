import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const readyPath = join(root, 'artifacts/READY.json')
const reportPath = join(root, 'artifacts/evidence/delivery.json')
const notificationPath = join(root, 'artifacts/evidence/notification.json')
const startedAt = Date.now()
const steps = []
const resume = process.argv.includes('--resume')

function run(id, script) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', script)], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  const step = { id, command: `node scripts/${script}`, exitCode: result.status ?? 1, ...(result.error ? { error: result.error.message } : {}) }
  steps.push(step)
  return step
}

let pending = false
if (!resume) {
  for (const [id, script] of [
    ['prepare:local', 'prepare.mjs'],
    ['build', 'build.mjs'],
    ['pack:plugin', 'pack.mjs'],
    ['test:required', 'test-required.mjs'],
    ['test:copied-domain', 'test-copied-domain.mjs'],
  ]) {
    if (run(id, script).exitCode !== 0) { pending = true; break }
  }
}
if (!pending && run('install:local', 'install-local.mjs').exitCode !== 0) pending = true
if (!pending) {
  run('smoke:installed', 'smoke-installed.mjs')
  run('test:ui', 'test-ui.mjs')
  run('verify:ready', 'verify-ready.mjs')
}
const receipt = !pending && existsSync(readyPath) && statSync(readyPath).mtimeMs >= startedAt
  ? JSON.parse(readFileSync(readyPath, 'utf8')) : null
if (receipt?.status === 'READY' && steps.every(step => step.exitCode === 0)) run('notify:result', 'notify.mjs')
else steps.push({ id: 'notify:result', command: 'node scripts/notify.mjs', skipped: true, reason: 'current installed artifact has not passed every delivery gate' })

const notification = existsSync(notificationPath) && statSync(notificationPath).mtimeMs >= startedAt
  ? JSON.parse(readFileSync(notificationPath, 'utf8')) : null
const status = pending ? steps.at(-2)?.id === 'install:local' && steps.at(-2)?.exitCode === 2 ? 'BLOCKED_ENV' : 'FAILED'
  : receipt?.status === 'READY' && (notification?.status !== 'READY' || notification?.delivered !== true) ? 'FAILED'
  : receipt?.status ?? 'FAILED'
const report = { schemaVersion: 1, startedAt: new Date(startedAt).toISOString(), completedAt: new Date().toISOString(), status, readyPath: receipt ? readyPath : null, notificationPath: notification ? notificationPath : null, steps }
mkdirSync(dirname(reportPath), { recursive: true })
const temporary = `${reportPath}.${process.pid}.tmp`
writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`)
renameSync(temporary, reportPath)
process.stdout.write(`${status}: ${reportPath}\n`)
if (status !== 'READY') process.exitCode = status === 'BLOCKED_ENV' ? 2 : 1
