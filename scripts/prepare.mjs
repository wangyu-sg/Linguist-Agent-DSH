import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const baseline = JSON.parse(readFileSync(join(root, 'integrations/browser-skill/BASELINE.json'), 'utf8'))
const files = {
  desktopDmg: join(root, '.toolchain/desktop/deepseek-harness-0.2.0-rc.2-mac-arm64.dmg'),
  browserSkillCli: join(root, '.toolchain/browser-skill/bin/bsk'),
  browserSkillExtension: join(root, '.toolchain/browser-skill/downloads', baseline.cliRelease.version, baseline.extensionRelease.archive),
  bun: join(root, '.toolchain/bun-1.3.14/bun-darwin-aarch64/bun'),
  pnpm: join(root, '.toolchain/pnpm-11.7.0/node_modules/pnpm/bin/pnpm.mjs'),
  dsh: join(root, '.toolchain/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/dsh/package.json'),
  typescript: join(root, 'node_modules/.bin/tsc'),
  tsdown: join(root, 'node_modules/.bin/tsdown'),
  desktopNode: '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node',
}
for (const [name, path] of Object.entries(files)) {
  if (!existsSync(path)) throw new Error(`${name} missing from the isolated fixed toolchain: ${path}`)
}
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const expected = {
  desktopDmg: '7c32c459c403d8a035ac60600f240ed2025312f0a7afde283f454f30ec4ed96e',
  browserSkillCli: baseline.cliRelease.binarySha256,
  browserSkillExtension: baseline.extensionRelease.archiveSha256,
  bun: 'e0c90ec15d33363e6b70713d56bc3b2c7585c17f40a0fe0f8fd9305901d4e233',
}
for (const [name, digest] of Object.entries(expected)) {
  if (sha(files[name]) !== digest) throw new Error(`${name} differs from its fixed SHA-256`)
}
const version = (binary, args = ['--version']) => execFileSync(binary, args, { encoding: 'utf8' }).trim()
const versions = {
  node: version(files.desktopNode),
  pnpm: version(files.desktopNode, [files.pnpm, '--version']),
  bun: version(files.bun),
  dsh: JSON.parse(readFileSync(files.dsh, 'utf8')).version,
  browserSkill: version(files.browserSkillCli),
}
if (versions.node !== 'v24.21.0' || versions.pnpm !== '11.7.0' || versions.bun !== '1.3.14' || versions.dsh !== '0.2.0-rc.2' || versions.browserSkill !== `bsk ${baseline.cliRelease.version}`) {
  throw new Error(`fixed toolchain version mismatch: ${JSON.stringify(versions)}`)
}
version(files.desktopNode, ['-e', 'require("node:sqlite")'])
const receipt = { schemaVersion: 1, checkedAt: new Date().toISOString(), status: 'PASS', versions, files: Object.fromEntries(Object.entries(expected).map(([name, digest]) => [name, { path: files[name], sha256: digest }])) }
const output = join(root, 'artifacts/evidence/toolchain.json')
mkdirSync(join(root, 'artifacts/evidence'), { recursive: true })
writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`)
process.stdout.write(`PASS: fixed local toolchain; ${output}\n`)
