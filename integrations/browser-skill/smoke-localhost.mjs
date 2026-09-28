import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const bsk = join(root, ".toolchain/browser-skill/bin/bsk");
const receiptFile = join(here, "dist/LOCALHOST_SMOKE.json");
const home = process.env.BSK_HOME;
assert(home, "set BSK_HOME to the new product's BrowserSkill home or an isolated test home");
assert.notEqual(resolve(home), resolve(process.env.HOME, ".bsk"), "do not target the user's default BrowserSkill daemon");

const downloadContent = "LA-DSH synthetic browser download\n";
const uploadContent = "LA-DSH synthetic browser upload\n";
const page = `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>LA-DSH BrowserSkill fixture</title>
<body><h1>LA-DSH synthetic browser fixture</h1>
<label for="note">Note</label><input id="note" aria-label="Note">
<input id="upload" type="file" aria-label="Attach synthetic file">
<p id="attached">No file attached</p>
<a id="download" href="/download">Download synthetic file</a>
<script>
document.querySelector('#upload').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  document.querySelector('#attached').textContent = file.name + ': ' + await file.text();
});
</script></body></html>`;
const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page);
  } else if (request.method === "GET" && request.url === "/download") {
    response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": 'attachment; filename="la-dsh-synthetic-download.txt"',
    });
    response.end(downloadContent);
  } else {
    response.writeHead(404);
    response.end();
  }
});

async function cli(args) {
  const child = spawn(bsk, args, {
    env: { ...process.env, BSK_HOME: home, BSK_AUTO_START: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill("SIGTERM"), 150_000);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  clearTimeout(timeout);
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}
async function required(args) {
  const result = await cli(args);
  assert.equal(result.code, 0, `bsk ${args[0]} failed: ${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const url = `http://127.0.0.1:${server.address().port}/`;
const work = await mkdtemp(join(tmpdir(), "la-dsh-bsk-smoke-"));
const evidence = {
  status: "FAILED",
  fixture: url,
  cli: bsk,
  bskHome: home,
  checks: {},
};
let sessionId;
try {
  const fixtureResponse = await fetch(url);
  assert.equal(fixtureResponse.status, 200);
  assert.match(await fixtureResponse.text(), /LA-DSH synthetic browser fixture/);
  evidence.checks.fixtureHttp = "PASS";

  assert.equal(await required(["--version"]), "bsk 0.3.1");
  evidence.checks.cli = "PASS";
  const status = await cli(["status", "--json"]);
  if (status.code !== 0) {
    evidence.status = "BLOCKED_ENV";
    evidence.blocker = "BrowserSkill daemon is not running for the specified BSK_HOME";
    evidence.daemonResponse = status.stdout || status.stderr;
  } else {
    const daemon = JSON.parse(status.stdout);
    assert.equal(daemon.daemon_version, "0.3.1");
    assert.equal(daemon.protocol_version, "1.3");
    evidence.checks.daemon = "PASS";
    evidence.daemon = { version: daemon.daemon_version, protocol: daemon.protocol_version, wsPort: daemon.ws_port };
    evidence.connectedBrowsers = daemon.browsers.map(({ instance_id, extension_version, browser_name }) => ({ instance_id, extension_version, browser_name }));
    if (daemon.browsers.length === 0) {
      evidence.status = "BLOCKED_ENV";
      evidence.blocker = "No real BrowserSkill browser extension is connected to this daemon";
      evidence.checks.extension = "BLOCKED_ENV";
    } else {
      const selector = process.env.BSK_BROWSER_ID;
      const browser = selector
        ? daemon.browsers.find(({ instance_id }) => instance_id === selector)
        : daemon.browsers.length === 1 ? daemon.browsers[0] : undefined;
      if (!browser) {
        evidence.status = "BLOCKED_ENV";
        evidence.blocker = "Select the intended connected browser with BSK_BROWSER_ID";
        evidence.checks.extension = "BLOCKED_ENV";
      } else {
        assert.equal(browser.extension_version, "0.3.1");
        evidence.checks.extension = "PASS";
        const started = JSON.parse(await required(["session", "start", "--no-focus", "--browser", browser.instance_id, "--json"]));
        sessionId = started.session_id;
        assert(sessionId);
        assert.equal(started.browser_instance_id, browser.instance_id);
        evidence.session = { id: sessionId, browserInstanceId: browser.instance_id };

        await required(["navigate", url, "--session", sessionId, "--json"]);
        assert.match(await required(["observe", "--session", sessionId]), /LA-DSH synthetic browser fixture/);
        evidence.checks.navigationAndObservation = "PASS";

        await required(["fill", "#note", "--value", "Synthetic note", "--session", sessionId, "--json"]);
        assert.match(await required(["get-html", "--session", sessionId]), /value="Synthetic note"/);
        evidence.checks.formEdit = "PASS";

        const upload = join(work, "la-dsh-synthetic-upload.txt");
        await writeFile(upload, uploadContent);
        await required(["upload", "#upload", "--file", upload, "--session", sessionId, "--json"]);
        const afterUpload = await required(["get-html", "--session", sessionId]);
        assert.match(afterUpload, /LA-DSH synthetic browser upload/);
        evidence.checks.uploadAttachment = "PASS";

        const destination = join(work, "la-dsh-synthetic-download.txt");
        await required(["download", "#download", "--out", destination, "--session", sessionId, "--json"]);
        assert.equal(await readFile(destination, "utf8"), downloadContent);
        evidence.checks.downloadBytes = "PASS";
        evidence.status = "READY";
      }
    }
  }
} catch (error) {
  evidence.status = "FAILED";
  evidence.error = error.message;
} finally {
  if (sessionId) {
    const stopped = await cli(["session", "stop", sessionId, "--json"]);
    evidence.checks.ownedSessionStop = stopped.code === 0 ? "PASS" : "FAIL";
    if (stopped.code !== 0) {
      evidence.status = "FAILED";
      evidence.stopError = stopped.stdout || stopped.stderr;
    }
  }
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(work, { recursive: true, force: true });
}
await mkdir(dirname(receiptFile), { recursive: true });
await writeFile(receiptFile, JSON.stringify(evidence, null, 2) + "\n");
process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
process.exitCode = evidence.status === "READY" ? 0 : evidence.status === "BLOCKED_ENV" ? 2 : 1;
