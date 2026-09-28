import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packages = ['linguist-cat-core', 'linguist-cat-formats', 'linguist-cat-store', 'linguist-cat-tools', 'linguist-domain-service', 'dsh-linguist']
const tsc = join(root, 'node_modules/.bin/tsc')
for (const name of packages) {
  const dir = join(root, 'packages', name)
  if (name === 'dsh-linguist') {
    for (const config of ['tsconfig.host.json', 'tsconfig.client.json']) execFileSync(tsc, ['--noEmit', '-p', config], { cwd: dir, stdio: 'inherit' })
  } else execFileSync(tsc, ['--noEmit'], { cwd: dir, stdio: 'inherit' })
}
const output = join(root, 'packages/dsh-linguist/lib')
rmSync(output, { recursive: true, force: true })
mkdirSync(dirname(output), { recursive: true })
execFileSync(join(root, 'node_modules/.bin/tsdown'), ['--config', 'tsdown.config.ts'], { cwd: join(root, 'packages/dsh-linguist'), stdio: 'inherit' })
