import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const yaml = createRequire(require.resolve('@deepseek-ai/cordis-plugin-include'))('js-yaml')
const { renderPrompt } = await import(require.resolve('@deepseek-ai/dsh-system-prompt'))

test('Linguist keeps native compaction without pruning unread tool results', () => {
  const patch = yaml.load(readFileSync(new URL('../../packages/dsh-linguist/cordis.patch.yml', import.meta.url), 'utf8'), {
    schema: yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar' })),
  })
  const preset = patch[0].insert.find(plugin => plugin.id === 'preset-linguist')
  const compaction = preset.config.plugins.find(plugin => plugin.id === 'compaction')
  assert(compaction.config.some(plugin => plugin.name === '@deepseek-ai/dsh-compaction-basic'))
  assert(compaction.config.some(plugin => plugin.name === '@deepseek-ai/dsh-command-compact'))
  assert(!compaction.config.some(plugin => plugin.name === '@deepseek-ai/dsh-compaction-tool-result-pruner'))
  assert.equal(compaction.isolate.toolResultPruner, undefined)
})

test('Linguist persona renders with the current host prompt variables', () => {
  const patch = yaml.load(readFileSync(new URL('../../packages/dsh-linguist/cordis.patch.yml', import.meta.url), 'utf8'), {
    schema: yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar' })),
  })
  const preset = patch[0].insert.find(plugin => plugin.id === 'preset-linguist')
  const persona = preset.config.plugins.find(plugin => plugin.id === 'persona').config
  const prompt = renderPrompt({
    sections: Object.entries(persona).map(([name, text]) => ({ name: `deployment:persona-${name}`, text })),
    variables: { provider: 'synthetic', model: 'Synthetic Model' },
  })
  assert.match(prompt, /game localization agent powered by the Synthetic Model model/)
})

test('native subagents can select a professional role while sharing the Linguist tool composition', () => {
  const patch = yaml.load(readFileSync(new URL('../../packages/dsh-linguist/cordis.patch.yml', import.meta.url), 'utf8'), {
    schema: yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar' })),
  })
  const presets = patch[0].insert.filter(plugin => plugin.name === '@deepseek-ai/dsh-agent-preset')
  const general = presets.find(plugin => plugin.config.id === 'linguist')
  const subagent = general.config.plugins.find(plugin => plugin.id === 'delegation').config.find(plugin => plugin.id === 'tool-subagent')
  for (const role of ['translator', 'reviewer', 'proofreader']) {
    const id = `linguist-${role}`
    assert.ok(subagent.config.allowedAgentPresets.includes(id))
    assert.deepEqual(presets.find(plugin => plugin.config.id === id).config.plugins, general.config.plugins)
  }
})
