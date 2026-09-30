import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { bundleAsync } from 'lightningcss'
import { defineConfig, type UserConfig } from 'tsdown'
import pkg from './package.json' with { type: 'json' }

const sharedClient = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
]
const cssPrefix = '\0linguist-css:'

const client: UserConfig = {
  name: `${pkg.name}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  clean: false,
  external: [...sharedClient, /^@deepseek-ai\/(?!dsh-util-workspace-path$)/],
  noExternal: (id: string) => id === '@deepseek-ai/dsh-util-workspace-path' ? true : sharedClient.includes(id) || id.startsWith('@deepseek-ai/') ? undefined : true,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [{
    name: 'linguist-css-modules',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      return `${cssPrefix}${relative(process.cwd(), resolve(dirname(importer!), source))}?module`
    },
    async load(id: string) {
      if (!id.startsWith(cssPrefix)) return null
      const path = resolve(process.cwd(), id.slice(cssPrefix.length, -'?module'.length))
      const { code, exports } = await bundleAsync({
        filename: path, projectRoot: process.cwd(), cssModules: { pattern: '[hash]_[local]' }, minify: true,
        resolver: { read: (file) => { this.addWatchFile(file); return readFile(file, 'utf8') } },
      })
      const names = Object.fromEntries(Object.entries(exports!).map(([name, value]) => [name, [value.name, ...value.composes.map(reference => reference.name)].join(' ')]))
      const tag = `${pkg.name}/${basename(path)}`
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `if (typeof document !== 'undefined' && !document.querySelector('style[data-linguist-css=${JSON.stringify(tag)}]')) {`,
        `  const element = document.createElement('style'); element.dataset.linguistCss = ${JSON.stringify(tag)}; element.textContent = css; document.head.appendChild(element);`,
        `}`,
        `export default ${JSON.stringify(names)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.cjs',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([
  {
    name: `${pkg.name}/host`,
    entry: { index: 'src/index.ts' },
    outDir: 'lib', format: 'esm', dts: false, clean: false,
    copy: ['../linguist-domain-service/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
    external: [/^@deepseek-ai\//],
    noExternal: [/^@linguist\//, /^file-type$/],
    outputOptions: { entryFileNames: 'index.mjs' },
  },
  {
    name: `${pkg.name}/worker`,
    entry: {
      'cat-job-worker': '../linguist-domain-service/src/cat-job-worker.ts',
      'integrity-scrub-worker': 'src/host/integrity-worker.ts',
    },
    outDir: 'lib', format: 'esm', dts: false, clean: false,
    external: [/^@deepseek-ai\//],
    noExternal: [/^@linguist\//, /^file-type$/],
    outputOptions: { entryFileNames: '[name].js' },
  },
  client,
])
