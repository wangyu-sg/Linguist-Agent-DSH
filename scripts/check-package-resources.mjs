import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(new URL('../packages/linguist-domain-service/package.json', import.meta.url))
const JSZip = require('jszip')
assert.equal(process.argv.length, 3, 'Pass the actual Linguist plugin tarball path')
const tarball = resolve(process.argv[2])
const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n')
const readEntry = (entry) => execFileSync('tar', ['-xOzf', tarball, entry], { maxBuffer: 100 * 1024 * 1024 })
const temporary = mkdtempSync(join(tmpdir(), 'la-dsh-package-resources-'))
try {
  for (const entry of entries.filter((entry) => entry.startsWith('package/lib/') && /\.[cm]?js$/.test(entry))) {
    assert(!entry.split('/').includes('..'), 'Package entry escapes its directory')
    const path = join(temporary, entry.slice('package/'.length))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, readEntry(entry))
  }
  const manifest = JSON.parse(readEntry('package/package.json'))
  writeFileSync(join(temporary, 'package.json'), JSON.stringify(manifest))
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    const dependency = realpathSync(join(root, 'packages/dsh-linguist/node_modules', name))
    assert.equal(JSON.parse(readFileSync(join(dependency, 'package.json'), 'utf8')).version, version, `Declared dependency ${name} differs from its fixed version`)
    const destination = join(temporary, 'node_modules', name)
    mkdirSync(dirname(destination), { recursive: true })
    symlinkSync(dependency, destination, 'dir')
  }
  const lib = entries.filter((entry) => entry.startsWith('package/lib/'))
  const pdf = lib.find((entry) => /^pdf-.*\.mjs$/.test(basename(entry)))
  const office = lib.filter((entry) => /^officeParser-.*\.mjs$/.test(basename(entry)))
  const mammoth = lib.filter((entry) => /^lib-.*\.mjs$/.test(basename(entry)) && readEntry(entry).includes('convertToHtml') && readEntry(entry).includes('extractRawText'))
  assert(pdf && office.length && mammoth.length, 'Packaged PDF, Office and Mammoth modules are required')
  const docx = new JSZip()
  docx.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  docx.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  docx.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>LA-DSH synthetic package document.</w:t></w:r></w:p></w:body></w:document>')
  const pptx = new JSZip()
  pptx.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>')
  pptx.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>')
  pptx.file('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>')
  pptx.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>LA-DSH synthetic package slide.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>')
  const input = {
    pdf: pathToFileURL(join(temporary, pdf.slice('package/'.length))).href,
    office: office.map((entry) => pathToFileURL(join(temporary, entry.slice('package/'.length))).href),
    mammoth: mammoth.map((entry) => pathToFileURL(join(temporary, entry.slice('package/'.length))).href),
    docx: await docx.generateAsync({ type: 'base64' }), pptx: await pptx.generateAsync({ type: 'base64' }),
  }
  const probe = `
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const input = ${JSON.stringify(input)};
const db = new DatabaseSync(':memory:');
try { assert.equal(db.prepare('SELECT 7 AS n').get().n, 7); } finally { db.close(); }
const docx = Buffer.from(input.docx, 'base64');
for (const module of input.mammoth) {
  const { default: mammoth } = await import(module);
  assert.equal((await mammoth.extractRawText({ buffer: docx })).value.trim(), 'LA-DSH synthetic package document.');
  assert.equal((await mammoth.convertToHtml({ buffer: docx })).value.trim(), '<p>LA-DSH synthetic package document.</p>');
}
for (const module of input.office) {
  const { default: office } = await import(module);
  assert.equal((await office.parseOfficeAsync(docx)).trim(), 'LA-DSH synthetic package document.');
  assert.equal((await office.parseOfficeAsync(Buffer.from(input.pptx, 'base64'))).trim(), 'LA-DSH synthetic package slide.');
}
const { getDocument } = await import(input.pdf);
const text = 'LA-DSH synthetic package PDF.';
const stream = 'BT /F1 12 Tf 20 100 Td (' + text + ') Tj ET';
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', '<< /Length ' + stream.length + ' >>\\nstream\\n' + stream + '\\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
let source = '%PDF-1.4\\n'; const offsets = [];
for (const [i, object] of objects.entries()) { offsets.push(source.length); source += (i + 1) + ' 0 obj\\n' + object + '\\nendobj\\n'; }
const xref = source.length;
source += 'xref\\n0 6\\n0000000000 65535 f \\n' + offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \\n').join('') + 'trailer\\n<< /Size 6 /Root 1 0 R >>\\nstartxref\\n' + xref + '\\n%%EOF';
const pdf = await getDocument({ data: new TextEncoder().encode(source), disableFontFace: true, isEvalSupported: false, useWorkerFetch: false }).promise;
try { assert.equal(pdf.numPages, 1); assert.equal((await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str).join(' '), text); } finally { await pdf.destroy(); }
`
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], { input: probe, encoding: 'utf8', cwd: temporary, timeout: 30_000 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Packaged resources failed:\n${result.stdout}\n${result.stderr}`)
  process.stdout.write('PASS: 6 actual-tarball resource checks (SQLite, DOCX text/HTML, Office DOCX/PPTX, PDF text)\n')
} finally { rmSync(temporary, { recursive: true, force: true }) }
