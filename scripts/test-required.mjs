import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const evidenceDir = join(root, 'artifacts/evidence')
const logPath = join(evidenceDir, 'required-synthetic.log')
const receiptPath = join(evidenceDir, 'required-synthetic.json')
const auditPath = join(evidenceDir, 'source-inventory-audit.json')
const loader = './packages/linguist-cat-store/test/register-ts-loader.mjs'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

mkdirSync(evidenceDir, { recursive: true })
const map = JSON.parse(readFileSync(join(root, 'docs/migration/FEATURE_MAP.json'), 'utf8'))
const sourceRoot = join(root, '.migration/source-snapshot')
const seen = new Set()
const audit = {
  schemaVersion: 1, auditedAt: new Date().toISOString(), inventoryCount: map.sourceInventory.files.length,
  statuses: {}, pending: [], resolved: [], features: [], tools: [], validations: [], errors: [],
}
if (map.sourceInventory.fileCount !== map.sourceInventory.files.length || map.sourceInventory.files.length < 316) {
  audit.errors.push('The expanded source inventory is smaller than the audited 316-file baseline or its recorded count differs')
}
for (const item of map.sourceInventory.files) {
  if (seen.has(item.sourcePath)) audit.errors.push(`Duplicate source path: ${item.sourcePath}`)
  seen.add(item.sourcePath)
  if (!existsSync(join(sourceRoot, item.sourcePath))) audit.errors.push(`Source snapshot file missing: ${item.sourcePath}`)
  audit.statuses[item.status] = (audit.statuses[item.status] ?? 0) + 1
  if (item.status === 'complete' && (!item.targetPath || !existsSync(join(root, item.targetPath)))) {
    audit.errors.push(`Completed target file missing: ${item.sourcePath}`)
  }
  if (item.status === 'host-replaced' || item.status === 'excluded') {
    if (!item.reason || !item.targetEntry || !existsSync(join(root, item.targetEntry)) || !item.evidencePaths?.length) {
      audit.errors.push(`${item.status} lacks reason, existing targetEntry or evidence: ${item.sourcePath}`)
    }
  }
  if (item.status === 'pending' || item.status === 'not_started') audit.pending.push({ sourcePath: item.sourcePath, candidateTargetEntry: item.targetEntry, auditNote: item.auditNote })
  else audit.resolved.push({ sourcePath: item.sourcePath, status: item.status, targetEntry: item.targetEntry ?? item.targetPath, ...(item.reason ? { reason: item.reason } : {}) })
}
for (const item of map.featureSurfaces) {
  audit.features.push({ id: item.id, status: item.status, targetEntry: item.targetEntry, remainingVerification: item.remainingVerification })
  if (item.status === 'complete' && (!item.targetEntry || !existsSync(join(root, item.targetEntry)))) audit.errors.push(`Completed feature target missing: ${item.id}`)
}
for (const item of map.tools) {
  audit.tools.push({ id: item.id, name: item.name, status: item.status, targetEntry: item.targetEntry })
  if (item.status === 'complete' && (!item.targetEntry || !existsSync(join(root, item.targetEntry)))) audit.errors.push(`Completed tool target missing: ${item.id}`)
}
for (const item of map.validationFamilies) audit.validations.push({ id: item.id, status: item.status })
writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`)

const checks = [
  ...['linguist-cat-core', 'linguist-cat-formats', 'linguist-cat-store', 'linguist-cat-tools', 'linguist-legacy-migration', 'linguist-domain-service'].map(name => ({
    id: `typecheck:${name}`,
    command: join(root, 'node_modules/.bin/tsc'),
    args: ['--noEmit', '-p', join(root, 'packages', name, 'tsconfig.json')],
  })),
  {
    id: 'typecheck:dsh-host', command: join(root, 'node_modules/.bin/tsc'),
    args: ['--noEmit', '-p', join(root, 'packages/dsh-linguist/tsconfig.host.json')],
  },
  {
    id: 'typecheck:dsh-client', command: join(root, 'node_modules/.bin/tsc'),
    args: ['--noEmit', '-p', join(root, 'packages/dsh-linguist/tsconfig.client.json')],
  },
  {
    id: 'required-node-tests', command: process.execPath,
    args: ['--experimental-test-module-mocks', '--experimental-transform-types', '--import', loader, '--test',
      'packages/linguist-cat-store/src/database.nodetest.ts',
      'packages/linguist-cat-store/src/store.nodetest.ts',
      'packages/linguist-cat-store/src/segments.nodetest.ts',
      'packages/linguist-cat-store/src/stage-evidence.nodetest.ts',
      'packages/linguist-cat-store/src/context-evidence.nodetest.ts',
      'packages/linguist-cat-store/src/integrity.nodetest.ts',
      'packages/linguist-cat-tools/src/tools.nodetest.ts',
      'packages/linguist-domain-service/src/domain-service.nodetest.ts',
      'packages/linguist-domain-service/src/context-import.nodetest.ts',
      'packages/linguist-domain-service/src/cat-job-worker-client.nodetest.ts',
      'packages/dsh-linguist/src/host/operations.nodetest.ts',
      'packages/dsh-linguist/src/host/integrity-diagnostics.nodetest.ts',
      'tests/copied-host/delegation-inputs.nodetest.ts',
      'tests/copied-host/evidence-observer.nodetest.ts',
      'tests/copied-host/project-delivery-evidence.nodetest.ts',
      'tests/copied-host/project-import-preview.nodetest.ts',
      'tests/copied-host/prompt-and-session-http.nodetest.ts',
      'tests/copied-host/stage-evidence-host.nodetest.ts',
      'tests/copied-renderer/cat-editor-logic.nodetest.ts',
      'tests/copied-renderer/client-api.nodetest.ts',
      'tests/copied-renderer/composer-context.nodetest.ts',
      'tests/copied-renderer/native-composer-reference.nodetest.mjs',
      'tests/copied-renderer/workbench-location.nodetest.ts',
      'tests/copied-renderer/session-navigation.nodetest.mjs',
      'tests/copied-renderer/project-input.nodetest.ts',
      'tests/copied-renderer/native-controls.nodetest.mjs',
      'tests/required/capability-coverage.nodetest.mjs',
      'tests/required/workbench-ui-parity.nodetest.mjs',
      'tests/required/css-modules-bundle.nodetest.mjs',
      'tests/required/locale-select.nodetest.mjs',
      'tests/required/backup-preview.nodetest.mjs',
      'tests/required/cat-editor-remount.nodetest.mjs',
      'tests/required/project-capabilities.nodetest.mjs',
      'tests/required/session-capabilities.nodetest.mjs',
      'tests/required/schedule-session-independence.nodetest.mjs',
      'tests/required/schedule-manager.nodetest.mjs',
      'tests/required/schedule-form.nodetest.mjs',
      'tests/required/schedule-calendar.nodetest.mjs',
      'tests/required/turn-reference.nodetest.mjs',
      'packages/dsh-linguist/src/client/Workbench.layout.test.mjs',
      'tests/required/acceptance.nodetest.mjs'],
  },
  {
    id: 'ported-domain-bun-tests', command: join(root, '.toolchain/bun-1.3.14/bun-darwin-aarch64/bun'),
    args: ['test',
      'packages/linguist-cat-formats/src/adapters/phrasemxliff.test.ts',
      'packages/linguist-domain-service/src/context-extractor.test.ts',
      'packages/linguist-domain-service/src/project-evidence-inventory.test.ts',
      'packages/linguist-domain-service/src/project-discovery-scope.test.ts',
      'packages/linguist-domain-service/src/project-brief.test.ts',
      'packages/linguist-domain-service/src/project-file-intake.test.ts'],
  },
]

const runs = []
const log = [`# Required synthetic verification ${new Date().toISOString()}`, `# Node ${process.version}`, `# Source inventory: ${audit.inventoryCount}; statuses ${JSON.stringify(audit.statuses)}`]
for (const check of checks) {
  const startedAt = new Date().toISOString()
  const result = spawnSync(check.command, check.args, { cwd: root, encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  log.push(`\n## ${check.id}: ${check.command} ${check.args.join(' ')}\n${output}`)
  const passed = Number(output.match(/^# pass (\d+)$/m)?.[1] ?? output.match(/^\s*(\d+) pass$/m)?.[1] ?? 0)
  const failed = Number(output.match(/^# fail (\d+)$/m)?.[1] ?? output.match(/^\s*(\d+) fail$/m)?.[1] ?? 0)
  const skipped = Number(output.match(/^# skipped (\d+)$/m)?.[1] ?? output.match(/^\s*(\d+) skip$/m)?.[1] ?? 0)
  runs.push({ id: check.id, command: `${check.command} ${check.args.join(' ')}`, startedAt, exitCode: result.status ?? 1, passed, failed, skipped, ...(result.error ? { error: result.error.message } : {}) })
  process.stdout.write(`${check.id}: ${result.status === 0 ? 'PASS' : 'FAIL'}${passed ? ` (${passed} tests)` : ''}\n`)
}
writeFileSync(logPath, `${log.join('\n')}\n`)
const report = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), synthetic: true,
  sourceInventory: { count: audit.inventoryCount, statuses: audit.statuses, pending: audit.pending.length, errors: audit.errors },
  mappingComplete: audit.pending.length === 0 && audit.features.every(item => item.status === 'complete') && audit.tools.every(item => item.status === 'complete') && audit.validations.every(item => item.status === 'complete'),
  runs, logPath: relative(root, logPath), logSha256: sha256(readFileSync(logPath)),
  auditPath: relative(root, auditPath), auditSha256: sha256(readFileSync(auditPath)),
  status: audit.errors.length === 0 && runs.every(run => run.exitCode === 0 && run.failed === 0 && run.skipped === 0) ? 'passed' : 'failed',
}
writeFileSync(receiptPath, `${JSON.stringify(report, null, 2)}\n`)
if (audit.errors.length) process.stderr.write(`${audit.errors.join('\n')}\n`)
process.stdout.write(`Synthetic verification: ${report.status}; ${resolve(root, report.logPath)}\n`)
if (report.status !== 'passed') process.exitCode = 1
