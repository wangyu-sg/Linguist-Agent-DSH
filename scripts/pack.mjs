import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = join(root, 'packages/dsh-linguist')
const stage = join(root, 'artifacts/pack-stage')
const artifacts = join(root, 'artifacts')
const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
const tarball = join(artifacts, `linguist-dsh-plugin-${manifest.version}.tgz`)
if (!process.env.npm_execpath) throw new Error('Run this script with pnpm pack:plugin')
const browserSource = join(root, 'integrations/browser-skill/dist/wxg-prc-cpg-browser-skill-dsh-plugin-0.3.1-la-dsh.5.tgz')
const browserTarball = join(artifacts, 'browser-skill-dsh-plugin-0.3.1-la-dsh.5.tgz')
if (!existsSync(join(source, 'lib/index.mjs')) || !existsSync(join(source, 'lib/client.cjs')) || !existsSync(join(source, 'lib/cat-job-worker.js')) || !existsSync(join(source, 'lib/integrity-scrub-worker.js')) || !existsSync(join(source, 'lib/pdf.worker.mjs'))) throw new Error('Build the complete plugin before packing')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
mkdirSync(artifacts, { recursive: true })
for (const item of ['lib', 'resources', 'cordis.patch.yml', 'LICENSE', 'NOTICE.md']) cpSync(join(source, item), join(stage, item), { recursive: true })
manifest.dependencies = Object.fromEntries(Object.entries(manifest.dependencies).filter(([name]) => !name.startsWith('@linguist/')))
delete manifest.devDependencies
delete manifest.scripts
writeFileSync(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--out', tarball], { cwd: stage, stdio: 'inherit' })
const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n')
for (const required of ['package/lib/index.mjs', 'package/lib/client.cjs', 'package/lib/cat-job-worker.js', 'package/lib/integrity-scrub-worker.js', 'package/lib/pdf.worker.mjs', 'package/resources/linguist-roles/general.md', 'package/resources/linguist-roles/translator.md', 'package/resources/linguist-roles/reviewer.md', 'package/resources/linguist-roles/proofreader.md', 'package/resources/skills/phrase-platform-review-ops/SKILL.md', 'package/resources/skills/phrase-platform-review-ops/references/workspace-update.md', 'package/cordis.patch.yml', 'package/LICENSE']) {
  if (!entries.includes(required)) throw new Error(`Plugin tarball omits ${required}`)
}
for (const name of ['phrase-platform-review-ops', 'cultural-lqa', 'game-localization', 'localization-readiness', 'release-lqa', 'terminology-candidate-mining', 'translator-brief']) {
  if (!entries.includes(`package/resources/skills/${name}/SKILL.md`)) throw new Error(`Plugin tarball omits bundled skill ${name}`)
}
if (entries.some(entry => entry.includes('la-doc-sync') || entry.startsWith('package/.agents/'))) throw new Error('Maintenance skills must not be bundled for translators')
for (const entry of entries.filter(name => name.startsWith('package/lib/') && /\.(mjs|cjs|js)$/.test(name))) {
  const code = execFileSync('tar', ['-xOzf', tarball, entry], { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 })
  if (/(?:require\(|from\s+|import\()["']@linguist\//.test(code) || code.includes('linguist-agent-next') || code.includes('/Users/wangyu/Desktop/Linguist-Agent-DSH/')) throw new Error(`Packaged runtime retains a source path or workspace import: ${entry}`)
}
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
let browserSkill
if (existsSync(browserSource)) {
  const baseline = JSON.parse(readFileSync(join(root, 'integrations/browser-skill/BASELINE.json'), 'utf8'))
  if (digest(browserSource) !== baseline.adaptedTarballSha256) throw new Error('BrowserSkill tarball differs from the fixed baseline')
  cpSync(browserSource, browserTarball)
  browserSkill = { path: browserTarball, sha256: digest(browserTarball), version: baseline.adaptedPluginVersion }
}
execFileSync(process.execPath, [join(root, 'scripts/check-package-resources.mjs'), tarball], { cwd: root, stdio: 'inherit' })
writeFileSync(join(artifacts, 'pack.json'), `${JSON.stringify({
  createdAt: new Date().toISOString(), dshVersion: manifest.peerDependencies['@deepseek-ai/dsh-agent'],
  linguist: { path: tarball, sha256: digest(tarball), version: manifest.version },
  ...(browserSkill === undefined ? {} : { browserSkill }),
  entries,
}, null, 2)}\n`)
