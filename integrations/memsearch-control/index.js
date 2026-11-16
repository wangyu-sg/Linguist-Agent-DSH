import { createSettings } from './settings.js'

export const name = 'memsearch-control'
export const inject = ['webServer', 'llm']

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 8192) throw new Error('Request too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function apply(ctx) {
  const settings = createSettings()
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/memsearch-control',
    async handler(req, res) {
      try {
        const connection = ctx.get('connection')
        if (!connection || typeof connection.requestRejection !== 'function') return json(res, 503, { error: 'DSH authentication unavailable' })
        const rejection = connection.requestRejection({ headers: req.headers })
        if (rejection !== undefined) return json(res, rejection, { error: 'Request rejected' })
      } catch (error) {
        ctx.logger?.warn?.('MemSearch settings authentication failed', error)
        return json(res, 503, { error: 'DSH authentication unavailable' })
      }
      try {
        const url = new URL(req.url, 'http://localhost')
        if (url.pathname === '/memsearch-control/catalog' && req.method === 'GET') {
          const providers = ctx.llm.listProviders().map(({ id, name }) => ({ id, name }))
          const provider = url.searchParams.get('provider')
          if (!provider) return json(res, 200, { providers })
          let models
          try { models = (await ctx.llm.listModels(provider)).map(({ id, name }) => ({ id, name })) }
          catch (error) { return json(res, 200, { providers, models: [], efforts: [], catalogError: `无法读取该提供方的模型：${error instanceof Error ? error.message : String(error)}` }) }
          const model = url.searchParams.get('model')
          try {
            const reasoning = model ? (await ctx.llm.resolveModelInfo(provider, model)).reasoning : undefined
            return json(res, 200, { providers, models, efforts: reasoning?.efforts?.map(({ id, name }) => ({ id, name })) ?? [] })
          } catch (error) {
            return json(res, 200, { providers, models, efforts: [], catalogError: `无法读取该模型的思考强度：${error instanceof Error ? error.message : String(error)}` })
          }
        }
        if (url.pathname !== '/memsearch-control/settings') return json(res, 404, { error: 'Not found' })
        if (req.method === 'GET') return json(res, 200, await settings.status())
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
        const body = await readBody(req)
        if (body.action === 'model') return json(res, 200, await settings.setModel(body.model, body.revision))
        if (body.action === 'maintenance') return json(res, 200, await settings.setMaintenance(body.key, body.enabled))
        return json(res, 400, { error: 'Unknown action' })
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))
}
