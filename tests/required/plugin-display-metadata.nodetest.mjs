import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { inspectPluginDisplay } from '../../scripts/check-plugin-display.mjs'

const la = new URL('../../packages/dsh-linguist/', import.meta.url)
const browser = new URL('../../integrations/browser-skill/metadata/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('package.json', la), 'utf8'))
const readLa = path => readFileSync(new URL(path, la))

test('Linguist root exports retain runtime entries and resolve localized display text and a real PNG', () => {
  assert.equal(manifest.exports['.'].default, './lib/index.mjs')
  assert.equal(manifest.exports['./client'].default, './lib/client.cjs')
  const display = inspectPluginDisplay(manifest, readLa)
  assert.equal(display.locales.en.title, 'Linguist Agent')
  assert.equal(display.locales.zh.title, 'Linguist Agent · 游戏本地化')
  assert.match(display.locales.zh.description, /CAT.*术语.*翻译记忆/)
  assert.equal(display.icon.width, 128)
  assert.equal(display.icon.height, 128)
  assert(manifest.files.includes('resources'))
})

test('BrowserSkill local display overlay has its own bilingual text and distinct valid icon', () => {
  const display = inspectPluginDisplay({ name: '@wxg-prc-cpg/browser-skill-dsh-plugin', exports: { './locale/*.json': './locale/*.json', './icon': './icon.png' } }, path => readFileSync(new URL(path, browser)))
  assert.equal(display.locales.en.title, 'BrowserSkill')
  assert.equal(display.locales.zh.title, 'BrowserSkill · 浏览器自动化')
  assert.match(display.locales.zh.description, /浏览器.*标签页.*文件传输/)
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  assert.notEqual(hash(readLa('resources/plugin-icon.png')), hash(readFileSync(new URL('icon.png', browser))))
})

test('display packaging checks reject absent exports, missing localized fields and corrupt or escaping icons', () => {
  const missing = structuredClone(manifest)
  delete missing.exports['./locale/*.json']
  assert.throws(() => inspectPluginDisplay(missing, readLa), /Export/)
  assert.throws(() => inspectPluginDisplay(manifest, path => path.endsWith('/zh.json') ? Buffer.from('{"meta":{"title":"测试"}}') : readLa(path)), /meta.description/)
  assert.throws(() => inspectPluginDisplay(manifest, path => path.endsWith('.png') ? Buffer.alloc(32) : readLa(path)), /PNG bytes/)
  const escaping = structuredClone(manifest)
  escaping.exports['./icon'] = './../foreign.png'
  assert.throws(() => inspectPluginDisplay(escaping, readLa), /inside the package/)
})
