# Renderer pending static audit — 2026-09-29

范围：FEATURE_MAP.sourceInventory.files 中 `pending`、`apps/electron/src/renderer/`、非测试的 77 个文件。`complete` 仅指目标静态功能映射，**不是验收完成**；全部仍需已安装官方 DSH Desktop 交互证据。

| # | Source file | 建议 | Target | 理由 / 仍需验证 |
|---:|---|---|---|---|
| 1 | apps/electron/src/renderer/components/automation/AutomationFormView.tsx | still-pending | packages/dsh-linguist/src/client/RunPanel.tsx + host/schedule | 已接专用创建；原生 Schedule 列表/编辑/取消/运行历史及到期执行尚需核验，源独立任务配置未逐项等价。 |
| 2 | apps/electron/src/renderer/features/linguist/composer/ComposerContextChips.tsx | still-pending | packages/dsh-linguist/src/client/CatWorkbench.tsx + client/index.ts | 工作台显式 Agent 快捷任务附 V1 快照；普通 DSH Composer 没有公开提交前快照接缝，Composer 内 chips 未实现。 |
| 3 | apps/electron/src/renderer/features/linguist/migration/MigrationWizard.tsx | complete | packages/dsh-linguist/src/client/LegacyMigrationPanel.tsx + client/ProjectsPage.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 4 | apps/electron/src/renderer/features/linguist/migration/migration-wizard-utils.ts | complete | packages/dsh-linguist/src/client/LegacyMigrationPanel.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 5 | apps/electron/src/renderer/features/linguist/projects/ApprovedExemplarDialog.tsx | complete | packages/dsh-linguist/src/client/CatWorkbench.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 6 | apps/electron/src/renderer/features/linguist/projects/AssetNavigator.tsx | complete | packages/dsh-linguist/src/client/CatWorkbench.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 7 | apps/electron/src/renderer/features/linguist/projects/CatToolResultNavigationInitializer.tsx | complete | packages/dsh-linguist/src/client/CatToolResult.tsx + client/cat-navigation.ts + client/index.ts | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 8 | apps/electron/src/renderer/features/linguist/projects/ContextDocsPanel.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 9 | apps/electron/src/renderer/features/linguist/projects/ContextEvidencePanel.tsx | complete | packages/dsh-linguist/src/client/CatWorkbench.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 10 | apps/electron/src/renderer/features/linguist/projects/DeliverablesSection.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 11 | apps/electron/src/renderer/features/linguist/projects/FormatQualificationCard.tsx | complete | packages/dsh-linguist/src/client/ProjectsPage.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 12 | apps/electron/src/renderer/features/linguist/projects/LinguistBottomDock.tsx | complete | packages/dsh-linguist/src/client/CatWorkbench.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 13 | apps/electron/src/renderer/features/linguist/projects/LinguistPreviewBody.tsx | complete | packages/dsh-linguist/src/client/BatchPreview.tsx + PreviewView.tsx | 批次双语分页、局部标签/占位符告警和原始文件切换已在右侧原生 resource tab 接线；仍需安装态操作。 |
| 14 | apps/electron/src/renderer/features/linguist/projects/LinguistWorkbenchShell.tsx | complete | packages/dsh-linguist/src/client/CatWorkbench.tsx + workbench-location.ts | 右侧原生 Tab、可调布局和项目内位置持久化已接线；仍需安装态操作。 |
| 15 | apps/electron/src/renderer/features/linguist/projects/LinguistWorkspaceBadge.tsx | still-pending | packages/dsh-linguist/src/client/index.ts | 主 Linguist 入口和 Session badge 已有；未证实 DSH 公开 Workspace 行徽章 Slot，不能注入行内标记。 |
| 16 | apps/electron/src/renderer/features/linguist/projects/LinkedContextImages.tsx | complete | packages/dsh-linguist/src/client/CatWorkbench.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 17 | apps/electron/src/renderer/features/linguist/projects/LocalizationProjectWorkbench.tsx | complete | packages/dsh-linguist/src/client/CatWorkbench.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 18 | apps/electron/src/renderer/features/linguist/projects/PrepareDeliveryPanel.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 19 | apps/electron/src/renderer/features/linguist/projects/ProjectAgentCapabilitiesSection.tsx | still-pending | packages/dsh-linguist/src/client/ProjectsPage.tsx + DSH native Skills/MCP/Memory/Files | DSH 原生能力存在；项目设置内状态摘要和直达 Skills/MCP/AGENTS.md/Memory 的公开 Client 导航接缝未证实。 |
| 20 | apps/electron/src/renderer/features/linguist/projects/ProjectArchiveAction.tsx | complete | packages/dsh-linguist/src/client/ProjectsPage.tsx + client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 21 | apps/electron/src/renderer/features/linguist/projects/ProjectAssetsSection.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 22 | apps/electron/src/renderer/features/linguist/projects/ProjectBackupsSection.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx + client/ProjectsPage.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 23 | apps/electron/src/renderer/features/linguist/projects/ProjectCard.tsx | complete | packages/dsh-linguist/src/client/ProjectsPage.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 24 | apps/electron/src/renderer/features/linguist/projects/ProjectCreateDialog.tsx | complete | packages/dsh-linguist/src/client/ProjectsPage.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 25 | apps/electron/src/renderer/features/linguist/projects/ProjectDiagnosticsSettings.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 26 | apps/electron/src/renderer/features/linguist/projects/ProjectLocaleSelect.tsx | complete | packages/dsh-linguist/src/client/ProjectsPage.tsx + client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 27 | apps/electron/src/renderer/features/linguist/projects/ProjectMaintenanceSettings.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 28 | apps/electron/src/renderer/features/linguist/projects/ProjectRunSummary.tsx | complete | packages/dsh-linguist/src/client/RunPanel.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 29 | apps/electron/src/renderer/features/linguist/projects/ProjectSettingsSheet.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 30 | apps/electron/src/renderer/features/linguist/projects/ProjectWorkflowSettings.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 31 | apps/electron/src/renderer/features/linguist/projects/ProjectsView.tsx | complete | packages/dsh-linguist/src/client/ProjectsPage.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 32 | apps/electron/src/renderer/features/linguist/projects/ProposalInbox.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx | 待审/历史/单项和批量处理、直接应用均接线；运行分组等呈现差异另见 proposal-inbox-utils。 |
| 33 | apps/electron/src/renderer/features/linguist/projects/QaFindingsPanel.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 34 | apps/electron/src/renderer/features/linguist/projects/ReferenceManager.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 35 | apps/electron/src/renderer/features/linguist/projects/SegmentEditor.tsx | complete | packages/dsh-linguist/src/client/CatWorkbench.tsx + TargetEditor.tsx | 编辑/CAS/阶段确认、下一个待处理及 QA 快捷导航、行内建议操作已接线；仍需安装态操作。 |
| 36 | apps/electron/src/renderer/features/linguist/projects/SegmentGrid.tsx | complete | packages/dsh-linguist/src/client/CatWorkbench.tsx | 虚拟化/选择/行编辑、QA/Proposal 投影与审查快捷操作已接线；仍需安装态操作。 |
| 37 | apps/electron/src/renderer/features/linguist/projects/SentencePatternsPanel.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 38 | apps/electron/src/renderer/features/linguist/projects/StyleGuidePanel.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 39 | apps/electron/src/renderer/features/linguist/projects/TagProfilesPanel.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx + client/UnknownTagNotice.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 40 | apps/electron/src/renderer/features/linguist/projects/TargetEditor.tsx | complete | packages/dsh-linguist/src/client/TargetEditor.tsx + client/cat-edit-utils.ts + client/tag-atomic-utils.ts | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 41 | apps/electron/src/renderer/features/linguist/projects/TermMatchPanel.tsx | complete | packages/dsh-linguist/src/client/CatWorkbench.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 42 | apps/electron/src/renderer/features/linguist/projects/TmMatchPanel.tsx | complete | packages/dsh-linguist/src/client/CatWorkbench.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 43 | apps/electron/src/renderer/features/linguist/projects/UnknownTagNotice.tsx | complete | packages/dsh-linguist/src/client/UnknownTagNotice.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 44 | apps/electron/src/renderer/features/linguist/projects/VoiceProfilePanel.tsx | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 45 | apps/electron/src/renderer/features/linguist/projects/cat-workspace-atoms.ts | complete | packages/dsh-linguist/src/client/workbench-location.ts | 工作台位置与布局以项目键持久化，不复制原 Proma 状态容器；仍需重开验证。 |
| 46 | apps/electron/src/renderer/features/linguist/projects/context-docs-refresh.ts | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 47 | apps/electron/src/renderer/features/linguist/projects/format-labels.ts | complete | packages/dsh-linguist/src/client/format-labels.ts | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 48 | apps/electron/src/renderer/features/linguist/projects/linguist-preview-open.ts | complete | packages/dsh-linguist/src/client/BatchPreview.tsx + DSH SidebarRight | 批次语义预览可从导航/资料区打开为官方 SidebarRight resource tab；仍需安装态操作。 |
| 49 | apps/electron/src/renderer/features/linguist/projects/linguist-preview-utils.ts | complete | packages/dsh-linguist/src/client/BatchPreview.tsx | 双语分页、保护 token 局部告警、页码和批次状态汇总已接线；仍需安装态操作。 |
| 50 | apps/electron/src/renderer/features/linguist/projects/open-linguist-session.ts | host-replaced | packages/dsh-linguist/src/client/index.ts + DSH Sessions/Workspace/SidebarRight | 会话创建、打开、文件右区由官方 DSH Session/Workspace/SidebarRight 承担。 |
| 51 | apps/electron/src/renderer/features/linguist/projects/open-localization-project.ts | host-replaced | packages/dsh-linguist/src/client/index.ts + DSH Sessions/SidebarRight | 项目打开映射到原生 Session 绑定及 CAT 右区 Tab。 |
| 52 | apps/electron/src/renderer/features/linguist/projects/project-agent-session.ts | host-replaced | packages/dsh-linguist/src/client/index.ts + host/bindings.ts | 原生 DSH Session 创建；Host 持久化项目/岗位/模式 binding。 |
| 53 | apps/electron/src/renderer/features/linguist/projects/project-agent-task.ts | complete | packages/dsh-linguist/src/client/CatWorkbench.tsx + client/index.ts | 显式 LA Agent 任务使用 beginSubmission requestId + Host prepare + 原生 prompt；普通 Composer 仍无同轮选区。 |
| 54 | apps/electron/src/renderer/features/linguist/projects/project-composer-context.ts | still-pending | packages/dsh-linguist/src/client/CatWorkbench.tsx + client/index.ts | 工作台显式引用/选区展示存在；原生 Composer 内项目/批次/选区 chips 与默认轮次快照缺失。 |
| 55 | apps/electron/src/renderer/features/linguist/projects/project-integrity-atoms.ts | complete | packages/dsh-linguist/src/client/Panels.tsx + client/api.ts | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 56 | apps/electron/src/renderer/features/linguist/projects/project-list-atoms.ts | complete | packages/dsh-linguist/src/client/ProjectsPage.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 57 | apps/electron/src/renderer/features/linguist/projects/project-mutation-atoms.ts | complete | packages/dsh-linguist/src/client/api.ts + client/CatWorkbench.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 58 | apps/electron/src/renderer/features/linguist/projects/project-summary-atoms.ts | complete | packages/dsh-linguist/src/client/CatWorkbench.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 59 | apps/electron/src/renderer/features/linguist/projects/project-utils.ts | still-pending | packages/dsh-linguist/src/client/ProjectsPage.tsx + client/api.ts | 列表/健康/输入处理已迁；源格式错误分类、稳定错误码中文说明和撤销引用计数说明未完整迁。 |
| 60 | apps/electron/src/renderer/features/linguist/projects/projects-atoms.ts | complete | packages/dsh-linguist/src/client/ProjectsPage.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 61 | apps/electron/src/renderer/features/linguist/projects/proposal-inbox-utils.ts | complete | packages/dsh-linguist/src/client/Panels.tsx | 建议差异、Run 分组和批量排除项确认已接线；仍需安装态操作。 |
| 62 | apps/electron/src/renderer/features/linguist/projects/qa-findings-utils.ts | complete | packages/dsh-linguist/src/client/Panels.tsx + CatWorkbench.tsx | 严重度文案和网格逐段 QA 投影已接线；仍需安装态操作。 |
| 63 | apps/electron/src/renderer/features/linguist/projects/sentence-patterns-utils.ts | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 64 | apps/electron/src/renderer/features/linguist/projects/stage-coverage-atoms.ts | complete | packages/dsh-linguist/src/client/RunPanel.tsx + client/CatWorkbench.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 65 | apps/electron/src/renderer/features/linguist/projects/style-guide-utils.ts | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 66 | apps/electron/src/renderer/features/linguist/projects/voice-profile-utils.ts | complete | packages/dsh-linguist/src/client/Panels.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 67 | apps/electron/src/renderer/features/linguist/projects/workflow-ui.ts | complete | packages/dsh-linguist/src/client/CatWorkbench.tsx + RunPanel.tsx | 岗位阶段标签和状态说明已接线；仍需安装态操作。 |
| 68 | apps/electron/src/renderer/features/linguist/session-binding/LinguistRoleMenu.tsx | complete | packages/dsh-linguist/src/client/index.ts + client/ProjectsPage.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 69 | apps/electron/src/renderer/features/linguist/session-binding/LinguistSessionBindingBadge.tsx | complete | packages/dsh-linguist/src/client/index.ts | 岗位/模式/项目 badge 与显式解除绑定入口已接线；仍需安装态操作。 |
| 70 | apps/electron/src/renderer/features/linguist/session-binding/binding-utils.ts | complete | packages/dsh-linguist/src/client/api.ts + client/index.ts | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 71 | apps/electron/src/renderer/features/linguist/session-binding/useLinguistSessionBinding.ts | complete | packages/dsh-linguist/src/client/index.ts | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 72 | apps/electron/src/renderer/features/linguist/sidebar/CopyLinguistSessionDialog.tsx | complete | packages/dsh-linguist/src/client/SessionCopyPage.tsx | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 73 | apps/electron/src/renderer/features/linguist/sidebar/LinguistProjectActionsMenu.tsx | complete | packages/dsh-linguist/src/client/ProjectsPage.tsx + client/index.ts | 同等用户操作已在原生 Client 页面中接线；仍需官方 Desktop 交互验收。 |
| 74 | apps/electron/src/renderer/features/linguist/sidebar/linguist-sidebar-data.ts | host-replaced | packages/dsh-linguist/src/client/index.ts + DSH native Workspace/Session sidebar | 原生侧栏管理 Workspace/Session；LA 项目页按绑定展示项目分组与归档/缺失历史会话，需 Desktop 核验。 |
| 75 | apps/electron/src/renderer/features/linguist/sidebar/useLinguistSidebarActions.tsx | host-replaced | packages/dsh-linguist/src/client/ProjectsPage.tsx + DSH native sidebar | 项目业务操作在 LA 主 Slot，Session pin/archive/打开由原生侧栏管理；项目级侧栏菜单非公开扩展。 |
| 76 | apps/electron/src/renderer/host/agent-host-extension.tsx | host-replaced | packages/dsh-linguist/src/client/index.ts + DSH native main/session/sidebarRight Slots | Proma Host extension 生命周期由 DSH 官方 Slots/Session/SidebarRight 接替。 |
| 77 | apps/electron/src/renderer/host/app-mode-registry.ts | host-replaced | packages/dsh-linguist/src/client/index.ts + DSH native shell | DSH 负责应用模式和窗口导航；LA 只注册主入口。 |

## 公开接缝与验收重点

- DSH 原生 Composer 目前未见公开的提交前 V1 快照附加接口；只对显式 LA 快捷任务实现 requestId/Host receipt，不能把普通对话算作同轮选区上下文。
- DSH Workspace 行徽章与项目能力设置直达 Skills/MCP/Memory 没有已核实的公开 Slot/导航服务；不应复制侧栏或深链。
- DSH 原生 Schedule due-execution 接缝由 Host 实现中；Client 只在显式创建时传 `executeAtDue:true`，仍需真实 Desktop 到期执行、管理操作、重开持续性验证。
- 批次语义预览、网格内 QA/Proposal 提示、布局位置持久化和阶段专用文案已有目标静态实现；源错误诊断说明仍是缺口，全部须已安装 Desktop 操作验收。
