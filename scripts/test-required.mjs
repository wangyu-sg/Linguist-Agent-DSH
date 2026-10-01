import { execFileSync } from 'node:child_process'
import { globSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const [major, minor] = process.versions.node.split('.').map(Number)
if (major !== 24 || minor < 21) throw new Error('Use Node 24.21 or newer Node 24 for the native SDK and regression tests')
if (execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim() !== '1.3.14') throw new Error('Use Bun 1.3.14 for format regressions')
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' })
for (const config of globSync(['packages/*/tsconfig.json'], { cwd: root }).filter(path => !path.includes('/dsh-linguist/')).sort()) {
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', config])
}
for (const config of ['host', 'client']) run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'packages/dsh-linguist/tsconfig.' + config + '.json'])
const nodeTests = globSync(['packages/*/src/**/*.nodetest.*', 'tests/**/*.nodetest.*', 'packages/dsh-linguist/src/client/Workbench.layout.test.mjs'], { cwd: root }).sort()
const bunTests = globSync('packages/*/src/**/*.test.ts', { cwd: root }).sort()
if (!nodeTests.length || !bunTests.length) throw new Error('Regression test files are missing')
run(process.execPath, ['--experimental-test-module-mocks', '--experimental-transform-types', '--import', './packages/linguist-cat-store/test/register-ts-loader.mjs', '--test', ...nodeTests])
run('bun', ['test', ...bunTests])
