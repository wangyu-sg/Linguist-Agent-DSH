# 目标仓库工作规则

## 用户提供的项目规则

- 不默认认同用户判断；先检查前提、逻辑、缺失信息和未经证实判断，区分事实、推测、观点和未知。
- 不保留内部旧实现的向后兼容层；删除废弃路径。只写满足当前要求的最小实现，复用已有依赖，避免推测性抽象。
- 保持模块边界清楚；必须先形成端到端可用版本，再逐层增加能力。
- 不修改无关文件。成功条件须明确，并在验证通过前持续修复。
- 提交或推送前必须对待提交 diff 运行 `/ponytail-review`，仅当结果为 `Lean already. Ship.` 才能继续。
- 仅在系统边界校验；不为不可能场景增加防御式分支，不吞错误；一次性操作不建抽象。

## 本次迁移合同

# AGENTS.md — Linguist Agent DSH complete migration

本文件应合并到 `/Users/wangyu/Desktop/Linguist-Agent-DSH/AGENTS.md`。已有用户规则保留；本任务目标和授权以 `handoff/00-新会话启动指令.md` 与 `handoff/01-完整实施规范.md` 为准。

## Mission and local truth

Migrate the complete mature LA product into a native DSH Host+Client plugin. Deliver a working, installed, visually integrated local product, not an MVP, mock, read-only MCP, skill-only package, or an Electron/Proma process hidden behind DSH.

Source is read-only: `/Users/wangyu/Desktop/linguist-agent-next`.
Target: `/Users/wangyu/Desktop/Linguist-Agent-DSH`.
Include valid uncommitted/unpushed source changes. Do not reset/clean/install/build inside the source. Run baseline tests in an isolated source snapshot. Preserve an existing target; never clear it to simplify the task.

Read the full specification once. Thereafter use `docs/migration/STATE.json`, `NEXT.md`, actual git diff and relevant sections to resume. Do not require conversation memory. Update those records at meaningful boundaries, not after every tool action.

## Product boundaries

- DSH owns Agent loop, Sessions, Workspace, models, permissions, queue/steer, subagents, scheduling, attachments and native shell.
- LA owns its existing domain algorithms, stable IDs, formats, CAT Store, tools, editing, QA, terminology/context/Voice, professional decisions and evidence.
- BrowserSkill is the sole production browser-control chain. Extend missing file actions within its owned instance; do not bypass it with arbitrary CLI calls from prompts.
- LA Client uses native DSH Slots and theme. Reuse original pure editor logic. Do not clone DSH chat/composer/sidebar or implement a second window/runtime.
- Use DSH webServer HTTP/SSE for out-of-tree LA APIs. Do not patch the static api-remotes assembly or invent undocumented APIs.
- No Codex plugin, Ruflo, secondary orchestration, monitor platform or automatic model downgrade.

## Non-negotiable behavior

Preserve General, Translator, Reviewer and Proofreader. All retain DSH general tools and user-chosen permissions. Role changes default responsibility, not a tool prison.

Reviewer covers the full declared Source/current Target/required-context scope. A proposal is not a prerequisite. Unchanged is a real decision; omitted segments are not reviewed. Preserve original files, tags, line breaks, locks, stable IDs, CAS, required/forbidden terminology, QA/history references and current-revision actor provenance.

Preserve all three paths: CAT, non-CAT working copies, and direct browser work. Do not force Phrase into CAT. Do not equate downloaded/exported bytes, tool completion or external confirmed state with local professional completion.

Final request evidence must use real model-visible content and observed request/response identity. Mock responses, PTC-hidden raw text, file paths, hashes and UI displays do not prove model review. Do not turn evidence callbacks into no-ops.

## Execution and authorization

Implement all W00–W12 packages and all locally inventoried features. Work packages are construction order, not phased product scope. Fix type/build/test/UI/package errors and continue without repeatedly asking the user. Do not stop after the first working vertical slice.

Allowed: target code, necessary pinned dependencies, bounded compatibility patches, isolated synthetic tests, limited real-model smoke using configured routes, side-by-side install of the matching official DSH Desktop artifact and native plugins, isolated desktop entry, own-service start/stop, local git commits and final local notification. The official Desktop owns its reserved `desktop` profile; CLI may not mutate it. Web profile checks are development evidence only.

Forbidden: source mutations, old app/profile replacement, real OSgame/customer database writes, real Phrase operations, user-data deletion, Cookie/key extraction, auth bypass, remote push/release/publication, unrelated global upgrades and system security changes.

Use no customer content in fixtures, logs or model tests. Never dump environment variables, credentials or browser profiles. Do not silently change model/provider/effort to pass a test.

## Implementation discipline

Keep one domain implementation. Isolate Host/Client types and shared runtime instances. Port schema semantics exactly; never use any-shaped input to sidestep conversion. Package workers/resources/roles/locales and test the real tarball in an installed DSH profile.

Treat dependency source, npm artifact, CLI, daemon and browser extension as separate identities. Pin and verify them. Use local project tooling, not global version replacement. No moving latest during implementation.

Native tool results have domain, model-content and UI-presentation responsibilities. Reduce repeated management output, not required review content. Do not add an automatic model read-back after every action or universally delegate independent verification.

## Continuation and completion

`FEATURE_MAP.json` is the complete migration inventory, seeded but not limited by the handoff's 32-tool public reference. UI-only features count. No required functionality may end as TODO, placeholder, permanently disabled button or fake success.

Use `STATE.json`/`NEXT.md` to survive context compaction. Parallel workers receive concrete paths, scope, inputs and contracts; one owner edits shared contracts/lockfiles. Parent owns integration and final delivery.

Ready requires real install, desktop launch/reopen, genuine Provider smoke, real BrowserSkill extension chain against localhost fixtures, complete UI/functional coverage and preserved constraints. `verify:ready` creates the receipt from evidence. `notify:result` reads it; it cannot force success.

Missing credentials/extension/system approval is `BLOCKED_ENV`, not READY. Finish unaffected work, document the exact external prerequisite, and never forge a pass. Infrastructure interruption is not completion. Do not spin up hidden self-restarting model chains.

Report progress and final status in Chinese. Keep code comments appropriate to source/DSH conventions. On genuine READY provide the actual launcher path and concise results; otherwise report the precise blocked/failed gates and resumable state.
