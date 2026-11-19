import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { LinguistProjectService } from '../../packages/linguist-domain-service/src/project-service.ts'
import { PhraseMxliffAdapter } from '../../packages/linguist-cat-formats/src/index.ts'
import { runDeterministicHardRules } from '../../packages/linguist-cat-core/src/index.ts'

// Synthetic project only. Exercise the same CAS save, persisted QA and verified
// delivery route as the workbench; no customer project or platform is involved.
test('Phrase native B/I/U authoring passes real save/QA/verified delivery while runtime checks remain strict', async () => {
  const temp = realpathSync(tmpdir())
  const rootDir = mkdtempSync(join(temp, 'la-native-format-'))
  const service = new LinguistProjectService({ rootDir, applicationVersion: 'synthetic-format-test' })
  service.init()
  const source = 'Gain <b>{hero}</b> <ph id="p">TOKEN</ph> points'
  const translated = '获得 <b>{hero}</b> <ph id="p">TOKEN</ph> 分'
  const xml = `<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file source-language="en-US" target-language="zh-CN"><body>${['one', 'two', 'locked'].map(key => `<trans-unit id="${key}"${key === 'locked' ? ' m:locked="true"' : ''}><source>${source}</source><target>${translated}</target></trans-unit>`).join('')}</body></file></xliff>`
  try {
    const project = await service.createProject({ name: 'Native style checks', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    const imported = await service.importAsset(project.id, { filename: 'styles.mxliff', bytes: new TextEncoder().encode(xml) })
    assert.equal(imported.status, 'imported')
    const assetId = imported.assetId!
    const db = service.openProject(project.id)
    const original = db.segments.query({ assetId })
    assert.equal(original.length, 3)
    const first = original[0]!, locked = original[2]!
    assert.throws(() => service.editSegment(project.id, locked.id, 'changed', locked.revision))
    const firstTarget = `{b>${translated}<b}`
    const repeated = service.editSegment(project.id, first.id, firstTarget, first.revision, { propagateRepeated: true })
    assert.equal(repeated.repetition?.updatedSegmentIds.length, 1)
    assert(repeated.repetition?.skipped.some(item => item.segmentId === locked.id && item.reason === 'locked'))

    let lastTarget = firstTarget
    for (const flags of ['b', 'i', 'u', 'bi', 'bu', 'iu', 'biu']) {
      lastTarget = `{${flags}>${translated}<${flags}}`
      for (const segment of db.segments.query({ assetId }).filter(segment => !segment.locked)) {
        assert.equal(runDeterministicHardRules({ segment, proposedTarget: lastTarget }).ok, true)
        const saved = service.editSegment(project.id, segment.id, lastTarget, segment.revision).segment
        service.confirmCurrentStage(project.id, saved.id, saved.revision)
      }
      const findings = service.runQa(project.id, assetId)
      assert.equal(findings.filter(finding => finding.status === 'open' && (finding.severity === 'L0' || finding.severity === 'L1')).length, 0)
      assert.equal(service.listQaFindings(project.id, { assetId, status: 'open', severity: 'L0' }).total, 0)
      assert.equal(service.listQaFindings(project.id, { assetId, status: 'open', severity: 'L1' }).total, 0)
      const prepared = await service.prepareDelivery(project.id, assetId, 'verified')
      assert.equal(prepared.preflight.ready, true, JSON.stringify(prepared.preflight.blockers))
      assert(prepared.staged)
      assert.equal(prepared.validation, 'verified')
      const result = await new PhraseMxliffAdapter().import({ bytes: readFileSync(prepared.staged.stagingPath), filename: 'roundtrip.mxliff', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
      assert.deepEqual(result.segments.map(segment => segment.source), original.map(segment => segment.source))
      assert.deepEqual(result.segments.map(segment => [segment.key, segment.ordinal, segment.locked]), original.map(segment => [segment.key, segment.ordinal, segment.locked]))
      assert.equal(result.segments[0]!.target, lastTarget)
      assert.equal(result.segments[1]!.target, lastTarget)
      assert.equal(result.segments[2]!.target, translated)
    }

    // Primary human saves are CAS-only by design. UI protections and real hard
    // rules reject these changes; persisted QA and verified delivery must also block.
    for (const bad of [lastTarget.replace('{hero}', '{other}'), lastTarget.replace('<b>', '<i>').replace('</b>', '</i>')]) {
      const current = db.segments.getById(first.id)!
      const other = db.segments.getById(original[1]!.id)!
      if (other.currentStageState === 'confirmed') service.unconfirmCurrentStage(project.id, other.id, other.revision)
      assert.equal(runDeterministicHardRules({ segment: current, proposedTarget: bad }).ok, false)
      const saved = service.editSegment(project.id, current.id, bad, current.revision, { propagateRepeated: true })
      assert(saved.repetition?.skipped.some(item => item.segmentId === other.id && item.reason === 'unsafe-target'))
      assert.equal(db.segments.getById(other.id)!.target, lastTarget)
      const findings = service.runQa(project.id, assetId)
      assert(findings.some(finding => finding.status === 'open' && (finding.severity === 'L0' || finding.severity === 'L1')))
      const blocked = await service.prepareDelivery(project.id, assetId, 'verified')
      assert.equal(blocked.preflight.ready, false)
      assert.equal(blocked.staged, undefined)
      await assert.rejects(service.stageExport(project.id, assetId))
      const repaired = service.editSegment(project.id, saved.segment.id, lastTarget, saved.segment.revision).segment
      service.confirmCurrentStage(project.id, repaired.id, repaired.revision)
      const remaining = db.segments.getById(other.id)!
      service.confirmCurrentStage(project.id, remaining.id, remaining.revision)
      service.runQa(project.id, assetId)
      assert.equal((await service.prepareDelivery(project.id, assetId, 'verified')).preflight.ready, true)
    }
    assert.equal(db.segments.getById(first.id)!.source, source)
    assert.equal(db.segments.getById(locked.id)!.target, translated)
  } finally {
    service.closeAll()
    assert.equal(dirname(realpathSync(rootDir)), temp)
    assert(basename(rootDir).startsWith('la-native-format-'))
    rmSync(rootDir, { recursive: true, force: true })
  }
})
