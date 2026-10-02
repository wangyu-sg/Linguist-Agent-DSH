import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const baseline = JSON.parse(await readFile(join(here, "BASELINE.json"), "utf8"));
const install = join(root, ".toolchain/browser-skill");
const downloads = join(install, "downloads", baseline.cliRelease.version);
const binary = join(install, "bin/bsk");
const extensionDirectory = join(install, `extension-v${baseline.extensionRelease.manifestVersion}`);
const archive = join(downloads, baseline.cliRelease.archive);
const manifestFile = join(downloads, "version.json");
const extensionFile = join(downloads, baseline.extensionRelease.archive);

assert.equal(process.platform, "darwin", "pinned CLI asset is for macOS");
assert.equal(process.arch, "arm64", "pinned CLI asset is for Apple Silicon");

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}: ${result.stderr}`);
  return result.stdout.trim();
}
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function check(path, expected) {
  const actual = createHash("sha256").update(await readFile(path)).digest("hex");
  assert.equal(actual, expected, `SHA256 mismatch for ${path}`);
}

await mkdir(downloads, { recursive: true });
for (const [tag, name] of [
  [baseline.cliRelease.tag, baseline.cliRelease.archive],
  [baseline.cliRelease.tag, "version.json"],
  [baseline.extensionRelease.tag, baseline.extensionRelease.archive],
]) {
  if (!await exists(join(downloads, name))) {
    run("gh", ["release", "download", tag, "--repo", "Tencent/BrowserSkill", "--pattern", name, "--dir", downloads]);
  }
}
await check(archive, baseline.cliRelease.archiveSha256);
await check(manifestFile, baseline.cliRelease.versionManifestSha256);
await check(extensionFile, baseline.extensionRelease.archiveSha256);

const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
assert.equal(manifest.name, "bsk");
assert.equal(manifest.version, baseline.cliRelease.version);
assert.equal(manifest.tag, baseline.cliRelease.tag);
assert.equal(manifest.assets["darwin-arm64"].sha256, baseline.cliRelease.archiveSha256);
const extensionManifest = JSON.parse(run("unzip", ["-p", extensionFile, "manifest.json"]));
assert.equal(extensionManifest.name, "BrowserSkill");
assert.equal(extensionManifest.version, baseline.extensionRelease.manifestVersion);
if (!await exists(extensionDirectory)) {
  const stage = await mkdtemp(join(install, "extension-stage-"));
  try {
    run("unzip", ["-q", extensionFile, "-d", stage]);
    assert.deepEqual(JSON.parse(await readFile(join(stage, "manifest.json"), "utf8")), extensionManifest);
    await rename(stage, extensionDirectory);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
assert.deepEqual(JSON.parse(await readFile(join(extensionDirectory, "manifest.json"), "utf8")), extensionManifest);

if (!await exists(binary) || createHash("sha256").update(await readFile(binary)).digest("hex") !== baseline.cliRelease.binarySha256) {
  const stage = await mkdtemp(join(install, "cli-stage-"));
  try {
    assert.equal(run("tar", ["-tzf", archive]), "bsk");
    run("tar", ["-xzf", archive, "-C", stage]);
    await check(join(stage, "bsk"), baseline.cliRelease.binarySha256);
    await mkdir(dirname(binary), { recursive: true });
    await chmod(join(stage, "bsk"), 0o755);
    await rename(join(stage, "bsk"), binary);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
await check(binary, baseline.cliRelease.binarySha256);
assert.equal(run(binary, ["--version"]), `bsk ${baseline.cliRelease.version}`);

const receipt = {
  cli: { path: binary, tag: baseline.cliRelease.tag, releaseCommit: baseline.cliRelease.commit, sha256: baseline.cliRelease.binarySha256 },
  daemon: { executable: binary, expectedVersion: baseline.cliRelease.version, runtimeIdentity: "verify with bsk status --json" },
  extension: { archive: extensionFile, unpackedDirectory: extensionDirectory, tag: baseline.extensionRelease.tag, releaseCommit: baseline.extensionRelease.commit, sha256: baseline.extensionRelease.archiveSha256, connection: "not checked by this installer" },
};
await writeFile(join(install, "INSTALL.json"), JSON.stringify(receipt, null, 2) + "\n");
process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
