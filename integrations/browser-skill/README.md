# BrowserSkill for LA-DSH

This directory adapts the pinned upstream DSH plugin in `BASELINE.json`. It adds
`bsk_files` to the same BrowserSkill Host/Client plugin instance and keeps its
owned sessions, runner, queue, cancellation, observation, and UI. There is no
second browser-control path.

The supported host baseline is DSH 0.2.2-rc.3 on macOS ARM64. Runtime peers and engines allow `>=0.2.2-rc.3 <0.2.3-0`; build SDKs remain pinned to rc.3. Future interface changes still require verification. Use the local
0.4.2-la-dsh.2 plugin tarball, bsk 0.4.2 CLI/daemon, and extension 0.4.2 with
protocol 1.8. The extension must show a connection to the configured daemon port
before browser actions work. Install or update the tarball through the official
DSH plugin manager, following its prompts to enable the plugin and reload if required.

The adaptation retains English/Chinese display resources, the DSH screenshot
and session binding fixes, and the file-transfer additions. The 0.4.2 update
passes its pinned source build, typecheck, plugin tests, package and display
checks. On the target macOS desktop it is installed and enabled, the matching
Chrome extension is connected, and generated localhost navigation, upload,
download, and repeat-request checks pass. No customer-platform test is implied.

The runtime is based on official 0.4.2 and uses its `bsk_*` tool names.
Reload `/browser-skill` in existing conversations to obtain the current tool instructions.
The patch targets the DSH 0.2.2 attachment API and current-session UI binding, retains notification sources and terminal labels, and adds
`bsk_files`, durable receipts, canonical request deduplication, configured
staging/home paths, and disables CLI self-update. Updating to the unmodified
marketplace package drops these additions.

Shared-control arguments retain the official `contextId`, `observationId`,
`dependsOn` and `expect` names and map to the corresponding CLI flags. File
transfers have one public entry, `bsk_files`: it reuses the official handlers
while enforcing workspace/staging paths and durable receipts. The duplicate
upload/download actions are removed from `bsk_interact`. Native dialog handling
remains available; resume a pending file save through `bsk_files` status with
the original request ID.

When upgrading the upstream runtime, upgrade the plugin, CLI/daemon and Chrome
extension together to the versions pinned in BASELINE.json. Keep `bskPath`, `bskHome`, `fileStagingDirectory`,
`sessionStateDirectory` and the daemon port. With no browser tasks running, stop
the owned daemon, install the plugin through the native manager, replace the
CLI at the configured path, restart the daemon, update the Chrome extension and
connect it to that same port. Loading an unpacked extension from a new directory
can create a new extension identity; disable the old instance to avoid duplicate
connections. Preserve its user settings until the new connection is working.

The following are maintainer helpers, not normal LA installation prerequisites.
The source build uses the prepared, pinned upstream checkout and local tooling
in BASELINE.json. From this repository root:

```sh
node integrations/browser-skill/build-adapted-plugin.mjs
node integrations/browser-skill/install-cli.mjs
```

The source build verifies upstream source, patch and adapted dependency lock,
runs the upstream plugin suite plus the file-action tests, then applies the
version and display metadata from `metadata/` before packing. It verifies the
actual packed display resources and pinned tarball SHA and writes `dist/BUILD.json`.

For a metadata-only change with the unchanged runtime, use the fixed existing
0.4.2-la-dsh.0 tarball in `dist/`, pinned separately by `metadataBase` in
BASELINE.json. This path uses Node/npm without an upstream rebuild or dependency
installation:

```sh
node integrations/browser-skill/build-adapted-plugin.mjs --metadata-only
node --test tests/required/browser-skill-metadata-repack.nodetest.mjs
```

It applies the same metadata overlay, repacks with lifecycle scripts disabled,
and compares the actual unpacked result: every original non-manifest file must
remain byte-identical; only the adaptation version, display exports/files and
three display assets may differ. Both build paths check the new tarball SHA
before writing it. Existing tarballs are verified, never overwritten.

Install the resulting `dist/*.tgz` in the official DSH default desktop profile as its sole
BrowserSkill plugin. Set `bskPath` to the absolute path in
`.toolchain/browser-skill/INSTALL.json`, `fileStagingDirectory` to the new
product's staging directory, and `sessionStateDirectory` to a directory owned
by that profile. The CLI installer checks the pinned official CLI and extension
archives, installs the CLI privately, and unpacks the extension for Chrome's
manual **Load unpacked** flow. It does not change any Chrome profile.
Set the plugin’s `bskHome` configuration to its product-owned daemon directory. The runner passes it as `BSK_HOME` to each CLI child. That isolates daemon state,
while the WebSocket port is separate: choose an unused port if another daemon
owns the default 52800, and have the user connect the extension to that exact
port in its UI.

After a user connects the exact extension to the new product's daemon, run the
real localhost chain with an explicit, nondefault BrowserSkill home:

```sh
BSK_HOME=/path/to/new/product/bsk-home node integrations/browser-skill/smoke-localhost.mjs
```

If several browser instances are connected, set `BSK_BROWSER_ID` to the chosen
instance ID. The smoke script disables daemon autostart, serves only generated
content on `127.0.0.1`, and checks navigation, observation, form edit, exact
upload/download bytes, and cleanup of its own tracked request. Its receipt is
`dist/LOCALHOST_SMOKE.json`. A missing daemon or extension yields `BLOCKED_ENV`;
the script never reports a browser pass from a simulated connection.

Optional maintainer diagnostics in an already prepared local installation:

- `node scripts/test-browser-skill.mjs`: uses that installation's fixed CLI,
  independent BSK_HOME and port with localhost synthetic jobs.
- `node scripts/test-browser-files-edge.mjs --managed`: exercises the plugin's
  recoverable prepare/start/claim/cancel file protocol with the real extension.

These tools use the author's local current.json and write local diagnostic output.
They are not prerequisites for ordinary build, regression tests or installation.
A disconnected extension is a real unavailable browser environment, not a successful
page operation. CLI navigation, model-generated output and verified platform save
are distinct results.
