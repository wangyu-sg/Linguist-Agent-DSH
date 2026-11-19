# Linguist Agent

Organize game localization projects in DeepSeek Harness and carry out translation, bilingual review and proofreading. DSH manages sessions, models, permissions and general tools; Linguist Agent provides project resources, CAT editing, working copies and localization workflows.

## Capabilities

- **Task groups** keep batches and their references together. Click **Task group** on a project card to create a group, import work or start a group session. Importing the same original into two groups creates independent editable batches. Moving an existing batch preserves its edits and history.
- **Excel handoff:** Each completed translation, review or proofreading stage includes its filled workbook in the workspace's `LA交付/` folder. A review with no changes still records the scope.
- **Project resources** include shared files and group-specific files. An explicit replacement overrides a shared file for one group. Backups preserve these references and the uploaded files. Keep separately registered workspace originals at their registered paths. Open the library from a project card to view, add, replace or remove files and edit purpose and scope. Read status and errors remain visible. The GUI and Agent share the same library; failed replacements keep the previous version active. No CAT session is needed.

- **CAT workspace:** edit source and target side by side with complete runtime inline tag code, invisible characters, terminology hints, number and variable checks, and change comparisons. Phrase MXLIFF supports native bold, italic and underline, including flat compound styles. Rich text is the default; switch to format-code view to inspect the raw markers. Select target text and use B/I/U or Cmd/Ctrl+B, I or U to apply or remove a style. These actions change only the draft; undo and redo restore both raw text and selection. In-field rich-text copying carries balanced native format codes; code view copies the exact selected raw characters. Unknown or unbalanced codes remain literal with a warning. Superscript and subscript are currently unavailable.
- **Reference resources:** share project TM/TB, rules, examples, queries and feedback across normal questions and all three work modes. Wording queries use keyword and TM/TB matching. Meaning-based lookups use the local encoder, which saves completed vectors in batches. Formal review materials include the relevant records and source locations. Sparse fields work without inventing approval status; only changed originals are reprocessed. TM/TB retain their native matching.
- **Review and QA:** independent review covers the full source and current target, checking continuous meaning as well as requirements, terminology and related entries. Working copies prepare grouped TM/TB, original row fields and rules in the background. Prepared materials do not prove review completion. Locks, stable IDs, revision checks and actual execution records remain in place.
- **Three work modes:** delegate translation, review or proofreading in CAT, working copy or browser mode. Discuss localization directly without importing a project; file tasks can supply their own TM/TB.
- **Visual context:** embedded XLSX/PPTX images and their locations can accompany review materials and are cached in the workspace. Reviewers must still inspect images; view the original slides for text and layout.

## Getting started

1. Open **Linguist** in the sidebar. Use **Add workspace → LA workspace · localization project** to create a workspace and project, or create or open a project in an existing DSH workspace.
2. Describe the task and supply its assets. For formal work, LA checks the file and suggests a working mode. If no choice has been made, it asks once; you can ask LA to decide. It reuses your choice and keeps the existing mode for continuing work. Choosing CAT prepares managed copies and references, then checks segment mapping, tags and locks. Check spreadsheet mappings and supply matching Phrase masters with split files. Manual import remains available.
3. On the Linguist home page, choose a workspace, role and work mode, then click **New LA session** on the project card. The new session is linked to that project and workspace. **Project sessions** follows the workspace filter; use **Open session** to continue an existing task. Describe the scope, style requirements and deliverable in the session.
4. In CAT, check the source, current target, necessary context and QA before saving, confirming or exporting. Generating a proposal, applying changes, completing review, exporting a file and submitting to a customer platform are separate operations.

## Data and saving

Saved projects, terminology, translation memory and revisions are stored in the configured data directory. Plugin updates retain the existing directory, installation identity and configuration. Manage and back up original material, project data and exported deliverables separately.

**Save unsaved editor content before reloading, updating or exiting.** Local storage does not mean entirely offline operation: model and browser tasks use the connected services, host permissions and project requirements.

Read snapshots and fragment progress are saved with their original session and survive hot updates or restarts. Writes still check source and target versions. When upgrading from 1.3.4 or earlier, save and pause current work, then restart DSH once so existing sessions stop using the previous extra tool-result pruning component. The original sessions are retained. Upgrades from 1.3.5 can be hot-applied directly.

## Compatibility and limits

- The current host baseline is **DSH 0.2.2-rc.5**. Development and checks use macOS Apple Silicon. Confirm this build’s native installation and loading in DSH; other systems and host versions have not been verified.
- The per-file receiving limit is **1 GiB**. This limit does not guarantee parsing performance for every format or large file; follow the actual import requirements and checks.
- Browser tasks require a working connection between the matching **official BrowserSkill CLI/MCP, daemon and matching Chrome extension**. CAT and working copies do not require a browser connection.
- Shared semantic groups for CAT, online review materials and working copies require a local MemSearch Python ONNX environment and cached `gpahal/bge-m3-onnx-int8` weights. Related sources, current draft targets and context are grouped for independent review; similarity does not generate QA errors. Embeddings and relations are cached per project locally, without writing to conversation memory, downloading models or using cloud inference. Unavailable retrieval is reported explicitly. Target edits reuse embeddings; only new or changed sources are embedded again.
- File locks are retained. If a platform export omits locks, supply a complete platform snapshot matched by stable key and current source/target, not display row numbers. Locked segments remain read-only.
- QA and file checks are not in-game LQA. Exporting does not submit to a customer platform or replace a human decision about scope and delivery.

## Maintenance and license

Install, update and enable the plugin through the official DSH plugin manager, following the actual application result and any reload instructions. This detail page explains capabilities and use; project operations remain in the Linguist workspace.

License: **AGPL-3.0-only**. The DSH plugin manager reports the installed version.

Global display and retrieval preferences, the local model check and semantic cache controls are in **DSH Settings → Linguist**. Language, QA, tag and delivery rules remain project-specific. Online review uses a bilingual export or platform snapshot without switching work modes; platform TM/TB and Comments still require verification. No per-segment queries or per-group acknowledgements are added.
