import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const pnpm = join(root, ".toolchain/pnpm-10.17/node_modules/pnpm/bin/pnpm.cjs");
const baseline = JSON.parse(await readFile(join(here, "BASELINE.json"), "utf8"));
const source = join(root, `.toolchain/source/browser-skill-${baseline.upstreamPlugin.version}`);
const patch = join(here, "patches/browser-files.patch");
const out = join(here, "dist");
const adaptedLock = join(here, "pnpm-lock.yaml");

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function treeHash(directory) {
  const digest = createHash("sha256");
  async function walk(parent, prefix = "") {
    for (const entry of (await readdir(parent, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = join(parent, entry.name);
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(path, `${name}/`);
      else {
        assert(entry.isFile(), `unexpected source entry ${path}`);
        digest.update(name).update("\0").update(await readFile(path)).update("\0");
      }
    }
  }
  await walk(directory);
  return digest.digest("hex");
}
function run(command, args, cwd, capture = false, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}\n${result.stderr ?? ""}`);
  return result.stdout;
}

if (!existsSync(source)) {
  const response = await fetch(`https://codeload.github.com/Tencent/BrowserSkill/tar.gz/${baseline.upstreamCommit}`);
  assert(response.ok, `upstream download failed: ${response.status}`);
  const archive = `${source}.tar.gz`;
  await mkdir(source, { recursive: true });
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  run("tar", ["-xzf", archive, "--strip-components=1", "-C", source], root);
}
assert.equal(await treeHash(join(source, "packages/dsh-plugin-browserskill")), baseline.upstreamPluginTreeSha256);
assert.equal(await treeHash(join(source, "packages/ui")), baseline.upstreamUiTreeSha256);
for (const [file, expected] of [
  ["pnpm-lock.yaml", baseline.upstreamLockSha256],
  ["package.json", baseline.upstreamRootPackageSha256],
  ["pnpm-workspace.yaml", baseline.upstreamWorkspaceSha256],
]) assert.equal(hash(await readFile(join(source, file))), expected, `upstream ${file} changed`);
assert.equal(hash(await readFile(patch)), baseline.patchSha256, "BrowserSkill patch changed");
assert.equal(JSON.parse(await readFile(join(root, ".toolchain/pnpm-10.17/node_modules/pnpm/package.json"), "utf8")).version, baseline.pnpmVersion);
assert.equal(hash(await readFile(adaptedLock)), baseline.adaptedLockSha256, "adapted dependency lock changed");

const temp = join(root, ".toolchain/browser-skill/adapter-build");
await mkdir(join(root, ".toolchain/browser-skill"), { recursive: true });
await mkdir(temp);
try {
  await mkdir(join(temp, "packages"));
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
    await cp(join(source, file), join(temp, file));
  }
  for (const name of ["dsh-plugin-browserskill", "ui"]) {
    await cp(join(source, "packages", name), join(temp, "packages", name), { recursive: true });
  }
  run("patch", ["-p1", "-i", patch], temp);
  await cp(adaptedLock, join(temp, "pnpm-lock.yaml"));
  run(process.execPath, [pnpm, "install", "--frozen-lockfile", "--filter", "@wxg-prc-cpg/browser-skill-dsh-plugin...", "--ignore-scripts"], temp);
  for (const script of ["typecheck", "test", "build"]) {
    run(process.execPath, [pnpm, "--filter", "@wxg-prc-cpg/browser-skill-dsh-plugin", script], temp);
  }
  await mkdir(out, { recursive: true });
  const npmCache = join(temp, "npm-cache");
  const packed = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--pack-destination", out, "--json"], join(temp, "packages/dsh-plugin-browserskill"), true, { ...process.env, npm_config_cache: npmCache }))[0];
  assert.equal(packed.name, baseline.upstreamPlugin.name);
  assert.equal(packed.version, baseline.adaptedPluginVersion);
  for (const required of ["LICENSE", "lib/index.mjs", "lib/client.cjs", "skill/references/file-transfers.md"]) {
    assert(packed.files.some((file) => file.path === required), `missing package file ${required}`);
  }
  const tarball = join(out, packed.filename);
  const bytes = await readFile(tarball);
  assert.equal(hash(bytes), baseline.adaptedTarballSha256, "adapted BrowserSkill tarball changed");
  const receipt = {
    package: `${packed.name}@${packed.version}`,
    tarball,
    sha256: hash(bytes),
    integrity: packed.integrity,
    bytes: (await stat(tarball)).size,
    sourceCommit: baseline.upstreamCommit,
    patchSha256: baseline.patchSha256,
    dshVersion: baseline.dshVersion,
    checks: ["typecheck", "test", "build"],
  };
  await writeFile(join(out, "BUILD.json"), JSON.stringify(receipt, null, 2) + "\n");
  process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
} finally {
  await rm(temp, { recursive: true, force: true });
}
