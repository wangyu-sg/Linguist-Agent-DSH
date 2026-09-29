# 目标 UI 全量审查与统一施工基线

日期：2026-09-29。范围：`packages/dsh-linguist/src/client/` 全部 **47 个文件**，包括 19 个 TSX、16 个 TS/声明文件、11 个 CSS Module、1 个布局测试；另外读取原 LA 对应组件与当前固定 DSH primitives/theme 的实际类型和 CSS。

本文是改造前源码审计，本审计未启动产品、未操作 UI、未运行模型、未修改产品源码或依赖。**已确认**表示可由列出的源码复核；**风险**表示由布局/状态代码推得，仍需新版 DSH 的真实截图和交互验证。本文不把源码断言当作视觉验收通过。原生控件与主题已按隔离 SDK `.toolchain/dsh-0.2.0-rc.2/node_modules` 重新核对，primitives/theme/web-frontend 三个包的实际版本均为 `0.2.0-rc.2`；目标主依赖的安装进度由主任务另行记录。

## 1. 结论与共享根因

现有目标已使用 DSH Slots、原生会话、右侧资源面板和一部分 primitives；不需要另造应用外壳。问题集中在：**同类控件有多套实现、页面同时暴露过多任务、面板宽度与窗口宽度混用、状态/错误反馈缺统一结构**。逐个按钮改颜色无法解决这些共同根因。

静态 JSX 调用点统计（不是运行时按钮数量；不含 `index.ts` 的 `createElement`）：原生 `Button` 161 处、`Input` 43 处，同时有手写 `button` 21 处、`input` 22 处、`select` 28 处、`textarea` 4 处；目标 UI 未导入 `Tooltip`、`Menu`、`Modal`、`Toast`、`Tag` 或 `Checkbox`。数量本身不是缺陷；同类交互的样式与行为分叉才是问题。

| ID | 优先级 | 已确认的共享根因 | 用户影响 / 施工原则 |
|---|---|---|---|
| U01 | P1 | 目标 CSS 使用 `--dsw-alias-border-focus`、`--dsw-alias-label-error`、`--dsw-alias-label-warning`；rc.2 theme 与官方 web 编译 CSS 仍未发现三者声明。官方已有 `--dsw-alias-state-error-primary` 等语义 token。 | CSS `var()` 无定义时相关声明失效；实际 computed style 尚未采样。按 rc.2 theme 语义整批替换，并验证真实焦点；不加一套 LA 色板或静默 fallback 掩盖拼错。 |
| U02 | P1 | `Native`、`TargetEditor`、`Workbench`、`CatToolResult` 手写按钮；其余多数使用 DSH `Button`，且几乎全是 `outline`。 | 同一屏同时存在不同高度、圆角、hover、disabled、焦点表现。主任务明确一项 primary，普通行操作用 ghost/toolbar，次要命令进入原生 Menu；所有动作仍可到达。 |
| U03 | P1 | 表单选择高度分别为 28、32、34px；DSH Input 自带 32px wrapper，Button sm 28px/md 36px。CSS 常用 `.form input` 而不是控制 Input wrapper。 | 高度和基线错落、表单宽度不可预测。以 DSH 原生尺寸为基线；布局类设在实际 wrapper，选择框/textarea 只补同一份必要样式。 |
| U04 | P1 | `Panels.module.css`、`WorkingCopyPage.module.css` 使用 `@media` 判定窄布局；实际内容位于可独立缩放的 DSH 右侧 pane。只有 Workbench 根设 `container-type`。 | 大窗口内的窄 pane 仍保留三列对比；文字被压成竖条。按内容容器宽度响应，保留宽视图双语对照、窄视图逐段堆叠。 |
| U05 | P1 | CAT 行列固定 `90px + Source + Target + 76px`，两边文列可缩到零；右侧 76px 操作列内塞多枚带文字 Button。 | 窄面板虽不一定出现整页横滚，但阅读面积和动作位置不足。为文列设实际可读下限并定义窄模式，收拢行命令而非缩小文字。 |
| U06 | P1 | 非 CAT 多处异步错误与成功共用 `message`，统一渲染为 `role=status`；有些加载失败仍同时显示“正在读取”。 | 用户难判断是空、加载、失败还是旧数据。共用视觉和状态约定：加载/空/错误/结果四类互斥；失败保留内容并就地重试，成功短反馈可用 Toast。 |
| U07 | P1 | 展开设置、复制、迁移、确认大多嵌在滚动长页；detach/display-options 为手写绝对定位浮层。 | 操作层级弱，焦点/遮挡/关闭行为不同。用原生 Menu/Modal 管理瞬时层；独立持久工作面仍留 DSH pane，避免重造侧栏/窗口。 |
| U08 | P2 | 固定 10–15px 字号、`system-ui`、3/4/5/6/7/10px 圆角、5/6/7/9/10/18/22px 间距遍布 CSS；通知、callout、选中行、标签都自配 brand 混色。 | 视觉节奏不统一，宿主密度/字体设置难继承。优先 DSH font/radius/semantic tokens，布局以 4/8/12/16/24px 节奏；仅业务正文需要更大阅读字号。 |
| U09 | P2 | 提示大量依赖 HTML `title`，有 aria-label 但无可聚焦 tooltip；禁用原因只在 title 或分散段落。 | 键盘和触屏难读完整说明，失效 token 又可能隐藏焦点。用 DSH Tooltip + ShortcutKeys，并为禁用控件提供可聚焦说明/可见帮助。 |
| U10 | P2 | 同时存在 page/dock/dockBody/preview/pre/inner list 的多层 overflow 和固定最大高度。 | 在窄短 pane 中滚轮被多层截获，键盘难到页尾。每个主要工作面一个纵向滚动容器；仅对照表、原文内容、长结果允许局部滚动。 |
| U11 | P2 | 技术 ID、hash、raw enum 与实际专业内容经常同级展示；`Panels.tsx` 把六类大功能及其表单放在一个文件、一套泛用 `.toolbar/.form/.item` 中。 | 专业决策和诊断信息争夺注意力。保留证据全文和所有操作，概要优先；技术详情用 Disclosure/JsonTree/ReadBlock。按已有领域面板整理，不建通用“页面生成器”。 |

## 2. DSH 原生成分基线

以下已重新核对隔离 rc.2 SDK 中 `@deepseek-ai/dsh-client-ui-primitives/lib/types/index.d.ts`、对应 `Button/Input/Checkbox/Menu/Modal/Tooltip/Toast/SegmentedTabs` 类型、CSS 与 `lib/index.js`。相较 rc.1，rc.2 新公开 `MenuGroup`/`observeStickyMenuGroups`，`Input` 新增原生 input 的 forwardRef；Button/Input 尺寸 CSS 与列举的 Menu/Modal/Tooltip/Toast/页签 API 未变化。不能根据名称想象未提供的组件。

| UI 需要 | 已有能力 | 最小统一用法 |
|---|---|---|
| 通用动作 | `Button`，variant 为 primary/ghost/outline/toolbar；sm 28px、md 36px；原生属性透传 | 同类表面只采用约定尺寸。图标用库内 icon，配 Tooltip 和 aria-label；不再手写按钮皮肤。 |
| 单行输入 | `Input`，返回包含 input 的 wrapper，当前 wrapper 32px；rc.2 的 ref 指向原生 input | 不用 `input { width:100% }` 假设组件根就是 input。显式 label；错误关联 aria-describedby，保持浏览器原生 number/date/time 语义；弹层聚焦可直接使用原生 ref。 |
| 选择、复选 | `Menu`、`MenuItemButton`、`Checkbox`；当前入口**没有公开 Select、RadioGroup、Textarea** | 命令/枚举选择可用 Menu；原生 select/radio 对固定表单仍成立，但统一一处样式与 label。多行业务编辑保留 textarea 及其纯逻辑。无需新增 UI 包。 |
| 瞬时层 | `Menu` 有 portal、键盘移动、Esc、outside-close；`Modal` 有原生层级、焦点、关闭/恢复；`RiskConfirmation` | 重用宿主的 overlay 规则；仅确认现有高影响动作时用 confirmation，不能为所有保存加弹窗。 |
| 标签/状态/披露 | `Tag`、`Pill`、`StateDot`、`DisclosureRow` | 区分“选中”“未保存”“警告”“错误”“已受理”“专业完成”；不要全部涂 brand。 |
| 辅助说明 | `Tooltip` 支持 focus、portal、shortcutKeys；`ShortcutKeys` | long path、锁定原因、行命令、复制/重排、编辑快捷键统一使用；专业必读约束仍在正文。 |
| 面板页签 | `SegmentedTabs` 提供 tab/panel ID、箭头/Home/End、roving focus；`SegmentedControl` 是 tablist 语义 | dock 可评估 SegmentedTabs 的等宽特征是否适合七项；不适合时保留现有滚动 tab 实现并补 ID/aria 对应。岗位是表单选择，不能为了外观机械换成 tablist。 |
| 文件/长结果 | `PathLabel`、`ReadBlock`、`DiffBlock`、`JsonTree`、`MarkdownText`、`ImageLightbox` | 用于非编辑展示，保留原文、Target、tag、revision 和 provenance；专业编辑仍使用 TargetEditor。 |
| 短成功反馈 | `Toast` 支持 anchor、onDone、actions、holdMs | 成功/已复制等短消息使用；阻塞/冲突/批量失败留在操作区，不自动消失。 |

当前 DSH theme 已公开 `--dsw-font-family`、`--ds-font-family-code`、`--dsw-font-s-14`、`--dsw-font-xs-13`、`--dsw-font-xxs-12`、`--dsw-radius-xs/sm/md/lg`、`--dsw-alias-label-*`、`--dsw-alias-interactive-bg-hover/active`、`--dsw-alias-state-error-primary/secondary`、`--dsw-alias-state-business-primary`、`--dsw-elevation-*`。当前 `--dsw-focus-ring-color` 默认存在透明状态，**不能盲目把错误变量改成它便宣称焦点已可见**；优先原生控件，再跟随宿主实际 modality/focus 规则验证。

采用 awesome-claude-design 的 Linear 原则仅限：高信息密度、稳定间距、弱边框层级、少量强调色、可发现的键盘操作。**DSH 的字体、圆角、色彩和主题优先**；不引入 Linear 紫色、Inter 字体或把原生 DSH 12px 圆角强改为 8px。

## 3. 每个可视组件的施工清单

所有路径均相对 `packages/dsh-linguist/src/client/`。行号为本次审查时的源码位置；实现前以实际 diff 复核。下列“保留动作”是最小不回退范围，不是新增产品功能。

| 文件 / 入口 | 已确认的问题及风险 | 统一方案 / 必须保留 |
|---|---|---|
| `index.ts:46,73,107,187`（CatPage、BatchPreviewPage、SessionBadge、Slots 接线） | 绑定/loading 都用 `.notice`，而 `.notice` 与 error 共用错误色；header badge 使用 `createElement('button'/'select')` 另造皮肤；岗位 select 与长项目名、打开/复制/解绑按钮单行 nowrap；解除确认是 absolute span，无 dialog/focus/outside/Esc 约定；错误详情只给 title 或长 span。 | DSH header utility 仅展示紧凑身份和主入口，其他动作放原生 Menu；解绑现有确认映射 Modal/RiskConfirmation，保留当前影响说明。保留 CAT/工作副本/BrowserSkill 打开、复制项目、新岗位会话、解绑、history、取消专用调度及错误回执；各 Slots/resource provider/keepMounted 不重造。 |
| `ProjectsPage.tsx:131` | 主列表、设置长表单、创建、备份导入、旧迁移、岗位/模式、格式资格同时展开；所有次要/危险/导航动作几乎同 outline；↑↓为字符按钮无 Tooltip；全局 busy 横跨多项动作；空态写“右侧表单”但小屏为上下布局；无项目搜索 UI（源对照应判定是否既有需求，不在本报告擅加）。失败进入底部 status，离触发点远。 | 项目列表作为页面主体；创建/导入/迁移按意图进入原生 Modal 或披露区；设置分类保持可直达。保留刷新、归档可见性、Workspace 关联/选择、排序、设置、进入会话、创建自动进入、备份目录、三路径/四岗位、资格全部入口；错误就近显示。 |
| `ProjectLocaleSelect.tsx:40` | 统一候选表和 BCP-47 自定义校验已存在；select 自配 34px/6px，而后续 Input 是 DSH 32px/12px；只有自定义输入有 error/hint，选择器与普通 Input视觉分叉。 | 保留 30 种候选和自定义代码、trim、pattern、长度、aria-invalid/describedby、disabled；选项不按视觉改动减少。统一选择框样式，表单 label/hint 一致。 |
| `ProjectSessions.tsx:47` | 项目组与每条会话信息同段串联，时间/岗位/模式/标题没有稳定列层级；loading 与已有组可同时存在；错误是无视觉分级的 p；只有打开项有 busy，刷新可重复触发；没有全量页面滚动策略。 | 用同一份列表行和 metadata 样式；保留按 project 归组、updatedAt 排序、刷新、缺项目禁止打开、归档只读、失败数和错误详情。DSH 原生会话侧栏继续为主。 |
| `CatWorkbench.tsx:467`（整体） | header 同时展示约十项命令并 wrap，可占据大量垂直空间；批次 nav 与工作批次 select 重复控制；summary/error/reference/tag notice 会继续增加头高；两个侧面板在 980px container 下 absolute 覆盖，但没有局部遮罩/焦点/关闭模式；默认 nav 开、dock 开 240px。 | 一个紧凑主工具栏：批次/搜索/阶段过滤、下一项、显示菜单、选区动作；nav 和 inspector 保留为清楚可开关的辅助面。窄 pane 约定一次只覆盖一个辅助面，能 Escape/按钮关闭并返回触发点；保留所存宽高/比例与会话编辑状态。 |
| `CatWorkbench.tsx:572`（SegmentRows） | grid 无可见列头；aria-rowcount 存在但行未见 aria-rowindex，虚拟行位置对辅助技术不完整；元数据/QA/proposal 为多种手写按钮；76px 命令列承载多个 Button，长中文/英文操作存在挤压风险；源码只保证 min-width:0，不能证明实际可读。 | 保留虚拟列表、稳定 ID、page load、Source/Target lang+dir、选中/复选、QA和建议定位、编辑、确认/撤销、引用、接受/拒绝。统一紧凑行命令，补可见列语义与虚拟行索引；窄模式需真实截图而非 CSS 字符串检查。 |
| `CatWorkbench.tsx:621`（ContextPanel） | 310px inspector 内把 TM/TB/Style/Voice/上下文/历史/证据/关联文档/译例全部连续展开；多个纯 button 无样式；Style/Voice 空列表只剩标题；关联候选又有180px内滚动；动作依赖 editorHandle 但 disabled 无解释。 | 用原生 DisclosureRow 为专业参考分组，保留 source+target、TM 差异/兼容警告、replace/insert草稿、required/forbidden、Voice 译例、stage actor/history、文档关联/取消/预览、保存译例；空组明确状态，禁用 TM 应说明需先进入编辑。 |
| `TargetEditor.tsx:550` | textarea/7处按钮自配样式，主按钮硬编码 `white`；11px帮助与密集按钮并排，toolbar不换行；target textarea 40%窗口高度限制不按pane高度；边框/焦点使用未查到的 token。 | 保留 textarea与纯编辑算法，仅统一外观和动作条。必须保持 IME、emoji/组合字符、tag 原子光标/删除/粘贴、undo/redo、CAS conflict两种恢复、dirty保留、保存/确认前进/Esc、aria-busy/live；允许动作条按pane宽度换行。 |
| `BatchPreview.tsx:47` | 表格固定 min-width:640px、max-height:450px，窄pane横滚为代码明确行为；外层没有页面padding/height规范；列头有role但长状态挤到130px；error无统一色和重试分类；0句段显示一个空表。 | 保留50行分页、tag检查范围声明、缺失token警告、刷新/关闭/源文件预览、整体与当前阶段统计。预览按pane大小占用剩余空间，窄模式定义对照堆叠或明确横向比较视图；空表给可理解空态。 |
| `PreviewView.tsx:24` | iframe强制白底且min-height340px，嵌在320–480px dock里容易双滚；文本pre统一却无内容类型层级；失败时header仍可能“正在读取”；只提供关闭，无原位重试。 | 保留安全 sandbox/CSP、受管URL校验、截断说明、提取纯文本、原件链接；文档白页可以保持白色但外部壳跟DSH主题。正文预览合理填满pane，用原生阅读组件/Disclosure，错误原位重试。 |
| `Panels.tsx:47`（QaPanel） | 三个select加命令挤同toolbar；豁免理由/操作人一直在首屏；未知loading没有占位，错误作为status；单条与项目批量豁免均outline，批量确认为普通callout；currentRevision不满足的禁用说明只有title。 | 保留status/severity/disposition过滤、全范围恢复、QA运行、刷新、分页、定位、resolve、带operator/reason豁免、项目同规则范围预览确认；将批量/豁免表单按动作展开，阻断等级用语义状态而非仅颜色。 |
| `Panels.tsx:101`（ProposalPanel） | 待审/历史建议共享长表单；初次 list 未返回时 `visibleProposals=[]` 会先显示“没有建议”；bulk 编辑、三列diff、provenance、警告、编辑接受同时占屏；三列切换用窗口760px断点；textarea与原生控件不一致。 | 保留分run、计数、version/lock禁用、刷新差异、evidence/term refs、发行身份、warnings、接受/编辑接受/拒绝/重签、批量预检排除项、立即apply与proposal两路径及逐段失败报告。主阅读区保持Source/current/proposed可比，长依据折叠，加载不冒充空。 |
| `Panels.tsx:222`（ReferencePanel） | TM/TB类型、search、status、文件导入、Agent整理、删除/校验共一行；术语状态显示英文enum；新增/编辑6+字段无可见字段名，依赖placeholder；checkbox手写；列表空/加载状态不统一；TM priority在blur保存且无就近保存状态。 | 保留搜索/分页、候选先预览再确认/拒绝、源hash与警告、TM source enabled/priority、术语CRUD/批量删、五状态/大小写/module/category/note、冲突保留译法、required/forbidden校验与句段跳转、Agent整理；共用表单/列表/反馈约定，blur写入要有明确回执。 |
| `Panels.tsx:398`（AssetsPanel） | 文件与目录原生input暴露浏览器按钮样式；批次统计/hash/预览/撤销全挤p；批次导入和5类语言资产同长面板；XLSX证据、映射与结果持续展开；资产表单复用first/second/third/fourth使可见placeholder混合“分类/译法/Text type/Scope”，不能一眼辨当前字段含义。 | 按既有批次/语言资产类别分组，不丢任何字段。保留多文件/文件夹、500项边界、重复/失败/待映射报告、worksheet/key/source/target/locked/context映射+样本、remember、hash复制、撤销、预览、Context/Style/Sentence/Voice/Tech CRUD、句型状态流转、Agent Voice、关联当前段。动态字段用本类别的明确label。 |
| `Panels.tsx:580`（DeliveryPanel） | verified/preflight/as-is三操作同outline同级；无批次仅disabled，缺解释；空历史无说明；阻塞在callout中，完整Markdown用pre；download提示不采用统一动作。 | 保留验证导出、仅预检、按当前状态导出、阻塞报告、一次性下载、历史/过时、重新导出。verified为默认主动作；as-is需沿用源产品已有风险确认语义（详见源对照），不弱化专业完成边界。 |
| `Panels.tsx:638`（ProjectSettingsPanel） | 能力入口→项目→语言→工作流→Tag→备份→诊断→归档删除全连续展开；原生controls与手写select混排；常见save与archive/delete同outline；诊断hash与专业设置同级；message位于最下方。 | 恢复清晰设置分类与直达锚点：基本/工作流/Tag/备份维护/诊断，能力仍跳原生页面。保留改名、语言冻结、SDLXLIFF输出、QA profile、tag扫描证据/候选CRUD批准/忽略、backup/restore、完整性取消/报告、诊断预览导出、archive/完整名称确认移回收区。 |
| `BackupRestorePreview.tsx:13` | 复用brand callout表示校验通过/失败和破坏性确认；table只有inline width/textAlign，未纳入表格样式；确认与取消均outline；长版本/notice无布局分组。 | 保留全部counts对照、schema迁移提示、完整性problems、restorable阻断、整体替换与pre-restore说明；统一可滚动对照表，确认保留显著风险语义，不能把校验详情隐藏为仅绿色勾。 |
| `RunPanel.tsx:23,165` | 专业coverage、最近run、创建调度、通知目标、6种时间方式、历史管理同长面板；通知fieldset浏览器默认边框；大表单使用小outline提交；请求错误用末尾status，coverage/run失败时仍可能显示loading；raw role/scope/time/id用于成功反馈。 | 保留专业coverage与运行/交付区别、可逆undo/refused、全部调度类型、tz/weekdays/maxRuns/sessionMode/冻结scope/通知触发、编辑重新核验。将创建编辑作为明确子任务区；非编辑总览先展示计数与现有任务。 |
| `ScheduleManager.tsx:70` | schedule活跃状态标为“运行中”，代码依据是 schedule.status=active，易与此刻执行混淆；整段prompt、授权/次数/时间/ID、执行历史逐p展开；history只能追加无收起入口；取消确认插在同行，缺focus处理；historyBusy锁所有历史按钮。 | 保留active/paused/limit/authorization差别、编辑重验/恢复、立即运行受理、取消后history影响、执行/投递分离、通知回执和更早分页。显示“已启用”与真实执行状态区分；原生Disclosure控制长历史，原生确认层管理取消。 |
| `WorkingCopyPage.tsx:24` | 路径、hash、coverage、diff、下一步都在article长文本；header不wrap，只有itemHead响应式；三列diff用窗口760px断点；显示空/error/loading已有但成功/nextAction统一brand。 | 保留刷新、当前/历史owner、文件原样声明、未正式提交、四种裁定数、20条差异截断、source/artifact hash、原生文件打开；窄pane三列转纵向，hash放详情，路径用PathLabel，状态保留文本语义。 |
| `SessionCopyPage.tsx:71` | 独立一套radio卡片与品牌选中背景；`.target span`缺min-width:0/长名换行；候选所有项目平铺；缺候选仅一条文字；复制完成但打开失败后copied状态会禁用按钮，用户只能读错误。 | 保留资格检查、blank/fork区别、目标语言警告、复制后会话ID及原项目不变；原生表单/状态结构统一。已创建但导航失败应给“打开已创建会话”明确恢复动作，不重复创建。此处是现有流程的收尾缺口，非新复制模式。 |
| `LegacyMigrationPanel.tsx:85` | 10px卡片圆角与6px内部卡不一致；路径Input混sm按钮；radio/checkbox/progress/details全浏览器默认；大迁移报告占满项目页；未统一 busy/状态标记；枚举disposition/verify直接显示。 | 保留只读scan、选择项目、copy/reference、orphan选项、逐项目进度/失败、SSE中断说明、冲突零写入、校验checks、转录与rollback信息。进入独立原生Modal/面板流程并保持关闭/后台执行语义诚实；不擅加取消能力。 |
| `ProjectCapabilities.tsx:47` | 原生插件/Files入口正确；Skills列表每项套border item，内联maxHeight280再次内滚；skill path只有打开按钮；loading/error/empty 已有但样式无差别；与设置上下文重复标题。 | 保留当前Session的真实skills、是否modelInvocable、指令文件、实际load边界说明、打开文件/插件/Files、刷新/错误；用DisclosureRow+PathLabel及统一状态，控制一层滚动。 |
| `ComposerContextChips.tsx:23` | 手写999px brand pill，10px说明；“附带选区”原生28px按钮与小chip高差；×点击区域很小、无Tooltip/专用focus样式；项目/批次ID仅title；发送错误纯span。 | 保留“仅显式附带”、当前project/asset/reference/selected count、clearReference/clearSelection、附带与遗漏状态、正在提交错误。使用原生Tag/Pill及可聚焦移除动作；不复制原生Composer，不自动附带。 |
| `UnknownTagNotice.tsx:31` | 报错与普通提示共用brand notice；两枚Button和字符×样式不同；未知scan无loading但设计上可合理隐藏，不能把隐藏认作通过；解释依赖title。 | 保留按fingerprint忽略、发现新形状再提示、查看设置、Agent识别、sending防重、错误重试；用统一inline notice与原生ghost关闭/Tooltip。 |
| `CatToolResult.tsx:182` | 另造工具卡/折叠箭头、inspect和anchor按钮；font12/system-ui、radius7、内部380px滚动与宿主工具样式不一；准备/执行/完成是纯文字；所有text结果都pre，JSON阅读负担大；图像错误无role/重试。 | 重用DisclosureRow/StateDot/原生Button和ReadBlock/JsonTree适用展示。保留props.useDisclosure、inspect轨迹、工具摘要、参数/全部内容、error、图像与锚点到真实Session/project/revision校验；“工具完成”不改称专业完成。 |
| `ui-locale.tsx:1,570` | 已通过DSH locale runtime维护中英字典；但其他组件仍有裸 enum、`Source/Target/Run/Model/Session/Style Guide`及错误String。前者可属专业术语，enum应按语境判断；不能将全部英文误判为漏译。 | 保留locale动态订阅。新增UI标签先进入同一字典，状态码与诊断原文可在详情显示；中英长文本均纳入布局验收。 |

## 4. 每个 CSS Module 的具体合并点

| 文件 | 当前数值/选择器事实 | 最小处理 |
|---|---|---|
| `Native.module.css:1` | badge nowrap、11px，select max92px；按钮padding3/6 radius4；detach absolute z5、shadow `#0002`；notice与error相同；chip radius999、10px提示。 | 移除自制控件/弹层皮肤，留slot位置和chip布局；错误/加载分色分role，长名可截断并Tooltip，header可收拢。 |
| `ProjectsPage.module.css:1` | root自设font14；24–48px页面padding、24px/650标题；列最小300+290+22；section radius10/pad16；message sticky+shadow；850/440 viewport断点。 | 主页面遵DSH面板排版；表单层级集中，容器断点替代窗口断点；统一间距，反馈就近+原生Toast。 |
| `ProjectLocaleSelect.module.css:1` | select34px/radius6/pad5/8；label12、hint11；自制focus token。 | 使用共享表单规则，保留本组件只负责field/hint布局。 |
| `Workbench.module.css:1` | root14px system-ui；header min44；nav190可resize(150–280)，inspector310/min260；段落90/双语/76；dock160–480/60%；各手写buttons/radius/brand fill；980 container下左右overlay z3/z2；scroll多层。 | 保留领域网格和原有持久化尺寸，删除通用按钮/弹层皮肤；统一容器宽度模式、滚动责任、层级与关闭；native pane外壳由DSH管理。 |
| `TargetEditor.module.css:1` | textarea最低76，border-focus变量；按钮radius4/pad3/6；主button `white`；toolbar无wrap；11px帮助；meta并排。 | 与原生Button/Input外观统一；只保留tag/editor/content-specific样式和srOnly，窄幅换行；继承DSH字体/语义色。 |
| `Panels.module.css:1` | 所有功能共用6px toolbar、28px select、5px radius、240px max；selected/callout共享brand背景；三列compare窗口760转1；textarea三套最小高度；preview iframe白底340；多处maxHeight260/320。 | 使用同一表单/状态/对照/列表样式；callout按用途区分；按pane宽度适配；只有原始文档白底，壳跟主题；移除不必要嵌套滚动。 |
| `BatchPreview.module.css:1` | rows450max；heading/row min640；84/180/180/130列；warning用未定义warning token混色；token自配brand/radius3。 | 表格按pane高度/宽度，明确窄模式；protected token样式与CAT一致；warning用真实token。 |
| `CatToolResult.module.css:1` | radius7/font12；body380max、20px缩进；pre11；anchor brand pill；image280max；自制focus。 | 服从宿主工具渲染密度/Disclosure；只保留专业锚点布局、内容高度边界；原生font与focus。 |
| `WorkingCopyPage.module.css:1` | page13px/system-ui/pad12，无box-sizing；header无wrap；item10px内距；diff三列、viewport760；hash11。 | 同pane页面壳，header可换行、容器断点；文件路径/证据详情层级统一。 |
| `SessionCopyPage.module.css:1` | page13px/system-ui/pad12，无box-sizing；target gap9/margin7；radio card brand8%；无长目标名换行限制。 | 共享pane与表单选择样式、可读长名；风险说明语义色取DSH。 |
| `LegacyMigrationPanel.module.css:1` | 外层radius10/pad16，内层radius6/pad8；多处11px code、12pxlabel；warning强制!important错误色；browser progress未样式。 | 共享层级/状态/表单；迁移报告保留信息但折叠，以统一列表/Disclosure展示；无需品牌化progress组件。 |

## 5. 其余 UI 支撑文件逐项归档

这些文件没有可替换的按钮/视觉表面，不应为了统一UI重写领域逻辑。施工必须保留其契约。

| 文件 | 作用与本次审查结论 |
|---|---|
| `api.ts:1` | HTTP/SSE、文件staging/download与错误信封。`invoke/required`没有signal参数，多数组件通过live标记丢弃迟到UI结果；`getInstructionFiles`有signal。统一UI不得让取消显示等同于服务端已取消；新增cancel须有真实链路。 |
| `cat-edit-utils.ts:1` | commit/confirm资格、save完成行为、键盘映射；保留locked/archived/IME/conflict等限制及未改动也可确认的语义。 |
| `cat-editor-state.ts:1` | 以Session+project隔离draft atom，外壳切换不能清空草稿；统一Modal/pane不得重新设计成每次render重建。 |
| `cat-navigation.ts:1` | tool anchor至Session+project的导航与revision；保留QA/proposal/doc/inspector定向，不把所有锚点退化为打开首页。 |
| `cat-virtual-utils.ts:1` | 分页/稳定key/键盘上下HomeEndPage/下一可编辑行；保持虚拟化，不为外观改成全量DOM。 |
| `composer-context.ts:1` | 按session发布selection快照与清理订阅；保留明确引用和count来源，避免跨会话残留。 |
| `composer-reference.ts:1` | 原生input trigger token、提交仲裁快照、100段边界；它是真实Composer扩展接缝，UI统一只改chip和反馈。错误原文可做本地化映射但不吞掉边界失败。 |
| `css-modules.d.ts:1` | CSS Module 类型声明，没有UI行为；无需为统一外观改造。 |
| `format-labels.ts:1` | 格式名称与资格描述；保留generic XLIFF/memoQ/Phrase能力边界，不能用“支持所有格式”的统一徽标代替。 |
| `project-errors.ts:1` | 既有错误码/格式/health映射可复用；减少组件各自 `String(error)`，但技术详情仍可查看。 |
| `proposal-view.ts:1` | 文本diff和run分组；保留现有依据，表现可用原生阅读块，不重写diff算法。 |
| `qa-severity.ts:1` | L0–L4→blocking/check/notice；语义可用于统一Tag/状态样式，不能只按红黄绿重新分级。 |
| `tag-atomic-utils.ts:1` | tag原子移动/删除/选择边界；当前任务无视觉代码，保持完整。 |
| `workbench-location.ts:1` | project维度存nav/dock大小、source比例、位置；默认nav+dock打开导致窄pane遮挡风险，响应策略需与保存状态一起明确。保留用户尺寸，不把容器变窄误持久化为永久偏好。 |
| `workflow-ui.ts:1` | T/E/P文案、状态、tooltip；现“徽标颜色对应整体状态”需与统一状态展示实际一致，若用文本Tag应同步真实描述。 |
| `Workbench.layout.test.mjs:1` | 仅检查CSS含min-width:0和源码有导入入口，无法证明窄窗、重叠、字重、主题或键盘可用；保留必要回归，视觉验收仍需真实DSH页面。 |

## 6. 与成熟源 UI 的可核对差异

源根：`/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/renderer/features/linguist/`。本节只列本次已直接读取的对照，不替代另行完整源功能清单。

| 源组件 / 已有行为 | 目标差异 | 应沿用的行为与DSH实现 |
|---|---|---|
| `projects/ProjectCreateDialog.tsx:1,18,55,79`：受控Dialog、字段error、aria-invalid/describedby、失败不关、创建后焦点回归 | 目标常驻创建form，错误进入页面底部message；无同等逐字段错误/成功焦点策略 | 创建流程保持清晰的输入/提交/失败修正/成功导航，采用DSH Modal；不拷贝Proma selector或Radix组件。 |
| `projects/ProjectSettingsSheet.tsx:54,97`：右侧Sheet，项目/批次/资产/Tag/维护/诊断六分类 | 目标SettingsPanel所有类别连续展开且还内嵌能力；批次和资产另挤同dock | 保留分类与定向入口；在DSH已有pane内组织tabs/Disclosure，不新建第二宿主侧栏。 |
| `projects/LinguistBottomDock.tsx:58,72,94`：tab ID、aria-controls/labelledby，键盘移动后scrollIntoView，面板可focus且overscroll-contain | 目标有箭头/Home/End，但缺tab↔panel ID关系、panel tabIndex、明确scrollIntoView | 采用DSH SegmentedTabs或补齐现有滚动tabs的对应关系；不改独立panel动作。 |
| `projects/AssetNavigator.tsx:64,106,115`：批次数、搜索、全项目阶段摘要、loading/空/无匹配、当前批次QA与preview | 目标搜索/空/预览存在，nav只显示confirmed/segmentCount，无同级全项目进度与QA摘要 | 恢复信息口径分离；保留批次与全项目统计，样式用DSH列表/Tag。 |
| `projects/PrepareDeliveryPanel.tsx:182,187,195,321`：warning、error+retry、无数据说明、as-is AlertDialog确认 | 目标统一message，as-is直接触发，少空态/就地重试 | 保留现有交付风险分层和as-is确认，让确认文案基于真实预检状态；使用DSH Modal/RiskConfirmation。 |
| `projects/ProjectLocaleSelect.tsx:58`：复用选择组件 | 目标已复用自身语言组件，但控件皮肤与Input分叉；目标额外有自定义BCP-47输入 | 保留当前合法语言能力；不把源Select品牌/依赖照搬，按DSH公开能力统一。 |
| `projects/TargetEditor` 对应迁移逻辑 | 目标已带原子tag/undo/IME/CAS与快捷键，不应视为视觉统一的可删复杂度 | 只替换控件呈现/布局，保留编辑算法和草稿状态；专业行为不因“更简洁”缩水。 |

源的 Proma Shell、窗口/tab/chats/composer、模型选择、工具权限和自动任务运行器属于宿主领域。本目标已经接入 DSH Slots/Session/BrowserSkill；UI统一继续使用这些真实接缝。专业上下文、CAT编辑、资产、证据、QA、术语、岗位职责的操作和信息都需要保留。

## 7. 一次统一施工的最小组织

1. **先锁宿主基线**：新版官方Desktop、匹配API/CLI/插件依赖身份及真实primitives导出；按该版本重新查所有DSH CSS变量。只有实际发布可用的组件进入施工表。
2. **先统一规则，再改所有消费点**：依托现有CSS Modules保留一份共享布局/表单/状态规则（可以由现有 `Panels.module.css` 收敛而来）；DSH Button/Input/Menu/Modal/Tooltip/Tag 等直接使用，不包一层同名LA组件工厂。没有原生Select/Textarea时，才保留最小统一原生HTML样式。
3. **按完整用户路径重排信息**：项目列表→创建/打开→CAT/工作副本/浏览器；CAT→选区/编辑→参考→QA/建议→交付；设置→维护/诊断；专业运行→调度。一次处理同类控件的全部消费点，保留行内快捷动作和命令可发现性。
4. **消除不一致状态模型的呈现**：每个读操作显示loading/empty/error/content；每个mutation显示忙碌、成功或可恢复失败。禁止“加载中”与失败并存。批量部分成功逐项可追踪，专业完成保持原本证据边界。
5. **整体容器响应式**：真实DSH并排/全屏/浮动pane决定宽高。普通表单单列化、diff分段堆叠、工具栏收拢，文本不靠缩到10px挤进去。CAT虚拟化、原文可比性、独立滚动和焦点路径一起验。

不需要新设计系统依赖、统一JSON表单生成器、第二套toast store、第二套route/shell、全局CSS覆盖DSH或新的UI运行时。需要的是把当前真实用户动作放入同一套宿主组件和布局规则。

## 8. 统一施工后的验收合同

此处列出应执行的验证；本次没有执行，也不生成通过回执。

- **版本/主题**：官方新版真实Desktop装载插件；亮/暗主题各一套主路径截图。检查使用的CSS token确实定义，focus/error/warning/disabled可辨，文字继承宿主字体；不靠hardcoded白字或brand背景掩盖。
- **容器尺寸**：在宽窗口内分别把pane调至约360/480/720/1000px，另验短高度；并排、全屏、浮动/重开。页面无无意义整页横滚；有意双语表横滚有可见线索，正文和主要动作能到达。
- **全47文件影响面**：19个TSX与index各入口全部走一次；七dock、设置各分类、无项目/零批次/零结果、长名/长path/长error、中文和英文均包含。不能只截图CAT第一页。
- **键盘**：Tab/Shift+Tab、Esc、Enter、space、tablist箭头/Home/End，Menu/Modal返回焦点，grid导航，编辑IME/撤销/重做/保存/确认前进。聚焦项不得被overflow裁切；tooltip可通过focus读取。
- **状态/并发**：慢读、失败、重试、刷新中切项目/Session、保存冲突、归档/锁定、二次点击；旧结果不得覆盖新身份。已经创建的Session导航失败可恢复打开，不能重复创建。
- **所有原有动作**：按本报告第三节保留清单逐项验收；Source/current Target/必要上下文与证据仍可读，tag/换行/锁/稳定ID/CAS不变；工具受理、任务结束、已下载、平台确认与专业完成仍清楚分开。
- **证据**：实际截图、组件/宿主版本、操作结果和已知限制进入统一验收记录。布局源码正则测试、空mock结果、页面看见的hash均不能替代实际功能和专业证据验收。

## 9. 本次只读审计可复核入口

- Target：`rg --files packages/dsh-linguist/src/client`；逐文件读取 TSX/CSS/TS，统计HTML/DSH控件调用点。
- Primitives：`.toolchain/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/types/index.d.ts`、各组件类型、`lib/index.js` 以及 `Button.module.css`、`Input.module.css`、`Checkbox.module.css`。
- 当前 theme：`.toolchain/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js`；官方 CSS：同根 `dsh-web-frontend/dist/assets/*.css`；版本由对应 `package.json` 确认。
- 设计参考：`/Users/wangyu/.codex/skills/awesome-claude-design/SKILL.md` 与 `design-md/editorial/linear.md`；仅取密度、层级、克制和键盘原则，DSH token为实施依据。

本审计唯一新增文件为本报告。产品视觉的运行时结论仍需 rc.2 真实 DSH UI 验证。
