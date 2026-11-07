import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { LinguistProjectService } from '../../packages/linguist-domain-service/src/index.ts'
import { BindingStore } from '../../packages/dsh-linguist/src/host/bindings.ts'
import { ScheduleContextManager } from '../../packages/dsh-linguist/src/host/schedule-context.ts'
import { ScheduleSessionRuntime } from '../../packages/dsh-linguist/src/host/schedule-session.ts'
import { Session, SessionId } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-session/lib/index.js'
import { ScheduleId, createEveryScheduleRecord, renderReminderFraming } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-schedule/lib/index.js'

const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const { validateStoredEvents } = require('@deepseek-ai/dsh-session-persistence')

test('native task owner survives source removal with frozen project, model and permissions; stopping owner stays stopped', async t => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-schedule-independent-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic original project', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    const otherProject = await service.createProject({ name: 'Synthetic switched project', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    await service.importAsset(project.id, { bytes: new TextEncoder().encode('key,source,target\na,Start,开始\n'), filename: 'fixture.csv' })
    const bindings = new BindingStore(root)
    bindings.bindProject(project.id, 'workspace-original')
    bindings.bindProject(otherProject.id, 'workspace-other')
    const actors = new Map(), stored = new Map(), reads = []
    let observationCount = 0, releasedObservations = 0
    const sourceId = SessionId('session-independent-source')
    const source = { id: sourceId, session: Session.create(sourceId) }
    source.session.append('permission/preset', { preset: 'workspace-write' })
    source.session.append('sandbox/mode', { mode: 'workspace-write' })
    source.session.append('approval/policy', { policy: 'ask' })
    source.session.append('model/selection', { provider: 'synthetic', model: 'chosen', reasoningEffort: 'max' })
    const originalSettings = source.session.ownEvents().map(event => event.data)
    actors.set(sourceId, source)
    bindings.bindSession(sourceId, { workspaceId: 'workspace-original', projectId: project.id, role: 'reviewer', workMode: 'cat' })
    const ctx = {
      workspaceRegistry: { get: id => ({ id, path: root }) },
      sessionPersistence: {
        async stat(id) { return stored.get(id) },
        async create(header) {
          const value = { header, events: [] }
          stored.set(header.id, value)
          return { async append(events) { value.events.push(...events) }, async flush() {}, async close() {} }
        },
      },
      sessionQuery: {
        async observeSession(id) {
          reads.push(id)
          const actor = actors.get(id)
          assert(actor, `Session ${id} must exist when inspected`)
          observationCount++
          return { header: actor.session.header, inheritedEventCount: 0, events: actor.session.ownEvents(),
            projections: { values: { agentPreset: 'synthetic-preset', modelSelection: { next: actor.session.ownEvents().findLast(event => event.type === 'model/selection')?.data } } },
            [Symbol.dispose]() { releasedObservations++ },
          }
        },
      },
      sessionController: {
        async create({ sessionId }) {
          const { header, events } = stored.get(sessionId)
          const session = Session.create(sessionId, validateStoredEvents(header, structuredClone(events)), header)
          actors.set(sessionId, { id: sessionId, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] }, followup(message) { this.inbox.nextTurn.push(message) } })
        },
        async resolveAgent(id) { const agent = actors.get(id); assert(agent, `Session ${id} must exist when resolved`); return { agent } },
        async rename() {},
      },
      sessions: { async flush() { return true } },
    }
    const runtime = new ScheduleSessionRuntime(ctx, bindings, () => {})
    let sourceEventsAvailable = true
    const deliveredManually = []
    const native = {
      rows: [],
      updates: 0,
      async create(request, actorSessionId) {
        const record = { ...createEveryScheduleRecord(ScheduleId(`schedule-${randomUUID()}`), request.prompt, request.timing.every_seconds, Date.now(), request.title),
          target: request.target, involvedSessionIds: [actorSessionId, request.target.sessionId], status: 'active', updatedAt: new Date().toISOString() }
        this.rows.push(record)
        return record
      },
      async catalog() { return this.rows },
      async edit(request) {
        const record = this.rows.find(row => row.id === request.id)
        if (!record) return { id: request.id, code: 'schedule_not_found' }
        if (request.expectedUpdatedAt !== undefined && request.expectedUpdatedAt !== (record.updatedAt ?? null)) return { id: request.id, code: 'schedule_conflict' }
        if (request.action === 'delete') {
          const count = this.rows.length
          this.rows = this.rows.filter(row => row.id !== request.id)
          return count !== this.rows.length ? { id: request.id, deleted: true } : { id: request.id, code: 'schedule_not_found' }
        }
        this.updates++
        Object.assign(record, request.patch)
        return record
      },
      async history({ id }) { return { id, records: [], earlierRecordsUnavailable: false, earlierRecordsPruned: false } },
      async stopSessionTasks(sessionId) { this.rows = this.rows.filter(row => row.target.sessionId !== sessionId || row.status !== 'active') },
    }
    let manager = new ScheduleContextManager(root, native, service, bindings, async (id, projectId) => {
      assert(actors.has(id), 'authorized Session must exist')
      assert.equal(bindings.session(id)?.projectId, projectId)
    }, async id => id === sourceId && !sourceEventsAvailable ? undefined : actors.get(id)?.session.ownEvents(), runtime, async (id, message) => { deliveredManually.push({ id, message }) })
    const instruction = 'Review synthetic selection.\nPreserve {player}, <b>tags</b> and 中文.\nReply exactly SYNTHETIC-SCHEDULE-COMPLETE.'
    const created = await manager.create({ sessionId: sourceId, projectId: project.id, title: 'Independent review', prompt: instruction, executeAtDue: true, scope: 'project', timing: { kind: 'every', seconds: 60 } })
    assert.notEqual(created.sessionId, sourceId, 'native Schedule must have its own owner before the first due run')
    assert.equal(native.rows[0].target.sessionId, created.sessionId)
    assert(native.rows[0].involvedSessionIds.includes(sourceId), 'native task records the source Session as the managing actor')
    assert.equal(releasedObservations, observationCount, 'creation releases its exact native Session observation')
    const owner = actors.get(created.sessionId)
    assert.equal(stored.get(owner.id).header.parentSession, undefined, 'cold restoration cannot require deleted source ancestry')
    assert.deepEqual(owner.session.ownEvents().filter(event => ['permission/preset', 'sandbox/mode', 'approval/policy', 'model/selection'].includes(event.type)).map(event => event.data), originalSettings)
    assert.equal((await manager.list(sourceId)).items[0].sessionId, owner.id, 'source can still manage its explicit task')
    await t.test('a concurrent native retarget rejects deletion and preserves both task and Linguist context', async () => {
      const row = native.rows.find(row => row.id === created.scheduleId)
      const before = { target: row.target, updatedAt: row.updatedAt }
      const token = row.prompt.match(/token=([^\]]+)/)[1]
      const path = join(root, 'linguist-schedule-context', `${token}.json`)
      const context = readFileSync(path, 'utf8')
      const originalEdit = native.edit
      const changedAt = new Date(Date.parse(row.updatedAt) + 1).toISOString()
      native.edit = async function (request, actorSessionId) {
        assert.equal(request.action, 'delete')
        assert.equal(request.expectedUpdatedAt, before.updatedAt)
        row.target = { kind: 'new', create: {} }
        row.updatedAt = changedAt
        return originalEdit.call(this, request, actorSessionId)
      }
      try {
        await assert.rejects(manager.cancel(sourceId, created.scheduleId), /changed before deletion/)
        assert(native.rows.includes(row), 'CAS rejection must not delete the retargeted native task')
        assert.deepEqual(row.target, { kind: 'new', create: {} })
        assert.equal(row.updatedAt, changedAt)
        assert.equal(readFileSync(path, 'utf8'), context, 'CAS rejection must not mark the Linguist context cancelled')
      } finally {
        native.edit = originalEdit
        Object.assign(row, before)
      }
    })
    await t.test('native target changes cannot redirect the frozen Linguist task', async () => {
      const row = native.rows.find(row => row.id === created.scheduleId)
      const target = row.target
      row.target = { kind: 'new', create: {} }
      assert.equal((await manager.list(sourceId)).items[0].authorizationStatus, 'changed')
      await assert.rejects(manager.runNow(sourceId, created.scheduleId, created.version), /changed since/)
      row.target = target
    })
    await t.test('obsolete source-owned sidecars stay read-only and do not block independent tasks', async () => {
      const request = { sessionId: sourceId, projectId: project.id, title: 'Obsolete synthetic task', prompt: 'Old task instruction', executeAtDue: true, scope: 'project', timing: { kind: 'every', seconds: 60 } }
      const legacy = await manager.create(request)
      const row = native.rows.find(row => row.id === legacy.scheduleId)
      const token = row.prompt.match(/token=([^\]]+)/)[1]
      const path = join(root, 'linguist-schedule-context', `${token}.json`)
      const saved = JSON.parse(readFileSync(path, 'utf8'))
      saved.sessionId = sourceId
      delete saved.sourceSessionId
      delete saved.binding
      writeFileSync(path, JSON.stringify(saved))
      row.target.sessionId = sourceId
      const before = readFileSync(path, 'utf8')
      await assert.rejects(manager.update({ ...request, scheduleId: legacy.scheduleId, expectedVersion: legacy.version }), /cancel.*recreate/i)
      await assert.rejects(manager.runNow(sourceId, legacy.scheduleId, legacy.version), /cancel.*recreate/i)
      const due = { id: 'obsolete-due', role: 'user', source: { kind: 'schedule' }, content: [{ type: 'text', text: renderReminderFraming(row) }] }
      await assert.rejects(manager.dispatchDue(source, { kind: 'enter', messages: [due] }, 1, [due]), /cancel.*recreate/i)
      await assert.rejects(manager.onPreStep(source, { kind: 'enter', messages: [due] }, 1, 0), /cancel.*recreate/i)
      assert.equal(native.updates, 0)
      assert.deepEqual(deliveredManually, [])
      assert.equal(readFileSync(path, 'utf8'), before, 'reading/rejecting an old sidecar must not migrate its authority')
      for (const partial of [
        { ...saved, binding: bindings.session(sourceId) },
        { ...saved, sourceSessionId: 'obsolete-origin' },
        { ...saved, binding: bindings.session(sourceId), sourceSessionId: sourceId },
      ]) {
        writeFileSync(path, JSON.stringify(partial))
        await assert.rejects(manager.update({ ...request, scheduleId: legacy.scheduleId, expectedVersion: legacy.version }), /cancel.*recreate/i)
        await assert.rejects(manager.runNow(sourceId, legacy.scheduleId, legacy.version), /cancel.*recreate/i)
        await assert.rejects(manager.dispatchDue(source, { kind: 'enter', messages: [due] }, 1, [due]), /cancel.*recreate/i)
      }
      writeFileSync(path, before)
      sourceEventsAvailable = false
      const listed = await manager.list(sourceId)
      assert.equal(listed.items.find(item => item.scheduleId === created.scheduleId).authorizationStatus, 'ready')
      assert.equal(listed.items.find(item => item.scheduleId === legacy.scheduleId).authorizationStatus, 'recreate-required')
      sourceEventsAvailable = true
      assert.deepEqual((await manager.history(sourceId, legacy.scheduleId, 10)).records, [])
      assert.equal((await manager.cancel(sourceId, legacy.scheduleId)).cancelled, true)
      actors.delete(legacy.sessionId)
    })
    bindings.bindSession(sourceId, { workspaceId: 'workspace-other', projectId: otherProject.id, role: 'translator', workMode: 'cat' })
    source.session.append('model/selection', { provider: 'synthetic', model: 'different', reasoningEffort: 'low' })
    source.session.append('approval/policy', { policy: 'never' })
    assert.equal((await manager.list(sourceId)).items.length, 0, 'switching source project does not expose authority over old task')
    await native.stopSessionTasks(sourceId)
    actors.delete(sourceId)
    bindings.restoreSession(sourceId, undefined)
    owner.session = Session.create(owner.id, JSON.parse(JSON.stringify(owner.session.ownEvents())), stored.get(owner.id).header)
    manager = new ScheduleContextManager(root, native, service, bindings, async (id, projectId) => {
      assert(actors.has(id), 'authorized Session must exist')
      assert.equal(bindings.session(id)?.projectId, projectId)
    }, async id => actors.get(id)?.session.ownEvents(), runtime)
    reads.length = 0
    assert.equal(native.rows.length, 1, 'stopping or removing source leaves the independent native task armed')
    const due = { id: 'independent-due', role: 'user', source: { kind: 'schedule' }, content: [{ type: 'text', text: renderReminderFraming(native.rows[0]) }] }
    owner.session.append('turn/start', { turn: 1 })
    manager.recordAttempts(owner, [due], 1)
    assert.doesNotThrow(() => validateStoredEvents(stored.get(owner.id).header, structuredClone(owner.session.ownEvents())), 'task admission must remain readable after a native cold restart')
    assert.deepEqual(await manager.dispatchDue(owner, { kind: 'enter', messages: [due, { id: 'native-context', role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'Synthetic native context injection' }] }] }, 1, [due]), { kind: 'reject' }, 'the owner must not run a model with only native context injections after dispatch')
    assert.doesNotThrow(() => validateStoredEvents(stored.get(owner.id).header, structuredClone(owner.session.ownEvents())), 'task dispatch must remain readable after a native cold restart')
    const child = [...actors.values()].find(actor => actor !== owner)
    assert(child)
    assert.equal(bindings.session(child.id).projectId, project.id)
    assert.equal(bindings.session(child.id).role, 'reviewer')
    assert.equal(bindings.session(child.id).delegatedScope.segmentIds.length, 1)
    assert.deepEqual(child.session.ownEvents().filter(event => ['permission/preset', 'sandbox/mode', 'approval/policy', 'model/selection'].includes(event.type)).map(event => event.data), originalSettings)
    const delivered = child.inbox.nextTurn.shift()
    child.session.append('turn/start', { turn: 1 })
    const admitted = await manager.onPreStep(child, { kind: 'enter', messages: [delivered] }, 1, 0)
    assert.equal(admitted.messages[0].source.projectId, project.id)
    assert.equal(admitted.messages[0].content[0].text.split('\n\n')[0], instruction)
    child.session.append('user/message', admitted.messages[0], { surfaceOp: 'append' })
    const childEvents = validateStoredEvents(stored.get(child.id).header, structuredClone(child.session.ownEvents()))
    const restoredChild = Session.create(child.id, childEvents, stored.get(child.id).header)
    assert.equal(restoredChild.deriveMessages().find(message => message.source.kind === 'linguist-schedule-execution').content[0].text, admitted.messages[0].content[0].text, 'the complete scheduled instruction must survive native cold read on the exact model-request surface')
    await manager.validateModelRequest(child, 1, 0, { provider: 'synthetic', model: 'chosen' }, async (provider, model) => assert.deepEqual([provider, model], ['synthetic', 'chosen']))
    assert(!reads.includes(sourceId), 'no execution read depends on deleted source')
    await native.stopSessionTasks(owner.id)
    await assert.rejects(manager.dispatchDue(owner, { kind: 'enter', messages: [due] }, 2, [due]), /deleted or changed/)
    assert.equal(native.rows.length, 0, 'archiving/stopping task owner never recreates its native schedule')
    const sessionCount = stored.size
    ctx.sessionQuery.observeSession = async () => {
      observationCount++
      return { events: owner.session.ownEvents(), projections: { values: {} }, [Symbol.dispose]() { releasedObservations++ } }
    }
    await assert.rejects(runtime.create(owner, bindings.session(owner.id), 'No configured model', () => assert.fail('must not create a task')), /selected model/)
    assert.equal(stored.size, sessionCount, 'missing model must fail before a task Session is stored')
    assert.equal(releasedObservations, observationCount, 'failed preparation also releases its native Session observation')
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})
