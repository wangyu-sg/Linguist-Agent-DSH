import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { bundleAsync } from 'lightningcss'

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const cssPath = fileURLToPath(new URL('./Native.module.css', import.meta.url))

async function badgeCss() {
  const result = await bundleAsync({
    filename: cssPath,
    projectRoot: dirname(dirname(dirname(cssPath))),
    cssModules: { pattern: '[hash]_[local]' },
    minify: true,
  })
  return { css: result.code.toString(), names: result.exports }
}

test('session badge responds to the host title-row container, not the viewport', async () => {
  const { css, names } = await badgeCss()
  const className = key => `.${names[key].name}`
  for (const name of ['identity', 'identityProject', 'badgeOpen', 'badgeIcon', 'badgeEllipsis', 'badgeMenu']) {
    assert.ok(names[name], `expected CSS module export ${name}`)
  }
  const medium = css.match(/@container\s*\(width\s*<=\s*1200px\)\s*\{([^{}]*\{[^{}]*\})\s*\}/)?.[1]
  const narrow = css.match(/@container\s*\(width\s*<=\s*960px\)\s*\{((?:[^{}]*\{[^{}]*\})+)\s*\}/)?.[1]
  assert.ok(medium, 'expected project-name breakpoint')
  assert.ok(narrow, 'expected icon-menu breakpoint')
  assert.ok(medium.includes(`${className('identityProject')}{display:none}`))
  assert.ok(narrow.includes(`${className('identity')}`))
  assert.ok(narrow.includes(`${className('badgeOpen')}`))
  assert.ok(narrow.includes(`${className('badgeEllipsis')}`))
  assert.ok(narrow.includes(`${className('badgeIcon')}{display:inline-flex}`))
})

test('compact menu keeps the full identity and workbench action available', () => {
  const start = source.indexOf('function SessionBadge(')
  const end = source.indexOf('\nexport function apply(', start)
  assert.ok(start >= 0 && end > start)
  const badge = source.slice(start, end)
  assert.match(badge, /label: identity, portal: true/)
  assert.match(badge, /'aria-label': `\$\{t\('Linguist 操作'\)\}：\$\{identity\}`/)
  assert.match(badge, /\{ type: 'label', id: 'identity', text: identity \}/)
  assert.match(badge, /openAction !== null \? \[\{ id: 'open', label: openAction\.label \}\] : \[\]/)
  assert.match(badge, /id === 'open'\) runOpen\(\)/)
  assert.match(badge, /openCat\(sessionId, binding\.projectId!\)/)
  assert.match(badge, /openWorkingCopy\(sessionId\)/)
  assert.doesNotMatch(source, /browserskill-observation|openBrowser\(/)
  assert.doesNotMatch(badge, /useHeaderDensity|ResizeObserver/)
})
