import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { initializeStorage } from './config'

test('first install creates its data directory and keeps its identity across reopen and configured updates', () => {
  const root = mkdtempSync(join(tmpdir(), 'la-config-'))
  try {
    const config = { dataRoot: join(root, 'product'), installationId: '' }
    const first = initializeStorage(config)
    assert.match(first.installationId, /^[0-9a-f-]{36}$/)
    assert.deepEqual(initializeStorage(config), first)
    assert.equal(initializeStorage({ ...config, installationId: 'existing-installation' }).installationId, 'existing-installation')
    assert.equal(readFileSync(join(config.dataRoot, 'installation-id'), 'utf8').trim(), first.installationId)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
