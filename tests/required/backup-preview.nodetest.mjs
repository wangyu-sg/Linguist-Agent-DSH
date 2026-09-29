import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const client = new URL('../../packages/dsh-linguist/src/client/', import.meta.url)
const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function renderPreview(preview, props = {}) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(new URL('BackupRestorePreview.tsx', client), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { exports, require: name => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: ({ variant, size, ...props }) => React.createElement('button', props) }
    if (name === './ui-locale') return { useT: () => (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(params[name])) }
    if (name.endsWith('.module.css')) return { default: {} }
    throw new Error(`Unexpected backup preview import: ${name}`)
  } })
  return renderToStaticMarkup(React.createElement(exports.BackupRestorePreview, {
    preview, archived: false, busy: false, onConfirm() {}, onClose() {}, ...props,
  }))
}

const preview = {
  backupName: 'backup-synthetic', format: 'directory', restorable: true,
  verification: { ok: true, problems: [] }, backupSchemaVersion: 4, currentSchemaVersion: 5, willMigrate: true,
  backupSummary: { assetCount: 2, totalSegments: 11, segmentCounts: { untranslated: 0, draft: 1, translated: 4, reviewed: 6 } },
  currentSummary: { assetCount: 3, totalSegments: 19, segmentCounts: { untranslated: 5, draft: 2, translated: 9, reviewed: 3 } },
}

test('restore preview shows real backup/current counts, verification, schema and replacement consequences', () => {
  const html = renderPreview(preview)
  assert.match(html, /<th[^>]*>备份<\/th>/)
  assert.match(html, /<th[^>]*>当前<\/th>/)
  assert.match(html, /总段数<\/th><td>11<\/td><td>19<\/td>/)
  assert.match(html, /未翻译<\/th><td>0<\/td><td>5<\/td>/)
  for (const text of ['完整性校验通过', '备份数据库版本：v4', '当前数据库版本：v5', '恢复后首次打开将自动迁移', '整体替换当前项目', 'pre-restore', '取消']) assert(html.includes(text), text)
  assert.match(html, /<button[^>]*>确认恢复<\/button>/)
})

test('failed and legacy previews never enable restore or represent unavailable counts as zero', () => {
  const html = renderPreview({ ...preview, restorable: false, verification: { ok: false, problems: ['source/blobs hash mismatch', 'database integrity failed'] }, backupSummary: undefined })
  for (const text of ['完整性校验未通过', 'source/blobs hash mismatch', 'database integrity failed']) assert(html.includes(text), text)
  assert.match(html, /总段数<\/th><td>—<\/td><td>19<\/td>/)
  assert.match(html, /<button[^>]*disabled=""[^>]*>确认恢复<\/button>/)
  const legacy = renderPreview({ ...preview, format: 'legacy', restorable: false, verification: undefined, notice: '旧格式备份仅可预览' })
  assert(legacy.includes('旧格式备份仅可预览'))
  assert(!legacy.includes('完整性校验通过'))
  for (const state of [{ archived: true }, { busy: true }]) assert.match(renderPreview(preview, state), /<button[^>]*disabled=""[^>]*>[^<]*恢复[^<]*<\/button>/)
  const panel = readFileSync(new URL('Panels.tsx', client), 'utf8')
  assert.match(panel, /required<LinguistRestorePreview>\('linguistBackupsPreviewRestore'/)
  assert.match(panel, /<BackupRestorePreview\b/)
})
