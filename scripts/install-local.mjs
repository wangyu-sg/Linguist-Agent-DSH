import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dataRoot = join(homedir(), 'Library/Application Support/Linguist-Agent-DSH')
const home = join(dataRoot, 'desktop-home')
const desktopUserDataDir = join(dataRoot, 'desktop-user-data')
const appPath = join(homedir(), 'Desktop/Linguist Agent DSH.app')
const officialApp = join(dataRoot, 'official-desktop/0.1.7-rc.2/DeepSeek Harness.app')
const dmg = join(root, '.toolchain/desktop/deepseek-harness-0.1.7-rc.2-mac-arm64.dmg')
const dmgSha256 = '30909618ec09559448fc5bb28dffd7111c66e30f9b2142165fb9a812896f6607'
const bskPath = join(dataRoot, 'runtime/browser-skill/bin/bsk')
const bskHome = join(dataRoot, 'browser-skill/home')
const receipts = join(dataRoot, 'receipts')
const pack = JSON.parse(readFileSync(join(root, 'artifacts/pack.json'), 'utf8'))
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const q = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$').replaceAll('`', '\\`')}"`
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  return { ...result, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

assert(pack.dshVersion === '0.1.7-rc.2', 'pack must match official Desktop 0.1.7-rc.2')
assert(sha256(dmg) === dmgSha256, 'official Desktop DMG SHA-256 changed')
for (const key of ['linguist', 'browserSkill']) assert(sha256(pack[key].path) === pack[key].sha256, `${key} pack changed`)
const installationId = `la-${pack.linguist.sha256.slice(0, 12)}-${pack.browserSkill.sha256.slice(0, 8)}`
const staged = {
  linguist: join(dataRoot, 'runtime/packages', `linguist-dsh-plugin-${pack.linguist.sha256.slice(0, 12)}.tgz`),
  browserSkill: join(dataRoot, 'runtime/packages/browser-skill-dsh-plugin-0.3.1-la-dsh.1.tgz'),
}
for (const path of [dataRoot, home, desktopUserDataDir, receipts, join(dataRoot, 'runtime/packages'), join(dataRoot, 'runtime/browser-skill/bin'), bskHome, join(dataRoot, 'browser-skill/session-state'), join(dataRoot, 'staging')]) mkdirSync(path, { recursive: true, mode: 0o700 })
for (const key of ['linguist', 'browserSkill']) {
  if (existsSync(staged[key])) assert(sha256(staged[key]) === pack[key].sha256, `${basename(staged[key])} exists with another hash`)
  else copyFileSync(pack[key].path, staged[key])
}
const baseline = JSON.parse(readFileSync(join(root, 'integrations/browser-skill/BASELINE.json'), 'utf8'))
if (!existsSync(bskPath)) copyFileSync(join(root, '.toolchain/browser-skill/bin/bsk'), bskPath)
assert(sha256(bskPath) === baseline.cliRelease.binarySha256, 'pinned BrowserSkill CLI differs')
const extension = join(dataRoot, 'runtime/browser-skill/extension-v0.3.1')
if (!existsSync(extension)) cpSync(join(root, '.toolchain/browser-skill/extension-v0.3.1'), extension, { recursive: true })
if (!existsSync(officialApp)) {
  const mount = join(tmpdir(), `la-dsh-official-${process.pid}`)
  mkdirSync(mount)
  execFileSync('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg], { stdio: 'ignore' })
  try {
    mkdirSync(join(dataRoot, 'official-desktop/0.1.7-rc.2'), { recursive: true })
    execFileSync('/usr/bin/ditto', [join(mount, 'DeepSeek Harness.app'), officialApp])
  } finally { execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: 'ignore' }) }
}
const plist = join(officialApp, 'Contents/Info.plist')
for (const [key, value] of [['CFBundleIdentifier', 'com.deepseek.dsh'], ['CFBundleShortVersionString', '0.1.7-rc.2']]) {
  assert(execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' }).trim() === value, `official app ${key} differs`)
}
const codesign = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', officialApp])
assert(codesign.status === 0, `copied official Desktop signature failed: ${codesign.output}`)
const identity = run('/usr/bin/codesign', ['-dv', '--verbose=4', officialApp])
assert(identity.status === 0 && identity.output.includes('Identifier=com.deepseek.dsh') && identity.output.includes('TeamIdentifier=NAN929V4UM'), 'official signing identity differs')
const spctl = run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', officialApp])
assert(spctl.status === 0 && spctl.output.includes('accepted') && spctl.output.includes('Notarized Developer ID'), `Gatekeeper rejected official Desktop: ${spctl.output}`)
const signatureLog = join(receipts, `desktop-codesign-${installationId}.log`)
const spctlLog = join(receipts, `desktop-spctl-${installationId}.log`)
writeFileSync(signatureLog, `codesign --verify --deep --strict ${officialApp}\n${codesign.output}codesign -dv --verbose=4 ${officialApp}\n${identity.output}exitCode=0\n`, { mode: 0o600 })
writeFileSync(spctlLog, `spctl --assess --type execute --verbose=4 ${officialApp}\n${spctl.output}exitCode=0\n`, { mode: 0o600 })
const attestationPath = join(receipts, `desktop-signature-${installationId}.json`)
writeFileSync(attestationPath, `${JSON.stringify({
  appPath: officialApp, dmgSha256, bundleId: 'com.deepseek.dsh', version: '0.1.7-rc.2', teamId: 'NAN929V4UM',
  codesign: { path: signatureLog, sha256: sha256(signatureLog), exitCode: 0, target: officialApp },
  spctl: { path: spctlLog, sha256: sha256(spctlLog), exitCode: 0, target: officialApp },
}, null, 2)}\n`, { mode: 0o600 })
const patchPath = join(home, 'cordis.patch.yml')
const patch = `# Linguist Agent DSH isolated home configuration.\n- id: session-log-deepseek\n  disabled: true\n- id: session-telemetry-otel\n  disabled: true\n- id: time-context\n  disabled: false\n- id: schedule\n  disabled: false\n- id: ui-schedule\n  disabled: false\n- id: browserskill\n  config:\n    bskPath: ${JSON.stringify(bskPath)}\n    fileStagingDirectory: ${JSON.stringify(join(dataRoot, 'staging'))}\n    sessionStateDirectory: ${JSON.stringify(join(dataRoot, 'browser-skill/session-state'))}\n    lazyTools: true\n- id: linguist\n  config:\n    dataRoot: ${JSON.stringify(dataRoot)}\n    installationId: ${JSON.stringify(installationId)}\n`
if (existsSync(patchPath)) {
  const existing = readFileSync(patchPath, 'utf8')
  assert(existing.startsWith('# Linguist Agent DSH isolated home configuration.'), 'independent DSH home has another user patch; inspect before changing')
  const identities = existing.match(/^    installationId: .*$/gm)
  assert(identities?.length === 1, 'independent DSH home has no unique Linguist installationId')
  writeFileSync(patchPath, existing.replace(identities[0], `    installationId: ${JSON.stringify(installationId)}`), { mode: 0o600 })
} else writeFileSync(patchPath, patch, { mode: 0o600 })
const content = join(appPath, 'Contents')
if (!existsSync(appPath)) {
  mkdirSync(join(content, 'MacOS'), { recursive: true })
  writeFileSync(join(content, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>CFBundleIdentifier</key><string>io.linguist-agent.dsh</string>\n<key>CFBundleName</key><string>Linguist Agent DSH</string>\n<key>CFBundleExecutable</key><string>LinguistAgentDSH</string>\n<key>CFBundlePackageType</key><string>APPL</string>\n<key>CFBundleVersion</key><string>1.0.0</string>\n</dict></plist>\n`)
}
assert(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(content, 'Info.plist')], { encoding: 'utf8' }).trim() === 'io.linguist-agent.dsh', 'desktop entry belongs to another app')
const wrapper = join(content, 'MacOS/LinguistAgentDSH')
writeFileSync(wrapper, [
  '#!/bin/sh',
  'set -eu',
  `app=${q(officialApp)}`,
  `home=${q(home)}`,
  `bsk_home=${q(bskHome)}`,
  `user_data=${q(desktopUserDataDir)}`,
  'lock="$user_data/SingletonLock"',
  'if [ -L "$lock" ]; then',
  '  target=$(/usr/bin/readlink "$lock")',
  '  pid=${target##*-}',
  '  case "$pid" in ""|*[!0-9]*) exit 1;; esac',
  '  if /bin/kill -0 "$pid" 2>/dev/null; then',
  '    command=$(/bin/ps -p "$pid" -o args=)',
  '    case "$command" in "$app/Contents/MacOS/DeepSeek Harness "*) ;; *) exit 1;; esac',
  '    case "$command" in *" --user-data-dir=$user_data"|*" --user-data-dir=$user_data "*) exec /usr/bin/open -a "$app";; *) exit 1;; esac',
  '  fi',
  'fi',
  'exec /usr/bin/open -n -a "$app" --env "DSH_HOME=$home" --env "BSK_HOME=$bsk_home" --args "--user-data-dir=$user_data"',
  '',
].join('\n'), { mode: 0o755 })
chmodSync(wrapper, 0o755)
const current = {
  installationId, dshVersion: pack.dshVersion, profile: 'desktop', home, desktopUserDataDir, dataRoot, appPath, bskPath, bskHome,
  desktopArtifact: { path: dmg, sha256: dmgSha256, appPath: officialApp, bundleId: 'com.deepseek.dsh', version: '0.1.7-rc.2', teamId: 'NAN929V4UM', attestationPath },
  plugins: {
    linguist: { sha256: pack.linguist.sha256, version: pack.linguist.version, tarball: staged.linguist },
    browserSkill: { sha256: pack.browserSkill.sha256, version: pack.browserSkill.version, tarball: staged.browserSkill },
  },
  nativeInstallReceiptPath: join(receipts, `native-install-${installationId}.json`),
}
const manifest = JSON.parse(readFileSync(join(home, 'profiles/desktop/package.json'), 'utf8'))
const wanted = [['@linguist/dsh-plugin', staged.linguist], ['@wxg-prc-cpg/browser-skill-dsh-plugin', staged.browserSkill]]
const installed = wanted.every(([name, tarball]) => manifest.dependencies?.[name] === `file:${tarball}` && manifest.dsh?.profile?.bundles?.filter(item => item === name).length === 1)
if (!installed) {
  console.log(JSON.stringify({ status: 'NATIVE_INSTALL_PENDING', installationId, staged, officialApp, appPath, profile: join(home, 'profiles/desktop') }, null, 2))
  process.exitCode = 2
} else {
  assert(existsSync(current.nativeInstallReceiptPath), `native Desktop UI receipt missing: ${current.nativeInstallReceiptPath}`)
  const bundledSkill = join(home, 'profiles/desktop/node_modules/@linguist/dsh-plugin/resources/skills/phrase-platform-review-ops')
  assert(existsSync(join(bundledSkill, 'SKILL.md')), 'installed Linguist plugin omits its Phrase skill')
  const skillRoot = join(home, 'skills')
  const userSkill = join(skillRoot, 'phrase-platform-review-ops')
  mkdirSync(skillRoot, { recursive: true, mode: 0o700 })
  if (!existsSync(userSkill)) cpSync(bundledSkill, userSkill, { recursive: true })
  else if (sha256(join(userSkill, 'SKILL.md')) !== sha256(join(bundledSkill, 'SKILL.md'))) console.warn('preserved existing product Phrase skill customization')
  const prior = join(dataRoot, 'current.json')
  if (existsSync(prior) && !existsSync(join(receipts, 'pre-desktop-current.json'))) copyFileSync(prior, join(receipts, 'pre-desktop-current.json'))
  const tmp = `${prior}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, prior)
  console.log(JSON.stringify({ status: 'INSTALLED_DESKTOP', installationId, staged, officialApp, appPath }, null, 2))
}
