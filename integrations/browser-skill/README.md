# BrowserSkill for DSH

LA uses the official BrowserSkill CLI/MCP and Chrome Web Store extension. DSH's
`@deepseek-ai/dsh-mcp-client` provides the tool bridge and screenshot attachments;
Fishquito's `dsh-skill-mcp-panel` provides the management page. No DSH or
BrowserSkill source changes or dedicated BrowserSkill DSH plugin are needed.

`BASELINE.json` records the last checked official release, not an update pin.
CLI 0.5.0 and store extension 0.5.0 were checked on DSH 0.2.2-rc.3, macOS ARM64;
both use protocol 1.9. The CLI's official automatic updates remain enabled, and
Chrome manages extension updates. LA installation does not replace either one.

## Install and connect

1. Install the CLI using the [official installer](https://github.com/Tencent/BrowserSkill#1-install-the-cli).
   It downloads and verifies a published release. The default path is
   `~/.local/bin/bsk`; `BSK_INSTALL_DIR` selects another directory. This checkout's
   local installation uses `~/Library/Application Support/Linguist-Agent-DSH/runtime/browser-skill/bin/bsk`.
   Stop the existing daemon before replacing a source build with a release bearing
   the same version number; `bsk update` compares versions, not source commits.
2. Install or enable the [official Chrome Web Store extension](https://chromewebstore.google.com/detail/hhcmgoofomhgciiibhipgmgkgnoenaoi).
   Disable older unpacked extensions. Preserve the existing BrowserSkill data
   directory and daemon port (52800 in this installation). For local file uploads,
   enable **Allow access to file URLs** in the extension's Chrome details page;
   otherwise Chrome can reject file attachment with `-32000 Not allowed`.
3. In Fishquito's **Skill / MCP → MCP → Add server**, use STDIO, the absolute CLI
   path, argument `mcp`, and `BSK_HOME` pointing to the existing data directory.
   Do not set `BSK_AUTO_UPDATE=off`. The resulting official configuration is:

```yaml
- insert:
    - id: panel-mcp-browser-skill
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: browser-skill
        transport: stdio
        command: /absolute/path/to/bsk
        args: [mcp]
        env:
          BSK_HOME: /absolute/path/to/existing/browser-skill/home
```

Remove the previous `browser-skill` entry under `mcp-manager.config.servers`
before enabling this one; preserve other servers. Disable the old dedicated
BrowserSkill DSH plugin if still installed. Keep exactly one BrowserSkill MCP
registration. The official Desktop owns its profile; terminal scripts do not
rewrite it. Its patch file can also be edited through the native configuration
editor. Fishquito reads these independent client entries, not manager aggregates.

Click **Test connection** in Fishquito. Official 0.5.0 exposes seven MCP tools.
Start a new conversation to load the current tool list and instructions.

## Updates and instructions

A background daemon started by the official CLI checks for releases every
30 minutes and updates when no agent session is active. `bsk update --check`
checks manually; `bsk update --yes` installs an available release. A foreground
or supervisor-managed daemon needs restarting through its owner. Chrome updates
the store extension separately. Check `bsk status` and `bsk doctor` for version
and protocol compatibility after an update.

CLI 0.5.0's released `install-skill --list` does not yet include DSH, although
current upstream source does. For this release, copy the unmodified
`crates/bsk-cli/skill/` directory from the corresponding official release tag to
`~/.dsh/skills/browser-skill`, preserving any existing custom skill before replacing
it. This DSH skill copy does not gain automatic synchronization from CLI 0.5.0;
refresh it with future official releases until DSH becomes a supported target.
Do not build unreleased source merely to enable that target.

For CLI calls, use the same `BSK_HOME` and executable path as the MCP configuration.
`bsk mcp` is the official binary; no command proxy or output wrapper is required.
CAT and working copies do not require a browser connection.

## Bounded reads and continuous operations

Load the installed `browser-skill` instructions. `bsk_session open` combines
opening, navigation and observation. On a shared MCP server, pass a distinct
task `scope` and reuse it with the returned session on subsequent calls.
`bsk_plan` performs up to 20 already-decided
actions, followed by one observation. Inspect `completed`, `stopped` and `not_run`
before continuing; never replay successful or uncertain writes.

Use the **same `max_tokens`** in open/sync/plan and in interact with `sync_after`.
For ordinary navigation start with 2000, then increase or use a targeted read when
necessary. CLI uses `--max-tokens`. Omitting it requests an unbounded snapshot,
not the previous budget. Published CLI 0.5.0 does not yet include the later post-action snapshot budget
fix. Use targeted reads when a response is too large; wait for an official release
for that fix instead of replacing the binary with a source build.

Use `bsk_inspect action: read` (`bsk read`) for known selectors/refs and wanted
`read_fields`. Reuse current context and already-saved evidence instead of observing
the entire page after every action. Navigation budgets must not omit required source,
target, TM, TB or independent-review coverage. A clipped view is not a full reading.

Official `bsk_interact` provides upload/download. Resolve pending dialogs through
`bsk_assist operation_await` without repeating the transfer. `bsk_inspect screenshot`
returns an MCP image that DSH displays natively.

## Checks

```sh
BSK_HOME=/path/to/existing/bsk-home node integrations/browser-skill/smoke-localhost.mjs
node scripts/test-browser-skill.mjs
node scripts/test-browser-files-edge.mjs
node integrations/browser-skill/desktop-fixture.mjs /tmp/bsk-desktop-check
```

The first three checks use the installed CLI and connected extension, allowing
official updates instead of requiring a frozen executable hash. Fixtures contain
only synthetic text and files. The desktop fixture can be used for a same-model
comparison of tool-result size, browser calls, elapsed time and successful file
transfers. CLI checks do not establish model-task speed or DSH screenshot display.

## Earlier performance observation

The 2026-11-17 same-model comparison used an **unreleased official source build**
at `615d5e9a52c3d5a5d472744cec3dd6932eb696ac`, which contained the later snapshot
budget fix. Returned browser text fell from 78,770 to 42,589 characters and the
complete turn from 163.6 to 150.8 seconds in that one run. Those figures do not
measure the currently installed official 0.5.0 release and must not be presented
as its performance results.
