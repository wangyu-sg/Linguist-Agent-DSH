import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = join(root, 'packages/dsh-linguist')
const stage = join(root, '.migration/pack-stage')
const artifacts = join(root, 'artifacts')
const tarball = join(artifacts, 'linguist-dsh-plugin-1.0.0.tgz')
const browserSource = join(root, 'integrations/browser-skill/dist/wxg-prc-cpg-browser-skill-dsh-plugin-0.3.1-la-dsh.2.tgz')
const browserTarball = join(artifacts, 'browser-skill-dsh-plugin-0.3.1-la-dsh.2.tgz')
if (!existsSync(join(source, 'lib/index.mjs')) || !existsSync(join(source, 'lib/client.cjs')) || !existsSync(join(source, 'lib/cat-job-worker.js')) || !existsSync(join(source, 'lib/integrity-scrub-worker.js'))) throw new Error('Build the complete plugin before packing')
if (!existsSync(browserSource)) throw new Error('Pinned BrowserSkill adapted tarball is missing')
const browserBaseline = JSON.parse(readFileSync(join(root, 'integrations/browser-skill/BASELINE.json'), 'utf8'))
const browserBuild = JSON.parse(readFileSync(join(root, 'integrations/browser-skill/dist/BUILD.json'), 'utf8'))
const browserHash = createHash('sha256').update(readFileSync(browserSource)).digest('hex')
if (browserHash !== browserBaseline.adaptedTarballSha256 || browserBuild.sha256 !== browserHash || browserBuild.patchSha256 !== browserBaseline.patchSha256 || browserBuild.dshVersion !== browserBaseline.dshVersion) throw new Error('BrowserSkill build receipt does not match its pinned source and artifact')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
mkdirSync(artifacts, { recursive: true })
for (const item of ['lib', 'resources', 'cordis.patch.yml', 'LICENSE', 'NOTICE.md']) cpSync(join(source, item), join(stage, item), { recursive: true })
const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
manifest.dependencies = Object.fromEntries(Object.entries(manifest.dependencies).filter(([name]) => !name.startsWith('@linguist/')))
delete manifest.devDependencies
delete manifest.scripts
writeFileSync(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
execFileSync(join(root, '.toolchain/pnpm-11.7.0/node_modules/.bin/pnpm'), ['pack', '--out', tarball], { cwd: stage, stdio: 'inherit' })
cpSync(browserSource, browserTarball)
const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n')
for (const required of ['package/lib/index.mjs', 'package/lib/client.cjs', 'package/lib/cat-job-worker.js', 'package/lib/integrity-scrub-worker.js', 'package/resources/linguist-roles/general.md', 'package/resources/linguist-roles/translator.md', 'package/resources/linguist-roles/reviewer.md', 'package/resources/linguist-roles/proofreader.md', 'package/resources/skills/phrase-platform-review-ops/SKILL.md', 'package/resources/skills/phrase-platform-review-ops/references/workspace-update.md', 'package/cordis.patch.yml', 'package/LICENSE']) {
  if (!entries.includes(required)) throw new Error(`Plugin tarball omits ${required}`)
}
for (const entry of entries.filter(name => name.startsWith('package/lib/') && /\.(mjs|cjs|js)$/.test(name))) {
  const code = execFileSync('tar', ['-xOzf', tarball, entry], { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 })
  if (/(?:require\(|from\s+|import\()["']@linguist\//.test(code) || code.includes('linguist-agent-next') || code.includes('/Users/wangyu/Desktop/Linguist-Agent-DSH/')) throw new Error(`Packaged runtime retains a source path or workspace import: ${entry}`)
}
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
writeFileSync(join(artifacts, 'pack.json'), `${JSON.stringify({
  createdAt: new Date().toISOString(), dshVersion: '0.2.0-rc.1',
  linguist: { path: tarball, sha256: digest(tarball), version: manifest.version },
  browserSkill: { path: browserTarball, sha256: digest(browserTarball), version: '0.3.1-la-dsh.2' },
  entries,
}, null, 2)}\n`)
