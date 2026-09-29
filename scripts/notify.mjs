import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { currentPath } from './smoke-installed.mjs'
import { privatePushProof, readyPath, targetCodeIdentity } from './verify-ready.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const exec = promisify(execFile)
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex')

async function atomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, value)
  await rename(temporary, path)
}

export function classifyReceipt({ receipt, current, pack, currentSha256, packSha256, installedTarballHashes, desktopArtifactSha256, codeTreeHash, codeCommit, acceptanceSha256, smokeSha256, now = Date.now() }) {
  if (!receipt) return { status: 'FAILED', detail: '缺少 verify:ready 生成的验收回执', receipt: null }
  const artifact = current?.desktopArtifact
  const stale = !current || current.profile !== 'desktop' || !current.home || !current.dataRoot || !current.desktopUserDataDir || !artifact?.sha256 || !artifact.path || !artifact.appPath || !artifact.bundleId || !artifact.version || !artifact.teamId || !pack || receipt.schemaVersion !== 1
    || receipt.currentSha256 !== currentSha256 || receipt.packSha256 !== packSha256
    || receipt.installed?.installationId !== current.installationId
    || receipt.installed?.dshVersion !== current.dshVersion || pack.dshVersion !== current.dshVersion
    || receipt.installed?.desktopProfile !== 'desktop'
    || receipt.installed?.desktopArtifactSha256 !== artifact.sha256
    || receipt.installed?.pluginHash !== pack.linguist.sha256
    || receipt.installed?.browserSkill?.plugin !== pack.browserSkill.sha256
    || receipt.installed?.desktopArtifact?.sha256 !== artifact.sha256
    || receipt.installed?.desktopArtifact?.bundleId !== artifact.bundleId
    || receipt.installed?.desktopArtifact?.version !== artifact.version
    || receipt.installed?.desktopArtifact?.teamId !== artifact.teamId
    || desktopArtifactSha256 !== artifact.sha256
    || !current.appPath || current.appPath !== artifact.appPath || artifact.version !== current.dshVersion
    || installedTarballHashes?.linguist !== pack.linguist.sha256
    || installedTarballHashes?.browserSkill !== pack.browserSkill.sha256
    || receipt.launch?.appPath !== current.appPath || receipt.launch?.url !== 'dsh-app://app/' || receipt.launch?.dataRoot !== current.dataRoot
    || receipt.targetCodeIdentity?.treeHash !== codeTreeHash
    || receipt.acceptanceSha256 !== acceptanceSha256 || receipt.smokeSha256 !== smokeSha256
    || !Number.isFinite(Date.parse(receipt.evaluatedAt))
    || now - Date.parse(receipt.evaluatedAt) > 15 * 60_000
    || Date.parse(receipt.evaluatedAt) > now + 60_000
  if (stale) return { status: 'FAILED', detail: '验收回执与当前安装、代码或产物不一致，或已超过 15 分钟；请重新运行 verify:ready', receipt }
  if (receipt.status === 'READY') {
    try {
      privatePushProof(receipt.remotePublished, receipt.remotePushAuthorization, receipt.privatePush, codeCommit)
      if (receipt.remotePublished === true && receipt.targetCodeIdentity?.commit !== codeCommit) throw new Error('READY receipt belongs to a different pushed commit')
    } catch (error) {
      return { status: 'FAILED', detail: `远端推送回执未通过：${error instanceof Error ? error.message : String(error)}`, receipt }
    }
    const gates = receipt.gates?.filter(item => /^G\d\d$/.test(item.id))
    if (gates?.length !== 13 || gates.some(item => item.outcome !== 'pass') || receipt.gates?.find(item => item.id === 'V30')?.outcome !== 'pass' || receipt.blockers?.length || receipt.customerDataTouched !== false || receipt.launch?.reopenVerified !== true) {
      return { status: 'FAILED', detail: 'READY 回执的必需门禁或隐私字段不完整', receipt }
    }
    return { status: 'READY', detail: `桌面入口：${current.appPath}`, receipt }
  }
  const code = receipt.blockers?.map(item => item.code).join('、') || '未知门禁'
  return { status: receipt.status === 'BLOCKED_ENV' ? 'BLOCKED_ENV' : 'FAILED', detail: `${code} 未通过；详见 ${readyPath}`, receipt }
}

export function evaluateReceipt() {
  if (!existsSync(readyPath)) return { status: 'FAILED', detail: '缺少 verify:ready 生成的验收回执', receipt: null }
  const receipt = JSON.parse(readFileSync(readyPath, 'utf8'))
  const current = existsSync(currentPath) ? JSON.parse(readFileSync(currentPath, 'utf8')) : null
  const packPath = join(root, 'artifacts/pack.json')
  const pack = existsSync(packPath) ? JSON.parse(readFileSync(packPath, 'utf8')) : null
  const smokePath = join(root, 'artifacts/evidence/installed-smoke.json')
  const code = targetCodeIdentity()
  return classifyReceipt({
    receipt, current, pack,
    currentSha256: current ? sha(currentPath) : null,
    packSha256: pack ? sha(packPath) : null,
    installedTarballHashes: current && existsSync(current.plugins?.linguist?.tarball) && existsSync(current.plugins?.browserSkill?.tarball)
      ? { linguist: sha(current.plugins.linguist.tarball), browserSkill: sha(current.plugins.browserSkill.tarball) }
      : null,
    desktopArtifactSha256: current?.desktopArtifact?.path && existsSync(current.desktopArtifact.path) ? sha(current.desktopArtifact.path) : null,
    codeTreeHash: code.treeHash, codeCommit: code.commit,
    acceptanceSha256: receipt.acceptancePath && existsSync(receipt.acceptancePath) ? sha(receipt.acceptancePath) : null,
    smokeSha256: existsSync(smokePath) ? sha(smokePath) : null,
  })
}

export async function notifyResult() {
  const result = evaluateReceipt()
  const title = 'Linguist Agent DSH'
  const message = result.status === 'READY'
    ? 'Linguist Agent DSH 已完成并验证，可从桌面打开'
    : result.status === 'BLOCKED_ENV'
      ? `Linguist Agent DSH 环境条件受阻：${result.detail}`
      : `Linguist Agent DSH 验收失败：${result.detail}`
  const report = [
    `# Linguist Agent DSH：${result.status}`,
    '', message, '', result.detail, '',
    `验收回执：${readyPath}`, '',
    ...(result.receipt?.blockers?.length ? ['未通过门禁：', '', ...result.receipt.blockers.map(item => `- ${item.code}: ${item.detail}`), ''] : []),
  ].join('\n')
  const reportPath = join(root, 'artifacts/RESULT.md')
  await atomic(reportPath, report)
  let delivered = false
  let notificationError = null
  try {
    await exec('osascript', [
      '-e', 'on run argv',
      '-e', 'display notification (item 1 of argv) with title (item 2 of argv)',
      '-e', 'end run', '--', message, title,
    ], { timeout: 10000 })
    delivered = true
  } catch (error) {
    notificationError = error instanceof Error ? error.message : String(error)
  }
  const log = { schemaVersion: 1, at: new Date().toISOString(), status: result.status, readyReceipt: readyPath, reportPath, delivered, notificationError }
  await atomic(join(root, 'artifacts/evidence/notification.json'), `${JSON.stringify(log, null, 2)}\n`)
  return log
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await notifyResult()
  process.stdout.write(`${result.status}; systemNotification=${result.delivered ? 'sent' : 'unavailable'}; report=${result.reportPath}\n`)
  if (result.status !== 'READY') process.exitCode = result.status === 'BLOCKED_ENV' ? 2 : 1
}
