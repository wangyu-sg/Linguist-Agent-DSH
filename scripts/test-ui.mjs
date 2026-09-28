import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const evidenceRoot = join(root, 'artifacts/evidence')
const currentPath = join(process.env.HOME, 'Library/Application Support/Linguist-Agent-DSH/current.json')
const packPath = join(root, 'artifacts/pack.json')
const rawPath = join(evidenceRoot, 'ui-cua.json')
const reportPath = join(evidenceRoot, 'ui-validation.json')
const logPath = join(evidenceRoot, 'ui-validation.log')
const requiredViews = ['projects', 'cat', 'qa', 'proposal', 'references', 'conflict', 'browser', 'settings']
const requiredActions = {
  V19: ['ime', 'emoji-combining', 'tag-atomic', 'locked-segment', 'line-break', 'undo-redo', 'shortcut', 'virtual-scroll'],
  V20: ['side-by-side', 'fullscreen', 'floating', 'two-projects', 'light-theme', 'dark-theme', 'narrow-window', 'keyboard-navigation', 'no-zombie-slot'],
}
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const sha = value => createHash('sha256').update(value).digest('hex')
const fileSha = path => sha(readFileSync(path))
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const assert = (condition, message) => { if (!condition) throw new Error(message) }

function evidencePath(path) {
  assert(typeof path === 'string' && path.length > 0, 'CUA evidence path is missing')
  const absolute = resolve(root, path)
  assert(absolute.startsWith(`${evidenceRoot}${sep}`), `CUA evidence is outside ${evidenceRoot}: ${path}`)
  assert(existsSync(absolute), `CUA evidence file is missing: ${path}`)
  return absolute
}

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, content)
  renameSync(temporary, path)
}

function validate() {
  assert(existsSync(currentPath), `current installed product record is missing: ${currentPath}`)
  assert(existsSync(packPath), `current package manifest is missing: ${packPath}`)
  assert(existsSync(rawPath), `real CUA evidence index is missing: ${rawPath}`)
  const current = readJson(currentPath)
  const pack = readJson(packPath)
  const raw = readJson(rawPath)
  const packAt = Date.parse(pack.createdAt)
  assert(current.profile === 'desktop' && current.desktopArtifact?.sha256, 'installed carrier is not the official DSH Desktop')
  assert(current.dshVersion === pack.dshVersion, 'installed DSH version differs from current pack')
  assert(Number.isFinite(packAt), 'package time is invalid')
  assert(raw.schemaVersion === 1 && raw.generatedBy === 'mcp__cua_repl', 'UI index must identify real CUA capture')
  assert(raw.installationId === current.installationId && raw.currentSha256 === fileSha(currentPath), 'CUA capture belongs to another installation record')
  assert(raw.desktopArtifactSha256 === current.desktopArtifact.sha256, 'CUA capture belongs to another official Desktop artifact')
  for (const name of ['linguist', 'browserSkill']) {
    assert(current.plugins?.[name]?.sha256 === pack[name].sha256 && raw.pluginHashes?.[name] === pack[name].sha256, `${name} UI capture differs from installed package`)
  }
  assert(raw.url === 'dsh-app://app/' && Number.isFinite(Date.parse(raw.capturedAt)) && Date.parse(raw.capturedAt) >= packAt, 'UI capture URL or time is invalid')
  const trace = evidencePath(raw.actionTracePath)
  assert(fileSha(trace) === raw.actionTraceSha256 && statSync(trace).mtimeMs >= packAt, 'CUA action trace hash or freshness differs')
  const traceText = readFileSync(trace, 'utf8')
  for (const value of ['mcp__cua_repl', current.installationId, 'dsh-app://app/']) assert(traceText.includes(value), `CUA action trace omits ${value}`)

  assert(Array.isArray(raw.screenshots) && raw.screenshots.length >= requiredViews.length, 'installed Desktop screenshots are incomplete')
  const screenshots = raw.screenshots.map(item => {
    const path = evidencePath(item.path)
    const bytes = readFileSync(path)
    assert(fileSha(path) === item.sha256 && statSync(path).mtimeMs >= packAt, `CUA screenshot hash or freshness differs: ${item.path}`)
    assert(bytes.length >= 24 && bytes.subarray(0, 8).equals(pngSignature) && bytes.toString('ascii', 12, 16) === 'IHDR', `CUA screenshot is not a PNG: ${item.path}`)
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    assert(width > 0 && height > 0, `CUA screenshot dimensions are invalid: ${item.path}`)
    assert(requiredViews.includes(item.view), `CUA screenshot view is unexpected: ${item.view}`)
    assert(['light', 'dark'].includes(item.theme) && ['normal', 'narrow'].includes(item.widthMode), `CUA screenshot theme or width is invalid: ${item.path}`)
    return { path: item.path, sha256: item.sha256, width, height, view: item.view, theme: item.theme, widthMode: item.widthMode }
  })
  for (const view of requiredViews) assert(screenshots.some(item => item.view === view), `installed UI view ${view} was not captured`)
  for (const theme of ['light', 'dark']) assert(screenshots.some(item => item.theme === theme), `installed UI ${theme} theme was not captured`)
  assert(screenshots.some(item => item.widthMode === 'normal'), 'installed UI normal window was not captured')
  assert(screenshots.some(item => item.widthMode === 'narrow'), 'installed UI narrow window was not captured')

  assert(Array.isArray(raw.actions), 'CUA action observations are missing')
  for (const [family, ids] of Object.entries(requiredActions)) {
    for (const id of ids) {
      const action = raw.actions.find(item => item.id === id)
      assert(action?.result === 'observed' && typeof action.detail === 'string' && action.detail.trim() && Number.isFinite(Date.parse(action.at)) && Date.parse(action.at) >= packAt, `${family} CUA action ${id} was not observed on the installed app`)
      assert(traceText.includes(id), `CUA action trace omits ${id}`)
    }
  }

  const log = [
    `mcp__cua_repl installationId=${current.installationId} url=${raw.url} capturedAt=${raw.capturedAt}`,
    `currentSha256=${raw.currentSha256} desktopArtifactSha256=${raw.desktopArtifactSha256}`,
    `actionTrace=${raw.actionTracePath} sha256=${raw.actionTraceSha256}`,
    ...screenshots.map(item => `screenshot ${item.view} ${item.theme} ${item.widthMode} ${item.width}x${item.height} sha256=${item.sha256} path=${item.path}`),
    ...Object.entries(requiredActions).map(([family, ids]) => `${family} observed=${ids.join(',')}`),
  ].join('\n') + '\n'
  atomicWrite(logPath, log)
  return {
    schemaVersion: 1, generatedBy: 'scripts/test-ui.mjs', evaluatedAt: new Date().toISOString(), status: 'PASS',
    rawPath, rawSha256: fileSha(rawPath),
    ui: {
      installationId: current.installationId, url: raw.url, views: requiredViews,
      themes: ['light', 'dark'], widths: ['normal', 'narrow'], screenshots,
      actionTracePath: raw.actionTracePath, actionTraceSha256: raw.actionTraceSha256,
    },
    testRuns: Object.entries(requiredActions).map(([id, ids]) => ({
      id, command: 'node scripts/test-ui.mjs (validates mcp__cua_repl evidence)', exitCode: 0,
      passed: ids.length, skipped: 0, installationId: current.installationId,
      pluginHashes: { linguist: pack.linguist.sha256, browserSkill: pack.browserSkill.sha256 },
      logPath, logSha256: sha(log),
    })),
  }
}

try {
  const report = validate()
  atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`PASS: real installed Desktop CUA evidence validated; ${reportPath}\n`)
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error)
  atomicWrite(reportPath, `${JSON.stringify({ schemaVersion: 1, generatedBy: 'scripts/test-ui.mjs', evaluatedAt: new Date().toISOString(), status: 'FAILED', detail }, null, 2)}\n`)
  process.stderr.write(`FAILED: ${detail}\n${reportPath}\n`)
  process.exitCode = 1
}
