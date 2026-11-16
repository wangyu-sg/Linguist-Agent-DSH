import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { apply } from '../index.js'

function routeFor(connection, llm) {
  let handler
  const ctx = {
    webServer: { register: route => { handler = route.handler; return () => {} } },
    llm,
    get: () => connection,
    effect: callback => callback(),
  }
  apply(ctx)
  return handler
}

async function call(handler, method, body, url = '/memsearch-control/settings') {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
  req.method = method
  req.url = url
  req.headers = {}
  const result = {}
  const res = { writeHead(status) { result.status = status }, end(value) { result.body = JSON.parse(value) } }
  await handler(req, res)
  return result
}

test('settings route requires DSH authentication and rejects unknown actions', async () => {
  assert.equal((await call(routeFor(undefined), 'GET')).status, 503)
  assert.equal((await call(routeFor({ requestRejection: () => 403 }), 'GET')).status, 403)
  const result = await call(routeFor({ requestRejection: () => undefined }), 'POST', { action: 'other' })
  assert.equal(result.status, 400)
  assert.equal(result.body.error, 'Unknown action')
})

test('catalog returns the DSH provider, model and supported reasoning choices', async () => {
  const llm = {
    listProviders: () => [{ id: 'example', name: 'Example' }],
    listModels: async () => [{ id: 'model-a', name: 'Model A' }],
    resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }),
  }
  const result = await call(routeFor({ requestRejection: () => undefined }, llm), 'GET', null, '/memsearch-control/catalog?provider=example&model=model-a')
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { providers: [{ id: 'example', name: 'Example' }], models: [{ id: 'model-a', name: 'Model A' }], efforts: [{ id: 'low', name: 'Low' }] })
})

test('an unavailable model catalog still leaves other providers selectable', async () => {
  const llm = { listProviders: () => [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], listModels: async () => { throw new Error('unavailable') } }
  const result = await call(routeFor({ requestRejection: () => undefined }, llm), 'GET', null, '/memsearch-control/catalog?provider=a')
  assert.equal(result.status, 200)
  assert.equal(result.body.providers.length, 2)
  assert.match(result.body.catalogError, /unavailable/)
})
