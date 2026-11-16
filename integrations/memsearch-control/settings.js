import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { isMap, isSeq, parse, parseDocument } from 'yaml'

const run = promisify(execFile)
const switches = new Set(['project_review', 'memory_to_skill', 'user_profile'])
const digest = text => createHash('sha256').update(text).digest('hex')
const yamlOptions = { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] }

function validateModel(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model) || Object.keys(model).length !== 3 || Object.keys(model).some(key => !['provider', 'model', 'reasoningEffort'].includes(key))) throw new Error('Invalid model configuration')
  for (const key of ['provider', 'model']) {
    if (typeof model[key] !== 'string' || !/^[\w.:/-]{1,160}$/.test(model[key])) throw new Error(`Invalid ${key}`)
  }
  if (typeof model.reasoningEffort !== 'string' || (model.reasoningEffort !== '' && !/^[\w.:-]{1,64}$/.test(model.reasoningEffort))) throw new Error('Invalid reasoning effort')
}

export function updateModelPatch(text, model) {
  validateModel(model)
  const doc = parseDocument(text, yamlOptions)
  if (doc.errors.length || !isSeq(doc.contents)) throw new Error('Invalid headless profile patch')
  const entries = doc.contents.items.filter(item => isMap(item) && item.get('id') === 'agent-default-model')
  if (entries.length > 1) throw new Error('Multiple agent-default-model entries')
  let entry = entries[0]
  if (!entry) {
    doc.contents.add({ id: 'agent-default-model', config: {} })
    entry = doc.contents.items.at(-1)
  }
  const current = entry.get('config', true)
  if (current && !isMap(current)) throw new Error('Invalid agent-default-model config')
  for (const [key, value] of Object.entries(model)) {
    if (key === 'reasoningEffort' && value === '') entry.deleteIn(['config', key])
    else entry.setIn(['config', key], value)
  }
  return doc.toString()
}

export function modelFromDump(text) {
  const rows = parse(text, yamlOptions)
  if (!Array.isArray(rows)) throw new Error('Invalid DSH configuration')
  const rowsForModel = rows.filter(row => row?.id === 'agent-default-model')
  if (rowsForModel.length !== 1) throw new Error('Cannot identify the effective headless model')
  const config = rowsForModel[0].config ?? {}
  return { provider: config.provider, model: config.model, reasoningEffort: config.reasoningEffort }
}

export function createSettings({ dsh = 'dsh', memsearch = 'memsearch', dshHome = process.env.DSH_HOME || join(homedir(), '.dsh') } = {}) {
  const patchPath = join(dshHome, 'profiles', 'headless', 'cordis.patch.yml')
  async function command(file, args) {
    const result = await run(file, args, { maxBuffer: 4 * 1024 * 1024, timeout: 30000 })
    return result.stdout.trim()
  }
  async function headless() {
    return modelFromDump(await command(dsh, ['--profile', 'headless', '--dump-config']))
  }
  async function status() {
    const [model, patch, provider, embeddingModel, uri, ...values] = await Promise.all([
      headless(), readFile(patchPath, 'utf8'),
      command(memsearch, ['config', 'get', 'embedding.provider']),
      command(memsearch, ['config', 'get', 'embedding.model']),
      command(memsearch, ['config', 'get', 'milvus.uri']),
      ...[...switches].map(key => command(memsearch, ['config', 'get', `plugins.dsh.${key}.enabled`]))
    ])
    if (values.some(value => value !== 'true' && value !== 'false')) throw new Error('Could not read MemSearch settings')
    return { model, revision: digest(patch), embedding: { provider, model: embeddingModel, uri }, maintenance: Object.fromEntries([...switches].map((key, index) => [key, values[index] === 'true'])) }
  }
  async function setModel(model, revision) {
    validateModel(model)
    const before = await readFile(patchPath, 'utf8')
    if (typeof revision !== 'string' || digest(before) !== revision) throw new Error('Headless settings changed; refresh and try again')
    const next = updateModelPatch(before, model)
    const mode = (await stat(patchPath)).mode & 0o777
    const tmp = `${patchPath}.${randomUUID()}.tmp`
    try {
      await writeFile(tmp, next, { encoding: 'utf8', mode, flag: 'wx' })
      if (digest(await readFile(patchPath, 'utf8')) !== revision) throw new Error('Headless settings changed; refresh and try again')
      await rename(tmp, patchPath)
    } finally {
      await unlink(tmp).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
    let effective
    try { effective = await headless() }
    catch { throw new Error('Model settings were saved, but the effective configuration could not be verified; refresh to check') }
    if (Object.keys(model).some(key => (effective[key] ?? '') !== model[key])) throw new Error('Saved, but a higher-priority DSH setting overrides the chosen model')
    return { model: effective, revision: digest(next) }
  }
  async function setMaintenance(key, value) {
    if (!switches.has(key) || typeof value !== 'boolean') throw new Error('Invalid MemSearch setting')
    await command(memsearch, ['config', 'set', `plugins.dsh.${key}.enabled`, String(value)])
    const actual = await command(memsearch, ['config', 'get', `plugins.dsh.${key}.enabled`])
    if (actual !== String(value)) throw new Error('MemSearch did not apply the setting')
    return { key, enabled: value }
  }
  return { status, setModel, setMaintenance }
}
