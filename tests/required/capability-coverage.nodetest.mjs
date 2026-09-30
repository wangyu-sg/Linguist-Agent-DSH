import test from 'node:test'
import assert from 'node:assert/strict'
import { requireCapabilityCoverage } from '../../scripts/verify-ready.mjs'

test('installed coverage cannot omit a source capability or a reachable UI action', () => {
  const domain = { features: [{ id: 'D001' }] }
  const ui = { actions: [{ id: 'UI001', implementationStatus: 'entry-mapped-parity-unverified' }, { id: 'UNWIRED', implementationStatus: 'source-unwired-not-current-requirement' }] }
  const result = { result: 'passed', detail: 'Synthetic assertion for gate validation', featureIds: ['D001'] }
  assert.throws(() => requireCapabilityCoverage(domain, ui, [result]), /UI001/)
  assert.throws(() => requireCapabilityCoverage(domain, ui, [{ ...result, featureIds: ['D001', 'UI001'], result: 'pending' }]), /passed result/)
  assert.throws(() => requireCapabilityCoverage(domain, ui, [{ ...result, featureIds: ['D001', 'UI001', 'UNWIRED'] }]), /excluded capability/)
  requireCapabilityCoverage(domain, ui, [{ ...result, featureIds: ['D001', 'UI001'] }])
})

test('an evidenced external prerequisite blocks completion without masking missing or invalid capabilities', () => {
  const domain = { features: [{ id: 'D059' }, { id: 'D001' }] }
  const ui = { actions: [] }
  const blocked = { result: 'BLOCKED_ENV', featureIds: ['D059'], prerequisite: 'No authorized notification destination configured', detail: 'Installed ScheduleList returned no destinations; user deferred configuration.' }
  const passed = { result: 'passed', featureIds: ['D001'], detail: 'Observed on current synthetic installation' }
  assert.throws(() => requireCapabilityCoverage(domain, ui, [blocked]), /without installed acceptance: D001/)
  assert.throws(() => requireCapabilityCoverage(domain, ui, [passed, { ...blocked, prerequisite: '' }]), /explicit external prerequisite/)
  assert.throws(() => requireCapabilityCoverage(domain, ui, [passed, blocked]), error => error.constructor.name === 'ExternalPrerequisiteError' && error.message.includes('D059'))
})
