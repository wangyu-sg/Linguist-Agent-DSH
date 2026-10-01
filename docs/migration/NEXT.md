# 当前进度与接续（2026-10-01）

## 当前真实安装与冻结源码

- 官方 DSH：`/Applications/DeepSeek Harness.app`，固定 `0.2.0-rc.2`，默认 desktop profile。
- 实际插件：**LA b62e45d3cc2d＋BrowserSkill .5 / 5c93f36b**；身份 `la-b62e45d3cc2d-5c93f36b`。官方依赖、own registry、冷启动 Host 身份一致；registry SHA `efae27cd62bffb921598a265841cb922a607c63f999213281eb1662c35f5772d`。
- **36 LA＋14 Browser** 包成员逐字节匹配，两插件原生启用开关均已观察。安装动作由谁、何时执行未知，Root未点击 Install；manifest mtime只作元数据，不作点击时间。证据 `native-final-b62/installed-members.json`、native-enabled-observation.json及 `native-install-la-b62e45d3cc2d-5c93f36b.json`/`-trace.json`。
- Root真实 Quit：`06:56:12.822484Z` 核实所有官方进程不存在、Host19387拒绝连接；`06:57:46.802Z` Finder真实双击官方 App，新 Host运行身份b62，**9/9 installed smoke** 通过。`native-final-b62/cold-start-receipt.json`与固定 installed-smoke.json；仅证明这段冷启动/安装检查，不代表完整G04/G10/G13或READY。
- **已安装 b62 的历史源码**为 `e34f282418d0d3ebc91cc58c1197100bccd389e6`；301 Node＋22 Bun＋8类型检查＋6实际tarball资源检查通过。18项Client、3项异步错误、PDF预览及排队取消修复在此包；这组旧源码/包/检查身份保留，不冒作新候选检查。
- `native-final-b62/candidate.json`/checks-followup.json是**b62安装前历史收据**，其“待安装”描述保留当时事实。当前运行状态以b62安装/冷启动收据为准；旧018c源码与277项检查、原生证据保留原ID。当前任务 **IN_PROGRESS / NOT_READY**，飞书仍BLOCKED_ENV。

## 新候选包：已提交、已检查、尚未安装

- 目标仓库源码提交 **`23299b4b22e3404120fd115f0c7f11906d059f9d`**，21文件；exact source-only Ponytail v3 diff SHA `12b5299717fa76df25109817718abca20ac79ecf376885b37bd04faab2a1985a`，结论 **Lean already. Ship.**。收据 `native-final-b62/grouped-attachment-followup/ponytail-review-12b5299717fa.json`；本次接续文档尚未提交。
- 最新完整 `required-03`：**302 Node＋24 Bun＋8类型检查**，`build-03`及**6实际tarball资源检查**通过。对应原始命令、日志及SHA在 STATE.json；保留此前301/22和失败尝试，不以较早的检查收据替代03。
- 固定包于 **2026-10-01T09:27:22.590Z** 构建：Linguist SHA **`1649404c5456c0855c0b3560a6b6f829b8dd30f9c198ba5e26666b6f56ba7f81`**；BrowserSkill `.5` SHA **`5c93f36bf87a403ec3ca252a3c8ed1749e53d0c8c4744c0968ef68c5ca556006`**不变。候选身份 `la-1649404c5456-5c93f36b`，`native-final-1649/candidate.json` SHA `231bbbdc29f4f51ececc32eaec1bb7c185857d853fabcef725bce212d9de45be`，状态 **PACKED_CHECKED_NOT_INSTALLED**；当前Host仍是b62。
- 已修复当前用户原生 `FileBlock`/`ImageBlock` 的公开路径准入、无扩展名图像filename/mediaType传播、`image.xlf/.xliff`图像免同批Phrase master误判，以及scope hash图像元数据身份。**D043原生未重验**；此前“图像已进入scope”实际引用Workspace旧图像，不能证明当次选取附件进入盘点，该结论已更正。Workspace暂存件导入/资源预览的有限证据继续保留。
- 恢复旧LA默认 **zh-CN→en-US**，初始化/重置四处literal一致；locale下拉框30项值、标签、顺序精确源对齐，并保留已有未知当前值的单个选项。源只提供纯下拉框，删除无来源的自定义Input；未改已有项目语言。`default-language-fix/locale-select-source-parity.json` SHA `e9d603d1ca5c8eeeb6b717d49d5cd5f9f9394d846751fd6f134aa1dd2251c798`；新默认与下拉框尚需候选包原生核验，旧b62的en-US→zh-CN观察不改写。

## 本轮新发现及修复

- 原3fe实际导入 XLSX TM/TB 返回 FORMAT_PARSE_ERROR：Client和Host缺明确 worksheet/source/target mapping。018c真实原生选择→预览→确认已成功；TM取消/原件三语言预览/新增occurrence删除和旧CSV设置保留已读回。TB原生确认成功，完整读回3/3通过；原RED不删。
- QueryTm返回真实 `tmuo_v2` occurrence ID，内部 delete SQL 支持，公共 ReferencesDelete 输入拒绝；同轮最小边界修复。原3fe RED保留在 `artifacts/evidence/domain-final-3fe-scoped/`。
- 同目录 actual QA批量原子豁免/编辑后解决/重跑，以及 proposal批量CAS/拒绝/接受/幂等已补 **12断言**；首次 runner期待错错误码保留。verified export/stale manifest有限范围真实通过。
- macOS当前桌面此前没有DSH可见窗口，AX与截图不一致；Root置前/居中/Finder打开无效后用户将窗口置前，2026-10-01已重新观察实际CAT画面。先前 projects-light.png 实际为JPEG旧帧，不纳入正式PNG视觉证据；原文件保留，未作为正式PNG证据；新包需重新采集真实窗口PNG。

## 当前验证与证据边界

- 历史3fe只读实际 **83HTTP/501断言：500通过、1旧Long整体日志SHA失败**，原FAILED保留。独立24项prefix补证证明原51记录逐字保留，新24记录来自真实压缩与后续回合。`current-invariance-3fe-v5/index.json`。
- 018c新增50HTTP427/427和Long独立24/24真实桥接；完整既有范围为 D007–009、D016–D023、D053。后续桥接完整新增D056；其余合同的局部证据与待原生动作保持区分。`current-invariance-018c/receipt.json` 与 index.json。
- 历史018c Browser CLI **11/11**、正式原生50921 Browser＋Provider请求/响应链和7/7网页作用已PASS；`browser-native-7678/native-final-018c/final-receipt-summary.json`。SID2b94冻结；同一请求真实MAX/30230tokens和唯一owned eklb保存/上传/下载/关闭。旧3fe SID5667保持原身份。
- 当前b62固定 BrowserSkill CLI **12/12检查、14次实际命令**，14个已安装Browser包成员精确一致；自有jvwv窗口与54460合成服务均已关闭。`native-final-b62/browser-cli/receipt.json`；不是原生Skill/模型暴露或完整G08证明。
- 当前b62 **13条完整声明范围领域桥接：50只读HTTP、464检查通过**（421读回＋43历史原生正文保留），范围仅D007–009、D016–023、D053、D056；旧请求/模型/actor/时间身份不改，不能推广到其他合同或202项全PASS。`native-final-b62/domain-current-bridge/receipt.json`。
- 源335文件映射 complete277/host-replaced57/excluded1，只证明来源落点。202合同=68领域＋134UI，V验证族与20功能面仍需按实际调用/完整范围核定，不能把源码映射或单个成功当完整PASS。
- 正式READY仍是旧 **FAILED** 收据；不再适合当前安装，已注明fresh=false。必须归集当前完整acceptance后真实重跑 `verify:ready`。
- 飞书用户决定暂不配置，真实投递保持 **BLOCKED_ENV**；先完成不受阻工作，不删除或伪造该门禁。

## 立即接续

1. 在官方DSH原生插件管理安装固定 **1649/.5** 候选，保持真实操作/包身份；再真实Quit、Finder双击、停止重开，核精确安装成员、Host runtime和smoke。当前b62不能改名为1649，未安装候选不能宣布可用。
2. 在新安装上核D043当前用户FileBlock/ImageBlock发现和原件准入、无扩展名元数据/同批图像排除与实际模型可见文图request/response链；原生Browser以小范围MAX/General localhost合成链完成freshness。CLI12/12、旧Workspace图像或旧模型链不替代新的来源证明；Root独占native/model。
3. 收集**8类真实PNG＋17个UI动作**，按 `native-final-018c/final-proof-collection.json` / `acceptance-gap-018c/缺口矩阵.md` 归集尚未覆盖的20surface、30V与完整合同。新默认语言/精确locale下拉框是本次修改，应核候选实际表现；已有projects/cat JPEG保留原件/转换来源，不充当未观察的PNG或动作。
4. 对已完整声明范围的历史及b62有限证据建立**合法canonical范围桥**，保留原请求/响应/actor/时间/安装ID；仅重验修改所影响或原本未覆盖的范围。下方bulk50/CAS/SSE冲突/201扫描、StyleVoice、TM来源、rename/未来任务创建暂停恢复保留取消、Exemplar/PDF/自然QAStop已有限实测，不再重复要求同场景；局部通过仍不自动变成整项合同PASS。
5. 完整归集202合同后运行正式 `verify:ready`。旧FAILED/NOT_OBSERVED保留；飞书用户暂不配置，真实投递仍 **BLOCKED_ENV**，不删门禁。只有当前安装产物全部必需门禁通过才通知“完整迁移完成，可以直接使用”。私有GitHub已创建未push；完成后按授权推送，每次commit/push先对精确diff运行Ponytail并得到 **Lean already. Ship.**。

## 冻结历史证据（保留原身份）

完整路径、SHA、作用范围见 STATE.json，以及以下原始receipt/index。不能替旧证据换安装ID。

- 四岗位/General长正文/工作副本T→R→P：`roles-7678/`、`current-invariance-3fe-v5/`；真实Source/currentTarget/required文图/当前revision与actor来自原原生模型。
- 原生导航/三分隔条/420段底栏：`ui-7678/navigation-and-splitters.json`；编辑生命周期 `ui-native-lifecycle/`（中文粘贴不是IME证明）。
- 原生子任务queue/steer/interrupt/冷恢复：`delegation-controls-v5/`，16实际断言；专业子任务初次缺图与后续真实补齐在 `delegation-7678/`，原错误保留。
- 原生六Skill：`skills-native-v5/`，22断言；中性短句General范围，不冒充六次专业Stage/丰富文化审批。
- 调度实际到期/手动、更新/暂停/冷恢复：`schedule-7678/` 及 STATE对应后续receipt；自己的合成任务已取消。
- Host原生文件附件/预览8项、复制解绑31项、外部备份21项：`native-shell-v5/`、`session-copy-detach-v5/`、`backup-external-v5/`；API不推导全部Client按钮。
- 跨批次15段pending一致性及5000段QA：`consistency-jobs-v5/index.json`；167proof SHA核对。QA两次自然完成，原生取消未观察，不能采用模型虚构的Stop叙述；不再增旧安装数据/重复旧QA。
- 实际维护恢复6/43HTTP：`maintenance-v5-contract/`；旧 `maintenance-7678/receipt.json` FAILED不改。旧LA合成项目迁移：`legacy-installed-v5/`，6/13HTTP＋SSE。
- HTTP `http-boundaries-v5/classification.json`：LA29＋DSH跨源403成功；15个未认证DSH业务401是NOT_REACHED_AUTH，Desktop已登录，不是外部凭据阻塞。
- Browser真实130秒等待/取消/reload/外来peer保护与富文本/虚拟行/断线：`browser-native-7678/`、`browser-v5-extra-boundaries/coverage.json`。单触发多下载未观察；捕获前取消出现的自有迟到Downloads保留。49914/54892旧fixture已停止，owned-shutdown proof保留。
- 功能合同归集草稿：`artifacts/evidence/final-acceptance-3fe-draft/`；Root按证据核定，不直接用局部声明清正式门禁。

## 用户决定与交付

- CAT选区按需附带、实际提交时冻结；项目身份由Linguist列表和原生会话顶部承载，用户接受SDK没有侧栏行内徽标接口。
- 全新包已有持续安装授权；桌面工具对不受信任本地build仍要求安装动作当场确认，按工具规则执行，已安装包不重复问。
- 源仓库只读；仅非客户合成；不访问真实Phrase/OSgame/客户库，不切provider/effort，不覆盖旧LA/Proma/DSH数据。
- 私有 `wangyu-sg/Linguist-Agent-DSH` 已创建、尚未push。完成后按授权推送；每次commit/push前精确diff必须Ponytail `Lean already. Ship.`。

## 历史检查点（以下安装等待已解除）

以下记录保留当时身份与结论；其中018c为旧安装，b62待安装状态已被上方当前安装/冷启动证据取代，不作为当前接续指令。

### 2026-10-01 13:11 集中修复边界

- 18 项 Client 源码修复冻结；会话附件发现修复已接入。完整 source check 297 Node / 22 Bun / 8 类型检查零失败、零跳过。
- 原生 QA Stop 实际 turn=user-aborted，但 Job=completed5000；不能标取消通过。保留 `native-final-018c/qa-worker-cancel/attempt-receipt.json` 与真实 Session/SSE。共同 runner 增加提交前标准事件循环让步，排队 abort 先 RED 后 GREEN；待新包实际重验。
- Desktop 禁止 dsh-app `target=_blank`，原件链接已改为下载；PDF原件行内预览的 native 能力正在整合，不凭 iframe 节点声称可见。
- 阅读 `artifacts/evidence/acceptance-gap-018c/缺口矩阵.md` 选择实际剩余操作；保持 13 条完整 Domain bounded bridge 口径，飞书继续 BLOCKED_ENV。
- 先解决上述预览整合再重跑 full checks/build、精确 Ponytail review、一次打包/原生安装；最新 build 尚早于 queued-cancel 与 download 修正。

### 2026-10-01 13:39 集中候选包冻结

- 新候选 Linguist `b62e45d3cc2d` / Browser `.5` 不变，source HEAD `e34f282418d0d3ebc91cc58c1197100bccd389e6`；完整 301 Node / 22 Bun / 8 类型检查 / 6 实际 tarball 资源检查通过，36 个 LA 文件。两个源码提交均经独立 exact Ponytail `Lean already. Ship.`。
- PDF真实三页/画布/正常Worker与错误重试15工程检查通过；正式官方DSH原生绘图另需验证。首次pack因新增直接依赖改变parser bundling失败，已修两处既有Host/Worker noExternal；失败日志保留，门禁没有削弱。
- 已到官方DSH安装按钮并提出当场确认；当前安装/registry仍是018c，未标b62安装或READY。确认到达后安装，再真实Quit/Finder双击、smoke，然后按集中矩阵验证剩余工作流。
- 源1862/1862字节不变，原Git tree1863paths完全一致；首次将清单外原trackedCursor规则错判新增的runner失败保留，最终基线元数据已澄清。
- 018c已实际QA rerun读回5/5：只剩EMPTY_TARGET开放，placeholder已解决历史保留。原运行中Stop Job仍completed失败不改；新5000段真实重负载fixture仅准备，待新包真实Stop。
- 当前候选固定收据 `artifacts/evidence/native-final-b62/candidate.json`；下一轮勿重新逐项打包，Root继续完整原生验收/门禁归集。

### 2026-10-01 候选包等待安装期间的真实进展

- b62 实际 tarball 内 QA Worker 经真实 adapter 跑2场景/7检查：5000×300占位符任务真实 started 后取消，返回 AbortError、线程退出、无结果；同入口小QA正常。仅工程证明，原生Stop仍待安装。`native-final-b62/packaged-worker-cancel/receipt.json`。
- 自有项目 `prj-33dba7eaee1dfa2a` 已用当前018c公共Host准备240段/51 pending，0 Target写入；该文件实际仅1锁段，原2锁错误期待保留并修正。供b62原生50/200边界和CAS，不能作原生create/import或模型证据。`native-final-b62/prepared-bulk/prepared.json`。
- 多变体TM合成CSV已准备，未导入；保留旧CSV disabled/priority37。`native-final-b62/prepared-reference/`。
- 译例A/B完整合成备份已验证原件和副本：独立 `prj-9543c468d3c5d30b` 两段 Pilot/dialogue、Guide/tutorial，以synthetic-fixture canonical confirmed；没有模型/专业审批。尚未安装导入，原生入口相对目录 `final-acceptance/exemplar-b62`；`native-final-b62/prepared-exemplar/fixture.json`。
- Browser .5一次真实单触发产生两HTTP附件但只观察到A捕获，两个确切默认文件均无，owned窗口/62402服务已关闭。无第二Chrome/CDP download intent，V23多下载拒绝保持NOT_OBSERVED，原runner宽期待FAILED不删。`browser-v5-single-trigger-018c/runs/38ddcf56-e47f-42c1-8162-8c5d16d92afa/classification.json`。
- 官方Desktop仍018c；b62固定包安装按钮和路径已重新观察，已有当场确认卡仍待回复，没有以旧018c确认冒作新包授权。

### 历史阻塞：b62 当场安装确认待回复（现已解除）

- 已连续三轮遇到同一缺失确认；本轮再读官方原生安装对话框、真实 desktop dependency 与 Host identity，仍018c，b62未安装。无当前运行任务可等；不受阻的候选/Worker和合成前置已完成。目标状态设blocked，保存接续，不宣READY、不推送。
- 原阻塞收据 `native-final-b62/blocked-install-confirmation.json` 保留不改。随后外部实际安装已观察，安装操作者/动作时间未知；Root已完成真实冷启动及9/9 smoke，目标恢复active，接续以本文顶部为准。

## 已安装 b62 的有限实测（范围与身份保留）

- 译例公共读回53项通过，仅B的Guide/tutorial被保存，A草稿未保存；两段ID/正文/revision0/锁/原件SHA不变。`native-final-b62/exemplar-readback/receipt.json`。
- 官方DSH内PDF三页真实画布/前后翻页，原生下载1522B与导入前SHA一致；公开原件/Worker安全头及确切单行三页提取正文38项通过。Markdown标题/正文实际可见，合成图像行内可见。截图为实际JPEG原始数据，尚未正式归集8PNG/17动作；未声明Worker生命周期、完整Preview或模型审阅。`native-final-b62/preview-readback/pdf-receipt.json`。

- 新建项目五字段：取消后重开保留名称/en-GB/zh-TW/编辑审校/字幕对白；b62成功创建后重置为空名/en-US/zh-CN/翻译/general。旧LA源码默认语言为zh-CN→en-US，这段b62实测存在真实差异；新1649候选已修复四处默认值，尚未原生核验，历史观察不改写。`native-final-b62/create-cancel-reopen.ax.txt`、create-success-reset.ax.txt；源 `projects-atoms.ts:26`。
- 自有自然QA第二轮运行中Stop：`native-final-b62/qa-natural-stop/retry-current/receipt.json` **52项有限通过**；持久Job cancelled、cursor0，零checkpoint、零新增更新，5000句段与20000旧QA全字段不变。首次Stop晚于QA完成8.171秒，`late-attempt-receipt.json`保留 **NOT_OBSERVED / 56检查**，没有将它记为新产品失败；不推导所有专业作业/Worker退出遥测或READY。

下列收据已逐一读回并核SHA；完整SHA见 STATE.json `groupedContractRepair.nativeScopedReadbacks`，均保留b62实际范围，不声明整个D族、全部UI或READY通过。

| 原生分支 | 检查 | 收据（前缀 `artifacts/evidence/native-final-b62/`） | 已观察范围 |
| --- | ---: | --- | --- |
| 接受50条建议 | 35 | `bulk-readback/accepted50-checkpoint.json`，SHA `99d2fb3d…` | 恰50 Target/revision1；status translated、currentStage draft；锁段#3和其余190整行不变，每建议一次mutation。#52当时pending/r0。 |
| 冻结Modal CAS | 40 | `bulk-readback/cas-checkpoint.json`，SHA `d803b18a…` | #52人工r1后实际STALE_PROPOSAL；Modal保留、零额外接受，239其他行不变。 |
| 编辑器SSE冲突 | 38 | `bulk-readback/editor-conflict-checkpoint.json`，SHA `b3ca1bfc…` | 人工r2后SSE先发现冲突，原生草稿保留、Save禁用；未dispatch Save、未观察REVISION_CONFLICT响应。 |
| 201段扫描边界 | 21 | `bulk-readback/scanner201-checkpoint.json`，SHA `d58d4cf8…` | 实际201选择/点击接受被200上限拒绝；240行/51proposal及issuance/history/original完整不变。 |
| Style/Voice | 81 | `style-voice-readback/receipt.json`，SHA `40e4581e…` | Style4同组聚合/未分组末尾；Voice分隔去重、取消不变、保存同ID。实际新增Style4＋Voice1，不宣全部assets不变。 |
| TM变体/来源及CAT | 113 | `tm-readback/receipt.json`，SHA `5f7a633b…` | TM3→5→6；旧3公开身份/文本及disabled/priority37来源元数据保留；Close2变体/2来源；独立带key CAT2段原件/ID/SourceTarget/r0不变。旧全SQL前置未存在，不伪造。 |
| Rename/未来任务暂停 | 61 | `schedule-readback/paused-receipt.json`，SHA `c2177280…` | 项目新名同步badge/CAT/composer，Session title不变；future86400独立owner继承真实模型/权限，暂停、执行0。 |
| 原生恢复未来任务 | 75 | `schedule-readback/active-receipt.json`，SHA `b215cf1e…` | logical ID/source/owner设置保留，新generation/version/due；执行0，canonical2/Style4/Voice1/原件不变。 |
| 保留→确认取消 | 73 | `schedule-readback/cancelled-receipt.json`，SHA `af227231…` | Keep原生仍active，随后真实Confirm移除自有未来任务/generation；sidecar cancelled、owner7 seed/日志不变、无执行。Keep/Confirm间没有独立公共快照；取消后已删除资源History额外探测的INTERNAL保留，不增为取消门禁。 |
