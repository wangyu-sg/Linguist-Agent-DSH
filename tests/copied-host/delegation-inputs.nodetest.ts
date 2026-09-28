import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LinguistProjectService } from '../../packages/linguist-domain-service/src/index.ts'
import { BindingStore } from '../../packages/dsh-linguist/src/host/bindings.ts'
import { createLinguistDelegationTool } from '../../packages/dsh-linguist/src/host/delegation-tool.ts'
import { freezeLinguistDelegation } from '../../packages/dsh-linguist/src/host/delegation.ts'

test('missing required input blocks native child start and frozen scope survives binding reload', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-delegation-copy-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic delegation', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const imported = await service.importAsset(project.id, {
      filename: 'synthetic.csv', bytes: new TextEncoder().encode('key,source,target\na,开始,Begin\n'),
    })
    const segment = service.openProject(project.id).segments.query({ assetId: imported.assetId, limit: 1 })[0]!
    const binding = { workspaceId: 'synthetic-workspace', projectId: project.id, role: 'general' as const, workMode: 'cat' as const }
    const frozen = freezeLinguistDelegation(service, binding, { role: 'reviewer', scope: { segmentIds: [segment.id] } })
    const bindings = new BindingStore(root)
    bindings.bindSession('synthetic-child', frozen)
    assert.deepEqual(new BindingStore(root).session('synthetic-child'), frozen)
    assert.deepEqual(frozen.delegatedScope?.segmentIds, [segment.id])
    let started = false
    const agent = { id: 'synthetic-parent' }
    const { tool } = createLinguistDelegationTool({
      service, binding, agent: agent as never,
      resolveSessionWorkspace: async () => ({ workspaceRoot: root }),
      reserveIntent: () => { throw new Error('No intent is reserved on blocked input') },
      control: {} as never,
      subagents: { resolveMaxDepth: () => 1, startContinuable: async () => { started = true; throw new Error('No child should start') } } as never,
    })
    const result = await tool.execute({
      role: 'reviewer', objective: 'Review this synthetic segment', scope: { segmentIds: [segment.id] }, expectedOutcome: 'A review report',
      inputs: [{ path: 'missing.txt', purpose: 'Required reference', required: true }],
    }, { agent, callId: 'synthetic-call', signal: new AbortController().signal } as never) as { status: string; inputs: Array<{ state: string }> }
    assert.equal(result.status, 'blocked-input')
    assert.equal(result.inputs[0]?.state, 'blocked-input')
    assert.equal(started, false)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})
