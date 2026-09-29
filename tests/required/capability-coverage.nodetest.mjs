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
