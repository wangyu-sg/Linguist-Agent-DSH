import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dataRoot = join(homedir(), 'Library/Application Support/Linguist-Agent-DSH')
const current = JSON.parse(readFileSync(join(dataRoot, 'current.json'), 'utf8'))
const appPath = '/Applications/DeepSeek Harness.app'
const executable = join(appPath, 'Contents/MacOS/DeepSeek Harness')
const userDataDir = join(homedir(), 'Library/Application Support/@deepseek-ai/dsh-desktop')
const lockPath = join(userDataDir, 'SingletonLock')
const receipts = join(dataRoot, 'receipts')

if (current.profile !== 'desktop' || current.dshVersion !== '0.2.0-rc.1' || current.dataRoot !== dataRoot || current.home !== join(homedir(), '.dsh') || current.appPath !== appPath || current.desktopUserDataDir !== userDataDir || current.desktopArtifact?.appPath !== appPath || current.bskHome !== join(dataRoot, 'browser-skill/home')) throw new Error('current.json does not identify this official Desktop plugin installation')
if (!existsSync(executable) || !existsSync(join(current.home, 'profiles/desktop/package.json')) || !existsSync(userDataDir)) throw new Error('official Desktop, desktop profile, or Chromium data directory is missing')

function ownedMainPid() {
  let lock
  try { lock = readlinkSync(lockPath) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  const match = lock.match(/-(\d+)$/)
  if (!match) throw new Error('Chromium SingletonLock has no process ID')
  const pid = Number(match[1])
  try { process.kill(pid, 0) }
  catch (error) { if (error.code === 'ESRCH') return null; throw error }
  const processInfo = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8' })
  if (processInfo.error) throw processInfo.error
  if (processInfo.status !== 0) throw new Error(`cannot inspect Desktop process ${pid}: ${processInfo.stderr.trim()}`)
  const command = processInfo.stdout.trim()
  if (command !== executable && !command.startsWith(`${executable} `)) throw new Error(`SingletonLock PID ${pid} is not the installed official Desktop process`)
  return pid
}

function record(result) {
  mkdirSync(receipts, { recursive: true, mode: 0o700 })
  const path = join(receipts, `desktop-launch-${current.installationId}-${Date.now()}-${process.pid}.json`)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(), installationId: current.installationId, launcherPath: current.appPath, appPath, userDataDir, ...result }, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
  return path
}

let pid
try { pid = ownedMainPid() }
catch (error) {
  record({ status: 'REFUSED', pid: null, startedNewProcess: false, error: error.message })
  throw error
}
if (pid !== null) {
  const receipt = record({ status: 'ALREADY_RUNNING', pid, startedNewProcess: false })
  console.log(JSON.stringify({ status: 'ALREADY_RUNNING', installationId: current.installationId, pid, receipt }))
} else {
  let openRequested = false
  try {
    const opened = spawnSync('/usr/bin/open', ['-a', appPath], { encoding: 'utf8' })
    if (opened.error) throw opened.error
    if (opened.status !== 0) throw new Error(`official Desktop open failed: ${opened.stderr.trim()}`)
    openRequested = true
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500))
      pid = ownedMainPid()
      if (pid !== null) break
    }
    if (pid === null) throw new Error('official Desktop did not create a Chromium SingletonLock within 20 seconds')
    const receipt = record({ status: 'LAUNCHED', pid, startedNewProcess: true, openExitCode: opened.status })
    console.log(JSON.stringify({ status: 'LAUNCHED', installationId: current.installationId, pid, receipt }))
  } catch (error) {
    record({ status: 'FAILED', pid: null, openRequested, startedNewProcess: null, error: error.message })
    throw error
  }
}
