import { loadProfessionalResources } from './professional-context'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buffer as streamBuffer } from 'node:stream/consumers'
import test from 'node:test'
import { LinguistProjectService } from '@linguist/domain-service'
import { BindingStore } from './bindings'
import { buildLinguistPromptSection, DiagnosticsHost } from './diagnostics'
import { ManagedFiles } from './files'
import { IntegrityHost, type IntegrityEvent } from './integrity'
import { MutationBus } from './mutations'

const professional = loadProfessionalResources(new URL('../../resources/professional-judgment/', import.meta.url))

test('native prompt, diagnostics bundle, worker scrub and redacted exports use synthetic data', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-integrity-'))
  const dataRoot = join(root, 'product')
  const workspaceRoot = join(root, 'workspace')
  mkdirSync(dataRoot)
  mkdirSync(join(workspaceRoot, '.linguist'), { recursive: true })
  const service = new LinguistProjectService({ rootDir: join(dataRoot, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  const files = new ManagedFiles(dataRoot)
  const bus = new MutationBus()
  const events: IntegrityEvent[] = []
  bus.publishIntegrity = (_projectId, event) => { events.push(event as IntegrityEvent) }
  const bindings = new BindingStore(dataRoot)
  const integrity = new IntegrityHost(service, bus, files, new URL('./integrity-worker.ts', import.meta.url))
  try {
    const project = await service.createProject({ name: 'Synthetic', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    writeFileSync(join(workspaceRoot, '.linguist', 'project-brief.json'), JSON.stringify({
      schemaVersion: 1,
      projectIdentity: { projectId: project.id, sourceLocale: project.sourceLocale, targetLocale: project.targetLocale },
      purpose: 'Synthetic fixture purpose', sources: [], requirements: [], referenceRoutes: [], unresolved: [],
    }))
    bindings.bindProject(project.id, 'ws-synthetic')
    bindings.bindSession('session-synthetic', { workspaceId: 'ws-synthetic', projectId: project.id, role: 'translator', workMode: 'cat' })
    const roles = { general: 'General', translator: 'Translator', reviewer: 'Reviewer', proofreader: 'Proofreader' }
    const binding = bindings.session('session-synthetic')!
    const prompt = buildLinguistPromptSection(service, roles, professional, binding, workspaceRoot)
    assert.match(prompt.prompt, /Synthetic fixture purpose/)
    assert.equal(prompt.status.projectDigestStatus, 'complete')
    assert.equal(prompt.status.promptHash, createHash('sha256').update(prompt.prompt).digest('hex'))
    const diagnostics = new DiagnosticsHost(service, bindings, files, {
      roleText: roles, professional,
      assertProjectSession: async (sessionId, projectId) => {
        assert.equal(sessionId, 'session-synthetic')
        assert.equal(projectId, project.id)
      },
      resolveWorkspaceRoot: workspaceId => workspaceId === 'ws-synthetic' ? workspaceRoot : undefined,
      getSession: async () => ({ cwd: workspaceRoot }),
    })
    const request = { projectId: project.id, sessionId: 'session-synthetic' }
    const status = await diagnostics.dispatch('linguistDiagnosticsGetStatus', request) as { prompt: { promptHash: string } }
    assert.equal(status.prompt.promptHash, prompt.status.promptHash)
    const preview = await diagnostics.dispatch('linguistDiagnosticsPreviewBundle', request) as { bundle: { privacy: { redacted: boolean }; prompt: { promptHash: string } } }
    assert.equal(preview.bundle.privacy.redacted, true)
    assert.equal(preview.bundle.prompt.promptHash, prompt.status.promptHash)
    const diagnosticExport = await diagnostics.dispatch('linguistDiagnosticsExportBundle', request) as { token: string; sha256: string }
    const diagnosticFile = await files.open(diagnosticExport.token)
    const diagnosticBytes = await streamBuffer(diagnosticFile.stream)
    assert.equal(createHash('sha256').update(diagnosticBytes).digest('hex'), diagnosticExport.sha256)
    assert.equal(diagnosticBytes.toString('utf8').includes(project.id), false)

    const cancelledJob = await integrity.dispatch('linguistIntegrityStart', { projectId: project.id }) as { jobId: string }
    assert.deepEqual(await integrity.dispatch('linguistIntegrityCancel', { projectId: project.id, jobId: cancelledJob.jobId }), { cancelled: true })
    const activeJob = await integrity.dispatch('linguistIntegrityStart', { projectId: project.id }) as { jobId: string }
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Synthetic integrity worker timed out')), 30_000)
      const poll = setInterval(() => {
        const event = events.find(value => value.jobId === activeJob.jobId && (value.state === 'completed' || value.state === 'failed'))
        if (!event) return
        clearTimeout(deadline)
        clearInterval(poll)
        if (event.state === 'failed') reject(new Error('Synthetic integrity worker failed'))
        else resolve()
      }, 10)
    })
    const completed = events.find(value => value.jobId === activeJob.jobId && value.state === 'completed')
    assert(completed && completed.state === 'completed')
    assert.equal(completed.report.executor, 'worker_thread')
    assert(completed.report.workerThreadId > 0)
    const reportExport = await integrity.dispatch('linguistIntegrityExportReport', { projectId: project.id, jobId: activeJob.jobId }) as { token: string; sha256: string }
    const report = await files.open(reportExport.token)
    const reportBytes = await streamBuffer(report.stream)
    assert.equal(createHash('sha256').update(reportBytes).digest('hex'), reportExport.sha256)
    assert.equal(reportBytes.toString('utf8').includes(project.id), false)
  } finally {
    integrity.dispose()
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})
