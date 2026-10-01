# BrowserSkill for LA-DSH

This directory adapts the pinned upstream DSH plugin in `BASELINE.json`. It adds
`browser_files` to the same BrowserSkill Host/Client plugin instance and keeps its
owned sessions, runner, queue, cancellation, observation, and UI. There is no
second browser-control path.

The supported host baseline is DSH 0.2.0-rc.2 on macOS ARM64. Use the local
0.3.1-la-dsh.5 plugin tarball, bsk 0.3.1 CLI, and extension 0.3.1. The extension
must show a connection to the configured daemon port before browser actions work.
Install the tarball through the official DSH plugin manager.

The following are maintainer helpers for a prepared, pinned upstream checkout
and local tooling described in BASELINE.json; they are not normal LA installation
prerequisites. From this repository root:

```sh
node integrations/browser-skill/build-adapted-plugin.mjs
node integrations/browser-skill/install-cli.mjs
```

The build verifies upstream source, patch, adapted dependency lock, package version and tarball SHA, runs
the upstream plugin suite plus the file-action tests, and writes `dist/BUILD.json`.
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
content on `127.0.0.1`, and checks navigation, observation, form edit, file
attachment, exact download bytes, and cleanup of its own session. Its receipt is
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
