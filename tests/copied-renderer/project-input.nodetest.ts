import test from 'node:test'
import assert from 'node:assert/strict'
import { LOCALE_MAX_LENGTH, LOCALE_PATTERN, PROJECT_NAME_MAX_LENGTH } from '../../packages/dsh-linguist/src/project-input.ts'

test('native project forms and Host share the source metadata limits', () => {
  assert.equal(PROJECT_NAME_MAX_LENGTH, 120)
  assert.equal(LOCALE_MAX_LENGTH, 35)
  // HTML pattern uses the v flag; exercise the same constraint as the browser.
  const nativePattern = new RegExp(LOCALE_PATTERN.source, 'v')
  for (const locale of ['en', 'zh-CN', 'zh-Hant-TW', 'pt-BR', 'es-419']) {
    assert.equal(nativePattern.test(locale), true, locale)
    assert.equal(LOCALE_PATTERN.test(locale), true, locale)
  }
  for (const locale of ['', 'e', 'english', 'zh_CN', 'zh--CN', 'zh-C', 'zh-中文']) {
    assert.equal(nativePattern.test(locale), false, locale)
    assert.equal(LOCALE_PATTERN.test(locale), false, locale)
  }
})
