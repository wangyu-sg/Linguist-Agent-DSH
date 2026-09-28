import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { LinguistProjectService } from '../../packages/linguist-domain-service/src/index.ts'
import { BindingStore } from '../../packages/dsh-linguist/src/host/bindings.ts'
import { buildLinguistPromptSection } from '../../packages/dsh-linguist/src/host/diagnostics.ts'
import { ManagedFiles } from '../../packages/dsh-linguist/src/host/files.ts'
import { registerHttpRoutes } from '../../packages/dsh-linguist/src/host/http.ts'
import { MutationBus } from '../../packages/dsh-linguist/src/host/mutations.ts'
import { loadLinguistRoleResources } from '../../packages/dsh-linguist/src/host/role-resources.ts'

test('packaged role resources reject missing, blank and oversized instructions without path in the error message', () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-role-resource-'))
  const directory = join(root, 'roles')
  mkdirSync(directory)
  try {
    for (const role of ['general', 'translator', 'reviewer', 'proofreader']) writeFileSync(join(directory, `${role}.md`), `${role} instructions`)
    const base = pathToFileURL(`${directory}/`)
    assert.equal(loadLinguistRoleResources(base).reviewer, 'reviewer instructions')
    unlinkSync(join(directory, 'reviewer.md'))
    assert.throws(() => loadLinguistRoleResources(base), error => error instanceof Error
      && error.message === 'Linguist reviewer role resource unavailable' && !error.message.includes(root))
    writeFileSync(join(directory, 'reviewer.md'), '  ')
    assert.throws(() => loadLinguistRoleResources(base), /Linguist reviewer role resource invalid/)
    writeFileSync(join(directory, 'reviewer.md'), 'x'.repeat(6_001))
    assert.throws(() => loadLinguistRoleResources(base), /Linguist reviewer role resource invalid/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('native Prompt retains the role and only whole Digest lines within 18k', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-prompt-copy-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic prompt', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const db = service.openProject(project.id)
    for (let index = 0; index < 12; index++) db.styleGuideRules.upsert({
      groupKey: '必须', ruleText: `COMPLETE-RULE-${index}:` + `synthetic-${index}-`.repeat(220),
    })
    const roles = Object.fromEntries((['general', 'translator', 'reviewer', 'proofreader'] as const).map(role => [
      role, readFileSync(new URL(`../../packages/dsh-linguist/resources/linguist-roles/${role}.md`, import.meta.url), 'utf8'),
    ])) as Record<'general' | 'translator' | 'reviewer' | 'proofreader', string>
    for (const text of Object.values(roles)) assert.ok(text.length <= 6_000)
    const result = buildLinguistPromptSection(service, roles, { role: 'reviewer', workMode: 'cat', projectId: project.id })
    assert.ok(result.prompt.length <= 18_000)
    assert.equal(result.status.role, 'reviewer')
    assert.equal(result.status.projectDigestTruncated, true)
    assert.match(result.prompt, /COMPLETE-RULE-0:/)
    assert.match(result.prompt, /其余必要要求与资料尚未展开/)
    assert.doesNotMatch(result.prompt, /COMPLETE-RULE-11:/)
    assert.match(result.prompt, /独立|审读|审校/)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('native Session binding rejects a role change after a real user request', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-dsh-session-http-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  const bindings = new BindingStore(root)
  let handler: ((request: unknown, response: unknown) => Promise<void>) | undefined
  try {
    const project = await service.createProject({ name: 'Synthetic binding', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    bindings.bindProject(project.id, 'workspace-synthetic')
    bindings.bindSession('session-synthetic', { workspaceId: 'workspace-synthetic', projectId: project.id, role: 'translator', workMode: 'cat' })
    const ctx = {
      webServer: { register: (entry: { handler: typeof handler }) => { handler = entry.handler; return () => {} } },
      sessionPersistence: {
        stat: async () => ({ header: { cwd: root } }),
        open: async () => ({ read: async () => ({ events: [{ type: 'user/message', data: { source: { kind: 'user' } } }] }), close: async () => {} }),
      },
      workspaceRegistry: { list: () => [{ id: 'workspace-synthetic', path: root }] },
    }
    registerHttpRoutes({
      ctx: ctx as never, service, bindings, files: new ManagedFiles(root), mutations: new MutationBus(), installationId: 'synthetic',
      rebindAgent: () => { throw new Error('Role change should be rejected before rebind') },
      dispatch: async () => { throw new Error('Unexpected operation') },
    })
    assert.ok(handler)
    const request = Readable.from([Buffer.from(JSON.stringify({
      sessionId: 'session-synthetic', projectId: project.id, role: 'reviewer', workMode: 'cat',
    }))]) as Readable & { method: string; url: string; headers: Record<string, string> }
    request.method = 'POST'
    request.url = '/la/v1/session-bind'
    request.headers = { host: '127.0.0.1:19387', 'content-type': 'application/json' }
    const response = {
      headersSent: false, statusCode: 0, body: '',
      writeHead(status: number) { this.statusCode = status; this.headersSent = true },
      end(body: string) { this.body = body },
    }
    await handler(request, response)
    assert.equal(response.statusCode, 409)
    assert.match((JSON.parse(response.body) as { error: string }).error, /fixed after the first user request/)
    assert.equal(bindings.session('session-synthetic')?.role, 'translator')
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('missing CAT database leaves Prompt diagnostic available and never recreates the database', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-cat-availability-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic availability', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const path = service.getProjectPaths(project.id).catDbPath
    service.closeProject(project.id)
    renameSync(path, `${path}.held`)
    try {
      const roles = { general: 'General', translator: 'Translator', reviewer: 'Reviewer', proofreader: 'Proofreader' }
      const prompt = buildLinguistPromptSection(service, roles, { role: 'general', workMode: 'cat', projectId: project.id })
      assert.equal(prompt.status.projectDigestStatus, 'skipped')
      assert.match(prompt.prompt, /Project Digest 当前无可用项目数据/)
      assert.equal(existsSync(path), false)
      assert.throws(() => service.openProject(project.id))
    } finally { renameSync(`${path}.held`, path) }
    assert.equal(service.checkProjectHealth(project.id).healthy, true)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})
