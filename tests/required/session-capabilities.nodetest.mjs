import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHttpRoutes } from '../../packages/dsh-linguist/src/host/http.ts'

test('instruction links use native discovery inside the bound Session Workspace without returning contents', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-instruction-links-')))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(root, 'home')
  const workspace = join(root, 'project', 'nested')
  mkdirSync(process.env.DSH_HOME)
  mkdirSync(join(root, 'project', '.git'), { recursive: true })
  mkdirSync(workspace)
  for (const directory of [process.env.DSH_HOME, join(root, 'project'), workspace]) writeFileSync(join(directory, 'AGENTS.md'), 'Synthetic instruction body must stay on the Host')
  let binding = { workspaceId: 'workspace-A' }
  let cwd = workspace
  let handler
  registerHttpRoutes({
    ctx: {
      webServer: { register: route => { handler = route.handler; return () => {} } },
      workspaceRegistry: { get: () => ({ path: workspace }) },
      sessionPersistence: { stat: async () => ({ header: { cwd } }) },
    },
    bindings: { session: () => binding },
  })
  const request = async (query = '?sessionId=session-A', origin) => {
    let status, result
    await handler({ url: `/la/v1/session-instructions${query}`, method: 'GET', headers: { host: '127.0.0.1:19387', ...(origin ? { origin } : {}) } }, {
      writeHead: value => { status = value }, end: body => { result = JSON.parse(body) },
    })
    return { status, result }
  }
  try {
    const response = await request()
    assert.equal(response.status, 200)
    assert.deepEqual(response.result.files.map(file => file.path), [join(process.env.DSH_HOME, 'AGENTS.md'), join(root, 'project', 'AGENTS.md'), join(workspace, 'AGENTS.md')])
    assert.equal(response.result.sessionId, 'session-A')
    assert(!JSON.stringify(response).includes('Synthetic instruction body'))
    assert.equal((await request('')).status, 400)
    assert.equal((await request('?sessionId=session-A', 'https://example.com')).status, 403)
    cwd = root
    assert.equal((await request()).status, 409)
    binding = undefined
    assert.equal((await request()).status, 404)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(root, { recursive: true, force: true })
  }
})
