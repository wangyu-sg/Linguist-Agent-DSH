# Linguist Agent

Organize game localization projects in DeepSeek Harness and carry out translation, bilingual review and proofreading. DSH manages sessions, models, permissions and general tools; Linguist Agent provides project resources, CAT editing, working copies and localization workflows.

## Capabilities

- **CAT workspace:** edit source and target side by side with complete inline tag code, invisible characters, terminology hints, number and variable checks, and change comparisons.
- **Reference resources:** manage terminology, translation memory, style rules and context. Inspect TM/TB matches beside a segment and compare both TM source and target with the current text.
- **Review and QA:** inspect proposals and findings before applying checked changes. Preserve locks, stable segment IDs, revision-conflict checks and actual execution records.
- **Three work modes:** CAT, working copy and browser. Choose the general, translator, reviewer or proofreader role for the task.

## Getting started

1. Open **Linguist** in the sidebar. Use **Add workspace → LA workspace · localization project** to create a workspace and project, or create or open a project in an existing DSH workspace.
2. Select the language pair, then import the material and required references. Check worksheet and column mappings for spreadsheets; select matching Phrase split/master inputs in the same batch.
3. Start a session in **Linguist** mode, choose the role, project and work mode, and describe the scope, style requirements and deliverable.
4. In CAT, check the source, current target, necessary context and QA before saving, confirming or exporting. Generating a proposal, applying changes, completing review, exporting a file and submitting to a customer platform are separate operations.

## Data and saving

Saved projects, terminology, translation memory and revisions are stored in the configured data directory. Plugin updates retain the existing directory, installation identity and configuration. Manage and back up original material, project data and exported deliverables separately.

**Save unsaved editor content before reloading, updating or exiting.** Local storage does not mean entirely offline operation: model and browser tasks use the connected services, host permissions and project requirements.

Read snapshots and fragment progress issued by this version are saved with their original session and survive hot updates or restarts. Writes still check source and target versions. After upgrading to this version, save and pause current work, then restart DSH once so existing sessions stop using the previous extra tool-result pruning component. The original sessions are retained.

## Compatibility and limits

- The current host baseline is **DSH 0.2.2-rc.1**. Native installation and loading have been checked on macOS Apple Silicon; other systems and host versions have not been verified.
- The per-file receiving limit is **512 MiB**. This limit does not guarantee parsing performance for every format or large file; follow the actual import requirements and checks.
- Browser tasks require a working connection between the matching **BrowserSkill plugin, bsk CLI/daemon and Chrome extension**. CAT and working copies do not require a browser connection.
- QA and file checks are not in-game LQA. Exporting does not submit to a customer platform or replace a human decision about scope and delivery.

## Maintenance and license

Install, update and enable the plugin through the official DSH plugin manager, following the actual application result and any reload instructions. This detail page explains capabilities and use; project operations remain in the Linguist workspace.

License: **AGPL-3.0-only**. The DSH plugin manager reports the installed version.
