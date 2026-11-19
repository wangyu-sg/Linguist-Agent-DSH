import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

// Synthetic page shared by the before/after Desktop runs; no customer data.
const directory = resolve(process.argv[2])
await mkdir(directory, { recursive: true })
const upload = 'Synthetic BrowserSkill upload\n'
const download = 'Synthetic BrowserSkill download\n'
await writeFile(join(directory, 'upload.txt'), upload)
const events = []
const rows = Array.from({ length: 100 }, (_, i) => `<tr><td>${i + 1}</td><td>Synthetic reference ${i + 1}: ${'paper cranes and blue lanterns '.repeat(8)}</td></tr>`).join('')
const page = `<!doctype html><meta charset="utf-8"><title>BrowserSkill desktop check</title>
<h1>BrowserSkill desktop check</h1>
<form id="form"><label>Name <input id="name" name="name"></label>
<label>Count <input id="count" name="count" type="number"></label>
<label>Language <select id="language" name="language"><option value="en">English</option><option value="fr">French</option></select></label>
<button id="apply">Apply</button></form><p id="result">Not applied</p>
<label>Upload synthetic text <input type="file" id="upload"></label><p id="uploaded">No upload</p>
<a id="download" href="/download" download>Download synthetic text</a>
<details open><summary>Reference table</summary><table>${rows}</table></details>
<script>
document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();
const value=Object.fromEntries(new FormData(e.target));await fetch('/apply',{method:'POST',body:JSON.stringify(value)});
document.querySelector('#result').textContent=JSON.stringify(value);});
document.querySelector('#upload').addEventListener('change',async e=>{const file=e.target.files[0];
await fetch('/upload',{method:'POST',body:file});document.querySelector('#uploaded').textContent=await file.text();});
</script>`
const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/') {
    response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(page)
  } else if (request.method === 'GET' && request.url === '/download') {
    events.push({ action: 'download', at: Date.now() })
    await writeFile(join(directory, 'events.json'), JSON.stringify(events, null, 2))
    response.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="synthetic-download.txt"' }); response.end(download)
  } else if (request.method === 'POST' && ['/apply', '/upload'].includes(request.url)) {
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const bytes = Buffer.concat(chunks)
    events.push({ action: request.url.slice(1), at: Date.now(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), value: bytes.toString() })
    await writeFile(join(directory, 'events.json'), JSON.stringify(events, null, 2))
    response.writeHead(204); response.end()
  } else if (request.url === '/events') {
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(events))
  } else { response.writeHead(404); response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
await writeFile(join(directory, 'fixture.json'), JSON.stringify({ url, directory, upload, download }, null, 2))
console.log(JSON.stringify({ url, directory }))
