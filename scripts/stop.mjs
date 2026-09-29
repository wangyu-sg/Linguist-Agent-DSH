import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readlinkSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dataRoot = join(homedir(), 'Library/Application Support/Linguist-Agent-DSH')
const current = JSON.parse(readFileSync(join(dataRoot, 'current.json'), 'utf8'))
const appPath = '/Applications/DeepSeek Harness.app'
const executable = join(appPath, 'Contents/MacOS/DeepSeek Harness')
const userDataDir = join(homedir(), 'Library/Application Support/@deepseek-ai/dsh-desktop')
const lockPath = join(userDataDir, 'SingletonLock')
const receipts = join(dataRoot, 'receipts')

if (current.profile !== 'desktop' || current.dshVersion !== '0.2.0-rc.1' || current.dataRoot !== dataRoot || current.home !== join(homedir(), '.dsh') || current.appPath !== appPath || current.desktopUserDataDir !== userDataDir || current.desktopArtifact?.appPath !== appPath) throw new Error('current.json does not identify this official Desktop plugin installation')

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
  const path = join(receipts, `desktop-stop-${current.installationId}-${Date.now()}-${process.pid}.json`)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(), installationId: current.installationId, launcherPath: current.appPath, appPath, userDataDir, ...result }, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
  return path
}

let pid
try { pid = ownedMainPid() }
catch (error) {
  record({ status: 'REFUSED', pid: null, signalSent: false, processExited: false, error: error.message })
  throw error
}
if (pid === null) {
  const receipt = record({ status: 'ALREADY_STOPPED', pid: null, signalSent: false, processExited: null })
  console.log(JSON.stringify({ status: 'ALREADY_STOPPED', installationId: current.installationId, receipt }))
} else {
  let signalSent = false
  try {
    process.kill(pid, 'SIGTERM')
    signalSent = true
    let active = pid
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250))
      active = ownedMainPid()
      if (active === null) break
      if (active !== pid) throw new Error(`another product Desktop process ${active} started while stopping ${pid}`)
    }
    if (active !== null) throw new Error(`official Desktop process ${pid} did not exit after SIGTERM`)
    const receipt = record({ status: 'STOPPED', pid, signalSent, processExited: true })
    console.log(JSON.stringify({ status: 'STOPPED', installationId: current.installationId, pid, receipt }))
  } catch (error) {
    record({ status: 'FAILED', pid, signalSent, processExited: false, error: error.message })
    throw error
  }
}
