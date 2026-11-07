import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
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

const displayFiles = ["icon.png", "locale/en.json", "locale/zh.json"];

export async function applyDisplayMetadata(packageDirectory) {
  const manifestPath = join(packageDirectory, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = baseline.adaptedPluginVersion;
  manifest.exports["./locale/*.json"] = "./locale/*.json";
  manifest.exports["./icon"] = "./icon.png";
  manifest.files = [...new Set([...manifest.files, "locale/*.json", "icon.png"])];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  for (const file of displayFiles) {
    await mkdir(dirname(join(packageDirectory, file)), { recursive: true });
    await cp(join(here, "metadata", file), join(packageDirectory, file));
  }
}

async function packageFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await packageFiles(join(directory, entry.name), `${name}/`));
    else {
      assert(entry.isFile(), `unexpected package entry ${name}`);
      files.push(name);
    }
  }
  return files;
}

export async function verifyMetadataOnlyPackage(original, adapted) {
  const originalFiles = await packageFiles(original);
  assert.deepEqual((await packageFiles(adapted)).sort(), [...originalFiles, ...displayFiles].sort(), "only display assets may be added");
  for (const file of originalFiles.filter((file) => file !== "package.json")) {
    assert.deepEqual(await readFile(join(adapted, file)), await readFile(join(original, file)), `${file} changed`);
  }
  const expected = JSON.parse(await readFile(join(original, "package.json"), "utf8"));
  expected.version = baseline.adaptedPluginVersion;
  expected.exports["./locale/*.json"] = "./locale/*.json";
  expected.exports["./icon"] = "./icon.png";
  expected.files = [...expected.files, "locale/*.json", "icon.png"];
  assert.deepEqual(JSON.parse(await readFile(join(adapted, "package.json"), "utf8")), expected, "non-display package metadata changed");
  for (const file of displayFiles) {
    assert.deepEqual(await readFile(join(adapted, file)), await readFile(join(here, "metadata", file)), `${file} differs from the metadata overlay`);
  }
  return originalFiles.length - 1;
}

async function buildFromSource(temp) {
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
  assert.equal(JSON.parse(await readFile(join(root, ".toolchain/pnpm-10.17/node_modules/pnpm/package.json"), "utf8")).version, baseline.pnpmVersion);
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
  return join(temp, "packages/dsh-plugin-browserskill");
}

async function main() {
  const metadataOnly = process.argv[2] === "--metadata-only";
  assert.deepEqual(process.argv.slice(2), metadataOnly ? ["--metadata-only"] : [], "usage: build-adapted-plugin.mjs [--metadata-only]");
  assert.equal(hash(await readFile(patch)), baseline.patchSha256, "BrowserSkill patch changed");
  assert.equal(hash(await readFile(adaptedLock)), baseline.adaptedLockSha256, "adapted dependency lock changed");
  const buildDirectory = join(root, ".toolchain/browser-skill");
  await mkdir(buildDirectory, { recursive: true });
  const temp = await mkdtemp(join(buildDirectory, "adapter-build-"));
  try {
    let packageDirectory;
    let original;
    const checks = metadataOnly ? ["pinned metadata-only repack"] : ["typecheck", "test", "build"];
    if (metadataOnly) {
      const archive = join(out, `wxg-prc-cpg-browser-skill-dsh-plugin-${baseline.metadataBase.version}.tgz`);
      assert.equal(hash(await readFile(archive)), baseline.metadataBase.tarballSha256, "metadata base tarball changed");
      const unpacked = join(temp, "original");
      await mkdir(unpacked);
      run("tar", ["-xzf", archive, "-C", unpacked], root);
      original = join(unpacked, "package");
      const manifest = JSON.parse(await readFile(join(original, "package.json"), "utf8"));
      assert.equal(manifest.name, baseline.upstreamPlugin.name);
      assert.equal(manifest.version, baseline.metadataBase.version);
      packageDirectory = join(temp, "adapted");
      await cp(original, packageDirectory, { recursive: true });
    } else {
      packageDirectory = await buildFromSource(temp);
    }
    await applyDisplayMetadata(packageDirectory);
    const packed = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--pack-destination", temp, "--json"], packageDirectory, true, { ...process.env, npm_config_cache: join(temp, "npm-cache") }))[0];
    assert.equal(packed.name, baseline.upstreamPlugin.name);
    assert.equal(packed.version, baseline.adaptedPluginVersion);
    for (const required of ["LICENSE", "lib/index.mjs", "lib/client.cjs", "skill/references/file-transfers.md", ...displayFiles]) {
      assert(packed.files.some((file) => file.path === required), `missing package file ${required}`);
    }
    if (original) {
      const unpacked = join(temp, "verification");
      await mkdir(unpacked);
      run("tar", ["-xzf", join(temp, packed.filename), "-C", unpacked], root);
      const preserved = await verifyMetadataOnlyPackage(original, join(unpacked, "package"));
      checks.push(`${preserved} original package files byte-identical`, "only version and display manifest fields changed");
    }
    run(process.execPath, [join(root, "scripts/check-plugin-display.mjs"), join(temp, packed.filename)], root);
    checks.push("plugin display metadata");
    const bytes = await readFile(join(temp, packed.filename));
    assert.equal(hash(bytes), baseline.adaptedTarballSha256, "adapted BrowserSkill tarball changed");
    await mkdir(out, { recursive: true });
    const tarball = join(out, packed.filename);
    if (existsSync(tarball)) assert.deepEqual(await readFile(tarball), bytes, "refusing to overwrite a different existing tarball");
    else await writeFile(tarball, bytes, { flag: "wx" });
    const receipt = {
      package: `${packed.name}@${packed.version}`,
      tarball,
      sha256: hash(bytes),
      integrity: packed.integrity,
      bytes: (await stat(tarball)).size,
      sourceCommit: baseline.upstreamCommit,
      patchSha256: baseline.patchSha256,
      dshVersion: baseline.dshVersion,
      checks,
    };
    await writeFile(join(out, "BUILD.json"), JSON.stringify(receipt, null, 2) + "\n");
    process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
  } finally {
    assert.equal(dirname(resolve(temp)), buildDirectory);
    assert(basename(temp).startsWith("adapter-build-"));
    await rm(temp, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
