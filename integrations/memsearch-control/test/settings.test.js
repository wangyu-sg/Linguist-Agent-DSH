import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse } from 'yaml'
import { createSettings, modelFromDump, updateModelPatch } from '../settings.js'

test('headless model changes preserve other configuration and reject stale revisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memsearch-control-test-'))
  const patch = join(root, 'profiles/headless/cordis.patch.yml')
  const store = join(root, 'store.json')
  const dsh = join(root, 'dsh')
  const memsearch = join(root, 'memsearch')
  const savedEnv = process.env.MEMSEARCH_CONTROL_TEST_ROOT
  process.env.MEMSEARCH_CONTROL_TEST_ROOT = root
  try {
    await mkdir(join(root, 'profiles/headless'), { recursive: true })
    await writeFile(patch, '# existing\n- id: credentials\n  disabled: false\n  config:\n    example: keep\n- id: agent-default-model\n  config:\n    provider: openai-codex\n    model: gpt-6-luna\n    reasoningEffort: low\n')
    await writeFile(store, JSON.stringify({ 'embedding.provider': 'onnx', 'embedding.model': 'bge-m3', 'milvus.uri': '.memsearch/milvus.db', 'plugins.dsh.project_review.enabled': 'false', 'plugins.dsh.memory_to_skill.enabled': 'false', 'plugins.dsh.user_profile.enabled': 'false' }))
    await writeFile(dsh, `#!/usr/bin/env node\nconst fs=require('node:fs'); const p=fs.readFileSync(process.env.MEMSEARCH_CONTROL_TEST_ROOT+'/profiles/headless/cordis.patch.yml','utf8'); const m=p.split('- id: agent-default-model')[1]; console.log('- id: agent-default-model\\n  config:'+m.split('  config:')[1]);\n`, { mode: 0o755 })
    await writeFile(memsearch, `#!/usr/bin/env node\nconst fs=require('node:fs'); const p=process.env.MEMSEARCH_CONTROL_TEST_ROOT+'/store.json'; const data=JSON.parse(fs.readFileSync(p)); if(process.argv[3]==='set'){data[process.argv[4]]=process.argv[5]; fs.writeFileSync(p,JSON.stringify(data));} else console.log(data[process.argv[4]]);\n`, { mode: 0o755 })
    const settings = createSettings({ dsh, memsearch, dshHome: root })
    const before = await settings.status()
    assert.equal(before.model.model, 'gpt-6-luna')
    assert.equal(before.maintenance.memory_to_skill, false)
    const chosen = { provider: 'openai-codex', model: 'other-model', reasoningEffort: 'medium' }
    const saved = await settings.setModel(chosen, before.revision)
    assert.deepEqual(saved.model, chosen)
    const savedPatch = await readFile(patch, 'utf8')
    assert.match(savedPatch, /# existing/)
    assert.equal(parse(savedPatch)[0].config.example, 'keep')
    await assert.rejects(settings.setModel(chosen, before.revision), /changed/)
    assert.equal(await readFile(patch, 'utf8'), savedPatch)
    assert.deepEqual(await settings.setMaintenance('memory_to_skill', true), { key: 'memory_to_skill', enabled: true })
    assert.equal((await settings.status()).maintenance.memory_to_skill, true)
    await assert.rejects(settings.setMaintenance('unknown', true), /Invalid/)
    assert.throws(() => updateModelPatch(savedPatch, { ...chosen, extra: 'no' }), /Invalid/)
    const noEffort = parse(updateModelPatch(savedPatch, { ...chosen, reasoningEffort: '' }))
    assert.equal(noEffort[1].config.reasoningEffort, undefined)
  } finally {
    if (savedEnv === undefined) delete process.env.MEMSEARCH_CONTROL_TEST_ROOT
    else process.env.MEMSEARCH_CONTROL_TEST_ROOT = savedEnv
    await rm(root, { recursive: true, force: true })
  }
})

test('effective model parsing tolerates DSH expressions without exposing other values', () => {
  const actual = modelFromDump('- id: other\n  config:\n    sensitive: private\n    expr: !!js test\n- id: agent-default-model\n  config:\n    provider: p\n    model: m\n    reasoningEffort: low\n')
  assert.deepEqual(actual, { provider: 'p', model: 'm', reasoningEffort: 'low' })
})
