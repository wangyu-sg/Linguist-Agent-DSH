import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LinguistProjectService } from '../../packages/linguist-domain-service/src/index.ts'
import { BindingStore } from '../../packages/dsh-linguist/src/host/bindings.ts'
import { addPreparedTurnContext, TurnContextReceipts, TurnContextCallProvenance } from '../../packages/dsh-linguist/src/host/turn-context.ts'

test('native reference snapshot binds the actual user RPC, preserves content and rejects invalid or cross-session scope', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-native-reference-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic native reference', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    await service.importAsset(project.id, { bytes: new TextEncoder().encode('key,source,target\na,Start,开始\nb,Quit,退出\n'), filename: 'fixture.csv' })
    const segment = service.openProject(project.id).segments.queryIds()[0]
    const bindings = new BindingStore(root)
    bindings.bindProject(project.id, 'workspace-A')
    bindings.bindSession('session-A', { workspaceId: 'workspace-A', projectId: project.id, role: 'reviewer', workMode: 'cat' })
    const receipts = new TurnContextReceipts(root)
    const context = { schemaVersion: 1, projectId: project.id, selectedSegmentIds: [segment], capturedAt: new Date().toISOString(), uiRevision: 7 }
    const envelope = (value = { sessionId: 'session-A', context }) => `\n[LA-TURN-CONTEXT v1]\n${JSON.stringify(value)}\n[/LA-TURN-CONTEXT]\n`
    const matched = []
    const image = { type: 'image', attachment: { id: 'synthetic-image' } }
    const rpcId = randomUUID()
    const original = { id: 'native-message', role: 'user', source: { kind: 'user', rpcId }, content: [{ type: 'text', text: `Review this selection.${envelope()}Keep the tag.` }, image] }
    const admit = message => addPreparedTurnContext({ sessionId: 'session-A', decision: { kind: 'enter', messages: [message] }, service, bindings, receipts,
      assertProjectSession: async (sessionId, projectId) => { assert.equal(sessionId, 'session-A'); assert.equal(projectId, project.id) },
      onAdmitted: (requestId, value) => matched.push({ requestId, context: value }),
    })
    const result = await admit(original)
    assert.deepEqual(receipts.get('session-A', rpcId), context)
    assert.equal(result.messages.length, 1, 'reference snapshot is present once in its actual user message')
    assert.equal(result.messages[0].id, original.id)
    assert.equal(result.messages[0].source, original.source)
    assert.equal(result.messages[0].content[1], image)
    assert.match(result.messages[0].content[0].text, /^Review this selection\./)
    assert.match(result.messages[0].content[0].text, /<linguist_turn_context /)
    assert.match(result.messages[0].content[0].text, /Keep the tag\.$/)
    assert(!result.messages[0].content[0].text.includes('[LA-TURN-CONTEXT'))
    const provenance = new TurnContextCallProvenance()
    provenance.admitStep(1, result, matched)
    provenance.observe({ type: 'tool/call', data: { turn: 1, callId: 'actual-call' } })
    assert.equal(provenance.forCall('actual-call').turnContextSnapshot, JSON.stringify(context))
    await admit(original)
    assert.deepEqual(new TurnContextReceipts(root).get('session-A', rpcId), context, 'same RPC replay retains the immutable snapshot')
    const invalid = text => ({ ...original, source: { kind: 'user', rpcId: randomUUID() }, content: [{ type: 'text', text }] })
    for (const text of [envelope({ sessionId: 'session-B', context }), envelope({ sessionId: 'session-A', context, extra: true }), '[LA-TURN-CONTEXT v1]\nnot json\n[/LA-TURN-CONTEXT]', envelope() + envelope(), '[LA-TURN-CONTEXT v2]\n{}\n[/LA-TURN-CONTEXT]', envelope({ sessionId: 'session-A', context: { ...context, selectionTruncated: true } }), envelope({ sessionId: 'session-A', context: { ...context, projectId: 'prj-0000000000000000' } })]) await assert.rejects(admit(invalid(text)))
    await assert.rejects(admit({ ...original, content: [{ type: 'text', text: envelope({ sessionId: 'session-A', context: { ...context, uiRevision: 8 } }) }] }), /different Linguist CAT selection/)
    await assert.rejects(admit({ ...original, source: { kind: 'user' } }), /request identity/)
    const plain = invalid('Plain request without a CAT reference')
    assert.equal((await admit(plain)).messages[0], plain)
    const toolContent = { ...original, source: { kind: 'schedule' } }
    assert.equal((await admit(toolContent)).messages[0], toolContent, 'non-user content never acquires user request provenance')
    const db = service.openProject(project.id)
    bindings.bindSession('session-A', { workspaceId: 'workspace-A', projectId: project.id, role: 'reviewer', workMode: 'cat', delegatedScope: {
      assetIds: [db.segments.getById(segment).assetId], segmentIds: [db.segments.queryIds()[1]],
    } })
    await assert.rejects(admit(invalid(envelope())), /delegated scope/)
    await assert.rejects(admit({ ...original, content: [{ type: 'text', text: 'Prepared request with its previously saved scope' }] }), /delegated scope/)
    const [finding] = db.qaFindings.insertOpen([{ segmentId: segment, code: 'SYNTHETIC_SCOPE', severity: 'L1', message: 'Synthetic out-of-scope QA' }])
    await assert.rejects(admit(invalid(envelope({ sessionId: 'session-A', context: { ...context, selectedSegmentIds: [], activeQaFindingId: finding.id } }))), /delegated scope/)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})
