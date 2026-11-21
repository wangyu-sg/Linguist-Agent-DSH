import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPluginDisplay } from './check-plugin-display.mjs'
import { checkPluginDetail } from './check-plugin-detail.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = join(root, 'packages/dsh-linguist')
const artifacts = process.argv[2] === undefined ? join(root, 'artifacts') : resolve(root, process.argv[2])
const stage = join(artifacts, 'pack-stage')
const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
const baseline = JSON.parse(readFileSync(join(root, 'scripts/dsh-baseline.json'), 'utf8'))
const tarball = join(artifacts, `linguist-dsh-plugin-${manifest.version}.tgz`)
if (!process.env.npm_execpath) throw new Error('Run this script with pnpm pack:plugin')
if (!existsSync(join(source, 'lib/semantic-review.py'))) throw new Error('Build the local semantic retrieval resource before packing')
if (!existsSync(join(source, 'lib/index.mjs')) || !existsSync(join(source, 'lib/client.cjs')) || !existsSync(join(source, 'lib/cat-job-worker.js')) || !existsSync(join(source, 'lib/integrity-scrub-worker.js')) || !existsSync(join(source, 'lib/pdf.worker.mjs'))) throw new Error('Build the complete plugin before packing')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
mkdirSync(artifacts, { recursive: true })
for (const item of ['lib', 'resources', 'locale', 'README.md', 'README.zh.md', 'cordis.patch.yml', 'LICENSE', 'NOTICE.md']) cpSync(join(source, item), join(stage, item), { recursive: true })
manifest.dependencies = Object.fromEntries(Object.entries(manifest.dependencies).filter(([name]) => !name.startsWith('@linguist/')))
delete manifest.devDependencies
delete manifest.scripts
writeFileSync(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--out', tarball], { cwd: stage, stdio: 'inherit' })
const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n')
if (!entries.includes('package/lib/semantic-review.py')) throw new Error('Plugin tarball omits the local semantic retrieval resource')
for (const required of ['package/lib/index.mjs', 'package/lib/client.cjs', 'package/lib/cat-job-worker.js', 'package/lib/integrity-scrub-worker.js', 'package/lib/pdf.worker.mjs', 'package/resources/linguist-roles/general.md', 'package/resources/linguist-roles/translator.md', 'package/resources/linguist-roles/reviewer.md', 'package/resources/linguist-roles/proofreader.md', 'package/resources/skills/phrase-platform-review-ops/SKILL.md', 'package/resources/skills/phrase-platform-review-ops/references/editor-and-data.md', 'package/resources/skills/phrase-platform-review-ops/references/references-and-comments.md', 'package/resources/skills/phrase-platform-review-ops/references/editing-and-save.md', 'package/resources/skills/phrase-platform-review-ops/references/workspace-update.md', 'package/resources/skills/weloc-platform-ops/SKILL.md', 'package/resources/skills/weloc-platform-ops/references/editor-and-data.md', 'package/resources/skills/weloc-platform-ops/references/references-and-comments.md', 'package/resources/skills/weloc-platform-ops/references/editing-and-save.md', 'package/resources/professional-judgment/standard.v1.json', 'package/resources/professional-judgment/examples.v1.json', 'package/cordis.patch.yml', 'package/LICENSE']) {
  if (!entries.includes(required)) throw new Error(`Plugin tarball omits ${required}`)
}
for (const name of ['phrase-platform-review-ops', 'weloc-platform-ops', 'cultural-lqa', 'game-localization', 'localization-readiness', 'release-lqa', 'terminology-candidate-mining', 'translator-brief']) {
  if (!entries.includes(`package/resources/skills/${name}/SKILL.md`)) throw new Error(`Plugin tarball omits bundled skill ${name}`)
}
for (const reference of ['cat', 'working-copy', 'browser', 'project-evidence', 'workspace-maintenance', 'delivery']) {
  if (!entries.includes(`package/resources/skills/game-localization/references/${reference}.md`)) throw new Error(`Plugin tarball omits localization reference ${reference}`)
}
for (const kind of ['translation', 'review']) {
  if (!entries.includes(`package/resources/delivery-templates/${kind}.xlsx`)) throw new Error(`Plugin tarball omits the ${kind} workbook`)
}
if (entries.some(entry => entry.includes('la-doc-sync') || entry.startsWith('package/.agents/'))) throw new Error('Maintenance skills must not be bundled for translators')
for (const entry of entries.filter(name => name.startsWith('package/lib/') && /\.(mjs|cjs|js)$/.test(name))) {
  const code = execFileSync('tar', ['-xOzf', tarball, entry], { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 })
  if (/(?:require\(|from\s+|import\()["']@linguist\//.test(code) || code.includes('linguist-agent-next') || code.includes(root)) throw new Error(`Packaged runtime retains a source path or workspace import: ${entry}`)
}
checkPluginDisplay(tarball)
console.log('PASS: Linguist native plugin display resources (en, zh, PNG)')
const detail = await checkPluginDetail(tarball)
console.log(`PASS: Linguist native plugin detail documents (${Object.entries(detail.documents).map(([language, document]) => `${language} → ${document.path}`).join(', ')})`)
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
execFileSync(process.execPath, [join(root, 'scripts/check-package-resources.mjs'), tarball], { cwd: root, stdio: 'inherit' })
writeFileSync(join(artifacts, 'pack.json'), `${JSON.stringify({
  createdAt: new Date().toISOString(), dshVersion: baseline.dshVersion,
  linguist: { path: tarball, sha256: digest(tarball), version: manifest.version },
  entries,
}, null, 2)}\n`)
