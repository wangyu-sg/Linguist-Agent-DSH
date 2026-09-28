# Renderer、共享契约和 preload 接续审计（合成数据）

源文件只从只读 `.migration/source-snapshot` 核对。目标测试执行当前 `packages/dsh-linguist/src/client` 的真实纯逻辑和 HTTP/SSE 边界：

```sh
node --experimental-transform-types --import ./packages/linguist-cat-store/test/register-ts-loader.mjs --test tests/copied-renderer/*.nodetest.ts
```

本次该命令实测 7/7 通过；`../../artifacts/evidence/copied-renderer-last-run.tap` 是此前一次运行的原始 TAP，不代表本次新增用例。Node 测试不渲染 DSH Desktop、不操纵原生 Slot，也不证明安装包中的 UI 行为。

## 五个源 Renderer 测试

| 源测试 | 目标公开接缝与本次测试 | 建议状态 / 真实剩余缺口 |
|---|---|---|
| `cat-editor.browser.test.ts`（BrowserWindow 中草稿、撤销、虚拟滚动、延迟保存、冲突、IME、项目导航、提案、QA、后台终端） | `cat-editor-logic.nodetest.ts` 驱动目标 `cat-edit-utils.ts` 和 `cat-virtual-utils.ts`，检查保存/确认门槛、IME 快捷键、分页与稳定 row key；目标组件在 `TargetEditor.tsx`、`CatWorkbench.tsx`、`Panels.tsx`。 | **partial**。原文件通过独立 Electron BrowserWindow + Proma/Jotai atoms 运行；目标没有该窗口和原 tab/terminal atoms。本次只验证纯逻辑；草稿跨卸载、迟到保存、真实 DOM、标签保护、提案/QA 切换、背景终端等仍须对已安装 DSH Desktop 执行 V19/V20 CUA 操作并存原始证据。 |
| `open-linguist-session.test.ts`（跨 Agent/Chat MRU、activate/restore 预览、右栏尺寸与收起、过期导航、脏表单） | DSH `UiWorkspace.openSession` 和 `ISidebarRight.openResourceIn/openTabIn`；目标 `client/index.ts` 的 `openBoundSession` 等待 `sidebarRight.mounted` 后打开 CAT/工作副本/BrowserSkill。`workbench-location.nodetest.ts` 验证 CAT 项目内布局位置隔离。 | **host-replaced / partial**。DSH 不公开 Proma `tabsAtom/tabMruAtom`、`agentDiffPanelTabAtom` 或渠道表单原子；不能移植旧 MRU/预览/脏表单断言。目标工作台位置已测；原生 Session、右栏 tab/尺寸、导航竞争须安装态 UI 验证。 |
| `project-agent-session.test.ts`（沿当前项目创建并激活会话，缺项目拒绝） | 目标 `client/index.ts` 的 `enter` 调用 DSH `ctx.sessions.create({workspaceId})`、`bindSession`、`openBoundSession`；`client-api.nodetest.ts` 验证绑定请求与返回 session/workspace/project/role/workMode 身份。 | **host-replaced / partial**。旧 `createActiveLinguistProjectSession` 及 Proma app mode 已删除；没有可独立调用的目标 `enter` 导出。本次测 HTTP 绑定身份，不证明 DSH Session 创建或缺活跃项目时 UI 无创建；需安装态点项目入口验证。 |
| `project-tab-navigation.test.ts`（普通 Chat/Agent 切换或关闭取消过期项目打开；预览与解绑恢复普通模式） | DSH `UiWorkspace.openSession` 公开导航；其 `openWorkspace` 文档写明后发导航可 supersede 前发请求。目标绑定解除由 `/la/v1/invoke` 和 Session Badge 处理，CAT tab 由 DSH sidebar-right 管理。 | **host-replaced / partial**。旧 `syncActiveTabSideEffects`、Preview tab 和 `appModeAtom` 不存在；目标 `openBoundSession` 本身无可公开测试的导航代际函数。DSH `openWorkspace` 的 supersession 不能直接推定 `openSession` + `openBoundSession` 全链无抢焦点；需安装态竞争操作与解除绑定观察。 |
| `linguist-sidebar-data.test.ts`（按项目分组，隔离普通/置顶/自动会话，保留归档与缺失项目历史） | DSH 原生 `sidebar.workspaces` 仍管理 Workspace/Session；目标 `ProjectSessions.tsx` 在 Linguist 主面板中按已保存的绑定分组，并显示归档/缺失项目历史与打开入口。 | **partial**。项目分组作为原生主面板内容存在，未取代 DSH 侧栏；旧侧栏同位置分组、置顶/自动会话规则没有等价投影。安装态需实际查看归档/缺失项目会话、普通 Session 隔离和原生侧栏行为。 |

## 三个共享类型文件

| 源类型文件 | 目标公开契约 | 建议状态 / 差异 |
|---|---|---|
| `packages/shared/src/types/automation.ts` | 目标 `client-contracts.ts` 的 `LinguistScheduleTiming/Create/Info/Update/History` 和 Host `automation-context.ts`；执行由 DSH 原生 Schedule 管理。 | **host-replaced / partial**。冻结 project/role/asset/segments 范围已迁；旧 `Automation` 的 `sessionMode`、`bypassPermissions`、Feishu notification、interval 活跃窗口、maxRuns、monthly 等字段没有同名 LA 契约。目标 UI 提供 `after/every/at/daily/weekly/cron`；是否由 DSH 满足旧具体行为须按原生调度实际运行验收，不可只比较名称。 |
| `packages/shared/src/types/linguist-turn-context.ts` | 目标 `client-contracts.ts:LinguistTurnContextV1`、`host/automation-context.ts:validateLinguistTurnContext`、`host/turn-context.ts:TurnContextReceipts/addPreparedTurnContext`，Client 在 `CatWorkbench.tsx` 构造 V1 并经 `linguistTurnContextPrepare` 绑定 DSH requestId。 | **partial**。V1 字段、100 段截断事实与 project/asset/segment 所有权在 Host 校验，已有 required 测试；源独立 `parse/create/serialize` API 的深冻结和固定字节序列化没有直接公开对应。Client 当前 >100 段拒绝发送，Host 可接收带截断标记的外部输入。真实最终 Provider 请求仍需请求级证据。 |
| `packages/shared/src/types/linguist.ts` | 目标 `packages/linguist-domain-service/src/client-contracts.ts` 提供主要响应 DTO、`LinguistIpcResult` 与错误码；ID/输入限制在 Host 边界和 CAT domain 校验；Client 经 `api.ts` 调 `/la/v1/invoke`。 | **partial / host-replaced**。旧 329 个导出名中 123 个与当前 Client DTO 同名（仅名称对照，不证明字段等价）；IPC channel 常量、许多 Electron request 类型和旧 Session 形状不作为 DSH Client 公共 API。应以 Host operation/schema、包类型检查及安装态调用证明行为，不应复制 2760 行旧类型形成第二套契约。 |

## Electron preload

`apps/electron/src/preload/linguist-api.ts` 的 `window.electronAPI`/`ipcRenderer` 被目标 `client/api.ts` 的同源 `/la/v1/session-bind`、`/la/v1/invoke`、`/la/v1/files/*`、`/la/v1/events` 和 Host `http.ts` 替代。`client-api.nodetest.ts` 实际验证身份回执、typed operation 信封、领域错误、受管 File token、项目 SSE 身份与 unsubscribe。**建议 host-replaced / partial**；这只是目标源码 HTTP 边界，不是 90 个旧方法逐一安装态调用。

逐名核查旧 90 个 preload 方法，除三个事件订阅外，8 个没有同名目标 Host operation：`linguistSessionsCreateForProject`→DSH `sessions.create` + `/session-bind`；`linguistSessionsUpdateRole`→新 DSH Session；`linguistSessionsGetBinding`→GET `/session-bind`；`linguistSessionsGetCopyEligibility`→`linguistSessionsCopyEligibility`；`linguistApplyTranslations`→`linguistProposalsApplyTranslations`；`linguistMigrationPickAndScan/Import`→`linguistLegacyMigrationScan/Import`。`linguistSessionsListForProject` 由 Client `ProjectSessions.tsx` 读取 DSH Session 列表和逐会话绑定，在 Linguist 主面板分组；旧侧栏位置/置顶语义仍不同。三个事件中 project mutation 使用 SSE，integrity 使用同一路径的 `integrity` 事件；旧迁移进度已通过按 `workspaceId + scanId` 绑定的 `migration-ready`/`migration-progress` SSE 接入 `LegacyMigrationPanel.tsx`，最终结果仍以逐项目 `/invoke` 报告为准。上述改动仍须在已安装 Desktop 中验证。

## 五个 Composer / Workspace / 项目导航源文件

| 源文件 | 固定 DSH 0.1.7-rc.2 公开接缝和目标实现 | 实际缺口与验收 |
|---|---|---|
| `ComposerContextChips.tsx` | `dsh-client-ui-conversation` 的 `conversation.input.dock` 是原生 Composer 卡片上方的 list Slot。目标 `ComposerContextChips.tsx` 在该 Slot 显示当前 CAT 工作台项目、批次、显式引用和选区；清除动作回写工作台。`composer-context.nodetest.ts` 验证 Session 隔离和卸载清除。 | **partial**。这组 chips 如实标为工作台视图；普通 Composer 提交没有自动附带 V1 选区快照。固定 RC 的 `InputTriggerSource.matchEnter` 仅参与以 `/` 或 `@` 开头的草稿，`conversation.composer` 是替换链，没有透明提交前钩子。须安装态验证 Slot、清除动作和 Session 切换；不能把 chips 显示当作本轮模型上下文证据。 |
| `LinguistWorkspaceBadge.tsx` | 目标在 `conversation.session.header.utilities` 显示绑定项目/岗位 Badge，Linguist 主面板也显示项目与 Workspace 关联。RC `dsh-client-ui-workspace` 公开 `sidebar.session.row.leading/hover` 和 Session 行 menu/action Slot。 | **pending exact Workspace-row placement**。这些装饰 Slot 仅收到 `sessionId`，Workspace 分组行没有公开徽章 Slot；`sidebar.workspaces` 是整块原生浏览区，覆盖它会接管宿主侧栏。若要求源 Workspace 行内标记，固定 RC 缺公开接缝；当前 Session header 标记需安装态查看。 |
| `ProjectAgentCapabilitiesSection.tsx` | 当前 CAT 项目设置可用 `ctx.sidebarRight.openTabIn(sessionId, 'files')` 打开 DSH 原生 Files；这是公开 right-sidebar API 和官方 Files kind。 | **partial / public navigation gap**。源区还显示 Skills、MCP、AGENTS.md、Memory 的 Workspace 状态与直达入口。固定 RC 的 Settings `openSection` 只作为 onboarding Slot owner prop 提供，普通项目页面没有可调用的 Settings 导航服务；现有 Workspace Controller 也不提供源式 `WorkspaceCapabilities` 摘要。不能伪造启用计数或跳转。Files 按钮须安装态实际打开。 |
| `project-composer-context.ts` | CAT 工作台将当前项目、批次、显式引用和选区推送至按 DSH `sessionId` 隔离的 `composer-context.ts`，原生 `conversation.input.dock` 读取并显示。专用“让 Agent 处理所选”另经 `beginSubmission` → `linguistTurnContextPrepare` → 原生 `prompt` 绑定真实 requestId。 | **partial**。可见视图与专用任务范围为真；普通 Composer 的每轮提交没有上述 receipt，不应推断当前 UI 选区自动随普通输入送入模型。需要安装态验证 chips 与专用发送，并用 Provider 请求级证据验证模型所见 V1。 |
| `project-tab-navigation.test.ts` | DSH `UiWorkspace.openSession` 管原生 Session 选择；目标 `openBoundSession` 等待 `sidebarRight.mounted` 等于目标 Session 才打开 CAT/工作副本/浏览器 tab；解绑用 Host `/invoke` 后撤销本地 CAT 绑定展示。RC `layout.beginNavigation` 仅为其异步 Workspace 导航提供取消信号。 | **host-replaced / pending installed race test**。Proma 的 `tabsAtom`、Preview tab、`appModeAtom` 没有 DSH 对等物。固定 RC 的 `openSession` 返回 `void`，不公开旧 tab 代际；不能用 `openWorkspace` 的 supersession 推断 LA 全链。须在已安装 Desktop 快速切换/关闭普通与项目 Session、解绑后重开，观察旧异步打开是否抢焦点和右栏是否串 Session。 |

无论上述建议状态如何，只有已安装官方 Desktop 的 CUA 原始 trace/截图、实际插件身份和 UI 操作才能完成正式视觉与交互验收。
