import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createLinguistCatTools } from '../../packages/linguist-cat-tools/src/index.ts'
import { LinguistProjectService } from '../../packages/linguist-domain-service/src/index.ts'
import { EvidenceObserver } from '../../packages/dsh-linguist/src/host/evidence.ts'
import { ensureStageEvidenceForSession } from '../../packages/dsh-linguist/src/host/stage-evidence.ts'
import { adaptCatTool } from '../../packages/dsh-linguist/src/host/tool-adapter.ts'

test('DSH CAT adapter preserves model-facing tool descriptions and input schema', () => {
  const source = createLinguistCatTools({ resolveProject: () => { throw new Error('Description check must not execute tools') } })
  const context = source.find(tool => tool.name === 'cat_get_translation_context')!
  const adapted = adaptCatTool(context, {} as never)
  assert.equal(adapted.description, context.description)
  assert.deepEqual(adapted.parameters, JSON.parse(JSON.stringify(context.parameters)))
  assert.match(adapted.description, /readOnly=true creates neither Stage nor evidence receipts/)
  assert.match((adapted.parameters as { properties: { readOnly: { description: string } } }).properties.readOnly.description, /without creating\/replacing a (professional )?Stage/)
})

test('Stage receipt needs exact model-visible tool content and a completed response', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-evidence-observer-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic evidence', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const imported = await service.importAsset(project.id, {
      filename: 'synthetic.csv', bytes: new TextEncoder().encode('key,source,target\na,开始,Begin\n'),
    })
    const db = service.openProject(project.id)
    const segment = db.segments.query({ assetId: imported.assetId, limit: 1 })[0]!
    const state = ensureStageEvidenceForSession({
      session: { id: 'synthetic-reviewer', linguistRole: 'reviewer' }, db,
      discoveryScope: { roots: [], files: [], unavailable: [], hash: 'synthetic-scope', managedEvidence: [
        { ref: { kind: 'asset', id: imported.assetId }, version: imported.sourceSha256 },
      ] },
      fallbackSegmentIds: [segment.id],
    })!
    const observer = new EvidenceObserver(service, root)
    observer.prepare(project.id, {
      stageRunId: state.stageRunId, baselineHash: state.baseline.baselineHash,
      sessionId: 'synthetic-reviewer', generationRunId: 'synthetic-run', toolCallId: 'synthetic-tool',
      segmentIds: [segment.id], evidence: [{ ref: { kind: 'asset', id: imported.assetId }, version: imported.sourceSha256, anchorIds: [] }],
    })
    const presented = [{ type: 'text' as const, text: 'Source: 开始\nCurrent target: Begin' }]
    observer.presented('synthetic-reviewer', 'synthetic-tool', presented)
    async function* response(kind: 'completed' | 'aborted') {
      yield { type: 'finish', reason: { kind }, replayState: { response: { responseId: 'synthetic-response' } } }
    }
    const request = (content: typeof presented) => ({
      sessionId: 'synthetic-reviewer', provider: 'synthetic-provider', model: 'synthetic-model',
      messages: [{ role: 'tool', toolCallId: 'synthetic-tool', content }],
    })
    for await (const _ of observer.stream(request([{ type: 'text', text: 'Details are hidden' }]) as never, () => response('completed') as never)) {}
    assert.equal(db.stageEvidence.listReceipts(state.stageRunId).length, 0)
    for await (const _ of observer.stream(request(presented) as never, () => response('aborted') as never)) {}
    assert.equal(db.stageEvidence.listReceipts(state.stageRunId).length, 0)
    for await (const _ of observer.stream(request(presented) as never, () => response('completed') as never)) {}
    const receipts = db.stageEvidence.listReceipts(state.stageRunId)
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0]!.evidence[0]!.submission, 'provider-response-v1')
    assert.equal(db.stageEvidence.getPresentationCoverage(state.stageRunId).presented, 1)
    const observation = readFileSync(join(root, 'evidence-observations.jsonl'), 'utf8')
    assert.match(observation, /"responseId":"synthetic-response"/)
    assert.match(observation, /"provider":"synthetic-provider"/)
    assert.doesNotMatch(observation, /Current target: Begin/)
    for await (const _ of observer.stream(request(presented) as never, () => response('completed') as never)) {}
    assert.equal(db.stageEvidence.listReceipts(state.stageRunId).length, 1)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})
