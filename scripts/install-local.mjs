import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeStorage } from '../packages/dsh-linguist/src/host/config.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const dataRoot = join(homedir(), 'Library/Application Support/Linguist-Agent-DSH')
const home = join(homedir(), '.dsh')
const desktopUserDataDir = join(homedir(), 'Library/Application Support/@deepseek-ai/dsh-desktop')
const appPath = '/Applications/DeepSeek Harness.app'
const bskPath = join(dataRoot, 'runtime/browser-skill/bin/bsk')
const bskHome = join(dataRoot, 'browser-skill/home')
const receipts = join(dataRoot, 'receipts')
const pack = JSON.parse(readFileSync(join(root, 'artifacts/pack.json'), 'utf8'))
const desktopManifest = join(home, 'profiles/desktop/package.json')
if (!existsSync(desktopManifest)) throw new Error('请先打开官方 DeepSeek Harness，完成首次初始化，再重试安装辅助命令。普通插件安装请使用 DSH 的“插件 → 安装本地插件”。')
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  return { ...result, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

const baseline = JSON.parse(readFileSync(join(root, 'integrations/browser-skill/BASELINE.json'), 'utf8'))
assert(pack.dshVersion === baseline.dshVersion, 'pack must match the supported Desktop baseline')
assert(existsSync(appPath), '请先安装并打开官方 DeepSeek Harness。')
assert(sha256(pack.linguist.path) === pack.linguist.sha256, 'linguist pack changed')
const prior = join(dataRoot, 'current.json')
const installationId = initializeStorage({ dataRoot, installationId: existsSync(prior) ? JSON.parse(readFileSync(prior, 'utf8')).installationId : '' }).installationId
const staged = {
  linguist: join(dataRoot, 'runtime/packages', `linguist-dsh-plugin-${pack.linguist.sha256.slice(0, 12)}.tgz`),
}
for (const path of [dataRoot, home, desktopUserDataDir, receipts, join(dataRoot, 'runtime/packages'), join(dataRoot, 'runtime/browser-skill/bin'), bskHome, join(dataRoot, 'staging')]) mkdirSync(path, { recursive: true, mode: 0o700 })
if (existsSync(staged.linguist)) assert(sha256(staged.linguist) === pack.linguist.sha256, `${basename(staged.linguist)} exists with another hash`)
else copyFileSync(pack.linguist.path, staged.linguist)
const plist = join(appPath, 'Contents/Info.plist')
for (const [key, value] of [['CFBundleIdentifier', 'com.deepseek.dsh'], ['CFBundleShortVersionString', baseline.dshVersion]]) {
  assert(execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' }).trim() === value, `official app ${key} differs`)
}
const codesign = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
assert(codesign.status === 0, `copied official Desktop signature failed: ${codesign.output}`)
const identity = run('/usr/bin/codesign', ['-dv', '--verbose=4', appPath])
assert(identity.status === 0 && identity.output.includes('Identifier=com.deepseek.dsh') && identity.output.includes('TeamIdentifier=NAN929V4UM'), 'official signing identity differs')
const spctl = run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
assert(spctl.status === 0 && spctl.output.includes('accepted') && spctl.output.includes('Notarized Developer ID'), `Gatekeeper rejected official Desktop: ${spctl.output}`)
const signatureLog = join(receipts, `desktop-codesign-${installationId}.log`)
const spctlLog = join(receipts, `desktop-spctl-${installationId}.log`)
writeFileSync(signatureLog, `codesign --verify --deep --strict ${appPath}\n${codesign.output}codesign -dv --verbose=4 ${appPath}\n${identity.output}exitCode=0\n`, { mode: 0o600 })
writeFileSync(spctlLog, `spctl --assess --type execute --verbose=4 ${appPath}\n${spctl.output}exitCode=0\n`, { mode: 0o600 })
const attestationPath = join(receipts, `desktop-signature-${installationId}.json`)
writeFileSync(attestationPath, `${JSON.stringify({
  appPath, bundleId: 'com.deepseek.dsh', version: baseline.dshVersion, teamId: 'NAN929V4UM',
  codesign: { path: signatureLog, sha256: sha256(signatureLog), exitCode: 0, target: appPath },
  spctl: { path: spctlLog, sha256: sha256(spctlLog), exitCode: 0, target: appPath },
}, null, 2)}\n`, { mode: 0o600 })
const current = {
  installationId, dshVersion: pack.dshVersion, profile: 'desktop', home, desktopUserDataDir, dataRoot, appPath, bskPath, bskHome,
  desktopArtifact: { appPath, bundleId: 'com.deepseek.dsh', version: baseline.dshVersion, teamId: 'NAN929V4UM', attestationPath },
  browserSkill: { channel: 'official-release', extensionStoreUrl: baseline.extension.storeUrl },
  plugins: {
    linguist: { sha256: pack.linguist.sha256, version: pack.linguist.version, tarball: staged.linguist },
  },
}
const manifest = JSON.parse(readFileSync(desktopManifest, 'utf8'))
const name = '@linguist/dsh-plugin'
const spec = manifest.dependencies?.[name]
const installed = spec?.startsWith('file:') && existsSync(spec.slice(5)) && sha256(spec.slice(5)) === pack.linguist.sha256
  && manifest.dsh?.profile?.bundles?.filter(item => item === name).length === 1
if (!installed) {
  console.log(JSON.stringify({ status: 'NATIVE_INSTALL_PENDING', installationId, staged, appPath, profile: join(home, 'profiles/desktop') }, null, 2))
  process.exitCode = 2
} else {
  if (existsSync(prior) && !existsSync(join(receipts, 'pre-desktop-current.json'))) copyFileSync(prior, join(receipts, 'pre-desktop-current.json'))
  const tmp = `${prior}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, prior)
  console.log(JSON.stringify({ status: 'INSTALLED_DESKTOP', installationId, staged, appPath }, null, 2))
}
