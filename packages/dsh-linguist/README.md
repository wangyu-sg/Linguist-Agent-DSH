# Linguist Agent

Organize game localization projects in DeepSeek Harness and carry out translation, bilingual review and proofreading. DSH manages sessions, models, permissions and general tools; Linguist Agent provides project resources, CAT editing, working copies and localization workflows.

## Capabilities

- **CAT workspace:** edit source and target side by side with complete inline tag code, invisible characters, terminology hints, number and variable checks, and change comparisons.
- **Reference resources:** manage terminology, translation memory, style rules and context. Inspect TM/TB matches beside a segment and compare both TM source and target with the current text.
- **Review and QA:** independent review covers the full source and current target, checking continuous meaning as well as requirements, terminology and related entries. Working copies prepare grouped TM/TB, original row fields and rules in the background. Prepared materials do not prove review completion. Locks, stable IDs, revision checks and actual execution records remain in place.
- **Three work modes:** delegate translation, review or proofreading in CAT, working copy or browser mode. Discuss localization directly without importing a project; file tasks can supply their own TM/TB.
- **Visual context:** embedded XLSX/PPTX images and their locations can accompany review materials and are cached in the workspace. Reviewers must still inspect images; view the original slides for text and layout.

## Getting started

1. Open **Linguist** in the sidebar. Use **Add workspace → LA workspace · localization project** to create a workspace and project, or create or open a project in an existing DSH workspace.
2. Select the language pair, then import the material and required references. Check worksheet and column mappings for spreadsheets; select matching Phrase split/master inputs in the same batch.
3. On the Linguist home page, choose a workspace, role and work mode, then click **New LA session** on the project card. The new session is linked to that project and workspace. **Project sessions** follows the workspace filter; use **Open session** to continue an existing task. Describe the scope, style requirements and deliverable in the session.
4. In CAT, check the source, current target, necessary context and QA before saving, confirming or exporting. Generating a proposal, applying changes, completing review, exporting a file and submitting to a customer platform are separate operations.

## Data and saving

Saved projects, terminology, translation memory and revisions are stored in the configured data directory. Plugin updates retain the existing directory, installation identity and configuration. Manage and back up original material, project data and exported deliverables separately.

**Save unsaved editor content before reloading, updating or exiting.** Local storage does not mean entirely offline operation: model and browser tasks use the connected services, host permissions and project requirements.

Read snapshots and fragment progress are saved with their original session and survive hot updates or restarts. Writes still check source and target versions. When upgrading from 1.3.4 or earlier, save and pause current work, then restart DSH once so existing sessions stop using the previous extra tool-result pruning component. The original sessions are retained. Upgrades from 1.3.5 can be hot-applied directly.

## Compatibility and limits

- The current host baseline is **DSH 0.2.2-rc.3**. Development and checks use macOS Apple Silicon. Confirm this build’s native installation and loading in DSH; other systems and host versions have not been verified.
- The per-file receiving limit is **512 MiB**. This limit does not guarantee parsing performance for every format or large file; follow the actual import requirements and checks.
- Browser tasks require a working connection between the matching **BrowserSkill plugin, bsk CLI/daemon and Chrome extension**. CAT and working copies do not require a browser connection.
- Shared semantic groups for CAT, online review materials and working copies require a local MemSearch Python ONNX environment and cached `gpahal/bge-m3-onnx-int8` weights. Related sources, current draft targets and context are grouped for independent review; similarity does not generate QA errors. Embeddings and relations are cached per project locally, without writing to conversation memory, downloading models or using cloud inference. Unavailable retrieval is reported explicitly. Target edits reuse embeddings; only new or changed sources are embedded again.
- QA and file checks are not in-game LQA. Exporting does not submit to a customer platform or replace a human decision about scope and delivery.

## Maintenance and license

Install, update and enable the plugin through the official DSH plugin manager, following the actual application result and any reload instructions. This detail page explains capabilities and use; project operations remain in the Linguist workspace.

License: **AGPL-3.0-only**. The DSH plugin manager reports the installed version.

Global display and retrieval preferences, the local model check and semantic cache controls are in **DSH Settings → Linguist**. Language, QA, tag and delivery rules remain project-specific. Online review uses a bilingual export or platform snapshot without switching work modes; platform TM/TB and Comments still require verification. No per-segment queries or per-group acknowledgements are added.
