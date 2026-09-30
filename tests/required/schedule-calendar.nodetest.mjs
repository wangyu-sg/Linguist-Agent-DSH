import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LinguistProjectService } from '../../packages/linguist-domain-service/src/index.ts'
import { BindingStore } from '../../packages/dsh-linguist/src/host/bindings.ts'
import { ScheduleContextManager } from '../../packages/dsh-linguist/src/host/schedule-context.ts'
import { nextCalendarOccurrence, nativeTiming } from '../../packages/dsh-linguist/src/host/schedule-timing.ts'
import { dispatchOperation } from '../../packages/dsh-linguist/src/host/operations.ts'
import { ScheduleId, createAtScheduleRecord, createEveryScheduleRecord, renderReminderFraming } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-schedule/lib/index.js'

const local = (year, month, day, hour = 9, minute = 0, second = 0) => new Date(year, month - 1, day, hour, minute, second).getTime()

test('ported monthly short-month clamp and interval window anchors preserve source local calendar rules', () => {
  const monthly = { kind: 'monthly', time: '09:00', dayOfMonth: 31 }
  assert.equal(nextCalendarOccurrence(monthly, local(2027, 1, 31)), local(2027, 2, 28))
  assert.equal(nextCalendarOccurrence(monthly, local(2028, 1, 31)), local(2028, 2, 29))
  assert.equal(nextCalendarOccurrence(monthly, local(2027, 2, 28)), local(2027, 3, 31))
  assert.equal(nextCalendarOccurrence(monthly, local(2027, 4, 1)), local(2027, 4, 30))
  const interval = { kind: 'every', seconds: 1200, activeWindowStart: '09:10', activeWindowEnd: '10:00', activeWeekdays: [1, 2, 3, 4, 5] }
  assert.equal(nextCalendarOccurrence(interval, local(2027, 1, 1, 9, 11)), local(2027, 1, 1, 9, 30))
  assert.equal(nextCalendarOccurrence(interval, local(2027, 1, 1, 9, 50)), local(2027, 1, 4, 9, 10))
  assert.equal(nextCalendarOccurrence(interval, local(2027, 1, 2, 8)), local(2027, 1, 4, 9, 10))
  assert.equal(nextCalendarOccurrence({ kind: 'every', seconds: 1200, activeWeekdays: [1, 2, 3, 4, 5] }, local(2027, 1, 1, 23, 50)), local(2027, 1, 4, 23, 50))
  assert.deepEqual(nativeTiming({ kind: 'every', seconds: 60 }, local(2027, 1, 1)), { kind: 'every', seconds: 60 })
})

test('interval weekday skips restore the source wall clock across a DST gap', () => {
  const previousZone = process.env.TZ
  process.env.TZ = 'America/New_York'
  try {
    const window = { kind: 'every', seconds: 1200, activeWindowStart: '02:30', activeWindowEnd: '04:00', activeWeekdays: [1] }
    assert.equal(nextCalendarOccurrence(window, local(2027, 3, 13, 2, 40)), local(2027, 3, 15, 2, 30))
    assert.equal(nextCalendarOccurrence({ ...window, activeWeekdays: [6, 1] }, local(2027, 3, 13, 3, 50)), local(2027, 3, 15, 2, 30))
    assert.equal(nextCalendarOccurrence({ kind: 'every', seconds: 1200, activeWeekdays: [1] }, local(2027, 3, 13, 2, 30)), local(2027, 3, 15, 2, 30))
  } finally { if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone }
})

test('calendar tasks use native at, re-arm after authorization, retain history, recover lost responses, and pause by CAS', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-calendar-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  const oldNow = Date.now
  let now = local(2027, 1, 31, 9, 1)
  Date.now = () => now
  try {
    const project = await service.createProject({ name: 'Synthetic calendar task', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    await service.importAsset(project.id, { bytes: new TextEncoder().encode('key,source,target\na,Start,开始\n'), filename: 'calendar.csv' })
    const bindings = new BindingStore(root)
    bindings.bindProject(project.id, 'workspace-calendar')
    const binding = { workspaceId: 'workspace-calendar', projectId: project.id, role: 'reviewer', workMode: 'cat' }
    bindings.bindSession('source-calendar', binding)
    const actors = new Map([['source-calendar', { id: 'source-calendar' }]])
    const events = new Map()
    const native = {
      rows: [], deliveries: new Map(), creates: 0, failAfterCreate: false,
      async create(sessionId, request) {
        this.creates++
        const id = ScheduleId(`schedule-${randomUUID()}`)
        const record = request.at ? createAtScheduleRecord(id, request.prompt, request.at, now, request.title) : createEveryScheduleRecord(id, request.prompt, request.every_seconds, now, request.title)
        this.rows.push({ ...record, sessionId, status: 'active' })
        await this.afterCreate?.(record)
        if (this.failAfterCreate) { this.failAfterCreate = false; throw new Error('Synthetic native create response lost') }
        return record
      },
      async catalog() { return this.rows },
      async history({ id }) { return { id, records: this.deliveries.get(id) ?? [], earlierRecordsUnavailable: false, earlierRecordsPruned: false } },
      async delete({ id }) { const before = this.rows.length; this.rows = this.rows.filter(row => row.id !== id); return { id, deleted: before !== this.rows.length } },
      async update() { assert.fail('calendar cadence should be carried by real native at records') },
      due(row) {
        now = Date.parse(row.scheduledAt)
        row.status = 'inactive'
        const id = `due-${row.id}`
        this.deliveries.set(row.id, [{ scheduledAt: row.scheduledAt, deliveredAt: new Date(now).toISOString(), messageId: id, prompt: row.prompt }])
        return { id, role: 'user', source: { kind: 'schedule' }, content: [{ type: 'text', text: renderReminderFraming(row) }] }
      },
    }
    const runtime = {
      async resolve(id) { return actors.get(id) },
      async create(parent, nextBinding, title, record) {
        const id = `session-${randomUUID()}`
        const actor = { id, status: 'idle', inbox: { nextTurn: [], nextStep: [] }, followup(message) { this.inbox.nextTurn.push(message) } }
        actors.set(id, actor); events.set(id, []); bindings.bindSession(id, nextBinding)
        record({ sessionId: id, createdAt: new Date(now).toISOString() })
        return actor
      },
      async busy(previous) { return actors.get(previous.sessionId).status === 'running' },
      async reusable() { return true },
      async flush() {},
    }
    const managerOf = () => new ScheduleContextManager(root, native, service, bindings,
      async (id, pid) => assert.equal(bindings.session(id)?.projectId, pid), async id => events.get(id) ?? [], runtime)
    let manager = managerOf()
    const request = { sessionId: 'source-calendar', projectId: project.id, title: 'Monthly review', prompt: 'Review synthetic source and current target.', executeAtDue: true, scope: 'project', timing: { kind: 'monthly', time: '09:00', dayOfMonth: 31 } }
    native.failAfterCreate = true
    await assert.rejects(manager.create(request), /response lost/)
    const committedInitial = native.rows[0]
    native.rows.push({ ...committedInitial, id: ScheduleId(`schedule-${randomUUID()}`) })
    manager = managerOf()
    await assert.rejects(manager.list('source-calendar'), /Multiple native Schedules/)
    native.rows.pop()
    const recoveredInitial = (await manager.list('source-calendar')).items[0]
    assert.equal(recoveredInitial.scheduleId, committedInitial.id, 'initial lost response adopts the verified single native record before due time')
    assert.equal((await manager.cancel('source-calendar', recoveredInitial.scheduleId)).cancelled, true)
    assert.equal(native.rows.length, 0)
    const created = await manager.create(request)
    assert.equal(created.kind, 'monthly')
    assert.equal(native.rows[0].kind, 'at')
    assert.equal(Date.parse(created.scheduledAt), local(2027, 2, 28))
    assert.deepEqual((await manager.list('source-calendar')).items[0].timing, request.timing)
    const owner = actors.get(created.sessionId)
    const originalDelete = native.delete
    native.delete = async () => ({ deleted: false })
    await assert.rejects(manager.pause('source-calendar', created.scheduleId, created.version), /still active/)
    assert.equal(native.rows.length, 1, 'failed deletion cannot be reported as success')
    native.delete = originalDelete
    await manager.enforceRunPolicy(created.sessionId)
    const pausedForDeletion = (await manager.list('source-calendar')).items[0]
    await manager.update({ ...request, scheduleId: created.scheduleId, expectedVersion: pausedForDeletion.version })
    const due = native.due(native.rows[0])
    manager.recordAttempts(owner, [due], 1)
    assert.deepEqual(await manager.dispatchDue(owner, { kind: 'enter', messages: [due] }, 1, [due]), { kind: 'reject' })
    assert.equal(native.creates, 3, 'owner dispatch must preserve old generation for child authorization')
    const child = [...actors.values()].find(actor => actor.inbox?.nextTurn.length)
    const delivered = child.inbox.nextTurn.shift()
    manager.recordAttempts(child, [delivered], 1)
    const admitted = await manager.onPreStep(child, { kind: 'enter', messages: [delivered] }, 1, 0)
    assert.equal(admitted.messages[0].source.scheduleId, created.scheduleId)
    assert.match(admitted.messages[0].content[0].text, /Review synthetic source and current target/)
    events.get(child.id).push({ type: 'turn/start', seq: 0, time: now, data: { turn: 1 } },
      { type: 'user/message', seq: 1, time: now, data: admitted.messages[0] })
    assert.equal(native.rows.length, 1)
    assert.equal(Date.parse(native.rows[0].scheduledAt), local(2027, 3, 31))
    assert.notEqual(native.rows[0].id, created.scheduleId)
    assert.equal((await manager.history('source-calendar', created.scheduleId, 10)).records[0].messageId, due.id)
    child.status = 'running'
    const skipped = native.due(native.rows[0])
    manager.recordAttempts(owner, [skipped], 2)
    assert.deepEqual(await manager.dispatchDue(owner, { kind: 'enter', messages: [skipped] }, 2, [skipped]), { kind: 'reject' })
    assert.equal(Date.parse(native.rows[0].scheduledAt), local(2027, 4, 30), 'busy execution skips one occurrence without losing future cadence')
    const lost = native.due(native.rows[0])
    native.failAfterCreate = true
    await assert.rejects(manager.dispatchDue(owner, { kind: 'enter', messages: [lost] }, 3, [lost]), /response lost/)
    const committedCount = native.creates
    manager = managerOf()
    let info = (await manager.list('source-calendar')).items[0]
    assert.equal(native.creates, committedCount, 'cold recovery reuses the native write after lost response')
    assert.equal(native.rows.length, 1)
    assert.equal(Date.parse(info.scheduledAt), local(2027, 5, 31))
    assert.equal(info.scheduleId, created.scheduleId)
    assert.equal((await manager.history('source-calendar', created.scheduleId, 10)).records.length, 3)
    await assert.rejects(manager.pause('source-calendar', created.scheduleId, created.version), /changed since/)
    assert.deepEqual(await manager.pause('source-calendar', created.scheduleId, info.version), { scheduleId: created.scheduleId, paused: true })
    assert.equal(native.rows.length, 0)
    manager = managerOf()
    info = (await manager.list('source-calendar')).items[0]
    assert.equal(info.pausedByUser, true)
    assert.equal(info.status, 'inactive')
    assert.equal((await manager.history('source-calendar', created.scheduleId, 10)).records.length, 3)
    assert.equal((await manager.history('source-calendar', created.scheduleId, 10)).executions.find(run => run.phase === 'execution').outcome, 'unfinished')
    events.get(child.id).push({ type: 'turn/end', seq: 2, time: now + 1, data: { turn: 1, reason: { kind: 'completed' } } })
    manager = managerOf()
    assert.equal((await manager.history('source-calendar', created.scheduleId, 10)).executions.find(run => run.phase === 'execution').outcome, 'completed', 'cold history reads a committed ending before its asynchronous sidecar listener runs')
    await manager.recordExecutionEnd(child.id, 1)
    events.delete(child.id)
    manager = managerOf()
    assert.equal((await manager.history('source-calendar', created.scheduleId, 10)).executions.find(run => run.phase === 'execution').outcome, 'completed', 'paused history keeps the real ending after execution Session removal and cold reopen')
    await assert.rejects(manager.update({ ...request, scheduleId: created.scheduleId, expectedVersion: created.version }), /changed since/)
    const resumed = await manager.update({ ...request, scheduleId: created.scheduleId, expectedVersion: info.version })
    assert.equal(resumed.scheduleId, created.scheduleId)
    assert.equal((await manager.list('source-calendar')).items[0].pausedByUser, false)
    assert.equal((await manager.history('source-calendar', created.scheduleId, 10)).records.length, 3)
    info = (await manager.list('source-calendar')).items[0]
    await manager.pause('source-calendar', created.scheduleId, info.version)
    assert.equal((await manager.cancel('source-calendar', created.scheduleId)).cancelled, true)
    assert.deepEqual((await manager.list('source-calendar')).items, [], 'cancelling a paused task removes it from active management')
    await assert.rejects(manager.update({ ...request, scheduleId: created.scheduleId, expectedVersion: info.version }), /cancelled/)
    const failing = await manager.create({ ...request, title: 'Synthetic admission failures' })
    const failureOwner = actors.get(failing.sessionId)
    for (let turn = 1; turn <= 5; turn++) {
      const row = native.rows.find(row => row.sessionId === failing.sessionId)
      const message = native.due(row)
      manager.recordAttempts(failureOwner, [message], turn)
      const own = events.get(failing.sessionId)
      own.push({ type: 'turn/start', seq: own.length, time: now, data: { turn } },
        { type: 'turn/end', seq: own.length + 1, time: now + 1, data: { turn, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'Synthetic admission failure' } } } })
      await manager.recordExecutionEnd(failureOwner.id, turn)
      assert.equal(native.rows.length, turn < 5 ? 1 : 0, 'failed admission must retain cadence until the fifth committed failure')
    }
    const stopped = (await manager.list('source-calendar')).items[0]
    assert.equal(stopped.pausedAfterFailures, true)
    assert.equal(stopped.runCount, 5)
    assert.equal(stopped.consecutiveFailures, 5)
    await manager.cancel('source-calendar', failing.scheduleId)
    const race = await manager.create({ ...request, title: 'Synthetic cancellation race' })
    const raceOwner = actors.get(race.sessionId)
    const raceDue = native.due(native.rows[0])
    await manager.dispatchDue(raceOwner, { kind: 'enter', messages: [raceDue] }, 1, [raceDue])
    const raceChild = [...actors.values()].find(actor => actor.inbox?.nextTurn.length)
    const raceMessage = raceChild.inbox.nextTurn.shift()
    let releaseCreate, announceCreate
    const startedCreate = new Promise(resolve => { announceCreate = resolve })
    native.afterCreate = () => { announceCreate(); return new Promise(resolve => { releaseCreate = resolve }) }
    const advancing = manager.onPreStep(raceChild, { kind: 'enter', messages: [raceMessage] }, 1, 0)
    await startedCreate
    await assert.rejects(manager.cancel('source-calendar', race.scheduleId), /generation update is already in progress/)
    releaseCreate()
    await advancing
    native.afterCreate = undefined
    assert.equal(native.rows.length, 1)
    assert.equal((await manager.cancel('source-calendar', race.scheduleId)).cancelled, true)
    assert.equal(native.rows.length, 0, 'a successful cancel leaves no current or pending native calendar timer')
  } finally { Date.now = oldNow; service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('schedule operation boundary accepts monthly and windows and rejects malformed calendar selectors', async () => {
  const accepted = []
  const input = { operation: 'linguistScheduleCreate', service: {}, scheduleContext: { async create(request) { accepted.push(request); return request } },
    payload: { sessionId: 'synthetic-source', projectId: 'prj-0123456789abcdef', title: 'Synthetic calendar', prompt: 'Synthetic instruction', executeAtDue: true, scope: 'project' } }
  for (const timing of [
    { kind: 'monthly', dayOfMonth: 31, time: '09:00' },
    { kind: 'every', seconds: 1200, activeWindowStart: '09:10', activeWindowEnd: '10:00', activeWeekdays: [1, 2, 3, 4, 5] },
    { kind: 'every', seconds: 60 },
  ]) assert.deepEqual((await dispatchOperation({ ...input, payload: { ...input.payload, timing } })).timing, timing)
  for (const timing of [
    { kind: 'monthly', dayOfMonth: 32, time: '09:00' },
    { kind: 'monthly', dayOfMonth: 1, time: '24:00' },
    { kind: 'every', seconds: 60, activeWindowStart: '09:00' },
    { kind: 'every', seconds: 60, activeWindowStart: '10:00', activeWindowEnd: '09:00' },
    { kind: 'every', seconds: 60, activeWeekdays: [1, 1] },
    { kind: 'every', seconds: 60, activeWeekdays: [7] },
  ]) await assert.rejects(dispatchOperation({ ...input, payload: { ...input.payload, timing } }), /timing|active window/)
  assert.equal(accepted.length, 3)
})
