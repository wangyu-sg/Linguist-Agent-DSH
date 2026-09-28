import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const sourceRoot = fileURLToPath(new URL('..', import.meta.url))
export const productRoot = join(homedir(), 'Library/Application Support/Linguist-Agent-DSH')
export const currentPath = join(productRoot, 'current.json')
export const smokePath = join(sourceRoot, 'artifacts/evidence/installed-smoke.json')
const officialDesktop = {
  sha256: '30909618ec09559448fc5bb28dffd7111c66e30f9b2142165fb9a812896f6607',
  bundleId: 'com.deepseek.dsh', version: '0.1.7-rc.2', teamId: 'NAN929V4UM',
}

const digest = value => createHash('sha256').update(value).digest('hex')
const fileDigest = path => digest(readFileSync(path))
const childOf = (path, root) => resolve(path).startsWith(`${resolve(root)}${sep}`)
const errorText = error => error instanceof Error ? error.message : String(error)

async function record(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, path)
}

async function tarFiles(path) {
  const { stdout } = await exec('tar', ['-tzf', path], { maxBuffer: 2 * 1024 * 1024 })
  return stdout.trim().split('\n').filter(entry => entry.startsWith('package/') && !entry.endsWith('/'))
}

async function matchInstalledPackage(tarball, installed, required, root) {
  const entries = await tarFiles(tarball)
  for (const file of required) if (!entries.includes(`package/${file}`)) throw new Error(`tarball lacks ${file}`)
  if (!childOf(realpathSync(installed), root)) throw new Error('installed package resolves outside product data root')
  for (const entry of entries) {
    const path = join(installed, entry.slice('package/'.length))
    if (!existsSync(path)) throw new Error(`installed package lacks ${entry}`)
    const { stdout } = await exec('tar', ['-xOzf', tarball, entry], { encoding: 'buffer', maxBuffer: 100 * 1024 * 1024 })
    if (digest(stdout) !== fileDigest(path)) throw new Error(`installed package differs from tarball: ${entry}`)
  }
  return entries.length
}

export async function runInstalledSmoke({ currentFile = currentPath, outputFile = smokePath, root = productRoot } = {}) {
  const checks = []
  const check = async (id, action, missing = 'fail') => {
    try {
      const detail = await action()
      checks.push({ id, outcome: 'pass', detail })
    } catch (error) {
      checks.push({ id, outcome: missing, detail: errorText(error) })
    }
  }
  let current
  let currentValid = false
  let pack
  await check('current', async () => {
    if (!existsSync(currentFile)) throw new Error(`no installed product record at ${currentFile}`)
    current = JSON.parse(readFileSync(currentFile, 'utf8'))
    if (current.profile !== 'desktop') throw new Error('official DSH Desktop reserved desktop profile is required; web is not a delivery carrier')
    if (!current.installationId || !current.home || !current.dataRoot || !current.appPath || !current.desktopUserDataDir || !current.desktopArtifact?.sha256 || !current.desktopArtifact?.path || !current.desktopArtifact?.appPath) throw new Error('official Desktop current.json is incomplete')
    if (current.dataRoot !== root || current.home !== join(root, 'desktop-home') || dirname(current.appPath) !== join(homedir(), 'Desktop')) throw new Error('official Desktop data root or double-click launcher path differs from the isolated product installation')
    if (!childOf(current.desktopArtifact.appPath, root) || !childOf(current.desktopUserDataDir, root)) throw new Error('official Desktop app or user-data directory is outside the isolated product root')
    if (current.appPath === current.desktopArtifact.appPath) throw new Error('double-click launcher must be recorded separately from the copied official Desktop app')
    if (!current.plugins?.linguist?.sha256 || !current.plugins?.browserSkill?.sha256) throw new Error('installed plugin hashes are missing')
    currentValid = true
    return `official Desktop installation ${current.installationId}; reserved desktop profile`
  })
  await check('pack', async () => {
    pack = JSON.parse(readFileSync(join(sourceRoot, 'artifacts/pack.json'), 'utf8'))
    for (const name of ['linguist', 'browserSkill']) {
      if (fileDigest(pack[name].path) !== pack[name].sha256) throw new Error(`${name} build tarball changed since pack.json`)
    }
    return `pack ${fileDigest(join(sourceRoot, 'artifacts/pack.json'))}`
  })
  if (currentValid && pack) {
    await check('identity', async () => {
      if (current.dshVersion !== pack.dshVersion) throw new Error('installed DSH version differs from pack')
      for (const name of ['linguist', 'browserSkill']) {
        if (current.plugins[name].sha256 !== pack[name].sha256 || current.plugins[name].version !== pack[name].version) throw new Error(`${name} install identity differs from current pack`)
        if (!childOf(current.plugins[name].tarball, root)) throw new Error(`${name} installed tarball is outside product data root`)
        if (fileDigest(current.plugins[name].tarball) !== pack[name].sha256) throw new Error(`${name} installed tarball differs from current pack`)
      }
      return `official Desktop ${current.dshVersion}; LA ${pack.linguist.sha256}; BrowserSkill ${pack.browserSkill.sha256}`
    })
    await check('official-desktop', async () => {
      const artifact = current.desktopArtifact
      if (artifact.sha256 !== officialDesktop.sha256 || artifact.bundleId !== officialDesktop.bundleId || artifact.version !== officialDesktop.version || artifact.teamId !== officialDesktop.teamId) throw new Error('official Desktop fixed artifact identity differs from the pinned release')
      if (fileDigest(artifact.path) !== artifact.sha256) throw new Error('official Desktop DMG differs from pinned SHA-256')
      const info = join(artifact.appPath, 'Contents/Info.plist')
      for (const [key, expected] of [['CFBundleIdentifier', artifact.bundleId], ['CFBundleShortVersionString', artifact.version]]) {
        const { stdout } = await exec('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, info])
        if (stdout.trim() !== expected) throw new Error(`installed official Desktop ${key} differs from pinned release`)
      }
      if (!artifact.attestationPath || !childOf(artifact.attestationPath, join(root, 'receipts'))) throw new Error('official Desktop signature attestation is missing or outside the product receipts')
      const attestation = JSON.parse(readFileSync(artifact.attestationPath, 'utf8'))
      if (attestation.appPath !== artifact.appPath || attestation.dmgSha256 !== artifact.sha256 || attestation.bundleId !== artifact.bundleId || attestation.version !== artifact.version || attestation.teamId !== artifact.teamId) throw new Error('official Desktop signature attestation belongs to another artifact')
      for (const command of ['codesign', 'spctl']) {
        const evidence = attestation[command]
        if (evidence?.exitCode !== 0 || !evidence.path || !evidence.target || !childOf(evidence.path, join(root, 'receipts')) || fileDigest(evidence.path) !== evidence.sha256) throw new Error(`${command} attestation log is missing or changed`)
        const log = readFileSync(evidence.path, 'utf8')
        if (!log.includes(command) || !log.includes(evidence.target) || !log.includes('exitCode=0')) throw new Error(`${command} attestation does not record a successful execution against its target`)
        if (command === 'codesign' && (evidence.target !== artifact.appPath || !log.includes(`Identifier=${artifact.bundleId}`) || !log.includes(`TeamIdentifier=${artifact.teamId}`))) throw new Error('codesign did not verify the copied official app and signing identity')
        if (command === 'spctl' && (!log.includes('accepted') || !log.includes('Notarized Developer ID'))) throw new Error('official Desktop did not pass notarized Gatekeeper assessment')
      }
      return `official Desktop DMG ${artifact.sha256}; signed ${artifact.bundleId} ${artifact.version} ${artifact.teamId}; Gatekeeper accepted`
    })
    await check('launcher', async () => {
      const info = join(current.appPath, 'Contents/Info.plist')
      const { stdout } = await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', info])
      const executable = join(current.appPath, 'Contents/MacOS', stdout.trim())
      if (!existsSync(executable) || !existsSync(current.desktopUserDataDir)) throw new Error('double-click launcher or isolated Chromium user-data directory is missing')
      return `double-click launcher ${current.appPath}; independent Chromium user data ${current.desktopUserDataDir}`
    })
    await check('linguist-files', async () => {
      const location = join(current.home, 'profiles/desktop/node_modules/@linguist/dsh-plugin')
      const count = await matchInstalledPackage(current.plugins.linguist.tarball, location, [
        'lib/index.mjs', 'lib/client.cjs', 'lib/cat-job-worker.js', 'lib/integrity-scrub-worker.js',
        'resources/linguist-roles/general.md', 'resources/linguist-roles/translator.md',
        'resources/linguist-roles/reviewer.md', 'resources/linguist-roles/proofreader.md',
        'resources/skills/phrase-platform-review-ops/SKILL.md',
        'resources/skills/phrase-platform-review-ops/references/workspace-update.md', 'cordis.patch.yml',
      ], root)
      const client = readFileSync(join(location, 'lib/client.cjs'), 'utf8')
      if (!client.includes('data-linguist-css') || !client.includes('registerLinguistLocale')) throw new Error('installed Client CSS or locale code is missing')
      if (!existsSync(join(current.home, 'skills/phrase-platform-review-ops/SKILL.md'))) throw new Error('Phrase skill is missing from the isolated DSH skill root')
      return `${count} tarball files match installed LA package including Host, Client, CSS, locale, workers, roles and skill`
    })
    await check('browser-skill-files', async () => {
      const location = join(current.home, 'profiles/desktop/node_modules/@wxg-prc-cpg/browser-skill-dsh-plugin')
      const count = await matchInstalledPackage(current.plugins.browserSkill.tarball, location, [
        'lib/index.mjs', 'lib/client.cjs', 'skill/SKILL.md', 'skill/references/file-transfers.md', 'cordis.patch.yml',
      ], root)
      const host = readFileSync(join(location, 'lib/index.mjs'), 'utf8')
      if (!host.includes('browser_files') || !host.includes('download') || !host.includes('upload')) throw new Error('installed BrowserSkill file actions are absent')
      return `${count} tarball files match the installed sole BrowserSkill plugin`
    })
    await check('profile', async () => {
      const profileDir = join(current.home, 'profiles/desktop')
      const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
      for (const [name, tarball] of [
        ['@linguist/dsh-plugin', current.plugins.linguist.tarball],
        ['@wxg-prc-cpg/browser-skill-dsh-plugin', current.plugins.browserSkill.tarball],
      ]) {
        if (manifest.dependencies?.[name] !== `file:${tarball}`) throw new Error(`${name} profile dependency does not point to the installed tarball`)
        if (manifest.dsh?.profile?.bundles?.filter(bundle => bundle === name).length !== 1) throw new Error(`${name} is not listed exactly once in the official desktop profile`)
      }
      const browserBundles = manifest.dsh.profile.bundles.filter(name => /browser|playwright|puppeteer|\bcdp\b/i.test(name))
      if (browserBundles.length !== 1 || browserBundles[0] !== '@wxg-prc-cpg/browser-skill-dsh-plugin') throw new Error('installed desktop profile contains another browser-control bundle')
      const managedProfilePatch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
      if (managedProfilePatch.includes('# Linguist Agent DSH managed rows.')) throw new Error('Desktop-managed profile was directly modified by the product installer')
      const patch = readFileSync(join(current.home, 'cordis.patch.yml'), 'utf8')
      if ([...patch.matchAll(/^\s*- id: browserskill\s*$/gm)].length !== 1) throw new Error('BrowserSkill profile configuration is not a single owned row')
      if ([...patch.matchAll(/^\s*- id: linguist\s*$/gm)].length !== 1 || !patch.includes(`installationId:`) || !patch.includes(current.installationId) || !patch.includes(`dataRoot:`) || !patch.includes(current.dataRoot)) throw new Error('Linguist profile binding does not match this installation')
      const baseline = JSON.parse(readFileSync(join(sourceRoot, 'integrations/browser-skill/BASELINE.json'), 'utf8'))
      if (!current.bskPath || !childOf(current.bskPath, root) || fileDigest(current.bskPath) !== baseline.cliRelease.binarySha256 || !patch.includes(`bskPath:`) || !patch.includes(current.bskPath)) throw new Error('installed profile does not use the pinned BrowserSkill CLI')
      if (!/- id: session-log-deepseek\s+disabled: true/.test(patch) || !/- id: session-telemetry-otel\s+disabled: true/.test(patch)) throw new Error('installed profile has not disabled extra session logging and telemetry')
      return 'official desktop profile resolves exactly one LA and one BrowserSkill bundle; home-level config pins the BrowserSkill CLI and disables extra logging/telemetry'
    })
    await check('native-plugin-manager', async () => {
      if (!current.nativeInstallReceiptPath || !childOf(current.nativeInstallReceiptPath, join(root, 'receipts'))) throw new Error('native plugin manager receipt is missing or outside the product receipts')
      const receipt = JSON.parse(readFileSync(current.nativeInstallReceiptPath, 'utf8'))
      if (receipt.installationId !== current.installationId || receipt.appPath !== current.appPath || receipt.profile !== 'desktop' || receipt.manager !== 'desktop-native' || !Number.isFinite(Date.parse(receipt.installedAt)) || Date.parse(receipt.installedAt) < Date.parse(pack.createdAt)) throw new Error('native plugin manager receipt belongs to another installation or predates the pack')
      for (const [key, name] of [['linguist', '@linguist/dsh-plugin'], ['browserSkill', '@wxg-prc-cpg/browser-skill-dsh-plugin']]) {
        const matches = receipt.plugins?.filter(item => item.name === name)
        if (matches?.length !== 1 || matches[0].version !== current.plugins[key].version || matches[0].sha256 !== current.plugins[key].sha256 || matches[0].tarball !== current.plugins[key].tarball) throw new Error(`native plugin manager receipt does not identify the installed ${name} tarball exactly once`)
      }
      if (!receipt.actionTracePath || !childOf(receipt.actionTracePath, join(root, 'receipts')) || fileDigest(receipt.actionTracePath) !== receipt.actionTraceSha256) throw new Error('native plugin manager action trace is missing or changed')
      const trace = readFileSync(receipt.actionTracePath, 'utf8')
      for (const value of [current.installationId, current.appPath, 'dsh-app://app/', 'desktop-native', '@linguist/dsh-plugin', '@wxg-prc-cpg/browser-skill-dsh-plugin']) if (!trace.includes(value)) throw new Error(`native plugin manager trace omits ${value}`)
      return `official Desktop native plugin manager installed and enabled both pinned tgz in ${current.home}/profiles/desktop`
    })
  }
  const outcome = checks.some(item => item.outcome === 'fail') ? 'FAILED' : checks.some(item => item.outcome === 'blocked') ? 'BLOCKED_ENV' : 'PASS'
  const receipt = {
    schemaVersion: 1, generatedBy: 'scripts/smoke-installed.mjs', evaluatedAt: new Date().toISOString(),
    status: outcome, currentFile, currentSha256: existsSync(currentFile) ? fileDigest(currentFile) : null,
    installationId: current?.installationId ?? null,
    pluginHashes: current ? { linguist: current.plugins?.linguist?.sha256 ?? null, browserSkill: current.plugins?.browserSkill?.sha256 ?? null } : null,
    checks,
  }
  await record(outputFile, receipt)
  return receipt
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt = await runInstalledSmoke()
  process.stdout.write(`${receipt.status}: ${receipt.checks.map(item => `${item.id}=${item.outcome}`).join(', ')}\n${smokePath}\n`)
  if (receipt.status !== 'PASS') process.exitCode = receipt.status === 'BLOCKED_ENV' ? 2 : 1
}
