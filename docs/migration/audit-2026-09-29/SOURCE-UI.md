# 旧 LA 当前有效 UI／交互盘点

2026-09-29；源 HEAD `70d6b1feab08b2767189e3597a69d81d86adb2a8`，以磁盘有效实现为准。源仓库全程只读，未运行源程序或测试。

本轮列出 **137 个操作／交互边界项**；覆盖完整 `renderer/features/linguist/` 的82个文件以及直接宿主接线。操作数是审计粒度，不是完成比例。

## 使用与边界

- 每条有源文件/符号/行号，默认、空态、异常、键盘、并发行为，目标已知入口、实现与安装两个独立状态。
- 目标入口只是待核对的位置，不能据文件存在或测试绿标等价。全部安装态为本轮逐项未验，旧包安装不代替最新DSH统一交付验收。
- LA领域行为保留；聊天、模型、权限、文件、Skills/MCP、浏览器壳、调度使用DSH原生能力，不复制Proma宿主。
- 源语言下拉30种、默认zh-CN→en-US，只保留未知现值；新增自定义locale输入是目标增强。
- 已确认目标术语匹配缺插入草稿动作和部分匹配详情；普通Composer默认CAT范围需重核新DSH公开API。
- `ProjectCard`、`DeliverablesSection`当前只有定义，无renderer调用，不把历史文件当现行入口。
- Proma独立Memory窗口不是LA领域后端；DSH只读Files不能冒称可手工编辑。
- 源renderer无独立非CAT工作副本页，流程经工具+原生Files；需与Host工具盘点合并。

## 状态词典

- `entry-mapped-parity-unverified`：源码行为已核对，目标入口已定位，尚未逐条件对比和安装验收
- `host-native-adaptation-required`：保持LA特有身份/上下文，通过DSH原生表面承接宿主行为
- `known-ui-gap`：已具体查明目标缺交互
- `known-sdk-boundary`：已按官方rc.2公开API重新核实的接口缺口，尚未闭合
- `host-specific-excluded-from-la-domain`：原Proma独立宿主能力不重建为LA后端
- `source-unwired-not-current-requirement`：文件存在但当前renderer无调用方，不列当前可达UI要求

## 用户操作台账

### 项目与会话

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-001 | 项目起始页、活跃列表、加载失败重试、数据迁移入口 | `ProjectsView.tsx:17` `ProjectsView` | `ProjectsPage.tsx`<br>`ProjectSessions.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-002 | 新建项目名称、语言方向、T/E/P任务阶段、QA场景 | `ProjectCreateDialog.tsx:161` `handleSubmit`<br>`projects-atoms.ts:26` `DEFAULT_PROJECT_CREATE_DRAFT` | `ProjectsPage.tsx`<br>`ProjectSessions.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-003 | 30种常用语言下拉及保留未知现值 | `ProjectLocaleSelect.tsx:16` `PROJECT_LOCALE_OPTIONS`<br>`project-utils.ts:72` `validateLocaleInput` | `ProjectsPage.tsx`<br>`ProjectSessions.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-004 | 关闭重开保留新建草稿、成功重置与焦点归还 | `ProjectCreateDialog.tsx:81` `focusAfterProjectCreate`<br>`projects-atoms.ts:34` `projectCreateDraftAtom` | `ProjectsPage.tsx`<br>`ProjectSessions.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-005 | 项目名打开Workbench、会话名打开完整Agent | `open-localization-project.ts:22` `openLocalizationProject`<br>`open-linguist-session.ts:79` `openLinguistAgentSession` | `ProjectsPage.tsx`<br>`ProjectSessions.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-006 | 项目重命名并同步各处徽标 | `useLinguistSidebarActions.tsx:106` `handleRenameProject`<br>`LinguistSessionBindingBadge.tsx:2` `LinguistSessionBindingBadge` | `ProjectsPage.tsx`<br>`ProjectSessions.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-007 | 上移、下移、拖拽排序活跃项目 | `useLinguistSidebarActions.tsx:198` `handleMoveProject`<br>`LeftSidebar.tsx:1721` `workspaceOrderChanged` | `ProjectsPage.tsx`<br>`ProjectSessions.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-008 | 确认归档并只读打开历史 | `ProjectArchiveAction.tsx:29` `useProjectArchive`<br>`projects-atoms.ts:40` `archivedSectionCollapsedAtom` | `ProjectsPage.tsx`<br>`ProjectSessions.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-009 | 名称确认后移入可恢复删除区 | `ProjectMaintenanceSettings.tsx:75` `deleteProject` | `ProjectsPage.tsx`<br>`ProjectSessions.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-010 | 选择四岗位新建项目会话 | `LinguistProjectActionsMenu.tsx:138` `LinguistCreateSessionMenu`<br>`project-agent-session.ts:124` `createProjectAgentSession` | `ProjectsPage.tsx`<br>`ProjectSessions.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-011 | 继续新任务保留项目/岗位，关闭会话后选择同项目候选 | `project-agent-session.ts:77` `selectFallbackLinguistSession`<br>`agent-host-extension.tsx:58` `createContinuationSession` | `ProjectsPage.tsx`<br>`ProjectSessions.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-001** 默认：共享侧栏管理全部项目；起始页无第二套卡片列表。 空态：无活跃项目提示新建；有项目提示选侧栏。 异常：加载失败有错误与重试。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

**LA-UI-002** 默认：源默认zh-CN→en-US、translation、general；名称trim非空且≤120；QA general/subtitle。 空态：空名称显示字段错误。 异常：失败保留草稿与Dialog；主进程权威校验。 键盘：Enter提交；Dialog圈焦点、Esc取消。 并发：submitting禁重复和关闭；成功onCreated打开权威返回项目。

**LA-UI-003** 默认：源仅下拉，不含新增自定义文本输入；已有非预置值追加当前值。 空态：无值请选择语言。 异常：locale按形状/长度校验，不查白名单。 键盘：Select原生键盘。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

**LA-UI-004** 默认：取消不清Jotai草稿；成功恢复默认。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：失败不清空。 键盘：取消回原触发按钮；成功回新项目打开按钮。 并发：列表异步刷新最多60帧探焦点，最后回触发按钮。

**LA-UI-005** 默认：使用同项目当前会话；没有时ensure创建。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：失败不降级到普通会话。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：导航代际保护：迟到A不抢已选B；原生标签/模式切换可取消旧导航。

**LA-UI-006** 默认：改项目名称，不改会话标题。 空态：空名称不提交。 异常：失败返回中文错误。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：刷新共享项目真源。

**LA-UI-007** 默认：首尾禁相应移动，归档不参与活跃排序。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：PROJECT_ORDER_CONFLICT需刷新重试。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：请求带预期顺序，不能覆盖别人排序。

**LA-UI-008** 默认：归档分组默认收起；归档仍可读和备份。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：归档失败保留确认态。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：archiving禁重复和关闭。

**LA-UI-009** 默认：只允许归档项目；仅CAT目录入受管Trash，Agent Session及工作目录保留。 空态：名称不匹配禁确认。 异常：失败明确；成功显示恢复目录或已清理索引。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：删除成功清项目草稿/UI/summary缓存。

**LA-UI-010** 默认：General、Translator、Reviewer、Proofreader；显式新建不复用当前会话。 空态：无活跃项目先选项目。 异常：创建失败不造普通会话。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：自动ensure有pending去重，显式新建独立。

**LA-UI-011** 默认：同项目候选按置顶/最近/ID；当前岗位沿用。 空态：无候选清关联。 异常：继续创建失败抛错，不回退普通会话。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：登记新session前核验绑定身份。

### 岗位、绑定与复制

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-012 | 切换四岗位及查看职责说明 | `LinguistRoleMenu.tsx:16` `LINGUIST_ROLE_OPTIONS` | `SessionCopyPage.tsx`<br>`index.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-013 | 查看归档/缺失项目通知并确认永久解绑 | `LinguistSessionBindingBadge.tsx:80` `LinguistSessionBindingNotice`<br>`binding-utils.ts:33` `bindingNoticeCopy` | `SessionCopyPage.tsx`<br>`index.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-014 | 核验后复制完整对话分支到其他健康活跃项目 | `CopyLinguistSessionDialog.tsx:46` `CopyLinguistSessionDialog` | `SessionCopyPage.tsx`<br>`index.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-015 | 复制完成后打开副本 | `useLinguistSidebarActions.tsx:240` `onCopied` | `SessionCopyPage.tsx`<br>`index.ts`<br>`entry-mapped-parity-unverified` |

**LA-UI-012** 默认：角色改默认责任，不限制宿主通用工具；审校检查完整Source与当前Target。 空态：非项目会话不渲染。 异常：失败保留原角色。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：saving禁重复并刷新会话元数据。

**LA-UI-013** 默认：项目不可用与普通对话可用分开；解绑转普通Agent且不可重新绑定。 空态：正常绑定不显示异常通知。 异常：解绑失败可重试。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：用更新后的元数据恢复普通模式。

**LA-UI-014** 默认：先资格检查和目标健康检查；源会话/项目文件不变。 空态：无其他健康活跃项目明确空态。 异常：不合格原因可见；语言方向不同警告但允许。 键盘：Radio选项目，Dialog取消。 并发：卸载忽略迟到资格结果；submitting防重入/关闭。

**LA-UI-015** 默认：toast提供打开副本动作，源会话保持不变。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：Host返回新session身份，不假定复制覆盖。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

### 工作台结构与导航

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-016 | 看项目/语言对/批次/只读/当前阶段进度 | `LinguistWorkbenchShell.tsx:136` `progressLabel`<br>`workflow-ui.ts:79` `stageProgressSummary` | `CatWorkbench.tsx`<br>`workbench-location.ts`<br>`Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-017 | 头部快速切换T/E/P | `LinguistWorkbenchShell.tsx:146` `handleWorkflowStageChange` | `CatWorkbench.tsx`<br>`workbench-location.ts`<br>`Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-018 | 搜索、选择、刷新、预览批次并直达管理 | `AssetNavigator.tsx:12` `AssetNavigator` | `CatWorkbench.tsx`<br>`workbench-location.ts`<br>`Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-019 | 恢复项目位置和面板布局 | `cat-workspace-atoms.ts:237` `serializeLinguistWorkbenchLocations` | `CatWorkbench.tsx`<br>`workbench-location.ts`<br>`Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-020 | 开合/拖动尺寸/复位批次导航与辅助面板 | `LinguistWorkbenchShell.tsx:36` `getAssetNavigatorWidthFromKey`<br>`cat-workspace-atoms.ts:38` `BOTTOM_DOCK_DEFAULT_HEIGHT` | `CatWorkbench.tsx`<br>`workbench-location.ts`<br>`Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-021 | 切换TM/术语/QA/上下文证据/建议/准备交付 | `LinguistBottomDock.tsx:16` `TABS` | `CatWorkbench.tsx`<br>`workbench-location.ts`<br>`Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-022 | 分类打开项目设置、消费一次性直达tab | `ProjectSettingsSheet.tsx:60` `ProjectSettingsSheetBody` | `CatWorkbench.tsx`<br>`workbench-location.ts`<br>`Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-023 | 跨工具/Agent变更实时刷新网格与语言资产 | `project-mutation-atoms.ts:136` `getProjectMutationRefreshPlan`<br>`LocalizationProjectWorkbench.tsx:132` `synchronize` | `CatWorkbench.tsx`<br>`workbench-location.ts`<br>`Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-024 | 点击工具结果直达真实项目/句段 | `CatToolResultNavigationInitializer.tsx:32` `navigateToCatResult`<br>`cat-result.tsx:410` `proposalStatuses` | `CatWorkbench.tsx`<br>`workbench-location.ts`<br>`Panels.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-016** 默认：本批次与全项目口径明确；导入原生状态不当本轮确认。 空态：尚无批次与未选择批次区分。 异常：统计加载/不可用单独显示。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

**LA-UI-017** 默认：切换后刷新summary与coverage。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：失败toast。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：stageSaving/归档/未变化不提交。

**LA-UI-018** 默认：搜索文件名忽略大小写；每批次显示阶段进度和QA。 空态：无批次与无匹配区分；summary缺时加载。 异常：本项无另立错误协议；依据所属组件的请求错误及Host拒绝处理。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：按批次记最后活动段；失效当前批次回首个真源批次。

**LA-UI-019** 默认：只持久化位置/开合/尺寸；不写CAT正文、草稿、临时筛选。 空态：真源无效ID清除，不猜段。 异常：本项无另立错误协议；依据所属组件的请求错误及Host拒绝处理。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：运行期已有状态优先，异步恢复不覆盖用户新操作。

**LA-UI-020** 默认：导航240范围180–420，Dock240范围160–480；编辑区优先保留360px。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：本项无另立错误协议；依据所属组件的请求错误及Host拒绝处理。 键盘：方向键16px，Home/End最小最大，Enter/双击复位。 并发：pointer capture/cancel清理；ResizeObserver适配窗口。

**LA-UI-021** 默认：默认TM；按项目保留标签。 空态：未选批次不请求全项目QA/建议。 异常：本项无另立错误协议；依据所属组件的请求错误及Host拒绝处理。 键盘：左右循环、Home/End、roving tabIndex及焦点滚入可见。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

**LA-UI-022** 默认：项目/批次/语言资产/Tag Profiles/维护/诊断；普通打开默认项目。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：本项无另立错误协议；依据所属组件的请求错误及Host拒绝处理。 键盘：Sheet/Tabs原生键盘。 并发：initialTab变化重挂Tabs；关闭清直达意图，不反复抢用户手选tab。

**LA-UI-023** 默认：按Hostsequence/revision重放，刷新对应页/summary/QA/proposals。 空态：首次正常查询。 异常：刷新失败提示，不能抹草稿。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：序列不倒退；项目隔离，卸载取消订阅。

**LA-UI-024** 默认：读取权威getContext得到assetId，清搜索/阶段筛选。 空态：只有projectId则只打开项目。 异常：无效segment不乱跳。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：共享导航代际；mutation后卡片建议状态重读。

### 批次导入与格式

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-025 | 原生选择多文件/文件夹并自动分类批次与资料 | `ProjectAssetsSection.tsx:300` `handleImport` | `Panels.tsx`<br>`BatchPreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-026 | 查看批量导入结果、重复跳过和异常条目 | `ProjectAssetsSection.tsx:596` `BulkImportSummary` | `Panels.tsx`<br>`BatchPreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-027 | XLSX选择sheet及源文/译文/ID/备注/锁定列 | `ProjectAssetsSection.tsx:561` `XlsxMappingConfirmPanel` | `Panels.tsx`<br>`BatchPreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-028 | 记住、复用或取消XLSX映射 | `ProjectAssetsSection.tsx:348` `handleConfirmXlsxMapping` | `Panels.tsx`<br>`BatchPreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-029 | 查看批次格式、计数、时间、警告、回读验证 | `ProjectAssetsSection.tsx:615` `AssetRow` | `Panels.tsx`<br>`BatchPreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-030 | 复制完整SHA-256摘要 | `ProjectAssetsSection.tsx:920` `CopyDigestButton` | `Panels.tsx`<br>`BatchPreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-031 | 撤销尚无下游引用的导入 | `ProjectAssetsSection.tsx:429` `handleUndoImport`<br>`project-utils.ts:194` `describeImportUndoBlockedCounts` | `Panels.tsx`<br>`BatchPreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-032 | 批次行直接导出翻译文件 | `ProjectAssetsSection.tsx:385` `handleExport` | `Panels.tsx`<br>`BatchPreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-033 | 查看格式内部验证与平台资格 | `FormatQualificationCard.tsx:19` `PLATFORM_QUALIFICATION_LABELS` | `Panels.tsx`<br>`BatchPreview.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-025** 默认：批量最多500；双语进批次、TM/TB/Context进语言资产；配套master单独标。 空态：取消不报错，空项目引导导入。 异常：failed/unsupported/needs-input分类展示，不把跳过当导入。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：import/export/undo/待映射互斥，卸载忽略迟到结果。

**LA-UI-026** 默认：found/imported/duplicate/needs-input/unsupported/failed独立；详情前20。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：达到500提示截断；需映射XLSX提示单独选择。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

**LA-UI-027** 默认：源文译文必填；显示建议置信度与表样本。 空态：无sheet/缺必填禁确认。 异常：展示公式、错误格、合并区、样本截断。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：Host核hash/sheet/列，不能编辑预览后偷换文件。

**LA-UI-028** 默认：用户勾记住；toast区分记住/复用。 空态：取消不导入。 异常：失败保留错误及再试入口。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：busy/requiredMissing保护。

**LA-UI-029** 默认：显示实际formatId及segment-count/format/language-pair验证。 空态：summary不可用仍说明可尝试导入。 异常：按格式unsupported/ambiguous/parse/export/segment-lost分类解释。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

**LA-UI-030** 默认：显示可截断，复制必须完整。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：剪贴板失败不报已复制。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

**LA-UI-031** 默认：归档禁用；删除批次段及受管源文件。 空态：无批次无按钮。 异常：显示建议/QA/历史评审件/导出/人工编辑引用阻断计数。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：Host现状检查；不能删除已有下游工作。

**LA-UI-032** 默认：系统保存对话框，成功显示verifiedSegments/hash。 空态：取消不失败。 异常：行内错误及重试；归档禁止。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：导出busy与导入等互斥。

**LA-UI-033** 默认：未验证/真实文件通过/平台回传通过/原生目标通过分开。 空态：未验证不等于不兼容。 异常：合成测试不冒充平台资格。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

### CAT网格与编辑

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-034 | 虚拟化双栏阅读Source/Target、原始序号、锁和原生状态 | `SegmentGrid.tsx:58` `SegmentGrid`<br>`SegmentGrid.tsx:498` `IdCell` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-035 | 按Source/Target搜索、按本轮状态筛选 | `SegmentEditor.tsx:323` `updateFilters` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-036 | 网格键盘翻页、首尾、选择和进入编辑 | `cat-virtual-utils.ts:48` `gridRowKeyAction`<br>`SegmentGrid.tsx:462` `onDoubleClick` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-037 | 下一个本轮未处理句段 | `SegmentEditor.tsx:340` `goToNextUntouched` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-038 | 下一个QA问题并展开正确批次句段 | `SegmentEditor.tsx:454` `goToNextQa`<br>`cat-workspace-atoms.ts:95` `buildQaFindingJumpPatch` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-039 | 编辑草稿、保存、取消 | `TargetEditor.tsx:34` `TargetEditor`<br>`SegmentEditor.tsx:630` `saveTarget` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-040 | 确认当前阶段并前进、撤销本轮确认 | `SegmentEditor.tsx:764` `confirmAndAdvance`<br>`SegmentEditor.tsx:668` `mutateCurrentStage` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-041 | 批量确认所选并保留失败项选择 | `SegmentEditor.tsx:949` `confirmSelectedStage` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-042 | 撤销/重做文字草稿并处理IME组合 | `TargetEditor.tsx:196` `targetDraftReducer`<br>`cat-edit-utils.ts:46` `editKeyAction` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-043 | 跨虚拟行/工作台重挂保留草稿和Undo | `cat-workspace-atoms.ts:355` `createLinguistTargetEditorDraftAtom`<br>`cat-editor.browser.test.ts:124` `工作区重新挂载保留草稿` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-044 | 外部更新冲突后重载最新或保留我的草稿 | `TargetEditor.tsx:521` `resolveConflict` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-045 | Tag/占位符硬保护与疑似Tag软提示 | `TargetEditor.tsx:260` `targetProtectionViolations`<br>`TargetEditor.tsx:284` `targetSuspectedTagWarnings` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-046 | Tag按整单元导航、选择与删除 | `tag-atomic-utils.ts:33` `listTargetTagSpans`<br>`TargetEditor.tsx:15` `hardSpanForUnitDeletion` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-047 | 长Target自适应高度、进入编辑滚入视野 | `TargetEditor.tsx:73` `autoSizeTargetTextarea`<br>`SegmentGrid.tsx:799` `editingCellRef` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-048 | 行内比较当前与建议译文，接受/拒绝 | `SegmentGrid.tsx:548` `ProposalInlineReview` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-049 | 明确为Agent引用句段 | `SegmentGrid.tsx:134` `handleSegmentAgentReference`<br>`cat-workspace-atoms.ts:494` `createSegmentAgentReference` | `CatWorkbench.tsx`<br>`TargetEditor.tsx`<br>`cat-editor-state.ts`<br>`entry-mapped-parity-unverified` |

**LA-UI-034** 默认：保留换行/tag；Source只读；原始序号不同过滤结果位置。 空态：未加载行占位。 异常：归档/locked不能编辑。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：稳定segment ID，动态行高。

**LA-UI-035** 默认：当前批次范围，untouched/draft/confirmed。 空态：查询中/无结果区别。 异常：失败可重试。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：deferredSearch，旧查询结果不覆盖新scope。

**LA-UI-036** 默认：活动行与selected集合区分。 空态：未知行先加载。 异常：锁/归档拒编辑。 键盘：↑↓、Home/End、PageUp/Down、Space选择、Enter/F2编辑；非控件区双击编辑。 并发：textarea内不抢网格键；加载后焦点恢复。

**LA-UI-037** 默认：当前批次/筛选，跳过不可编辑行。 空态：无候选提示。 异常：定位失败可见。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：异步候选必须仍属请求scope。

**LA-UI-038** 默认：开放Finding计数；清阻挡定位的搜索/阶段筛选。 空态：未运行QA与0问题区分。 异常：无效上下文不跳。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

**LA-UI-039** 默认：当前Target/revision为基线；不即时写数据库；显示未保存。 空态：空Target可编辑。 异常：失败保留草稿；冲突独立处理。 键盘：⌘/Ctrl+S保存，Esc取消。 并发：saving/resolving只读；无dirty不重复提交。

**LA-UI-040** 默认：无文字更改也可确认；T/E/P决定业务含义。 空态：无下一可编辑段明确提示。 异常：确认失败不前进；撤销不覆盖译文。 键盘：⌘/Ctrl+Enter确认并前进。 并发：重读revision；迟到A回执不改B当前段。

**LA-UI-041** 默认：逐段重读后CAS确认。 空态：无选择禁用。 异常：成功/失败分别计，失败项继续选中。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：busy防重复；不得对读失败段假成功。

**LA-UI-042** 默认：200操作/200000字符有界历史；IME按完整组合记录。 空态：无past/future禁用对应操作。 异常：saving/IME不接受Undo/Redo。 键盘：⌘/Ctrl+Z、Shift+Z、Ctrl+Y。 并发：IME卸载保留文字并结束组合状态，不锁死重挂。

**LA-UI-043** 默认：源project+segment内存态；不承诺冷应用重启保存。 空态：取消/成功保存/项目删除清除。 异常：卸载后失败仍可恢复。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：跨项目隔离；pending保存时重挂仍只读；迟到保存不误清新草稿。

**LA-UI-044** 默认：pristine跟真源；dirty进入冲突。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：重载失败保留原草稿。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：保留文字同时刷新baseRevision，Undo基线是最新Target，不强覆新修订。

**LA-UI-045** 默认：源token chip、数量/结构守恒；未知候选未批准只提示。 空态：无token不造警告。 异常：不能将合法稿改坏；已有坏稿允许逐步修复。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：手输/粘贴/TM同一保护，保存再次校验。

**LA-UI-046** 默认：hard/soft span分开。 空态：普通文字走textarea行为。 异常：必须保留源tag，拒绝破坏并提示。 键盘：左右跨hard span；选择扩完整span；Backspace/Delete先选整tag再尝试删除。 并发：IME/modifier/只读不抢原生输入。

**LA-UI-047** 默认：最小76px、视口40%上限，长文内滚动；Dock预留空间。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：本项无另立错误协议；依据所属组件的请求错误及Host拒绝处理。 键盘：Tab可达保存/取消/确认。 并发：IME期间跳过重排，结束补测。

**LA-UI-048** 默认：pending建议以revision判断冲突，不只比文字。 空态：无建议不展示。 异常：归档/锁/过期禁接受，拒绝可单独进行。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：mutating防重入；失败刷新。

**LA-UI-049** 默认：项目单槽引用，普通焦点不是发送scope。 空态：未引用默认project/batch。 异常：跨项目残留引用不可见。 键盘：右键菜单引用；Composer清除按钮。 并发：发送点击冻结引用，后续焦点不漂移。

### QA

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-050 | 运行当前批次QA，显示全批次或仅当前句段 | `QaFindingsPanel.tsx:96` `buildQaRunRequest`<br>`QaFindingsPanel.tsx:156` `QaFindingsPanel` | `Panels.tsx`<br>`cat-navigation.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-051 | 筛选状态/L0–L4/处置并分页 | `QaFindingsPanel.tsx:67` `buildQaFindingsRequest`<br>`qa-findings-utils.ts:22` `QA_SEVERITY_LABELS` | `Panels.tsx`<br>`cat-navigation.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-052 | 从Finding定位句段 | `QaFindingsPanel.tsx:484` `QaFindingCard`<br>`qa-findings-utils.ts:77` `qaJumpDisabledReason` | `Panels.tsx`<br>`cat-navigation.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-053 | 修改译文后标记已解决 | `QaFindingsPanel.tsx:100` `qaResolveDisabledReason` | `Panels.tsx`<br>`cat-navigation.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-054 | 填写原因/操作者豁免单条 | `QaFindingsPanel.tsx:121` `qaWaiverReasonError`<br>`QaFindingsPanel.tsx:189` `waive` | `Panels.tsx`<br>`cat-navigation.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-055 | 确认全项目同规则批量豁免 | `QaFindingsPanel.tsx:324` `moreNotice` | `Panels.tsx`<br>`cat-navigation.ts`<br>`entry-mapped-parity-unverified` |
| LA-UI-056 | 项目设置打开全项目QA历史 | `ProjectSettingsSheet.tsx:93` `qaHistoryOpen` | `Panels.tsx`<br>`cat-navigation.ts`<br>`entry-mapped-parity-unverified` |

**LA-UI-050** 默认：默认批次open；显示仅当前句段不改变运行批次范围。 空态：无批次提示选择，不请求全项目。 异常：运行失败可见；归档禁运行。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：running互斥；scopeKey隔离迟到结果。

**LA-UI-051** 默认：open/resolved/waived；blocking/check/notice视觉区分。 空态：结果总数和范围，空态明确。 异常：列表错误明确。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：筛选变化offset归0。

**LA-UI-052** 默认：次要导航不改变Finding处置。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：归档/无有效segment源会禁跳。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：切批次并清过滤，恢复焦点。

**LA-UI-053** 默认：open且currentRevision大于finding.segmentRevision才可解。 空态：终态无处置入口。 异常：未改译文给禁用原因。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：mutatingId串行，Host再次核验。

**LA-UI-054** 默认：原因trim非空≤500；操作者来自用户名或本机用户。 空态：空原因不提交。 异常：失败不改处置；已豁免显示理由/操作者。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：归档/其他mutation禁用；取消收起理由。

**LA-UI-055** 默认：先取同code开放Finding，再列实际数量/截断/理由/操作者。 空态：无可豁免项提示。 异常：不能只对当前页却声称全项目。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：确认后发明确IDs；Host权威核验。

**LA-UI-056** 默认：details按需加载，全项目范围明确。 空态：未展开不请求。 异常：历史可读不等于允许写。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：跳转后关闭Sheet。

### 建议与专业覆盖

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-057 | 按当前批次pending或全部历史查看Run分组/分页 | `ProposalInbox.tsx:51` `ProposalInbox`<br>`proposal-inbox-utils.ts:168` `groupProposalRuns` | `Panels.tsx`<br>`proposal-view.ts`<br>`RunPanel.tsx`<br>`CatToolResult.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-058 | 对照Source/当前Target/建议Target及文字差异 | `ProposalInbox.tsx:332` `ProposalCard`<br>`proposal-inbox-utils.ts:13` `textDiffParts` | `Panels.tsx`<br>`proposal-view.ts`<br>`RunPanel.tsx`<br>`CatToolResult.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-059 | 接受、拒绝或编辑后接受单条建议 | `ProposalInbox.tsx:51` `ProposalInbox` | `Panels.tsx`<br>`proposal-view.ts`<br>`RunPanel.tsx`<br>`CatToolResult.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-060 | 确认所选建议实际可操作集合与排除原因 | `ProposalInbox.tsx:219` `runBulkMutation`<br>`proposal-inbox-utils.ts:139` `bulkProposalReviewConfirmation` | `Panels.tsx`<br>`proposal-view.ts`<br>`RunPanel.tsx`<br>`CatToolResult.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-061 | 网格所选句段批量接受/拒绝建议 | `SegmentEditor.tsx:854` `reviewSelected` | `Panels.tsx`<br>`proposal-view.ts`<br>`RunPanel.tsx`<br>`CatToolResult.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-062 | 终态建议重新提出 | `ProposalInbox.tsx:48` `reissue` | `Panels.tsx`<br>`proposal-view.ts`<br>`RunPanel.tsx`<br>`CatToolResult.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-063 | 看阶段确认/未处理/未修改/修正/阻塞覆盖 | `ProposalInbox.tsx:65` `ProposalCoverageBanner`<br>`stage-coverage-atoms.ts:78` `formatStageCoverage`<br>`delegation-result.tsx:96` `formatDelegationCoverage` | `Panels.tsx`<br>`proposal-view.ts`<br>`RunPanel.tsx`<br>`CatToolResult.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-064 | 全项目建议历史入口 | `ProjectSettingsSheet.tsx:92` `proposalHistoryOpen` | `Panels.tsx`<br>`proposal-view.ts`<br>`RunPanel.tsx`<br>`CatToolResult.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-057** 默认：保留run/session/model/time/revision。 空态：无建议不等于已审校/QA/可交付。 异常：失败重试。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：generation防旧A覆盖B，筛选变重查。

**LA-UI-058** 默认：理由、风险、证据/术语引用、发行prompt/digest/toolset hash可查。 空态：空Target显示空。 异常：pending revision不一致即冲突；终态不当pending误报。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

**LA-UI-059** 默认：编辑接受要求非空；保留旧提案审计。 空态：终态不复用pending按钮。 异常：stale/lock/冲突明确。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：单条mutating防重复，Host校验baseRevision。

**LA-UI-060** 默认：最多实际50；stale/lock/终态逐项排除。 空态：0可操作不执行。 异常：超过50要求缩范围，不偷偷截断。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：确认前fresh diffs；明确IDs/revisions提交。

**LA-UI-061** 默认：最多200句段核验，实际建议最多50。 空态：无pending明确告知。 异常：读失败不盲改。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：bulk busy；确认展示排除数。

**LA-UI-062** 默认：创建带lineage新pending，旧accepted/rejected保留。 空态：锁/归档禁用。 异常：确认说明非原地恢复。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：新旧身份不混淆。

**LA-UI-063** 默认：Translator确认、Reviewer/Proofreader决策分开；进程结束不是专业完成。 空态：零建议不代表全覆盖。 异常：无证据不能伪造完成。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：以current revision和冻结scope统计，mutation刷新。

**LA-UI-064** 默认：设置details按需挂载。 空态：未展开不全量取。 异常：全项目与当前批次范围不得混淆。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

### TM与术语

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-065 | 查看当前句段TM匹配分数/来源/变体/差异/检查提示 | `TmMatchPanel.tsx:202` `TmMatchView` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-066 | TM替换或插入当前未保存草稿 | `TmMatchPanel.tsx:68` `applyTmMatchToEditor` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-067 | 查看术语匹配详细信息并插入草稿 | `TermMatchPanel.tsx:236` `TermMatchView`<br>`TermMatchPanel.tsx:83` `applyTermMatchToEditor` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-068 | 搜索分页TM/TB及五态术语筛选 | `ReferenceManager.tsx:56` `ReferenceManager` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-069 | 导入TMX/CSV或TBX/CSV候选，确认/取消写库 | `ReferenceManager.tsx:135` `importReference`<br>`ReferenceManager.tsx:390` `ReferenceCandidateConfirmPanel` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-070 | 启用/禁用TM来源及整数优先级 | `ReferenceManager.tsx:217` `updateTmSource` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-071 | 新增/编辑/取消术语和删除参考记录 | `ReferenceManager.tsx:483` `TermEditForm` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-072 | 冲突术语保留一个有效译法 | `ReferenceManager.tsx:259` `keepConflictTerm`<br>`ReferenceManager.tsx:33` `buildTermConflictResolution` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-073 | 让Agent整理批次术语并先给用户确认 | `ReferenceManager.tsx:293` `organizeTermsWithAgent`<br>`project-agent-task.ts:36` `sendProjectAgentTask` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-074 | 预览已导入参考原件和待确认候选原件 | `ReferenceManager.tsx:309` `openImportSource`<br>`LinguistPreviewBody.tsx:43` `ReferenceImportPreview` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-065** 默认：matchedSource/Target同时显示，provenanceCount/variantCount可见。 空态：未选/加载/无匹配分别说明。 异常：只读结果不自动改Target。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：active segment ID匹配才展示，资料mutation刷新。

**LA-UI-066** 默认：插入使用textarea最后选区，返回编辑焦点。 空态：未开当前editor给禁用理由。 异常：保护拒绝有提示，不报已应用。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：project/segment绑定、归档/锁/IME/saving保护。

**LA-UI-067** 默认：状态/match kind/case/冲突/备注可见，调用当前editor.insert。 空态：未选段/无匹配/无editor区分。 异常：Tag保护拒绝不改稿。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：只操作匹配当前project/segment，IME/saving禁写。 补充：本轮已补齐完整匹配详情与当前草稿插入，合成交互检查通过，待真实rc.2安装验收。

**LA-UI-068** 默认：TM/terms/patterns分类，required/preferred/forbidden/allowed/deprecated。 空态：无记录显示空态。 异常：读取失败toast。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：tab/query/status变offset归0。

**LA-UI-069** 默认：列候选数、语言对、警告、原件预览。 空态：取消丢弃候选不写库。 异常：失败保留可重试状态。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：有candidate禁新导入，confirm带candidate/hash。

**LA-UI-070** 默认：控制匹配源，不删除原件。 空态：无source不显示。 异常：非整数即时错误。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：Host更新后刷新。

**LA-UI-071** 默认：term/translation必填；状态、caseSensitive、module/category/note。 空态：空必填禁保存。 异常：失败留表单。 键盘：表单提交。 并发：归档禁写；adding/editing/busy互斥。

**LA-UI-072** 默认：required/preferred多译法冲突；其他改allowed，绝不删除。 空态：无冲突不显示警告。 异常：失败报告。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：termBusy串行，重读冲突。

**LA-UI-073** 默认：复用完整项目Agent；固定任务不擅自写库。 空态：无session走ensure。 异常：发送失败与范围过大明确。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：发送时冻结scope，sending防重复。

**LA-UI-074** 默认：只读原件与数据库条目独立。 空态：会话未就绪提示。 异常：本项无另立错误协议；依据所属组件的请求错误及Host拒绝处理。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：同名不同identity分tab，同identity复用。

### 句式、风格与角色

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-075 | 导入句式CSV并按状态查看样例 | `SentencePatternsPanel.tsx:46` `importPatterns` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-076 | 确认/驳回/退回待审句式及删除 | `SentencePatternsPanel.tsx:67` `transitionTo`<br>`sentence-patterns-utils.ts:32` `SENTENCE_PATTERN_TRANSITIONS` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-077 | 按分组查看、添加/删除风格规则和正反例 | `StyleGuidePanel.tsx:12` `StyleGuidePanel`<br>`style-guide-utils.ts:24` `groupStyleGuideRules` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-078 | 新增/编辑/取消/删除Voice Profile | `VoiceProfilePanel.tsx:58` `saveProfile`<br>`voice-profile-utils.ts:9` `parseMarkerList` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-079 | 让Agent从已确认台词总结角色声音 | `VoiceProfilePanel.tsx:115` `summarizeWithAgent` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-080 | 把已确认句段设为角色译例 | `ApprovedExemplarDialog.tsx:119` `ApprovedExemplarDialog`<br>`SegmentGrid.tsx:250` `onAddApprovedExemplar` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-075** 默认：pending/confirmed/rejected计数，非自动覆盖Target。 空态：无句式空态。 异常：导入失败/警告明确。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：busy/归档禁导入。

**LA-UI-076** 默认：三态人工互转，禁止原地自转。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：失败不改状态。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：busy/归档禁操作。

**LA-UI-077** 默认：group可空归未分组，ruleText必填。 空态：无规则空态。 异常：内容验证错误明确。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：busy/归档禁写。

**LA-UI-078** 默认：speaker必填≤1000，textType/register/person/notes/toneMarkers/taboos；中英文逗号顿号去重。 空态：无角色空态。 异常：失败保留真实状态。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：busy/归档禁写。

**LA-UI-079** 默认：必须引Segment依据，缺speaker不猜，修改前确认。 空态：无已确认台词不伪造voice。 异常：发送失败/超范围分别提示。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：发送冻结scope并禁重复。

**LA-UI-080** 默认：Host读权威Source/Target；speaker/textType预填，note可空。 空态：未确认等条件不可设例。 异常：失败留Dialog。 键盘：Dialog与表单键盘。 并发：saving防重复，不信任renderer正文。

### Context与证据

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-081 | 导入Context文档/图片并查看可阅读性 | `ContextDocsPanel.tsx:65` `importDoc` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`PreviewView.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-082 | 预览原件、编辑/清备注、删除Context Doc | `ContextDocsPanel.tsx:89` `saveNote`<br>`ContextDocsPanel.tsx:117` `previewDoc` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`PreviewView.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-083 | 关联/解除句段文档图片与缩略图预览 | `LinkedContextImages.tsx:19` `LinkedContextImages` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`PreviewView.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-084 | 看句段上下文、备注、Style/Voice/译例/Context/TM摘要 | `ContextEvidencePanel.tsx:202` `ContextEvidenceView` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`PreviewView.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-085 | 从建议证据引用打开原始来源或术语 | `ContextEvidencePanel.tsx:48` `evidenceProvenance` | `Panels.tsx`<br>`CatWorkbench.tsx`<br>`PreviewView.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-081** 默认：文件类型、抽取长度、note；可阅读/无抽取/旧不可读DOCX分别标。 空态：无文档空态。 异常：不可读提示删后重导，不假装读过。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：refresh gate阻旧列表盖新导入。

**LA-UI-082** 默认：note空即清除；归档仍可只读预览。 空态：无note显示缺省说明。 异常：失败可见，session未就绪提示。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：归档禁备注/删除，mutation刷新。

**LA-UI-083** 默认：从项目已有Context Doc选择；Agent经cat_read_context_doc查看。 空态：无关联与无候选不同，后者提示先导入。 异常：读取/关联/解除失败明确。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：busyDocId防同doc重入；segment切换不能串关联。

**LA-UI-084** 默认：规则适用性需实际Source判断，不自动宣称已审。 空态：每来源独立empty；未选段先选择。 异常：加载失败不当无资料。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：project/segment隔离，mutation按资料类型刷新。

**LA-UI-085** 默认：按ref类别定位，保留原引用身份。 空态：无pending与无证据区分。 异常：未知ref不虚构来源。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：当前段切换清旧来源。

### 预览

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-086 | 分页阅读批次语义Source/Target/状态 | `LinguistPreviewBody.tsx:39` `BatchPreview`<br>`linguist-preview-open.ts:25` `useOpenLinguistPreview` | `BatchPreview.tsx`<br>`PreviewView.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-087 | 原始文件/语义概览切换与文本Markdown图像呈现 | `LinguistPreviewBody.tsx:152` `LinguistAssetPreviewContent`<br>`LinguistPreviewBody.tsx:415` `BatchRawPreview` | `BatchPreview.tsx`<br>`PreviewView.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-086** 默认：保留tag形态、snapshot摘要。 空态：无片段说明。 异常：本页缺tag仅本页检查，不是完整QA。 键盘：上一页/下一页。 并发：受管身份区分同名文件，同对象复用tab，不抢中心会话。

**LA-UI-087** 默认：只读；HTML清理；超200000字符明确截断。 空态：未知格式说明。 异常：错误可重试，不执行原件脚本。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

### 交付

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-088 | 选择批次、仅预检或验证并导出 | `PrepareDeliveryPanel.tsx:23` `PrepareDeliveryPanel` | `Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-089 | 查看阶段/必需证据覆盖、缺口及回读比较 | `PrepareDeliveryPanel.tsx:6` `DeliveryResult` | `Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-090 | 通过预检后保存新交付副本 | `PrepareDeliveryPanel.tsx:78` `save` | `Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-091 | 显式确认按当前状态导出 | `PrepareDeliveryPanel.tsx:333` `按当前状态导出？` | `Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-092 | 复制PM审校报告 | `PrepareDeliveryPanel.tsx:126` `copyReport` | `Panels.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-088** 默认：核pending建议/QA/阶段/必需证据/格式回写与回读。 空态：无资产禁执行，初态说明两路径。 异常：归档只读，预检失败不可称ready。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：loading/saving互斥，不复用过期批次结果。

**LA-UI-089** 默认：required/presented/pending，stage runs，source/target/native status比对。 空态：无verification不开放正常交付保存。 异常：blocking/warning分开。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

**LA-UI-090** 默认：排他复制新名，不覆盖原件/已有文件/受管目录。 空态：取消不报失败。 异常：保存失败不宣称交付完成。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：Host核产物及revision。

**LA-UI-091** 默认：绕阶段/证据/开放QA门，但保留格式回读/hash/不可覆盖，标as-is。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：绝不标为预检通过。 键盘：确认Dialog可取消。 并发：saving防重复。

**LA-UI-092** 默认：使用真实preflight/report。 空态：无报告无伪文本。 异常：剪贴板失败明确。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

### 维护、设置与诊断

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-093 | 查看Quick Health | `ProjectMaintenanceSettings.tsx:109` `ProjectHealthSection` | `Panels.tsx`<br>`BackupRestorePreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-094 | 启动/取消全量完整性扫描，进度及脱敏报告导出 | `ProjectMaintenanceSettings.tsx:110` `FullIntegrityScrubSection`<br>`project-integrity-atoms.ts:1` `project-integrity-atoms` | `Panels.tsx`<br>`BackupRestorePreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-095 | 新建完整备份并刷新列表 | `ProjectBackupsSection.tsx:88` `handleBackup` | `Panels.tsx`<br>`BackupRestorePreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-096 | 恢复预览：完整性、schema、备份/当前摘要 | `ProjectBackupsSection.tsx:196` `RestorePreviewDialog` | `Panels.tsx`<br>`BackupRestorePreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-097 | 确认整体恢复并自动pre-restore备份 | `ProjectBackupsSection.tsx:251` `handleRestore` | `Panels.tsx`<br>`BackupRestorePreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-098 | 探测真实Prompt/Digest及fallback/裁减诊断 | `ProjectDiagnosticsSettings.tsx:36` `PromptStatusCard` | `Panels.tsx`<br>`BackupRestorePreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-099 | 先预览脱敏诊断包再显式导出 | `ProjectDiagnosticsSettings.tsx:300` `previewBundle`<br>`ProjectDiagnosticsSettings.tsx:323` `exportBundle` | `Panels.tsx`<br>`BackupRestorePreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-100 | 修改语言对并展示冻结原因 | `ProjectSettingsSheet.tsx:119` `ProjectLocaleSettings` | `Panels.tsx`<br>`BackupRestorePreview.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-101 | 设T/E/P、SDLXLIFF输出级别、QA场景 | `ProjectWorkflowSettings.tsx:27` `ProjectWorkflowSettings` | `Panels.tsx`<br>`BackupRestorePreview.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-093** 默认：仅metadata/schema/DB可开/最多20source抽样。 空态：loading与不可用区分。 异常：Quick通过不能充当全量完整性通过。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

**LA-UI-094** 默认：独立worker查source/blob/SQLite/references/events/job/run/export/sessionworkspace。 空态：未开始与完成可重扫。 异常：unavailable/failed/passed区分。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：任务ID/进度订阅，进行中禁重复start。

**LA-UI-095** 默认：DB/元数据/全部源文件；method/文件数/大小；归档允许。 空态：无备份解释范围。 异常：加载/创建失败明确。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：creating防重复。

**LA-UI-096** 默认：全文件SHA+DB校验；旧schema首次打开迁移说明。 空态：未知schema诚实显示。 异常：旧格式/坏校验不可恢复。 键盘：Dialog取消。 并发：preview卸载忽略迟到；restoring禁关闭。

**LA-UI-097** 默认：替换DB/元数据/源文件；旧状态可人工找回。 空态：归档禁止恢复。 异常：失败报告。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：Host校验权威；完成刷新summary。

**LA-UI-098** 默认：打开诊断后探测，显示构建链/版本/工具技能摘要。 空态：未探测不算通过。 异常：岗位文件fallback、Digest部分失败/失败/预算裁减各自说明。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：loading禁重入。

**LA-UI-099** 默认：默认无客户正文/文件名/绝对路径/key/隐藏推理，不自动上传。 空态：未预览禁导出。 异常：失败明确，成功带大小/hash。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：preview/export互斥。

**LA-UI-100** 默认：源UI归档或有批次冻结，Host另检查TM/TB。 空态：未变化不提交。 异常：PROJECT_LOCALE_CHANGE_BLOCKED需新项目。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：saving禁重复，project更新同步控件。

**LA-UI-101** 默认：Translated/ApprovedTranslation/ApprovedSignOff或随阶段；general/subtitle。 空态：缺覆写用随阶段。 异常：字幕降噪不放松数字/tag硬门。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：归档/saving禁写。

### Tag Profiles

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-102 | 扫描未知Tag形状、样例、候选 | `UnknownTagNotice.tsx:48` `UnknownTagNotice`<br>`TagProfilesPanel.tsx:109` `TagProfilesPanel` | `UnknownTagNotice.tsx`<br>`Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-103 | 让Agent识别Tag并给正则候选 | `UnknownTagNotice.tsx:124` `askAgent` | `UnknownTagNotice.tsx`<br>`Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-104 | 修改正则候选、验证保存、批准或拒绝 | `TagProfilesPanel.tsx:28` `CandidateRow` | `UnknownTagNotice.tsx`<br>`Panels.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-105 | 禁用/重启规则，忽略本轮提示 | `TagProfilesPanel.tsx:136` `toggleFamily`<br>`UnknownTagNotice.tsx:27` `unknownTagFingerprint` | `UnknownTagNotice.tsx`<br>`Panels.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-102** 默认：project revision/source摘要驱动；未批准仅软提示。 空态：已启用/候选/已忽略分别empty。 异常：扫描失败明确。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：scanning防重入。

**LA-UI-103** 默认：真实格式整理候选、误报说明理由；不得自动硬启用。 空态：无未知形状不提示。 异常：发送失败/超范围提示。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：sending和scope冻结。

**LA-UI-104** 默认：kind/例证可见，批准才进硬保护。 空态：未改pattern禁保存。 异常：Host拒无效正则。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：busy/归档禁写。

**LA-UI-105** 默认：提示fingerprint限定形状，新形状会重新提示；不是全局关闭扫描。 空态：无规则空态。 异常：更新失败明确。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：按项目隔离。

### 运行与撤销

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-106 | 最近CAT运行、Job进度、建议/文件计数 | `ProjectRunSummary.tsx:16` `ProjectRunSummary` | `RunPanel.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-107 | 撤销最近CAT变更并看部分失败原因 | `ProjectRunSummary.tsx:53` `undoLatestProjectRun`<br>`ProjectRunSummary.tsx:96` `describeRunUndoRefusal` | `RunPanel.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-106** 默认：pending/running/paused/completed/failed/cancelled分开。 空态：暂无CAT运行明确。 异常：读取失败不伪零。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：refreshSequence和merge防新结果被旧请求覆盖。

**LA-UI-107** 默认：仅仍未变化且可结构化撤销项；文件需FileRewind，外部副作用仅记录。 空态：无记录/已处理禁重复。 异常：后续revision/终态/不存在/不支持各自说明。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：绝不覆盖后续工作，undoing防重入。

### 上下文与普通聊天

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-108 | 显示项目/批次/引用/选择chip并可清引用选择 | `ComposerContextChips.tsx:10` `ComposerContextChips`<br>`project-composer-context.ts:19` `buildProjectComposerContextChips` | `ComposerContextChips.tsx`<br>`composer-reference.ts`<br>`index.ts`<br>`CatToolResult.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-109 | 普通Composer发送/queue/steer同步冻结CAT上下文 | `agent-host-extension.tsx:52` `captureTurnContext`<br>`AgentView.tsx:2061` `const linguistContext = captureTurnContext()` | `ComposerContextChips.tsx`<br>`composer-reference.ts`<br>`index.ts`<br>`CatToolResult.tsx`<br>`known-sdk-boundary` |
| LA-UI-110 | 从领域按钮发送完整项目Agent任务 | `project-agent-task.ts:36` `sendProjectAgentTask` | `ComposerContextChips.tsx`<br>`composer-reference.ts`<br>`index.ts`<br>`CatToolResult.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-111 | 委派进程状态与专业覆盖分开展示 | `delegation-result.tsx:104` `DelegationSummaryRow` | `ComposerContextChips.tsx`<br>`composer-reference.ts`<br>`index.ts`<br>`CatToolResult.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-108** 默认：项目chip保留，窄空间摘要；普通焦点不算引用。 空态：非LA不渲染。 异常：跨项目引用不可见。 键盘：clear独立aria-label。 并发：UI和发送snapshot同project atom。

**LA-UI-109** 默认：默认project/batch，显式引用才带activeSegment；selected最多100并提示。 空态：非LA无context。 异常：超限不可假称全选区已附带。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：点击时深冻结，队列沿原scope，真实RPC Host再准入。 补充：已知固定rc1仅显式原生引用可用，默认自动附scope缺公开同步/真实RPC/await准入hook；最新DSH须重核，不能用抢IME/leading-slash的自动塞chip替代。

**LA-UI-110** 默认：复用原生Agent，不建第二聊天界面。 空态：必要时ensure会话。 异常：超过选择上限拒发领域任务，非静默截断。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：冻结后发送，异步导航不抢新会话。

**LA-UI-111** 默认：completed叫已结束；CAT stage complete另有冻结scope审计。 空态：普通非LA委派原生渲染。 异常：未知outcome不伪造完成。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：current revision，未修改也需真实决策。

### 原生宿主能力

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-112 | LA会话保留原生附件/Files/预览/slash/模型/权限/queue-steer | `contracts.ts:26` `DEFAULT_AGENT_HOST_CAPABILITIES`<br>`agent-attachment-gate.ts:16` `resolveAgentAttachmentSaveGate` | `ProjectCapabilities.tsx`<br>`index.ts`<br>`host-native-adaptation-required` |
| LA-UI-113 | 真实Skills摘要与管理入口 | `ProjectAgentCapabilitiesSection.tsx:24` `describeCapabilities` | `ProjectCapabilities.tsx`<br>`index.ts`<br>`host-native-adaptation-required` |
| LA-UI-114 | MCP管理与真实启用摘要 | `ProjectAgentCapabilitiesSection.tsx:68` `openSkillsView` | `ProjectCapabilities.tsx`<br>`index.ts`<br>`host-native-adaptation-required` |
| LA-UI-115 | 项目指令文件与Files原生入口 | `ProjectAgentCapabilitiesSection.tsx:84` `openFilesPanel` | `ProjectCapabilities.tsx`<br>`index.ts`<br>`host-native-adaptation-required` |
| LA-UI-116 | 原Proma独立Memory窗口 | `ProjectAgentCapabilitiesSection.tsx:76` `openMemoryWindow`<br>`WorkspaceMemoryWindowApp.tsx:1` `WorkspaceMemoryWindowApp` | `ProjectCapabilities.tsx`<br>`index.ts`<br>`host-specific-excluded-from-la-domain` |

**LA-UI-112** 默认：宿主全能力，按session授权附件落盘。 空态：普通会话原生路径。 异常：归档/缺失写入Host fail closed。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：不复制权限/模型路由/聊天/事件循环。

**LA-UI-113** 默认：源enabled count来自WorkspaceCapabilities，不是技能文件数。 空态：workspace未建提示首个会话。 异常：失败不能伪造0启用。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：目标用DSH callable Skills真值并原生打开SKILL.md。

**LA-UI-114** 默认：源开agent-skills mcp tab，服务enabled count。 空态：无workspace不展示管理。 异常：DSH未公开分类count不可猜插件名。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：用DSH Plugins管理，别复制MCP管理器。

**LA-UI-115** 默认：源AGENTS大小>0标配置，指令管理去宿主memory tab。 空态：无session入口需明确，不为展示隐建会话。 异常：默认发现路径不证明composition全部实际加载。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：DSH Files只读不证明手工编辑等价。

**LA-UI-116** 默认：openWorkspaceMemoryWindow(workspaceSlug)，不是LA结构化语言资产。 空态：无workspace不可开。 异常：打开失败toast。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：DSH宿主替换，不重建PromaMemory后端/窗口。

### 非CAT与浏览器

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-117 | 普通附件/Files承载非CAT原件与工作稿 | `agent-attachment-gate.ts:16` `resolveAgentAttachmentSaveGate`<br>`SidePanel.tsx:1551` `paneTab` | `WorkingCopyPage.tsx`<br>`index.ts`<br>`host-native-adaptation-required` |
| LA-UI-118 | 浏览器地址、后退/前进/刷新/外部打开 | `BrowserPanel.tsx:27` `BrowserPanel`<br>`BrowserSlot.tsx:7` `BrowserSlot` | `WorkingCopyPage.tsx`<br>`index.ts`<br>`host-native-adaptation-required` |
| LA-UI-119 | 停止浏览器关联后台自动任务/委派 | `BrowserPanel.tsx:115` `stopBackgroundRun` | `WorkingCopyPage.tsx`<br>`index.ts`<br>`host-native-adaptation-required` |

**LA-UI-117** 默认：源renderer无独立working-copy页；业务来自领域工具+原生文件表面。 空态：宿主Files空态。 异常：原件/工作稿身份不混；下载字节不等于专业完成。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：Target WorkingCopyPage是增强入口；领域完整性另见Host工具审计。

**LA-UI-118** 默认：源Proma受管browser，只controller active tab导航。 空态：无URL/不可前退相应禁用。 异常：风险告知/登录/授权不得绕过。 键盘：地址form提交。 并发：正式控制迁BrowserSkill，不搬PromaWebContentsView；DSH内置浏览器不自动证明控制链过关。

**LA-UI-119** 默认：按executionSource和真实绑定展示停止。 空态：没有后台run不显示停止。 异常：失败可见。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：不能误停无关session。

### 自动任务

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-120 | 任务列表分启用/暂停/结束，查看下次时间和编辑 | `AutomationsListView.tsx:76` `AutomationsListView` | `RunPanel.tsx`<br>`ScheduleManager.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-121 | 新建/重命名/编辑任务描述并保存 | `AutomationFormView.tsx:292` `AutomationFormView` | `RunPanel.tsx`<br>`ScheduleManager.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-122 | 捕获项目/批次/selected或移除LA绑定 | `AutomationFormView.tsx:520` `captureScope`<br>`automation.ts:20` `AutomationLinguistCapture` | `RunPanel.tsx`<br>`ScheduleManager.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-123 | 配置interval/daily/weekly/monthly/once与时段星期 | `AutomationFormView.tsx:788` `运行频率`<br>`automation-schedule.ts:1` `automation-schedule` | `RunPanel.tsx`<br>`ScheduleManager.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-124 | 运行上限和会话复用策略 | `AutomationFormView.tsx:1062` `运行次数上限`<br>`automation.ts:141` `sessionMode` | `RunPanel.tsx`<br>`ScheduleManager.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-125 | 选择模型项目、启停/删除/立即运行 | `AutomationsListView.tsx:163` `handleRunNow`<br>`AutomationFormView.tsx:537` `handleRunNow` | `RunPanel.tsx`<br>`ScheduleManager.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-126 | 历史记录打开真实执行会话 | `AutomationFormView.tsx:565` `handleOpenRunSession` | `RunPanel.tsx`<br>`ScheduleManager.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-127 | 选择既有飞书目标和通知条件 | `AutomationFormView.tsx:533` `updateFeishuNotification` | `RunPanel.tsx`<br>`ScheduleManager.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-120** 默认：调度属宿主，LA附加专业绑定与证据。 空态：空态新建入口。 异常：加载失败不能当无任务。 键盘：行Enter/Space进入。 并发：使用DSH原生Schedule，不克隆Proma壳。

**LA-UI-121** 默认：源自动保存有未保存/中/成功/失败；模型项目可缺但不可启用。 空态：空描述引导。 异常：缺名称/描述/模型/项目明确。 键盘：名称Enter确认、Esc取消。 并发：保存签名/队列和关闭flush；目标明确保存也须防丢稿。

**LA-UI-122** 默认：同Workspace LA会话；role/project/scope/capturedAt冻结。 空态：无绑定明确标。 异常：selected>100拒绝，提示改全批或缩范围。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：Host从source session核验，不沿漂移UI。

**LA-UI-123** 默认：源monthly短月落最后一天，interval支持时段/工作日/周末/自定义。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：频率变化清不相干字段。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：最新DSH须确认等价表达；有cron输入不证明短月语义等价。

**LA-UI-124** 默认：once1次；成功/失败都计真实执行；源UI隐藏sessionMode默认daily同日复用跨日新建。 空态：maxRuns空不限。 异常：不可拿delivery count冒充执行次数。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：达到上限停原生提醒；reuse是源schema/工具能力，非源可见控件。

**LA-UI-125** 默认：字段完整才可启用；删除确认。 空态：未配置提示补全。 异常：失败真实反馈，开始不等于完成。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：先保存最新草稿；owner/source/child身份不得错判。

**LA-UI-126** 默认：success标签执行结束；error/skipped展示原因。 空态：无sessionId禁跳；已删明确提示。 异常：不能据执行结束推专业完成。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：真session ID不替换为当前会话。

**LA-UI-127** 默认：always/success/error；目标来自已有绑定。 空态：无绑定提示先飞书发消息。 异常：通知失败不回写成功。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：冻结目标，配置变更需重新保存；不再造渠道管理。

### 旧数据迁移

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-128 | 原生选择旧根目录只读扫描 | `MigrationWizard.tsx:98` `handlePickAndScan` | `LegacyMigrationPanel.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-129 | 预览各项目批次/段/TM/TB/聊天并勾选导入 | `MigrationWizard.tsx:208` `PreviewStep`<br>`MigrationWizard.tsx:211` `SelectStep` | `LegacyMigrationPanel.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-130 | 显示导入/验证进度并禁运行中退出 | `MigrationWizard.tsx:228` `RunningStep`<br>`migration-wizard-utils.ts:1` `migration-wizard-utils` | `LegacyMigrationPanel.tsx`<br>`entry-mapped-parity-unverified` |
| LA-UI-131 | 逐项目核迁移验证/隔离/重复跳过/回滚提示 | `MigrationWizard.tsx:694` `ReportRowDetail` | `LegacyMigrationPanel.tsx`<br>`entry-mapped-parity-unverified` |

**LA-UI-128** 默认：含data的副本，旧聊天归档只读转录。 空态：无项目不可下一步。 异常：扫描失败重试，不改旧源。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：scanning互斥。

**LA-UI-129** 默认：无清单默认隔离零写；显式勾选才孤儿抢救。 空态：未选择禁开始。 异常：救援从载荷推语言对/目录名，不静默修复。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

**LA-UI-130** 默认：phase/index/total/项目真实进度。 空态：无progress显示准备。 异常：失败不称全部成功。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：订阅task progress，完成才退出。

**LA-UI-131** 默认：transcript重渲染/字节、DB只读重开、资产/引用/QA计数。 空态：隔离也出报告。 异常：未通过展开检查项，不能假完成。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：already-exists不写；不覆盖旧目标。

### 非当前接线遗留

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-132 | ProjectCard旧卡片组件当前不可达 | `ProjectCard.tsx:2` `ProjectCard`<br>`ProjectsView.tsx:17` `ProjectsView` | 未建立当前入口<br>`source-unwired-not-current-requirement` |
| LA-UI-133 | DeliverablesSection历史交付物组件当前不可达 | `DeliverablesSection.tsx:2` `DeliverablesSection` | 未建立当前入口<br>`source-unwired-not-current-requirement` |

**LA-UI-132** 默认：全renderer引用只有定义，实际项目管理移共享侧栏。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：文件存在不能当当前可用功能。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

**LA-UI-133** 默认：全renderer引用只有定义；实际交付由PrepareDeliveryPanel。 空态：无独立空态，沿用所属面板的空态与选择条件。 异常：不得把未接线历史组件标成源现有界面要求。 键盘：未发现专用快捷键；沿用按钮/表单控件的原生键盘操作。 并发：本项无独立并发协议；不代表可忽略Host的身份/revision校验。

### 导航与身份补充

| ID | 用户操作 | 源依据 | 目标已知入口／状态 |
| --- | --- | --- | --- |
| LA-UI-134 | 跨Agent/Chat访问保留MRU及未保存宿主表单确认 | `open-linguist-session.test.ts:34` `跨 Agent/Chat` | `index.ts`<br>`host-native-adaptation-required` |
| LA-UI-135 | 共享侧栏隔离普通会话/置顶/自动任务并保留缺失项目历史 | `linguist-sidebar-data.ts:13` `buildLinguistSidebarGroups` | `index.ts`<br>`host-native-adaptation-required` |
| LA-UI-136 | 宿主Workspace标明Linguist项目身份但不生成第二份项目 | `LinguistWorkspaceBadge.tsx:14` `buildLinguistWorkspaceMap` | `index.ts`<br>`host-native-adaptation-required` |
| LA-UI-137 | memoQ通用回退和Phrase专用结构能力明示 | `format-labels.ts:22` `GENERIC_XLIFF_FALLBACK_NOTICE` | `index.ts`<br>`entry-mapped-parity-unverified` |

**LA-UI-134** 默认：Ctrl+Tab回上次访问而非最近更新；未保存渠道表单只登记待确认导航；右栏展开/宽度/预览按会话恢复。 空态：身份或目标不存在时不猜测替代实体。 异常：以源导航/Host拒绝处理，不宣称已完成。 键盘：Ctrl+Tab的MRU行为由宿主负责；其余原生控件。 并发：过期导航不能抢当前会话或清无关状态。

**LA-UI-135** 默认：项目分组仅提供领域身份，侧栏滚动/归档/展开属于宿主；不可把领域projectId用于Workspace mutation。 空态：身份或目标不存在时不猜测替代实体。 异常：以源导航/Host拒绝处理，不宣称已完成。 键盘：Ctrl+Tab的MRU行为由宿主负责；其余原生控件。 并发：过期导航不能抢当前会话或清无关状态。

**LA-UI-136** 默认：Proma workspace到LA项目共享映射；列表未ready不显示徽标而不阻断原生侧栏。 空态：身份或目标不存在时不猜测替代实体。 异常：以源导航/Host拒绝处理，不宣称已完成。 键盘：Ctrl+Tab的MRU行为由宿主负责；其余原生控件。 并发：过期导航不能抢当前会话或清无关状态。

**LA-UI-137** 默认：mqxliff若落通用XLIFF必须警告专有结构未完全验证；专用adapter合成tag测试与真实样本资格分开；Phrase split/master及Tag Mapping能力如实显示。 空态：身份或目标不存在时不猜测替代实体。 异常：以源导航/Host拒绝处理，不宣称已完成。 键盘：Ctrl+Tab的MRU行为由宿主负责；其余原生控件。 并发：过期导航不能抢当前会话或清无关状态。

## 覆盖索引与未验证事项


- JSON coverage逐文件保存SHA-256与操作ID；82个界定目录文件无未归类项。文件数只用于确认扫描边界。
- 直接集成检查限LA seams，不声称所有Proma通用设置都已穷举。
- 源浏览器交互测试揭示草稿/Undo/延迟保存/导航竞态/当前批次作用域；引用测试是行为依据，本轮未执行。
- Host领域算法、真实Provider内容、BrowserSkill扩展链、冷启、安装态完整工作台、平台回传需独立证据。
- 旧schedule自定义事件缺ignorable的冷读诊断保留；本轮不继续旧包验收，不修写真实旧日志。

| 源文件 | 审计角色 | 对应操作 |
| --- | --- | --- |
| `apps/electron/src/renderer/features/linguist/composer/ComposerContextChips.tsx` | behavior-source | LA-UI-108 |
| `apps/electron/src/renderer/features/linguist/migration/MigrationWizard.tsx` | behavior-source | LA-UI-128, LA-UI-129, LA-UI-129, LA-UI-130, LA-UI-131 |
| `apps/electron/src/renderer/features/linguist/migration/migration-wizard-utils.ts` | behavior-source | LA-UI-130 |
| `apps/electron/src/renderer/features/linguist/projects/ApprovedExemplarDialog.tsx` | behavior-source | LA-UI-080 |
| `apps/electron/src/renderer/features/linguist/projects/AssetNavigator.tsx` | behavior-source | LA-UI-018 |
| `apps/electron/src/renderer/features/linguist/projects/CatToolResultNavigationInitializer.tsx` | behavior-source | LA-UI-024 |
| `apps/electron/src/renderer/features/linguist/projects/ContextDocsPanel.tsx` | behavior-source | LA-UI-081, LA-UI-082, LA-UI-082 |
| `apps/electron/src/renderer/features/linguist/projects/ContextEvidencePanel.tsx` | behavior-source | LA-UI-084, LA-UI-085 |
| `apps/electron/src/renderer/features/linguist/projects/DeliverablesSection.tsx` | behavior-source | LA-UI-133 |
| `apps/electron/src/renderer/features/linguist/projects/FormatQualificationCard.tsx` | behavior-source | LA-UI-033 |
| `apps/electron/src/renderer/features/linguist/projects/LinguistBottomDock.tsx` | behavior-source | LA-UI-021 |
| `apps/electron/src/renderer/features/linguist/projects/LinguistPreviewBody.tsx` | behavior-source | LA-UI-074, LA-UI-086, LA-UI-087, LA-UI-087 |
| `apps/electron/src/renderer/features/linguist/projects/LinguistWorkbenchShell.tsx` | behavior-source | LA-UI-016, LA-UI-017, LA-UI-020 |
| `apps/electron/src/renderer/features/linguist/projects/LinguistWorkspaceBadge.tsx` | behavior-source | LA-UI-136 |
| `apps/electron/src/renderer/features/linguist/projects/LinkedContextImages.tsx` | behavior-source | LA-UI-083 |
| `apps/electron/src/renderer/features/linguist/projects/LocalizationProjectWorkbench.tsx` | behavior-source | LA-UI-023 |
| `apps/electron/src/renderer/features/linguist/projects/PrepareDeliveryPanel.tsx` | behavior-source | LA-UI-088, LA-UI-089, LA-UI-090, LA-UI-091, LA-UI-092 |
| `apps/electron/src/renderer/features/linguist/projects/ProjectAgentCapabilitiesSection.tsx` | behavior-source | LA-UI-113, LA-UI-114, LA-UI-115, LA-UI-116 |
| `apps/electron/src/renderer/features/linguist/projects/ProjectArchiveAction.tsx` | behavior-source | LA-UI-008 |
| `apps/electron/src/renderer/features/linguist/projects/ProjectAssetsSection.tsx` | behavior-source | LA-UI-025, LA-UI-026, LA-UI-027, LA-UI-028, LA-UI-029, LA-UI-030, LA-UI-031, LA-UI-032 |
| `apps/electron/src/renderer/features/linguist/projects/ProjectBackupsSection.tsx` | behavior-source | LA-UI-095, LA-UI-096, LA-UI-097 |
| `apps/electron/src/renderer/features/linguist/projects/ProjectCard.tsx` | behavior-source | LA-UI-132 |
| `apps/electron/src/renderer/features/linguist/projects/ProjectCreateDialog.tsx` | behavior-source | LA-UI-002, LA-UI-004 |
| `apps/electron/src/renderer/features/linguist/projects/ProjectDiagnosticsSettings.tsx` | behavior-source | LA-UI-098, LA-UI-099, LA-UI-099 |
| `apps/electron/src/renderer/features/linguist/projects/ProjectLocaleSelect.tsx` | behavior-source | LA-UI-003 |
| `apps/electron/src/renderer/features/linguist/projects/ProjectMaintenanceSettings.tsx` | behavior-source | LA-UI-009, LA-UI-093, LA-UI-094 |
| `apps/electron/src/renderer/features/linguist/projects/ProjectRunSummary.tsx` | behavior-source | LA-UI-106, LA-UI-107, LA-UI-107 |
| `apps/electron/src/renderer/features/linguist/projects/ProjectSettingsSheet.tsx` | behavior-source | LA-UI-022, LA-UI-056, LA-UI-064, LA-UI-100 |
| `apps/electron/src/renderer/features/linguist/projects/ProjectWorkflowSettings.tsx` | behavior-source | LA-UI-101 |
| `apps/electron/src/renderer/features/linguist/projects/ProjectsView.tsx` | behavior-source | LA-UI-001, LA-UI-132 |
| `apps/electron/src/renderer/features/linguist/projects/ProposalInbox.tsx` | behavior-source | LA-UI-057, LA-UI-058, LA-UI-059, LA-UI-060, LA-UI-062, LA-UI-063 |
| `apps/electron/src/renderer/features/linguist/projects/QaFindingsPanel.tsx` | behavior-source | LA-UI-050, LA-UI-050, LA-UI-051, LA-UI-052, LA-UI-053, LA-UI-054, LA-UI-054, LA-UI-055 |
| `apps/electron/src/renderer/features/linguist/projects/ReferenceManager.tsx` | behavior-source | LA-UI-068, LA-UI-069, LA-UI-069, LA-UI-070, LA-UI-071, LA-UI-072, LA-UI-072, LA-UI-073, LA-UI-074 |
| `apps/electron/src/renderer/features/linguist/projects/SegmentEditor.tsx` | behavior-source | LA-UI-035, LA-UI-037, LA-UI-038, LA-UI-039, LA-UI-040, LA-UI-040, LA-UI-041, LA-UI-061 |
| `apps/electron/src/renderer/features/linguist/projects/SegmentGrid.tsx` | behavior-source | LA-UI-034, LA-UI-034, LA-UI-036, LA-UI-047, LA-UI-048, LA-UI-049, LA-UI-080 |
| `apps/electron/src/renderer/features/linguist/projects/SentencePatternsPanel.tsx` | behavior-source | LA-UI-075, LA-UI-076 |
| `apps/electron/src/renderer/features/linguist/projects/StyleGuidePanel.tsx` | behavior-source | LA-UI-077 |
| `apps/electron/src/renderer/features/linguist/projects/TagProfilesPanel.tsx` | behavior-source | LA-UI-102, LA-UI-104, LA-UI-105 |
| `apps/electron/src/renderer/features/linguist/projects/TargetEditor.tsx` | behavior-source | LA-UI-039, LA-UI-042, LA-UI-044, LA-UI-045, LA-UI-045, LA-UI-046, LA-UI-047 |
| `apps/electron/src/renderer/features/linguist/projects/TermMatchPanel.tsx` | behavior-source | LA-UI-067, LA-UI-067 |
| `apps/electron/src/renderer/features/linguist/projects/TmMatchPanel.tsx` | behavior-source | LA-UI-065, LA-UI-066 |
| `apps/electron/src/renderer/features/linguist/projects/UnknownTagNotice.tsx` | behavior-source | LA-UI-102, LA-UI-103, LA-UI-105 |
| `apps/electron/src/renderer/features/linguist/projects/VoiceProfilePanel.tsx` | behavior-source | LA-UI-078, LA-UI-079 |
| `apps/electron/src/renderer/features/linguist/projects/cat-edit-utils.ts` | behavior-source | LA-UI-042 |
| `apps/electron/src/renderer/features/linguist/projects/cat-editor.browser.test.ts` | behavior-source | LA-UI-043 |
| `apps/electron/src/renderer/features/linguist/projects/cat-virtual-utils.ts` | behavior-source | LA-UI-036 |
| `apps/electron/src/renderer/features/linguist/projects/cat-workspace-atoms.ts` | behavior-source | LA-UI-019, LA-UI-020, LA-UI-038, LA-UI-043, LA-UI-049 |
| `apps/electron/src/renderer/features/linguist/projects/context-docs-refresh.ts` | state-or-presentation-support | LA-UI-081, LA-UI-082, LA-UI-083, LA-UI-084, LA-UI-085 |
| `apps/electron/src/renderer/features/linguist/projects/format-labels.ts` | behavior-source | LA-UI-137 |
| `apps/electron/src/renderer/features/linguist/projects/linguist-preview-open.ts` | behavior-source | LA-UI-086 |
| `apps/electron/src/renderer/features/linguist/projects/linguist-preview-utils.ts` | state-or-presentation-support | LA-UI-086, LA-UI-087 |
| `apps/electron/src/renderer/features/linguist/projects/open-linguist-session.test.ts` | behavior-source | LA-UI-134 |
| `apps/electron/src/renderer/features/linguist/projects/open-linguist-session.ts` | behavior-source | LA-UI-005 |
| `apps/electron/src/renderer/features/linguist/projects/open-localization-project.ts` | behavior-source | LA-UI-005 |
| `apps/electron/src/renderer/features/linguist/projects/project-agent-session.test.ts` | test-support | LA-UI-001, LA-UI-002, LA-UI-003, LA-UI-004, LA-UI-005, LA-UI-006, LA-UI-007, LA-UI-008, LA-UI-009, LA-UI-010, LA-UI-011, LA-UI-012, LA-UI-013, LA-UI-014, LA-UI-015, LA-UI-016, LA-UI-017, LA-UI-018, LA-UI-019, LA-UI-020, LA-UI-021, LA-UI-022, LA-UI-023, LA-UI-024 |
| `apps/electron/src/renderer/features/linguist/projects/project-agent-session.ts` | behavior-source | LA-UI-010, LA-UI-011 |
| `apps/electron/src/renderer/features/linguist/projects/project-agent-task.ts` | behavior-source | LA-UI-073, LA-UI-110 |
| `apps/electron/src/renderer/features/linguist/projects/project-composer-context.ts` | behavior-source | LA-UI-108 |
| `apps/electron/src/renderer/features/linguist/projects/project-integrity-atoms.ts` | behavior-source | LA-UI-094 |
| `apps/electron/src/renderer/features/linguist/projects/project-list-atoms.ts` | state-or-presentation-support | LA-UI-001, LA-UI-002, LA-UI-003, LA-UI-004, LA-UI-005, LA-UI-006, LA-UI-007, LA-UI-008, LA-UI-009, LA-UI-010, LA-UI-011 |
| `apps/electron/src/renderer/features/linguist/projects/project-mutation-atoms.ts` | behavior-source | LA-UI-023 |
| `apps/electron/src/renderer/features/linguist/projects/project-summary-atoms.ts` | state-or-presentation-support | LA-UI-016, LA-UI-017, LA-UI-018, LA-UI-019, LA-UI-020, LA-UI-021, LA-UI-022, LA-UI-023, LA-UI-024 |
| `apps/electron/src/renderer/features/linguist/projects/project-tab-navigation.test.ts` | test-support | LA-UI-001, LA-UI-002, LA-UI-003, LA-UI-004, LA-UI-005, LA-UI-006, LA-UI-007, LA-UI-008, LA-UI-009, LA-UI-010, LA-UI-011, LA-UI-012, LA-UI-013, LA-UI-014, LA-UI-015, LA-UI-016, LA-UI-017, LA-UI-018, LA-UI-019, LA-UI-020, LA-UI-021, LA-UI-022, LA-UI-023, LA-UI-024 |
| `apps/electron/src/renderer/features/linguist/projects/project-utils.ts` | behavior-source | LA-UI-003, LA-UI-031 |
| `apps/electron/src/renderer/features/linguist/projects/projects-atoms.ts` | behavior-source | LA-UI-002, LA-UI-004, LA-UI-008 |
| `apps/electron/src/renderer/features/linguist/projects/proposal-inbox-utils.ts` | behavior-source | LA-UI-057, LA-UI-058, LA-UI-060 |
| `apps/electron/src/renderer/features/linguist/projects/qa-findings-utils.ts` | behavior-source | LA-UI-051, LA-UI-052 |
| `apps/electron/src/renderer/features/linguist/projects/sentence-patterns-utils.ts` | behavior-source | LA-UI-076 |
| `apps/electron/src/renderer/features/linguist/projects/stage-coverage-atoms.ts` | behavior-source | LA-UI-063 |
| `apps/electron/src/renderer/features/linguist/projects/style-guide-utils.ts` | behavior-source | LA-UI-077 |
| `apps/electron/src/renderer/features/linguist/projects/tag-atomic-utils.ts` | behavior-source | LA-UI-046 |
| `apps/electron/src/renderer/features/linguist/projects/voice-profile-utils.ts` | behavior-source | LA-UI-078 |
| `apps/electron/src/renderer/features/linguist/projects/workflow-ui.ts` | behavior-source | LA-UI-016 |
| `apps/electron/src/renderer/features/linguist/session-binding/LinguistRoleMenu.tsx` | behavior-source | LA-UI-012 |
| `apps/electron/src/renderer/features/linguist/session-binding/LinguistSessionBindingBadge.tsx` | behavior-source | LA-UI-006, LA-UI-013 |
| `apps/electron/src/renderer/features/linguist/session-binding/binding-utils.ts` | behavior-source | LA-UI-013 |
| `apps/electron/src/renderer/features/linguist/session-binding/useLinguistSessionBinding.ts` | state-or-presentation-support | LA-UI-012, LA-UI-013, LA-UI-014, LA-UI-015 |
| `apps/electron/src/renderer/features/linguist/sidebar/CopyLinguistSessionDialog.tsx` | behavior-source | LA-UI-014 |
| `apps/electron/src/renderer/features/linguist/sidebar/LinguistProjectActionsMenu.tsx` | behavior-source | LA-UI-010 |
| `apps/electron/src/renderer/features/linguist/sidebar/linguist-sidebar-data.test.ts` | test-support | LA-UI-001, LA-UI-002, LA-UI-003, LA-UI-004, LA-UI-005, LA-UI-006, LA-UI-007, LA-UI-008, LA-UI-009, LA-UI-010, LA-UI-011, LA-UI-012, LA-UI-013, LA-UI-014, LA-UI-015, LA-UI-016, LA-UI-017, LA-UI-018, LA-UI-019, LA-UI-020, LA-UI-021, LA-UI-022, LA-UI-023, LA-UI-024 |
| `apps/electron/src/renderer/features/linguist/sidebar/linguist-sidebar-data.ts` | behavior-source | LA-UI-135 |
| `apps/electron/src/renderer/features/linguist/sidebar/useLinguistSidebarActions.tsx` | behavior-source | LA-UI-006, LA-UI-007, LA-UI-015 |
| `apps/electron/src/renderer/components/agent-skills/WorkspaceMemoryWindowApp.tsx` | integration-or-contract | LA-UI-116 |
| `apps/electron/src/renderer/components/agent/AgentView.tsx` | integration-or-contract | LA-UI-109 |
| `apps/electron/src/renderer/components/agent/SidePanel.tsx` | integration-or-contract | LA-UI-117 |
| `apps/electron/src/renderer/components/agent/agent-attachment-gate.ts` | integration-or-contract | LA-UI-112, LA-UI-117 |
| `apps/electron/src/renderer/components/agent/tool-result-renderers/cat-result.tsx` | integration-or-contract | LA-UI-024 |
| `apps/electron/src/renderer/components/agent/tool-result-renderers/delegation-result.tsx` | integration-or-contract | LA-UI-063, LA-UI-111 |
| `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx` | integration-or-contract | LA-UI-007 |
| `apps/electron/src/renderer/components/automation/AutomationFormView.tsx` | integration-or-contract | LA-UI-121, LA-UI-122, LA-UI-123, LA-UI-124, LA-UI-125, LA-UI-126, LA-UI-127 |
| `apps/electron/src/renderer/components/automation/AutomationsListView.tsx` | integration-or-contract | LA-UI-120, LA-UI-125 |
| `apps/electron/src/renderer/components/browser/BrowserPanel.tsx` | integration-or-contract | LA-UI-118, LA-UI-119 |
| `apps/electron/src/renderer/components/browser/BrowserSlot.tsx` | integration-or-contract | LA-UI-118 |
| `apps/electron/src/renderer/host/agent-host-extension.tsx` | integration-or-contract | LA-UI-011, LA-UI-109 |
| `apps/electron/src/renderer/host/contracts.ts` | integration-or-contract | LA-UI-112 |
| `packages/shared/src/types/automation.ts` | integration-or-contract | LA-UI-122, LA-UI-124 |
| `packages/shared/src/utils/automation-schedule.ts` | integration-or-contract | LA-UI-123 |
| `packages/shared/src/types/linguist.ts` | domain-ipc-contract-support | LA-UI-001, LA-UI-002, LA-UI-003, LA-UI-004, LA-UI-005, LA-UI-006, LA-UI-007, LA-UI-008, LA-UI-009, LA-UI-010, LA-UI-011, LA-UI-012, LA-UI-013, LA-UI-014, LA-UI-015, LA-UI-016, LA-UI-017, LA-UI-018, LA-UI-019, LA-UI-020, LA-UI-021, LA-UI-022, LA-UI-023, LA-UI-024, LA-UI-025, LA-UI-026, LA-UI-027, LA-UI-028, LA-UI-029, LA-UI-030, LA-UI-031, LA-UI-032, LA-UI-033, LA-UI-034, LA-UI-035, LA-UI-036, LA-UI-037, LA-UI-038, LA-UI-039, LA-UI-040, LA-UI-041, LA-UI-042, LA-UI-043, LA-UI-044, LA-UI-045, LA-UI-046, LA-UI-047, LA-UI-048, LA-UI-049, LA-UI-050, LA-UI-051, LA-UI-052, LA-UI-053, LA-UI-054, LA-UI-055, LA-UI-056, LA-UI-057, LA-UI-058, LA-UI-059, LA-UI-060, LA-UI-061, LA-UI-062, LA-UI-063, LA-UI-064, LA-UI-065, LA-UI-066, LA-UI-067, LA-UI-068, LA-UI-069, LA-UI-070, LA-UI-071, LA-UI-072, LA-UI-073, LA-UI-074, LA-UI-075, LA-UI-076, LA-UI-077, LA-UI-078, LA-UI-079, LA-UI-080, LA-UI-081, LA-UI-082, LA-UI-083, LA-UI-084, LA-UI-085, LA-UI-086, LA-UI-087, LA-UI-088, LA-UI-089, LA-UI-090, LA-UI-091, LA-UI-092, LA-UI-093, LA-UI-094, LA-UI-095, LA-UI-096, LA-UI-097, LA-UI-098, LA-UI-099, LA-UI-100, LA-UI-101, LA-UI-102, LA-UI-103, LA-UI-104, LA-UI-105, LA-UI-106, LA-UI-107, LA-UI-108, LA-UI-109, LA-UI-110, LA-UI-111, LA-UI-120, LA-UI-121, LA-UI-122, LA-UI-123, LA-UI-124, LA-UI-125, LA-UI-126, LA-UI-127, LA-UI-128, LA-UI-129, LA-UI-130, LA-UI-131, LA-UI-137 |
