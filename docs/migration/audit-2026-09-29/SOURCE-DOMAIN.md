# 原 LA 领域、工具、岗位与工作流功能审计

审计时间：2026-09-29T12:37:21.611Z。源 HEAD：`70d6b1feab08b2767189e3597a69d81d86adb2a8`；源有效工作树状态：干净（包含未跟踪状态检查）。目标 HEAD：`7df65b06b814e56feb3853c9d3f0067c543c7d31`。

登记安装快照：DSH `0.2.0-rc.1`，LA `9e362081d5d9`。以上是初审登记身份。后续本轮已运行rc.2工作树Host类型及42项合成回归；未安装新包、未调用真实模型或访问客户数据，旧身份不沿用为新包验收。

## 结论

大部分 CAT 领域算法及存储已迁入，现有工具清单之外的 UI 后端也有对应入口。**这不等于完整产品已验收。** 本次从源实际目录独立枚举，按用户功能建立下表，未采纳旧 FEATURE_MAP 的完成标签。

当前已落实与剩余边界：

- **D005 复制会话到其他项目或 Workspace**：原生create/fork/跨Workspace seed保留设置与历史；命名及最终源/目标复核后才建立LA绑定。失败时清除本次副本的LA绑定/工具并await官方workspaceRegistry.archiveSession(id,{stopActivity:true})，退出默认活动列表且可从原生归档恢复。已覆盖持久化但未激活seed，以及原生create/fork的workspace-attach-failed副本身份；拒绝源Session、错误Workspace及无官方标记的错误身份。绑定回滚失败仍尝试归档，任一清理失败都明确报告副本ID和失败状态。 工作树3项定向回归通过；当前安装验收待办。
- **D046 发送时冻结项目、批次、显式段引用与选区**：用户按需点击“附带 CAT 选区”；原生 Reference codec 在实际发送时同步冻结项目、批次、显式句段引用与选区 ID，快照随该条原生 prompt 携带。Host 在 agent/pre-step 等待项目/Workspace 准入，并按实际 user/message source.rpcId 记录。附件、queue/steer 沿官方发送链。该交互已获用户于2026-09-29明确接受。 当前安装产物仍待逐项核验。
- **D033 QA/一致性后台任务、取消与进度**：原领域工具第4个onUpdate已接入适配器，真实Job的running/completed/cancelled通过已有job-updated SSE发布；现有运行页可重读摘要，新增linguistCatGetJob按project/session/job精确授权读取。取消仍沿DSH回合AbortSignal终止worker，不改写假状态。
- **D047 建议/运行的生成来源可追溯性**：每次公开llm/stream观察实际provider/model/工具schemas，校验所装配LA prompt确在该请求system内容中，记录prompt版本/hash及toolsetHash；真实tool/call与PTC root关联此快照，未观察身份拒绝生成来源。后续请求/auxiliary调用不会改写已有call来源。
- **D056 子任务专业完成度回传**：linguist_delegations_list的模型可见结果包含professionalOutcome；从完整冻结delegatedScope计算当前revision、真实子Session actor和Stage决策边界覆盖，另报必要证据/阻塞；部分Stage完成不等于完整委派完成。
- **D060–D065**：六领域Skills及必要references已补齐，通过官方SkillRegistry注册；仍待新安装catalog验证。
- **D059**：飞书通知真实凭据与收件方不在本审计范围。

本轮检查日志：[rc2-host-domain-checks.log](/Users/wangyu/Desktop/Linguist-Agent-DSH/artifacts/evidence/rc2-host-domain-checks.log)；Host类型检查与42项合成回归通过，0跳过。该结果仅覆盖工作树。

D005补充检查：[d005-native-archive-regression.log](/Users/wangyu/Desktop/Linguist-Agent-DSH/artifacts/evidence/d005-native-archive-regression.log)，3项定向回归通过、0跳过；包含真实官方归档持久化及重开恢复。D046精准复审：[native-composer-rc2-public-api-reaudit.json](/Users/wangyu/Desktop/Linguist-Agent-DSH/artifacts/evidence/native-composer-rc2-public-api-reaudit.json)。两者均不代表新包安装验收。

## 集中处理顺序

| 顺序 | 功能 | 类别 | 处理依据 |
|---|---|---|---|
| VERIFY | D005 | implemented_requires_current_install | 原生失败副本归档、错误身份限定与源不变回归通过；待当前安装包验证活动列表退出、归档重开恢复和失败反馈。 |
| VERIFY | D046 | implemented_requires_current_install | 用户已接受按需点击附带CAT选区；发送时冻结、实际rpcId与Host模型前准入有对应实现，待当前安装产物及真实模型逐项验收。 |
| VERIFY | D033、D047、D056、D060、D061、D062、D063、D064、D065 | implemented_requires_current_install | 本轮实现及Host合成检查通过；集中构建新包后验证实际progress/provenance/delegation/Skill catalog，不复用旧安装身份。 |
| VERIFY | D036、D059 | external_runtime_dependency | SDLTB工具运行环境与飞书真实发送分别有外部依赖，未验证不等于核心领域缺失。 |
| RECONCILE | D004、D010、D011、D054、D055、D057、D058、D066、D067、D068 | host_takeover_not_missing_by_default | Session/Workspace/Agent/BrowserSkill等接管有实际入口；升级后核对能力等价与真实流程，不重建宿主。 |

实现、宿主差异、外部依赖和安装态验收分别记录，不把源码修复当作已交付。

## 用户功能索引

“实现存在”只表示找到实际入口并核对了关键合同；“待验”不是“未实现”。测试源文件仅作为回归范围证据，既有执行证据另保留身份。

| ID | 用户功能 | 当前实现结论 | 当前明确差异/验证边界 |
|---|---|---|---|
| D001 | 项目创建、列表、摘要、重命名与排序 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D002 | 项目语言对与已有内容保护 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D003 | 归档、移入回收区、健康与只读状态 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D004 | 项目对话创建、岗位绑定与历史会话列表 | 实现存在，待安装验收 | 升级后确认项目会话列表、空会话岗位选择、已执行会话锁定与归档项目历史打开。 |
| D005 | 复制会话到其他项目或 Workspace | 实现及本轮合成检查通过，待安装验收 | 目标采用DSH可恢复归档清理失败副本，保留原生历史字节；不声称物理删除。stopActivity发出停止请求，持久归档阻止后续模型step，不冒称所有活动已终结。 |
| D006 | General 项目负责人岗位 | 实现存在，待安装验收 | 真实 General 任务使用原生通用工具及 LA 工具，合理选择直做/委派并准确汇报专业覆盖。 |
| D007 | Translator 译者岗位 | 实现存在，待安装验收 | 真实 Translator 合成批次完成读取、写回、当前版本决定与证据，而不只回复岗位名称。 |
| D008 | Reviewer 完整双语审校岗位 | 实现存在，待安装验收 | 真实 Reviewer 无Proposal情况下覆盖完整批次；保留项与修改项都绑定本次actor和当前revision，必要Context模型可见。 |
| D009 | Proofreader 校对岗位 | 实现存在，待安装验收 | 真实 Proofreader 合成批次保留原意、检查技术要求并形成独立当前版本决定。 |
| D010 | 四岗位共享通用工具和完整 CAT 工具 | 实现存在，待安装验收 | 四岗位逐一核对实际模型请求工具集合与用户选定模型/权限；静态全部注册不代表真实会话生效。 |
| D011 | CAT、非 CAT 工作副本、直接网页三种方式 | 实现存在，待安装验收 | 升级后从产品入口分别完成三种合成流程，确认无强制 CAT 导入和无第二套宿主。 |
| D012 | 多文件/目录导入与自动资源分类 | 实现存在，待安装验收 | 多文件及目录相对路径、分类错误、500文件截断、取消、重复文件及受管文件边界。 |
| D013 | XLSX 列映射建议、确认与复用 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D014 | 条件撤销导入 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D015 | 源件、参考和 Context 预览 | 实现存在，待安装验收 | 实际安装中PDF、图片、DOCX/XLSX/PPTX预览、无法提取分支、原件hash不变。 |
| D016 | XLIFF 1.2 格式处理 | 实现存在，待安装验收 | 实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。 |
| D017 | memoQ MQXLIFF 格式处理 | 实现存在，待安装验收 | 实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。 |
| D018 | Trados SDLXLIFF 格式处理 | 实现存在，待安装验收 | 实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。 |
| D019 | Phrase MXLIFF 格式处理 | 实现存在，待安装验收 | 实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。 |
| D020 | Phrase 双语 DOCX 格式处理 | 实现存在，待安装验收 | 实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。 |
| D021 | CSV 双语文本 格式处理 | 实现存在，待安装验收 | 实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。 |
| D022 | JSON 本地化文件 格式处理 | 实现存在，待安装验收 | 实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。 |
| D023 | XLSX 工作簿 格式处理 | 实现存在，待安装验收 | 实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。 |
| D024 | CAT 查询、搜索、分页与稳定定位 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D025 | 人工保存、CAS、锁与修订历史 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D026 | 编辑草稿、撤销重做、IME与重开 | 实现存在，待安装验收 | 目标草稿为Client内存store，插件卸载/冷启动会清空；不要将工作台重挂保持写成跨App重启持久化。 |
| D027 | 模型直接写回与建议写入 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D028 | 建议比较、接受、拒绝、修改后接受、批量及再发 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D029 | 跨批次一致性诊断与修复建议 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D030 | 运行账本、操作历史、最近运行撤销与事件追补 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D031 | 确定性 QA 与技术写入硬门 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D032 | QA 定位、过滤、解决与有理由豁免 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D033 | QA/一致性后台任务、取消与进度 | 本轮实现/合成检查通过，待rc.2安装验收 | 新rc.2安装上运行页持续进度、并发job身份、停止当前DSH会话活动回合及重连最终态；合成回归不能替代桌面验收。 |
| D034 | TM 导入、来源管理与删除 | 实现存在，待安装验收 | 各参考格式安装态导入；停用/优先级更新反映到真实TM检索，删除不误删其他来源。 |
| D035 | TM 模糊/精确/上下文命中及安全引用 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D036 | 术语参考导入与映射预览 | 实现存在，待安装验收 | SDLTB实现沿用外部mdb-tables/mdb-export查找；本次未执行工具，不证明升级后Desktop进程可找到兼容二进制。 |
| D037 | 术语新增更新删除、作用域冲突与验证 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D038 | Context 文档导入、提取、分页与图像 | 实现存在，待安装验收 | 实际模型图像及完整分页证据；SVG/BMP可保存但当前模型readContextImage仅PNG/JPEG/WebP/GIF，不混称全部图片模型已读。 |
| D039 | Context 锚点与批次/句段关联 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D040 | 风格指南与技术约束资产 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D041 | 句式库、人物 Voice 与批准译例 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D042 | 标签族扫描、候选审批与项目语法 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D043 | 项目资料盘点、有效简报与范围路由 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D044 | T/E/P 阶段、人工确认和专业决定覆盖 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D045 | 资料真正进入模型请求的 Stage 证据 | 实现存在，待安装验收 | 升级后实际provider请求/响应、toolCallId/必要全文和图片同链验收；本地观察ID不得冒充远端Provider request ID。 |
| D046 | 发送时冻结项目、批次、显式段引用与选区 | 实现存在，已确认按需附带交互，待安装验收 | 目标采用用户已接受的按需显式附带方式；源 LA 每条普通发送默认自动携带改为本条消息选择附带。发送时冻结范围与同消息真实请求身份的要求保留。 当前安装产物仍需核验引用呈现、发送时冻结、queue/steer及真实请求绑定；43历史观察中user消息显示完整LA-TURN-CONTEXT JSON，仍只作为历史证据。 |
| D047 | 建议/运行的生成来源可追溯性 | 本轮实现/合成检查通过，待rc.2安装验收 | 新安装有限真实模型生成proposal/写回，检查落库issuance的实际provider/model/prompt版本/hash/toolsetHash及toolCallId关联。 |
| D048 | 交付预检、verified/as-is导出及审计清单 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D049 | 格式资格和真实平台交付边界 | 实现存在，待安装验收 | 仅合成内部round-trip可在本次授权验证；真实客户平台资格不能伪造也不在本次授权中。 |
| D050 | 备份、恢复预览、恢复与外部CAT备份导入 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D051 | 历史 LA 项目迁移、孤立素材与旧记录 | 实现存在，待安装验收 | 只用合成旧根测试进度、部分失败、验证和重入；不把未访问客户旧库解释为迁移实现缺失。 |
| D052 | 完整性全检、取消、脱敏诊断和导出报告 | 实现存在，待安装验收 | 升级后包内worker路径、取消、真实全检、诊断报告下载与字段脱敏；Prompt/工具数量未观察要显示未知。 |
| D053 | 不导入CAT的双语工作副本和跨阶段接续 | 实现存在，待安装验收 | 通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。 |
| D054 | 直接网页业务与同链下载上传 | 宿主接管＋薄适配 | 现有43 CLI/daemon/extension localhost通过不是升级后DSH模型browser_*调用、取消/借还页的完整验收。 |
| D055 | 原生专业子任务、输入交接、续聊和中断 | 实现存在，待安装验收 | 真实父子模型任务、完整输入到达、角色/模型/权限继承、终止与续聊、禁止越界写。 |
| D056 | 子任务专业完成度回传 | 本轮实现/合成检查通过，待rc.2安装验收 | 新安装真实父/子会话读取professionalOutcome，并核对未裁定、其他actor及旧revision均不能冒称完成。 |
| D057 | 定时任务冻结范围与独立运行会话 | 实现存在，待安装验收 | 升级后真实到期运行、来源Session关闭/删除后的独立运行、冻结scope、实际模型设置及权限保持。 |
| D058 | 定时任务创建、修改、暂停恢复、立即运行和历史 | 实现存在，待安装验收 | 真实调度/手动运行/取消、失败暂停恢复、重开后的完整历史；不得以测试替身记录代替已安装原生运行。 |
| D059 | 定时任务飞书通知 | 实现存在，需外部验证 | 本次未读凭据、未对外发送；真实飞书凭据/接收方未验证，属于外部环境验收。 |
| D060 | 游戏本地化作业技能 | 本轮实现/合成检查通过，待rc.2安装验收 | 新包tarball资源、官方Desktop实际Skill catalog/get及references可读；核对用户已有同名Skill的胜出来源，不覆盖用户自定义。 |
| D061 | 文化与语用审查技能 | 本轮实现/合成检查通过，待rc.2安装验收 | 新包tarball资源、官方Desktop实际Skill catalog/get及references可读；核对用户已有同名Skill的胜出来源，不覆盖用户自定义。 |
| D062 | 本地化开工准备度技能 | 本轮实现/合成检查通过，待rc.2安装验收 | 新包tarball资源、官方Desktop实际Skill catalog/get及references可读；核对用户已有同名Skill的胜出来源，不覆盖用户自定义。 |
| D063 | 交付前LQA检查技能 | 本轮实现/合成检查通过，待rc.2安装验收 | 新包tarball资源、官方Desktop实际Skill catalog/get及references可读；核对用户已有同名Skill的胜出来源，不覆盖用户自定义。 |
| D064 | 术语候选挖掘技能 | 本轮实现/合成检查通过，待rc.2安装验收 | 新包tarball资源、官方Desktop实际Skill catalog/get及references可读；核对用户已有同名Skill的胜出来源，不覆盖用户自定义。 |
| D065 | 译者简报与专业交接技能 | 本轮实现/合成检查通过，待rc.2安装验收 | 新包tarball资源、官方Desktop实际Skill catalog/get及references可读；核对用户已有同名Skill的胜出来源，不覆盖用户自定义。 |
| D066 | 宿主通用能力接管边界 | 宿主接管，等价性待核 | 不能从DSH拥有扩展点推导原LA所有具体Provider登录、语音、远程桥、默认技能、Planning等都逐项等价；这些需宿主专项清单核对。 |
| D067 | 解绑项目并保留普通原生对话 | 实现存在，待安装验收 | 实际已执行会话停止后解绑，历史/附件保留、LA工具解绑、任务停止规则明确。 |
| D068 | UI后端调用、项目变更事件与错误反馈 | 实现存在，待安装验收 | 升级后实际origin/webServer路由、同源文件token、断连重连/事件ACK和所有UI操作错误；自动漏项表只检入口不证明行为。 |

## 逐项合同与代码入口

### D001 项目创建、列表、摘要、重命名与排序

- 原行为：创建独立项目；项目名/语言对/稳定ID持久化；活跃项目排序必须是完整无重复集合；列表与摘要读取真实数据。
- 源入口：[apps/electron/src/main/lib/linguist/project-service.ts · createProject](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-service.ts:108)；[apps/electron/src/main/lib/linguist/project-ipc.ts · reorderActive](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-ipc.ts:545)
- 目标入口：[packages/linguist-domain-service/src/project-service.ts · createProject](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-service.ts:106)；[packages/dsh-linguist/src/host/operations.ts · linguistProjectsReorderActive](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:358)；[packages/dsh-linguist/src/client/ProjectsPage.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/ProjectsPage.tsx:1)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_project_summary`。
- 回归定义：`packages/linguist-domain-service/src/domain-service.nodetest.ts`、`packages/dsh-linguist/src/host/operations.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D002 项目语言对与已有内容保护

- 原行为：设置地区语言；存在批次、TM或术语时拒绝会改变已有数据语义的语言对修改，返回真实阻断数量。
- 源入口：[apps/electron/src/main/lib/linguist/project-service.ts · setProjectLocales](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-service.ts:314)
- 目标入口：[packages/linguist-domain-service/src/project-service.ts · setProjectLocales](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-service.ts:298)；[packages/dsh-linguist/src/host/operations.ts · linguistProjectsSetLocales](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:352)；[packages/dsh-linguist/src/client/ProjectLocaleSelect.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/ProjectLocaleSelect.tsx:1)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/locale-select.nodetest.mjs`、`packages/linguist-domain-service/src/domain-service.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D003 归档、移入回收区、健康与只读状态

- 原行为：归档后可读/备份但禁止领域写入；删除要求名称确认并保留回收目录；数据库身份/损坏不可伪装空项目。
- 源入口：[apps/electron/src/main/lib/linguist/project-service.ts · archiveProject](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-service.ts:341)；[apps/electron/src/main/lib/linguist/project-service.ts · deleteProject](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-service.ts:353)；[packages/linguist-cat-store/src/project-database.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-store/src/project-database.ts:1)
- 目标入口：[packages/linguist-domain-service/src/project-service.ts · archiveProject](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-service.ts:325)；[packages/linguist-domain-service/src/project-service.ts · deleteProject](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-service.ts:337)；[packages/dsh-linguist/src/host/operations.ts · linguistProjectsCheckHealth](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:337)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/acceptance.nodetest.mjs`、`packages/linguist-cat-store/src/database.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D004 项目对话创建、岗位绑定与历史会话列表

- 原行为：项目/Workspace/Session对应明确；新会话设置岗位，已有用户对话后禁止换岗位；项目不可用时历史会话仍可读。
- 源入口：[apps/electron/src/main/lib/linguist/session-ipc.ts · createForProject](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/session-ipc.ts:6)；[apps/electron/src/main/lib/agent-session-manager.ts · updateAgentSessionLinguistRole](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/agent-session-manager.ts:829)
- 目标入口：[packages/dsh-linguist/src/host/bindings.ts · BindingStore](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/bindings.ts:22)；[packages/dsh-linguist/src/host/http.ts · /la/v1/session-bind](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/http.ts:53)；[packages/dsh-linguist/src/client/ProjectSessions.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/ProjectSessions.tsx:1)；[packages/dsh-linguist/src/client/api.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/api.ts:1)
- 状态：实现存在，待安装验收。宿主负责：DSH sessionController/sessionPersistence/workspaceRegistry 管理原生会话及工作区。
- 回归定义：`tests/copied-host/prompt-and-session-http.nodetest.ts`、`tests/copied-renderer/session-navigation.nodetest.mjs`；既有证据：E-REQUIRED。
- 待验：升级后确认项目会话列表、空会话岗位选择、已执行会话锁定与归档项目历史打开。

### D005 复制会话到其他项目或 Workspace

- 原行为：源会话必须安全完成；复制保留历史与设置、切换目标项目及工作区，源不变；取得副本身份后失败会尝试移除索引、消息与会话目录，文件清理失败可遗留，不是原子删除事务。
- 源入口：[apps/electron/src/main/lib/linguist/session-copy.ts · export async function copyLinguistSessionToProject](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/session-copy.ts:205)；[apps/electron/src/main/lib/agent-session-manager.ts · export function deleteAgentSession](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/agent-session-manager.ts:856)
- 目标入口：[packages/dsh-linguist/src/client/SessionCopyPage.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/SessionCopyPage.tsx:1)；[packages/dsh-linguist/src/host/session-copy.ts · export async function copyLinguistSessionToProject](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/session-copy.ts:102)；[packages/dsh-linguist/src/host/http.ts · export function invokeError](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/http.ts:186)；[packages/linguist-domain-service/src/client-contracts.ts · SESSION_COPY_FAILED](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/client-contracts.ts:54)；[packages/dsh-linguist/src/client/project-errors.ts · export function describeProjectError](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/project-errors.ts:42)
- 状态：实现及本轮合成检查通过，待安装验收。宿主负责：DSH create/fork/buildForkSeed/sessionPersistence；DSH WorkspaceRegistry.archiveSession/unarchiveSession 与原生归档可见性。
- 当前实现：原生create/fork/跨Workspace seed保留设置与历史；命名及最终源/目标复核后才建立LA绑定。失败时清除本次副本的LA绑定/工具并await官方workspaceRegistry.archiveSession(id,{stopActivity:true})，退出默认活动列表且可从原生归档恢复。已覆盖持久化但未激活seed，以及原生create/fork的workspace-attach-failed副本身份；拒绝源Session、错误Workspace及无官方标记的错误身份。绑定回滚失败仍尝试归档，任一清理失败都明确报告副本ID和失败状态。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；证据：E-REQUIRED、E-RC2-HOST、E-COPY-RC2。
- 具体差异：目标采用DSH可恢复归档清理失败副本，保留原生历史字节；不声称物理删除。stopActivity发出停止请求，持久归档阻止后续模型step，不冒称所有活动已终结。
- 待验：当前安装包验证同/跨Workspace复制及命名/绑定/归档失败；检查副本退出活动列表、归档重开后可恢复，源会话不变，并确认界面准确区分归档成功与清理失败。

### D006 General 项目负责人岗位

- 原行为：复用现有输入与要求；小任务直接做，需独立职责时委派 T/E/P；分清语言成果、写回、QA、Stage和平台状态。
- 源入口：[resources/linguist-roles/general.md](/Users/wangyu/Desktop/linguist-agent-next/resources/linguist-roles/general.md:1)；[apps/electron/src/main/lib/linguist/linguist-prompt-builder.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/linguist-prompt-builder.ts:1)
- 目标入口：[packages/dsh-linguist/resources/linguist-roles/general.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/linguist-roles/general.md:1)；[packages/dsh-linguist/src/host/diagnostics.ts · buildLinguistPromptSection](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/diagnostics.ts:131)；[packages/dsh-linguist/src/index.ts · linguist-role](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:56)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED、E-ROLES-E4。
- 待验：真实 General 任务使用原生通用工具及 LA 工具，合理选择直做/委派并准确汇报专业覆盖。

### D007 Translator 译者岗位

- 原行为：理解完整源义、用途、上下文和声音，保留机制/数字/标签，交付自然可用译文；不强制多方案或无依据增写。
- 源入口：[resources/linguist-roles/translator.md](/Users/wangyu/Desktop/linguist-agent-next/resources/linguist-roles/translator.md:1)；[apps/electron/src/main/lib/linguist/session-cat-tools.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/session-cat-tools.ts:1)
- 目标入口：[packages/dsh-linguist/resources/linguist-roles/translator.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/linguist-roles/translator.md:1)；[packages/dsh-linguist/src/index.ts · prepareStage](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:151)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/acceptance.nodetest.mjs`、`packages/linguist-cat-tools/src/tools.nodetest.ts`；既有证据：E-REQUIRED、E-ROLES-E4。
- 待验：真实 Translator 合成批次完成读取、写回、当前版本决定与证据，而不只回复岗位名称。

### D008 Reviewer 完整双语审校岗位

- 原行为：审查声明范围内完整 Source/current Target/必要依据；不以 Proposal、差异或 QA 作为前提；unchanged 是真实决定，省略不算已审。
- 源入口：[resources/linguist-roles/reviewer.md](/Users/wangyu/Desktop/linguist-agent-next/resources/linguist-roles/reviewer.md:1)；[apps/electron/src/main/lib/linguist/stage-evidence-host.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/stage-evidence-host.ts:1)
- 目标入口：[packages/dsh-linguist/resources/linguist-roles/reviewer.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/linguist-roles/reviewer.md:1)；[packages/dsh-linguist/src/index.ts · prepareStage](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:151)；[packages/linguist-cat-tools/src/stage-tools.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-tools/src/stage-tools.ts:1)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/copied-host/stage-evidence-host.nodetest.ts`、`packages/linguist-cat-tools/src/tools.nodetest.ts`；既有证据：E-REQUIRED、E-ROLES-E4。
- 待验：真实 Reviewer 无Proposal情况下覆盖完整批次；保留项与修改项都绑定本次actor和当前revision，必要Context模型可见。

### D009 Proofreader 校对岗位

- 原行为：整体阅读最新目标语；必要时回看源文；保护角色风格、标签/换行；不将文本检查说成游戏内LQA。
- 源入口：[resources/linguist-roles/proofreader.md](/Users/wangyu/Desktop/linguist-agent-next/resources/linguist-roles/proofreader.md:1)
- 目标入口：[packages/dsh-linguist/resources/linguist-roles/proofreader.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/linguist-roles/proofreader.md:1)；[packages/dsh-linguist/src/index.ts · prepareStage](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:151)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED、E-ROLES-E4。
- 待验：真实 Proofreader 合成批次保留原意、检查技术要求并形成独立当前版本决定。

### D010 四岗位共享通用工具和完整 CAT 工具

- 原行为：岗位改变责任，不剥夺基础 Agent 工具、用户模型或权限；领域工具统一从当前 Session binding 找项目。
- 源入口：[apps/electron/src/main/lib/linguist/agent-tool-composition.ts · composeAgentTools](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/agent-tool-composition.ts:11)；[packages/linguist-cat-tools/src/factory.ts · createLinguistCatTools](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/factory.ts:25)
- 目标入口：[packages/dsh-linguist/src/index.ts · bindAgent](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:75)；[packages/dsh-linguist/src/host/cat-deps.ts · createCatDeps](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/cat-deps.ts:35)；[packages/linguist-cat-tools/src/factory.ts · createLinguistCatTools](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-tools/src/factory.ts:25)
- 状态：实现存在，待安装验收。宿主负责：DSH 管通用工具、Provider、模型、权限和Agent循环。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED。
- 待验：四岗位逐一核对实际模型请求工具集合与用户选定模型/权限；静态全部注册不代表真实会话生效。

### D011 CAT、非 CAT 工作副本、直接网页三种方式

- 原行为：CAT管理项目数据库；工作副本保留原件、不强制导入；网页作业直接使用浏览器链，不把下载或网页确认等同本地审校完成。
- 源入口：[apps/electron/src/main/lib/linguist/working-copy-tool.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/working-copy-tool.ts:1)；[packages/shared/src/types/agent-profile.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/shared/src/types/agent-profile.ts:1)
- 目标入口：[packages/dsh-linguist/src/host/bindings.ts · LinguistWorkMode](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/bindings.ts:5)；[packages/dsh-linguist/src/host/http.ts · isWorkMode](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/http.ts:64)；[packages/dsh-linguist/src/client/ProjectsPage.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/ProjectsPage.tsx:1)；[packages/dsh-linguist/src/client/WorkingCopyPage.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/WorkingCopyPage.tsx:1)
- 状态：实现存在，待安装验收。宿主负责：浏览器链由 BrowserSkill；原生对话仍由 DSH。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED。
- 待验：升级后从产品入口分别完成三种合成流程，确认无强制 CAT 导入和无第二套宿主。

### D012 多文件/目录导入与自动资源分类

- 原行为：批次/TM/TB/Context自动分类，保留未知/失败/待映射分支；扫描上限返回truncated；导入不覆盖原件。
- 源入口：[apps/electron/src/main/lib/linguist/project-file-intake.ts · importProjectResources](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-file-intake.ts:251)；[apps/electron/src/main/lib/linguist/project-ipc.ts · import](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-ipc.ts:5)；[packages/linguist-cat-tools/src/intake-tools.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/intake-tools.ts:1)
- 目标入口：[packages/linguist-domain-service/src/project-file-intake.ts · importProjectResources](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-file-intake.ts:251)；[packages/dsh-linguist/src/host/operations.ts · linguistProjectsImport](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:459)；[packages/dsh-linguist/src/host/files.ts · ManagedFiles](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/files.ts:16)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_import_resources`。
- 回归定义：`packages/linguist-domain-service/src/project-file-intake.test.ts`、`tests/copied-host/project-import-preview.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：多文件及目录相对路径、分类错误、500文件截断、取消、重复文件及受管文件边界。

### D013 XLSX 列映射建议、确认与复用

- 原行为：预览工作表/样例，建议 key/source/target/locked/context/speaker/status；用文件fingerprint/表头signature匹配映射，歧义必须显式确认。
- 源入口：[apps/electron/src/main/lib/linguist/project-workbook-mapping.ts · suggestProjectWorkbookMapping](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-workbook-mapping.ts:69)；[packages/linguist-cat-tools/src/workbook-tools.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/workbook-tools.ts:1)
- 目标入口：[packages/linguist-domain-service/src/project-workbook-mapping.ts · suggestProjectWorkbookMapping](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-workbook-mapping.ts:69)；[packages/dsh-linguist/src/host/operations.ts · linguistProjectsConfirmXlsxMapping](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:461)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_preview_workbook_mapping`、`cat_save_workbook_mapping`。
- 回归定义：`packages/linguist-domain-service/src/project-file-intake.test.ts`、`packages/linguist-cat-tools/src/tools.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D014 条件撤销导入

- 原行为：仅在未编辑、无提案/QA/导出/Job等下游依赖时撤销导入；有依赖返回具体数量，不级联破坏成果。
- 源入口：[apps/electron/src/main/lib/linguist/project-delivery.ts · undoImportAsset](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-delivery.ts:876)
- 目标入口：[packages/linguist-domain-service/src/project-delivery.ts · undoImportAsset](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-delivery.ts:876)；[packages/dsh-linguist/src/host/operations.ts · linguistProjectsUndoImportAsset](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:453)
- 状态：实现存在，待安装验收。
- 回归定义：`packages/linguist-domain-service/src/domain-service.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D015 源件、参考和 Context 预览

- 原行为：原件只读；文本、PDF/图片、Office采用相应预览；展示截断和不支持状态，不把预览转换当交付。
- 源入口：[apps/electron/src/main/lib/linguist/project-ipc.ts · previewAssetSource](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-ipc.ts:122)；[apps/electron/src/main/lib/linguist/assets-ipc.ts · previewContextDoc](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/assets-ipc.ts:80)
- 目标入口：[packages/dsh-linguist/src/host/operations.ts · linguistProjectsPreviewAssetSource](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:463)；[packages/linguist-domain-service/src/office-preview.ts · convertOfficePreviewToHtml](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/office-preview.ts:19)；[packages/dsh-linguist/src/client/PreviewView.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/PreviewView.tsx:1)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED。
- 待验：实际安装中PDF、图片、DOCX/XLSX/PPTX预览、无法提取分支、原件hash不变。

### D016 XLIFF 1.2 格式处理

- 原行为：标准XLIFF 1.2导入/导出；稳定unit/segment身份、inline和目标状态按adapter合同回写。
- 源入口：[packages/linguist-cat-formats/src/adapters/xliff.ts · XliffAdapter](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-formats/src/adapters/xliff.ts:2)
- 目标入口：[packages/linguist-cat-formats/src/adapters/xliff.ts · XliffAdapter](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-formats/src/adapters/xliff.ts:2)；[packages/linguist-domain-service/src/format-registry.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/format-registry.ts:1)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/acceptance.nodetest.mjs`、`packages/linguist-cat-formats/src/adapters/xliff.test.ts`；既有证据：E-REQUIRED、E-DOMAIN。
- 待验：实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。

### D017 memoQ MQXLIFF 格式处理

- 原行为：memoQ原生结构、锁、标签、状态与已存在目标保留，round-trip检查段落集合。
- 源入口：[packages/linguist-cat-formats/src/adapters/mqxliff.ts · MqXliffAdapter](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-formats/src/adapters/mqxliff.ts:113)
- 目标入口：[packages/linguist-cat-formats/src/adapters/mqxliff.ts · MqXliffAdapter](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-formats/src/adapters/mqxliff.ts:113)；[packages/linguist-domain-service/src/format-registry.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/format-registry.ts:1)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/acceptance.nodetest.mjs`、`packages/linguist-cat-formats/src/adapters/mqxliff.test.ts`；既有证据：E-REQUIRED、E-DOMAIN。
- 待验：实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。

### D018 Trados SDLXLIFF 格式处理

- 原行为：SDL分段/合并和原生状态按同一adapter导入导出，不能仅产普通XLIFF冒充原生交付。
- 源入口：[packages/linguist-cat-formats/src/adapters/sdlxliff.ts · SdlXliffAdapter](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-formats/src/adapters/sdlxliff.ts:2)
- 目标入口：[packages/linguist-cat-formats/src/adapters/sdlxliff.ts · SdlXliffAdapter](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-formats/src/adapters/sdlxliff.ts:2)；[packages/linguist-domain-service/src/format-registry.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/format-registry.ts:1)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/acceptance.nodetest.mjs`、`packages/linguist-cat-formats/src/adapters/sdlxliff.test.ts`；既有证据：E-REQUIRED、E-DOMAIN。
- 待验：实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。

### D019 Phrase MXLIFF 格式处理

- 原行为：Phrase namespace/原生标签/状态及原件结构保留；扩展名异常仍按内容识别；网页平台资格另判。
- 源入口：[packages/linguist-cat-formats/src/adapters/phrasemxliff.ts · PhraseMxliffAdapter](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-formats/src/adapters/phrasemxliff.ts:2)
- 目标入口：[packages/linguist-cat-formats/src/adapters/phrasemxliff.ts · PhraseMxliffAdapter](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-formats/src/adapters/phrasemxliff.ts:2)；[packages/linguist-domain-service/src/format-registry.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/format-registry.ts:1)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/acceptance.nodetest.mjs`、`packages/linguist-cat-formats/src/adapters/phrasemxliff.test.ts`；既有证据：E-REQUIRED、E-DOMAIN。
- 待验：实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。

### D020 Phrase 双语 DOCX 格式处理

- 原行为：按Phrase双语DOCX表结构导入和原件回写；原生标签占位对应保留，不泛称任意Word翻译。
- 源入口：[packages/linguist-cat-formats/src/adapters/phrasedocx.ts · PhraseDocxAdapter](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-formats/src/adapters/phrasedocx.ts:2)
- 目标入口：[packages/linguist-cat-formats/src/adapters/phrasedocx.ts · PhraseDocxAdapter](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-formats/src/adapters/phrasedocx.ts:2)；[packages/linguist-domain-service/src/format-registry.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/format-registry.ts:1)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED、E-DOMAIN。
- 待验：实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。

### D021 CSV 双语文本 格式处理

- 原行为：RFC4180引号、逗号、换行、列映射及非目标列保留；稳定行身份。
- 源入口：[packages/linguist-cat-formats/src/adapters/csv.ts · CsvAdapter](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-formats/src/adapters/csv.ts:2)
- 目标入口：[packages/linguist-cat-formats/src/adapters/csv.ts · CsvAdapter](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-formats/src/adapters/csv.ts:2)；[packages/linguist-domain-service/src/format-registry.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/format-registry.ts:1)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED、E-DOMAIN。
- 待验：实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。

### D022 JSON 本地化文件 格式处理

- 原行为：保留key/层级/非文本原始字节；排除配置JSON和工作稿。目标另排除mapping配置误识别。
- 源入口：[packages/linguist-cat-formats/src/adapters/json.ts · JsonAdapter](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-formats/src/adapters/json.ts:2)
- 目标入口：[packages/linguist-cat-formats/src/adapters/json.ts · JsonAdapter](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-formats/src/adapters/json.ts:2)；[packages/linguist-domain-service/src/format-registry.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/format-registry.ts:1)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED、E-DOMAIN。
- 待验：实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。

### D023 XLSX 工作簿 格式处理

- 原行为：工作表、行列、公式/样式和锁语义保留；只改映射目标列并回验，明确不支持结构。
- 源入口：[packages/linguist-cat-formats/src/adapters/xlsx.ts · XlsxAdapter](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-formats/src/adapters/xlsx.ts:2)
- 目标入口：[packages/linguist-cat-formats/src/adapters/xlsx.ts · XlsxAdapter](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-formats/src/adapters/xlsx.ts:2)；[packages/linguist-domain-service/src/format-registry.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/format-registry.ts:1)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/acceptance.nodetest.mjs`、`packages/linguist-cat-formats/src/adapters/xlsx.test.ts`；既有证据：E-REQUIRED、E-DOMAIN。
- 待验：实际插件包导入→改目标→导出→重新导入合成样例，核对原件/稳定ID/锁/标签/状态；真实客户平台资格仍未验证。

### D024 CAT 查询、搜索、分页与稳定定位

- 原行为：同过滤条件下行数/索引/分页一致；asset/status/currentStageState/source-or-target字面搜索；上下文以稳定ID读取，不依赖虚拟窗口。
- 源入口：[apps/electron/src/main/lib/linguist/cat-workspace-ipc.ts · query](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/cat-workspace-ipc.ts:44)；[packages/linguist-cat-store/src/repositories/segments.ts · queryIndex](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-store/src/repositories/segments.ts:117)
- 目标入口：[packages/dsh-linguist/src/host/operations.ts · linguistCatQuery](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:473)；[packages/linguist-domain-service/src/project-quality.ts · queryCatWorkspace](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-quality.ts:44)；[packages/dsh-linguist/src/client/CatWorkbench.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/CatWorkbench.tsx:1)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_list_batches`、`cat_get_segments`。
- 回归定义：`packages/linguist-cat-store/src/segments.nodetest.ts`、`tests/copied-renderer/workbench-location.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D025 人工保存、CAS、锁与修订历史

- 原行为：编辑通过expectedRevision CAS；锁定拒写；修改产生revision/history并取消过时确认；陈旧保存不覆盖新Target。
- 源入口：[apps/electron/src/main/lib/linguist/project-quality.ts · editSegment](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-quality.ts:345)；[packages/linguist-cat-core/src/segment.ts · applyTargetEdit](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-core/src/segment.ts:90)；[packages/linguist-cat-store/src/repositories/segments.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-store/src/repositories/segments.ts:1)
- 目标入口：[packages/linguist-domain-service/src/project-quality.ts · editSegment](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-quality.ts:345)；[packages/dsh-linguist/src/host/operations.ts · linguistCatEditSegment](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:483)；[packages/linguist-cat-store/src/repositories/segments.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-store/src/repositories/segments.ts:1)
- 状态：实现存在，待安装验收。
- 回归定义：`packages/linguist-cat-store/src/segments.nodetest.ts`、`tests/required/cat-editor-remount.nodetest.mjs`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D026 编辑草稿、撤销重做、IME与重开

- 原行为：原子标签编辑、草稿撤销/重做、输入法组合、保存中只读、revision冲突保留草稿；关闭再开工作台应保留本会话草稿。
- 源入口：[apps/electron/src/renderer/features/linguist/projects/cat-edit-utils.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/renderer/features/linguist/projects/cat-edit-utils.ts)；[apps/electron/src/renderer/features/linguist/projects/tag-atomic-utils.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/renderer/features/linguist/projects/tag-atomic-utils.ts)
- 目标入口：[packages/dsh-linguist/src/client/TargetEditor.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/TargetEditor.tsx:1)；[packages/dsh-linguist/src/client/cat-editor-state.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/cat-editor-state.ts:1)；[packages/dsh-linguist/src/client/CatWorkbench.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/CatWorkbench.tsx:1)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/copied-renderer/cat-editor-logic.nodetest.ts`、`tests/required/cat-editor-remount.nodetest.mjs`；既有证据：E-REQUIRED。
- 具体差异：目标草稿为Client内存store，插件卸载/冷启动会清空；不要将工作台重挂保持写成跨App重启持久化。
- 待验：原生桌面实际中文IME、标签选择、撤销、保存等待期间关开、晚到回执、同段新草稿与跨Session隔离；测试harness不替代真实编辑器。

### D027 模型直接写回与建议写入

- 原行为：apply/proposal共用完整硬门、CAS、锁、术语与幂等run；成功回执携带真实revision，不靠模型自报。
- 源入口：[packages/linguist-cat-tools/src/proposal-tools.ts · cat_apply_translations](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/proposal-tools.ts:90)；[packages/linguist-cat-store/src/repositories/proposals.ts · applyTranslations](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-store/src/repositories/proposals.ts:151)
- 目标入口：[packages/linguist-cat-tools/src/proposal-tools.ts · cat_apply_translations](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-tools/src/proposal-tools.ts:90)；[packages/dsh-linguist/src/host/operations.ts · linguistProposalsApplyTranslations](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:764)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_apply_translations`、`cat_propose_translations`。
- 回归定义：`packages/linguist-cat-store/src/store.nodetest.ts`、`packages/linguist-cat-tools/src/tools.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D028 建议比较、接受、拒绝、修改后接受、批量及再发

- 原行为：读取当前/提案/源文和baseRevision；单/批量审核使用CAS与idempotencyKey；终态建议明确reissue而非复活旧回执。
- 源入口：[apps/electron/src/main/lib/linguist/proposal-ipc.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/proposal-ipc.ts:1)；[packages/linguist-cat-tools/src/proposal-tools.ts · cat_get_proposal_snapshot](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/proposal-tools.ts:66)
- 目标入口：[packages/dsh-linguist/src/host/operations.ts · linguistProposalsGetDiff](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:748)；[packages/dsh-linguist/src/host/operations.ts · linguistProposalsReissue](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:801)；[packages/dsh-linguist/src/client/Panels.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/Panels.tsx:1)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_get_proposal_snapshot`、`cat_accept_proposals`。
- 回归定义：`packages/linguist-cat-store/src/store.nodetest.ts`、`packages/dsh-linguist/src/host/operations.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D029 跨批次一致性诊断与修复建议

- 原行为：按重复源文/目标等证据制定一致性计划，保留合理语境差异；可创建建议，不做盲目全局替换。
- 源入口：[packages/linguist-cat-core/src/batch-consistency.ts · analyzeBatchConsistency](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-core/src/batch-consistency.ts:104)；[packages/linguist-cat-tools/src/proposal-tools.ts · cat_plan_consistency_repairs](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/proposal-tools.ts:462)
- 目标入口：[packages/linguist-cat-core/src/batch-consistency.ts · analyzeBatchConsistency](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-core/src/batch-consistency.ts:104)；[packages/linguist-cat-tools/src/proposal-tools.ts · cat_create_consistency_proposals](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-tools/src/proposal-tools.ts:471)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_plan_consistency_repairs`、`cat_create_consistency_proposals`。
- 回归定义：`packages/linguist-cat-tools/src/tools.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D030 运行账本、操作历史、最近运行撤销与事件追补

- 原行为：持久化run/job/event/CAS变化；撤销要求仍是最近run且当前值匹配，不覆盖之后人工编辑；mutation事件按序分页和ACK。
- 源入口：[packages/linguist-cat-store/src/run-harness.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-store/src/run-harness.ts:1)；[apps/electron/src/main/lib/linguist/cat-workspace-ipc.ts · undoLatestRun](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/cat-workspace-ipc.ts:213)
- 目标入口：[packages/linguist-cat-store/src/run-harness.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-store/src/run-harness.ts:1)；[packages/dsh-linguist/src/host/operations.ts · linguistCatUndoLatestRun](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:559)；[packages/dsh-linguist/src/client/RunPanel.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/RunPanel.tsx:1)
- 状态：实现存在，待安装验收。
- 回归定义：`packages/linguist-cat-store/src/store.nodetest.ts`、`packages/linguist-cat-tools/src/tools.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D031 确定性 QA 与技术写入硬门

- 原行为：占位符/ICU/原生及项目标签/配平嵌套/数字/换行/锁/空译/必需禁用术语硬门；QA另含空白、标点、重复词、URL/email、字母数字、一致性/长度/残留CJK等；general/subtitle不同。
- 源入口：[packages/linguist-cat-core/src/hard-rules.ts · DETERMINISTIC_HARD_RULE_CODES](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-core/src/hard-rules.ts:27)；[packages/linguist-cat-core/src/qa-core.ts · QA_RULE_CODES](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-core/src/qa-core.ts:14)
- 目标入口：[packages/linguist-cat-core/src/hard-rules.ts · runDeterministicHardRules](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-core/src/hard-rules.ts:563)；[packages/linguist-cat-core/src/qa-core.ts · runQa](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-core/src/qa-core.ts:455)；[packages/linguist-cat-tools/src/qa-tools.ts · cat_run_qa](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-tools/src/qa-tools.ts:37)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_run_qa`。
- 回归定义：`packages/linguist-cat-core/src/hard-rules.test.ts`、`packages/linguist-cat-core/src/qa-core.test.ts`；既有证据：E-DOMAIN、E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D032 QA 定位、过滤、解决与有理由豁免

- 原行为：按code/status/severity/disposition/segment过滤；保留产生版本和当前版本；解决/豁免及批量豁免需真实原因/操作者，重跑保持生命周期。
- 源入口：[apps/electron/src/main/lib/linguist/cat-workspace-ipc.ts · waiveQaFindings](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/cat-workspace-ipc.ts:550)；[packages/linguist-cat-store/src/repositories/qa-findings.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-store/src/repositories/qa-findings.ts:1)
- 目标入口：[packages/dsh-linguist/src/host/operations.ts · linguistCatWaiveQaFindingsBulk](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:549)；[packages/linguist-domain-service/src/project-quality.ts · resolveQaFinding](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-quality.ts:263)；[packages/dsh-linguist/src/client/Panels.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/Panels.tsx:1)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_get_qa_findings`。
- 回归定义：`packages/linguist-cat-store/src/store.nodetest.ts`、`packages/dsh-linguist/src/host/operations.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D033 QA/一致性后台任务、取消与进度

- 原行为：worker_threads承担计算；冻结输入、记录job cursor/state；AbortSignal取消；原工具onUpdate报告真实进度。
- 源入口：[apps/electron/src/main/lib/linguist/cat-job-worker-client.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/cat-job-worker-client.ts:1)；[packages/linguist-cat-tools/src/qa-tools.ts · publishProgress](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/qa-tools.ts:140)；[packages/linguist-cat-tools/src/job-runner.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/job-runner.ts:1)
- 目标入口：[packages/linguist-domain-service/src/cat-job-worker-client.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/cat-job-worker-client.ts:1)；[packages/dsh-linguist/src/host/cat-deps.ts · qaWorker](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/cat-deps.ts:58)；[packages/dsh-linguist/src/host/tool-adapter.ts · adaptCatTool](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/tool-adapter.ts:9)；[packages/dsh-linguist/src/index.ts · kind: 'job-updated'](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:223)；[packages/dsh-linguist/src/host/operations.ts · case 'linguistCatGetJob'](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:559)
- 状态：本轮实现/合成检查通过，待rc.2安装验收。宿主负责：DSH拥有工具执行及取消；rc.2 ToolRunContext无过程update接口，实时进度使用同一LA工作台HTTP/SSE。
- 当前实现：原领域工具第4个onUpdate已接入适配器，真实Job的running/completed/cancelled通过已有job-updated SSE发布；现有运行页可重读摘要，新增linguistCatGetJob按project/session/job精确授权读取。取消仍沿DSH回合AbortSignal终止worker，不改写假状态。
- 回归定义：`packages/linguist-domain-service/src/cat-job-worker-client.nodetest.ts`、`packages/linguist-cat-tools/src/tools.nodetest.ts`、`tests/required/acceptance.nodetest.mjs`；证据：E-REQUIRED、E-RC2-HOST。
- 待验：新rc.2安装上运行页持续进度、并发job身份、停止当前DSH会话活动回合及重连最终态；合成回归不能替代桌面验收。

### D034 TM 导入、来源管理与删除

- 原行为：TMX、CSV、XLSX、SDLTM导入；原始来源/语言方向/重复导入和provenance保留；可启停来源/调整优先级及删除。
- 源入口：[apps/electron/src/main/lib/linguist/project-resource-parsers.ts · parseTmReference](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-resource-parsers.ts:95)；[apps/electron/src/main/lib/linguist/project-resources.ts · updateTmSource](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-resources.ts:177)
- 目标入口：[packages/linguist-domain-service/src/project-resource-parsers.ts · parseTmReference](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-resource-parsers.ts:95)；[packages/dsh-linguist/src/host/operations.ts · linguistReferencesUpdateTmSource](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:843)
- 状态：实现存在，待安装验收。
- 回归定义：`packages/linguist-domain-service/src/domain-service.nodetest.ts`、`packages/dsh-linguist/src/host/operations.nodetest.ts`、`packages/linguist-cat-formats/src/tmx.test.ts`；既有证据：E-REQUIRED。
- 待验：各参考格式安装态导入；停用/优先级更新反映到真实TM检索，删除不误删其他来源。

### D035 TM 模糊/精确/上下文命中及安全引用

- 原行为：context/double-context/exact/near-exact/fuzzy区分；来源优先级、标签结构、邻文、variants、适用资格和原属性真实可见。
- 源入口：[packages/linguist-cat-core/src/tm-matching.ts · matchTmCandidates](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-core/src/tm-matching.ts:240)；[packages/linguist-cat-tools/src/reference-tools.ts · cat_search_tm](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/reference-tools.ts:607)
- 目标入口：[packages/linguist-cat-core/src/tm-matching.ts · matchTmCandidates](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-core/src/tm-matching.ts:240)；[packages/linguist-domain-service/src/project-quality.ts · getSegmentContext](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-quality.ts:74)；[packages/linguist-cat-tools/src/reference-tools.ts · cat_search_tm](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-tools/src/reference-tools.ts:607)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_search_tm`。
- 回归定义：`packages/linguist-cat-core/src/tm-matching-corpus.test.ts`；既有证据：E-DOMAIN、E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D036 术语参考导入与映射预览

- 原行为：TBX、CSV、XLSX、SDLTB导入，歧义列候选确认/取消、源hash/候选归属验证；SDLTB通过mdbtools解析语言索引。
- 源入口：[apps/electron/src/main/lib/linguist/reference-ipc.ts · confirmImport](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/reference-ipc.ts:419)；[apps/electron/src/main/lib/linguist/trados-reference-parsers.ts · parseSdltbReference](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/trados-reference-parsers.ts:181)
- 目标入口：[packages/linguist-domain-service/src/trados-reference-parsers.ts · parseSdltbReference](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/trados-reference-parsers.ts:181)；[packages/dsh-linguist/src/host/operations.ts · linguistReferencesConfirmImport](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:856)
- 状态：实现存在，待安装验收。
- 回归定义：`packages/linguist-domain-service/src/domain-service.nodetest.ts`；既有证据：E-REQUIRED。
- 具体差异：SDLTB实现沿用外部mdb-tables/mdb-export查找；本次未执行工具，不证明升级后Desktop进程可找到兼容二进制。
- 待验：安装态用合成SDLTB验证外部mdb工具身份/可执行性及错误提示；不访问真实客户术语库。

### D037 术语新增更新删除、作用域冲突与验证

- 原行为：required/forbidden/preferred/deprecated、大小写、module/category、来源/备注；同一scope evaluator贯穿检索、冲突、验证、QA和写入。
- 源入口：[packages/linguist-cat-tools/src/terminology-tools.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/terminology-tools.ts:1)；[packages/linguist-cat-core/src/term-policy.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-core/src/term-policy.ts:1)；[packages/linguist-cat-store/src/repositories/term-entries.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-store/src/repositories/term-entries.ts:1)
- 目标入口：[packages/linguist-cat-tools/src/terminology-tools.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-tools/src/terminology-tools.ts:1)；[packages/dsh-linguist/src/host/operations.ts · linguistReferencesUpsertTerms](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:884)；[packages/linguist-cat-store/src/repositories/term-entries.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-store/src/repositories/term-entries.ts:1)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_search_terms`、`cat_upsert_terms`、`cat_delete_terms`、`cat_list_term_conflicts`、`cat_validate_terms`。
- 回归定义：`packages/linguist-cat-tools/src/tools.nodetest.ts`、`packages/linguist-cat-store/src/store.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D038 Context 文档导入、提取、分页与图像

- 原行为：原件blob保留；TXT/MD、DOCX、PDF、XLSX提取结构化段/页/行锚点及图片；不支持格式保留并明确未提取；真实模型图片经附件字节传递。
- 源入口：[apps/electron/src/main/lib/linguist/context-extractor.ts · extractContext](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/context-extractor.ts:169)；[apps/electron/src/main/lib/linguist/context-import.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/context-import.ts:1)；[packages/linguist-cat-tools/src/reference-tools.ts · cat_read_context_doc](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/reference-tools.ts:236)
- 目标入口：[packages/linguist-domain-service/src/context-extractor.ts · extractContext](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/context-extractor.ts:169)；[packages/linguist-domain-service/src/context-import.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/context-import.ts:1)；[packages/dsh-linguist/src/host/cat-deps.ts · readContextImage](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/cat-deps.ts:100)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_read_context_doc`。
- 回归定义：`packages/linguist-domain-service/src/context-extractor.test.ts`、`packages/linguist-domain-service/src/context-import.nodetest.ts`、`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED。
- 待验：实际模型图像及完整分页证据；SVG/BMP可保存但当前模型readContextImage仅PNG/JPEG/WebP/GIF，不混称全部图片模型已读。

### D039 Context 锚点与批次/句段关联

- 原行为：文档/锚点关联资产或句段，required/conditional/optional及mapping revision进入Stage证据；漏映射客户可见行有真实gap。
- 源入口：[packages/linguist-cat-store/src/repositories/context-docs.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-store/src/repositories/context-docs.ts:1)；[apps/electron/src/main/lib/linguist/stage-evidence-host.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/stage-evidence-host.ts:1)
- 目标入口：[packages/linguist-cat-store/src/repositories/context-docs.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-store/src/repositories/context-docs.ts:1)；[packages/dsh-linguist/src/host/operations.ts · linguistAssetsSetContextDocSegmentLink](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:1101)；[packages/dsh-linguist/src/host/stage-evidence.ts · ensureStageEvidenceForSession](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/stage-evidence.ts:57)
- 状态：实现存在，待安装验收。
- 回归定义：`packages/linguist-cat-store/src/context-evidence.nodetest.ts`、`tests/copied-host/stage-evidence-host.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D040 风格指南与技术约束资产

- 原行为：按项目保存/查询/删除风格规则和技术约束；scope、状态、版本、mandatory等级进入相关范围上下文与必要规则覆盖。
- 源入口：[apps/electron/src/main/lib/linguist/assets-ipc.ts · styleGuideRules](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/assets-ipc.ts:7)；[packages/linguist-cat-store/src/repositories/style-guide-rules.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-store/src/repositories/style-guide-rules.ts:1)；[packages/linguist-cat-store/src/repositories/tech-constraints.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-store/src/repositories/tech-constraints.ts:1)
- 目标入口：[packages/dsh-linguist/src/host/operations.ts · linguistAssetsUpsert](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:1042)；[packages/linguist-cat-store/src/repositories/style-guide-rules.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-store/src/repositories/style-guide-rules.ts:1)；[packages/linguist-cat-store/src/repositories/tech-constraints.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-store/src/repositories/tech-constraints.ts:1)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_get_translation_context`。
- 回归定义：`packages/dsh-linguist/src/host/operations.nodetest.ts`、`packages/linguist-cat-tools/src/tools.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D041 句式库、人物 Voice 与批准译例

- 原行为：句式CSV导入及候选/批准状态；Voice记录speaker、textType、register/person等；批准译例必须来自当前已确认句段，保留出处与适用范围。
- 源入口：[apps/electron/src/main/lib/linguist/project-resources.ts · importSentencePatterns](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-resources.ts:513)；[packages/linguist-cat-tools/src/voice-tools.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/voice-tools.ts:1)；[packages/linguist-cat-tools/src/reference-tools.ts · cat_search_sentence_patterns](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/reference-tools.ts:691)
- 目标入口：[packages/linguist-domain-service/src/project-resources.ts · importSentencePatterns](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-resources.ts:513)；[packages/linguist-cat-tools/src/voice-tools.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-tools/src/voice-tools.ts:1)；[packages/dsh-linguist/src/host/operations.ts · voiceProfiles](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:61)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_upsert_voice_profile`、`cat_add_approved_exemplar`、`cat_get_voice_context`、`cat_search_sentence_patterns`。
- 回归定义：`packages/linguist-cat-tools/src/tools.nodetest.ts`、`packages/dsh-linguist/src/host/operations.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D042 标签族扫描、候选审批与项目语法

- 原行为：扫描未知标签，样例有限但总量真实；候选验证/激活/忽略/启停；内置族与项目复数语法、参数约束进入原子编辑/QA/写入保护。
- 源入口：[packages/linguist-cat-core/src/unknown-tag-patterns.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-core/src/unknown-tag-patterns.ts:1)；[packages/linguist-cat-core/src/tag-profile.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-core/src/tag-profile.ts:1)；[packages/linguist-cat-core/src/project-grammar.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-core/src/project-grammar.ts:1)；[packages/linguist-cat-tools/src/tag-tools.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/tag-tools.ts:1)
- 目标入口：[packages/linguist-cat-core/src/tag-profile.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-core/src/tag-profile.ts:1)；[packages/dsh-linguist/src/host/operations.ts · linguistProjectsUpdateTagProfile](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:370)；[packages/linguist-cat-tools/src/tag-tools.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-tools/src/tag-tools.ts:1)；[packages/dsh-linguist/src/client/UnknownTagNotice.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/UnknownTagNotice.tsx:1)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_scan_unknown_tag_patterns`、`cat_save_tag_profile_candidate`。
- 回归定义：`packages/linguist-cat-core/src/hard-rules.test.ts`、`packages/linguist-cat-tools/src/tools.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D043 项目资料盘点、有效简报与范围路由

- 原行为：在受权根盘点源/参考/媒体/映射并记录缺口；派生简报需来源版本匹配；目录摘要不冒充已读全部原文；规则分页覆盖明确。
- 源入口：[apps/electron/src/main/lib/linguist/project-evidence-inventory.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-evidence-inventory.ts:1)；[apps/electron/src/main/lib/linguist/project-brief.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-brief.ts:1)；[packages/linguist-cat-tools/src/intake-tools.ts · cat_refresh_project_inventory](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/intake-tools.ts:108)
- 目标入口：[packages/linguist-domain-service/src/project-evidence-inventory.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-evidence-inventory.ts:1)；[packages/linguist-domain-service/src/project-brief.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-brief.ts:1)；[packages/dsh-linguist/src/host/discovery.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/discovery.ts:1)；[packages/dsh-linguist/src/host/diagnostics.ts · buildDigest](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/diagnostics.ts:64)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_refresh_project_inventory`、`cat_get_translation_context`。
- 回归定义：`packages/linguist-domain-service/src/project-evidence-inventory.test.ts`、`packages/linguist-domain-service/src/project-brief.test.ts`、`packages/linguist-domain-service/src/project-discovery-scope.test.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D044 T/E/P 阶段、人工确认和专业决定覆盖

- 原行为：translation/editing/proofreading及原生输出状态映射；确认/撤销确认/批量；模型unchanged/corrected/blocked绑定actor、revision和冻结任务范围，证据缺口不可冒充完成。
- 源入口：[packages/linguist-cat-core/src/workflow.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-core/src/workflow.ts:1)；[packages/linguist-cat-store/src/repositories/stage-evidence.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-store/src/repositories/stage-evidence.ts:1)；[packages/linguist-cat-tools/src/stage-tools.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/stage-tools.ts:1)
- 目标入口：[packages/linguist-cat-core/src/workflow.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-cat-core/src/workflow.ts:1)；[packages/dsh-linguist/src/host/stage-evidence.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/stage-evidence.ts:1)；[packages/dsh-linguist/src/host/operations.ts · linguistCatConfirmStageBulk](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:497)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_confirm_segments`。
- 回归定义：`packages/linguist-cat-store/src/stage-evidence.nodetest.ts`、`packages/linguist-cat-tools/src/tools.nodetest.ts`；既有证据：E-DOMAIN、E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D045 资料真正进入模型请求的 Stage 证据

- 原行为：prepare/presented不等于模型读到；精确text/image必须位于真实模型请求且成功响应，才记provider-response-v1 receipt；报告缺口不吞作通过。
- 源入口：[apps/electron/src/main/lib/linguist/evidence-submission.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/evidence-submission.ts:1)；[packages/linguist-cat-tools/src/tool-runtime.ts · prepareEvidence](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/tool-runtime.ts:81)
- 目标入口：[packages/dsh-linguist/src/host/evidence.ts · EvidenceObserver](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/evidence.ts:15)；[packages/dsh-linguist/src/host/tool-adapter.ts · onPresented](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/tool-adapter.ts:9)；[packages/dsh-linguist/src/index.ts · llm/stream](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:222)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/copied-host/evidence-observer.nodetest.ts`、`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED、E-PROVIDER-43。
- 待验：升级后实际provider请求/响应、toolCallId/必要全文和图片同链验收；本地观察ID不得冒充远端Provider request ID。

### D046 发送时冻结项目、批次、显式段引用与选区

- 原行为：原LA实际发送快照捕获projectId/assetId、用户显式为Agent引用的段、selectedSegmentIds、uiRevision及capturedAt；不偷渡普通编辑焦点。V1虽声明可选activeQaFindingId，实际capture未传；没有activeProposalId字段。快照绑定本次真实发送并在异步后保持原范围。
- 源入口：[apps/electron/src/main/lib/linguist/turn-context-validator.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/turn-context-validator.ts:1)；[apps/electron/src/main/lib/linguist/agent-host-extension.ts · turnContextBlock](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/agent-host-extension.ts:45)；[packages/shared/src/types/linguist-turn-context.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/shared/src/types/linguist-turn-context.ts:1)；[apps/electron/src/renderer/features/linguist/projects/cat-workspace-atoms.ts · export function captureLinguistTurnContextSnapshot](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/renderer/features/linguist/projects/cat-workspace-atoms.ts:508)
- 目标入口：[packages/dsh-linguist/src/host/turn-context.ts · addPreparedTurnContext](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/turn-context.ts:76)；[packages/dsh-linguist/src/client/composer-reference.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/composer-reference.ts:1)；[packages/dsh-linguist/src/client/ComposerContextChips.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/ComposerContextChips.tsx:1)
- 状态：实现存在，用户已接受按需附带，待安装验收。宿主负责：DSH ReferenceCodec、原生prompt/requestId、附件及queue/steer；Host agent/pre-step准入。
- 当前实现：用户按需点击“附带 CAT 选区”；原生 Reference codec 在实际发送时同步冻结项目、批次、显式句段引用与选区 ID，快照随该条原生 prompt 携带。Host 在 agent/pre-step 等待项目/Workspace 准入，并按实际 user/message source.rpcId 记录。附件、queue/steer 沿官方发送链。该交互已获用户于2026-09-29明确接受。
- 回归定义：`tests/copied-renderer/native-composer-reference.nodetest.mjs`、`tests/required/turn-reference.nodetest.mjs`；证据：E-REQUIRED、E-PROVIDER-43、E-COMPOSER-RC2、E-COMPOSER-RC2-REAUDIT。
- 产品决定与验收边界：目标采用用户已接受的按需显式附带方式；源 LA 每条普通发送默认自动携带改为本条消息选择附带。发送时冻结范围与同消息真实请求身份的要求保留。 当前安装产物仍需核验引用呈现、发送时冻结、queue/steer及真实请求绑定；43历史观察中user消息显示完整LA-TURN-CONTEXT JSON，仍只作为历史证据。
- 口径更正：源实际capture不含QA/Proposal焦点。rc.2显式Reference可携带快照并在Host按真实rpcId准入。2026-09-29用户已明确接受按需附带CAT选区；这关闭产品交互决定，安装与真实模型验收仍待完成。
- 待验：在当前安装产物核验按需附带、删除引用、slash/附件/IME/undo、queue/steer时的同步冻结与同消息actual rpcId绑定，并观察模型前准入及模型可见内容。

### D047 建议/运行的生成来源可追溯性

- 原行为：源生成来源包含session/run/tool/model/runtime、Linguist prompt版本/hash、toolsetHash及本轮context快照/hash。
- 源入口：[apps/electron/src/main/lib/linguist/agent-host-extension.ts · linguistPromptVersion](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/agent-host-extension.ts:116)；[packages/linguist-cat-core/src/proposal-issuance.ts · LinguistGenerationProvenance](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-core/src/proposal-issuance.ts:4)
- 目标入口：[packages/dsh-linguist/src/host/diagnostics.ts · promptHash](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/diagnostics.ts:46)；[packages/dsh-linguist/src/host/turn-context.ts · TurnContextCallProvenance](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/turn-context.ts:149)；[packages/dsh-linguist/src/host/model-provenance.ts · ModelCallProvenance](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/model-provenance.ts:15)；[packages/dsh-linguist/src/index.ts · generationProvenance:](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:206)
- 状态：本轮实现/合成检查通过，待rc.2安装验收。
- 当前实现：每次公开llm/stream观察实际provider/model/工具schemas，校验所装配LA prompt确在该请求system内容中，记录prompt版本/hash及toolsetHash；真实tool/call与PTC root关联此快照，未观察身份拒绝生成来源。后续请求/auxiliary调用不会改写已有call来源。
- 回归定义：`packages/linguist-cat-tools/src/tools.nodetest.ts`、`tests/required/turn-reference.nodetest.mjs`、`tests/required/acceptance.nodetest.mjs`；证据：E-REQUIRED、E-RC2-HOST。
- 待验：新安装有限真实模型生成proposal/写回，检查落库issuance的实际provider/model/prompt版本/hash/toolsetHash及toolCallId关联。

### D048 交付预检、verified/as-is导出及审计清单

- 原行为：检查当前revision、QA、待审建议、Stage责任与格式round-trip；生成staging后另存、默认不覆盖；记录文件hash/大小/时间/项目版本及stale，不混称外部已提交。
- 源入口：[apps/electron/src/main/lib/linguist/project-delivery.ts · prepareDelivery](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-delivery.ts:361)；[apps/electron/src/main/lib/linguist/export-manifest.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/export-manifest.ts:1)；[packages/linguist-cat-tools/src/delivery-tools.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-tools/src/delivery-tools.ts:1)
- 目标入口：[packages/linguist-domain-service/src/project-delivery.ts · prepareDelivery](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-delivery.ts:361)；[packages/dsh-linguist/src/host/operations.ts · linguistExportsSaveAsset](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:1143)；[packages/linguist-domain-service/src/export-manifest.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/export-manifest.ts:1)
- 状态：实现存在，待安装验收。
- 公开工具：`cat_export_batch`。
- 回归定义：`tests/copied-host/project-delivery-evidence.nodetest.ts`、`packages/linguist-domain-service/src/domain-service.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D049 格式资格和真实平台交付边界

- 原行为：内部adapter验证与Phrase/memoQ/Trados平台资格分开；代码两端均platformQualification=unverified，下载/导出不是平台接受。
- 源入口：[apps/electron/src/main/lib/linguist/format-qualification.ts · listDefaultFormatQualifications](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/format-qualification.ts:26)
- 目标入口：[packages/linguist-domain-service/src/format-qualification.ts · listDefaultFormatQualifications](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/format-qualification.ts:25)
- 状态：实现存在，待安装验收。
- 既有证据：E-DOMAIN。
- 待验：仅合成内部round-trip可在本次授权验证；真实客户平台资格不能伪造也不在本次授权中。

### D050 备份、恢复预览、恢复与外部CAT备份导入

- 原行为：备份数据库/blobs/manifest；核验摘要、schema、数据库身份、实际行数与当前项目差异；恢复先校验及保全旧数据；旧schema稳定ID保留。
- 源入口：[apps/electron/src/main/lib/linguist/project-service.ts · backupProject](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/project-service.ts:590)；[packages/linguist-cat-store/src/backup.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-store/src/backup.ts:1)；[packages/linguist-cat-store/src/restore.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-store/src/restore.ts:1)
- 目标入口：[packages/linguist-domain-service/src/project-service.ts · previewRestore](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-service.ts:637)；[packages/linguist-domain-service/src/project-service.ts · importProjectBackupFromPath](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/project-service.ts:587)；[packages/dsh-linguist/src/client/BackupRestorePreview.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/BackupRestorePreview.tsx:1)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/backup-preview.nodetest.mjs`、`tests/required/acceptance.nodetest.mjs`、`packages/linguist-cat-store/src/integrity.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D051 历史 LA 项目迁移、孤立素材与旧记录

- 原行为：显式选定旧根扫描，选择项目和copy/reference策略，可救援orphan；迁入新根、独立验证、保留legacy critic历史，只读源不写回。
- 源入口：[apps/electron/src/main/lib/linguist/migration-service.ts · LinguistMigrationService](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/migration-service.ts:91)；[packages/linguist-legacy-migration/src/scan.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-legacy-migration/src/scan.ts:1)；[packages/linguist-legacy-migration/src/import.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-legacy-migration/src/import.ts:1)
- 目标入口：[packages/linguist-domain-service/src/migration-service.ts · LinguistMigrationService](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/migration-service.ts:89)；[packages/dsh-linguist/src/host/operations.ts · linguistLegacyMigrationImport](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:424)；[packages/dsh-linguist/src/client/LegacyMigrationPanel.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/LegacyMigrationPanel.tsx:1)
- 状态：实现存在，待安装验收。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED。
- 待验：只用合成旧根测试进度、部分失败、验证和重入；不把未访问客户旧库解释为迁移实现缺失。

### D052 完整性全检、取消、脱敏诊断和导出报告

- 原行为：worker检查SQLite/关系/blob/受管文件；进度/取消/结果区分；诊断含Prompt/事件积压/runtime状态，导出脱敏包不自动上传。
- 源入口：[apps/electron/src/main/lib/linguist/integrity-scrub-service.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/integrity-scrub-service.ts:1)；[apps/electron/src/main/lib/linguist/diagnostics-ipc.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/diagnostics-ipc.ts:1)；[packages/linguist-cat-store/src/integrity.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/linguist-cat-store/src/integrity.ts:1)
- 目标入口：[packages/dsh-linguist/src/host/integrity.ts · IntegrityHost](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/integrity.ts:52)；[packages/dsh-linguist/src/host/diagnostics.ts · DiagnosticsHost](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/diagnostics.ts:185)；[packages/dsh-linguist/src/client/Panels.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/Panels.tsx:1)
- 状态：实现存在，待安装验收。
- 回归定义：`packages/dsh-linguist/src/host/integrity-diagnostics.nodetest.ts`；既有证据：E-REQUIRED。
- 待验：升级后包内worker路径、取消、真实全检、诊断报告下载与字段脱敏；Prompt/工具数量未观察要显示未知。

### D053 不导入CAT的双语工作副本和跨阶段接续

- 原行为：prepare保留原文件、完整双语稳定IDs；assemble校验source/previous hash、baseRevision、完整groups与unchanged/corrected/blocked；结构/锁硬门；结果submitted=false。
- 源入口：[apps/electron/src/main/lib/linguist/working-copy.ts · prepareWorkingCopy](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/working-copy.ts:67)；[apps/electron/src/main/lib/linguist/working-copy.ts · assembleWorkingCopy](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/working-copy.ts:96)；[apps/electron/src/main/lib/linguist/working-copy-tool.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/working-copy-tool.ts:1)
- 目标入口：[packages/linguist-domain-service/src/working-copy.ts · assembleWorkingCopy](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/working-copy.ts:96)；[packages/linguist-domain-service/src/working-copy-service.ts · executeWorkingCopyAction](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/linguist-domain-service/src/working-copy-service.ts:24)；[packages/dsh-linguist/src/host/working-copy-tool.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/working-copy-tool.ts:1)；[packages/dsh-linguist/src/client/WorkingCopyPage.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/WorkingCopyPage.tsx:1)
- 状态：实现存在，待安装验收。
- 公开工具：`linguist_working_copy`。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED。
- 待验：通过实际 DSH 插件入口完成该用户流程，核对持久化结果、失败状态及重开恢复。

### D054 直接网页业务与同链下载上传

- 原行为：在授权浏览器状态工作，使用鲜活语义定位、明确文本/键操作；步骤失败保留已执行前缀，不自动重放；下载/上传不冒充业务提交或专业完成。
- 源入口：[apps/electron/default-skills/phrase-platform-review-ops/SKILL.md](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/default-skills/phrase-platform-review-ops/SKILL.md:1)
- 目标入口：[packages/dsh-linguist/resources/skills/phrase-platform-review-ops/SKILL.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/skills/phrase-platform-review-ops/SKILL.md:1)；[integrations/browser-skill/patches/browser-files.patch](/Users/wangyu/Desktop/Linguist-Agent-DSH/integrations/browser-skill/patches/browser-files.patch:1)
- 状态：宿主接管＋薄适配。宿主负责：BrowserSkill唯一正式浏览器链；DSH内置浏览器不自动等于该链。
- 既有证据：E-BROWSER-43。
- 具体差异：现有43 CLI/daemon/extension localhost通过不是升级后DSH模型browser_*调用、取消/借还页的完整验收。
- 待验：升级后的真实DSH会话使用固定BrowserSkill访问localhost合成页，执行inspect/interact/download/upload/cancel/reopen/borrow-return且保留真实回执。

### D055 原生专业子任务、输入交接、续聊和中断

- 原行为：General委派T/E/P，冻结本项目Asset/Segment范围；required文件预检/hash或snapshot；原生子Session继续/排队/steer/当前轮中断，接收不等于专业完成。
- 源入口：[apps/electron/src/main/lib/linguist/delegation-host-extension.ts · resolveLinguistDelegationMetadata](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/delegation-host-extension.ts:55)；[apps/electron/src/main/lib/agent-collaboration-tools.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/agent-collaboration-tools.ts:1)
- 目标入口：[packages/dsh-linguist/src/host/delegation-tool.ts · createLinguistDelegationTool](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/delegation-tool.ts:44)；[packages/dsh-linguist/src/host/delegation-inputs.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/delegation-inputs.ts:1)；[packages/dsh-linguist/src/host/delegation-control.ts · LinguistDelegationControl](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/delegation-control.ts:10)
- 状态：实现存在，待安装验收。宿主负责：DSH subagents.startContinuable/sendMessage/prompt/interruptByParent。
- 回归定义：`tests/copied-host/delegation-inputs.nodetest.ts`、`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED。
- 待验：真实父子模型任务、完整输入到达、角色/模型/权限继承、终止与续聊、禁止越界写。

### D056 子任务专业完成度回传

- 原行为：源协作状态/结果从冻结范围的真实CAT审计读取专业覆盖与证据缺口，进程结束和语言完成分开。
- 源入口：[apps/electron/src/main/lib/linguist/delegation-host-extension.ts · resolveLinguistDelegationOutcome](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/delegation-host-extension.ts:76)；[apps/electron/src/main/lib/agent-collaboration-tools.ts · resolveLinguistDelegationOutcome](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/agent-collaboration-tools.ts:53)
- 目标入口：[packages/dsh-linguist/src/host/delegation.ts · linguistDelegationOutcome](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/delegation.ts:34)；[packages/dsh-linguist/src/host/delegation-control.ts · professionalOutcome](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/delegation-control.ts:22)；[packages/dsh-linguist/src/host/delegation-tool.ts · name: 'linguist_delegations_list'](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/delegation-tool.ts:113)
- 状态：本轮实现/合成检查通过，待rc.2安装验收。
- 当前实现：linguist_delegations_list的模型可见结果包含professionalOutcome；从完整冻结delegatedScope计算当前revision、真实子Session actor和Stage决策边界覆盖，另报必要证据/阻塞；部分Stage完成不等于完整委派完成。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；证据：E-REQUIRED、E-RC2-HOST。
- 待验：新安装真实父/子会话读取professionalOutcome，并核对未裁定、其他actor及旧revision均不能冒称完成。

### D057 定时任务冻结范围与独立运行会话

- 原行为：创建时冻结project/role/范围；定时运行不读当前UI；项目/范围/模型/权限重校验；独立任务Session不依赖原来源会话存活，daily/reuse原生设置继承。
- 源入口：[apps/electron/src/main/lib/linguist/automation-context.ts · captureAutomationLinguistContext](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/automation-context.ts:9)；[apps/electron/src/main/lib/automation-scheduler.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/automation-scheduler.ts)
- 目标入口：[packages/dsh-linguist/src/host/automation-context.ts · captureAutomationLinguistContext](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/automation-context.ts:65)；[packages/dsh-linguist/src/host/schedule-context.ts · ScheduleContextManager](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/schedule-context.ts:238)；[packages/dsh-linguist/src/host/schedule-session.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/schedule-session.ts:1)
- 状态：实现存在，待安装验收。宿主负责：DSH Schedule拥有时间触发、原生Session事件与投递。
- 回归定义：`tests/required/schedule-session-independence.nodetest.mjs`、`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED。
- 待验：升级后真实到期运行、来源Session关闭/删除后的独立运行、冻结scope、实际模型设置及权限保持。

### D058 定时任务创建、修改、暂停恢复、立即运行和历史

- 原行为：支持延后/绝对/间隔/每日/每周/cron；执行记录来自真实turn事件；最大次数、连续5次失败暂停、恢复清失败计数、分发不计执行完成。
- 源入口：[apps/electron/src/main/lib/automation-manager.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/automation-manager.ts:1)；[apps/electron/src/main/lib/automation-scheduler.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/automation-scheduler.ts:1)；[packages/shared/src/types/automation.ts](/Users/wangyu/Desktop/linguist-agent-next/packages/shared/src/types/automation.ts:1)
- 目标入口：[packages/dsh-linguist/src/host/schedule-context.ts · scheduleRunPolicy](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/schedule-context.ts:200)；[packages/dsh-linguist/src/client/ScheduleManager.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/ScheduleManager.tsx:1)
- 状态：实现存在，待安装验收。宿主负责：DSH schedule record与原生事件。
- 回归定义：`tests/required/schedule-manager.nodetest.mjs`、`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED。
- 待验：真实调度/手动运行/取消、失败暂停恢复、重开后的完整历史；不得以测试替身记录代替已安装原生运行。

### D059 定时任务飞书通知

- 原行为：选定接收方，任务结束后发送限定本轮结果；投递失败/不确定分开，不把进程结束描述为专业完成。
- 源入口：[apps/electron/src/main/lib/automation-notification-service.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/automation-notification-service.ts:1)
- 目标入口：[packages/dsh-linguist/src/host/schedule-notifications.ts · ScheduleNotifications](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/schedule-notifications.ts:18)；[packages/dsh-linguist/src/index.ts · notificationDestinations](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:39)
- 状态：实现存在，需外部验证。宿主负责：DSH原生设置存储secret字段；LA仅薄出站通知适配。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED。
- 具体差异：本次未读凭据、未对外发送；真实飞书凭据/接收方未验证，属于外部环境验收。
- 待验：有用户明确发送授权和已配置专用接收方后验证真实回执；无凭据保持BLOCKED_ENV，不伪造sent。

### D060 游戏本地化作业技能

- 原行为：按实际TEP用途和范围取得有效依据、连贯完成语言判断、批量写回与交接，避免每页机械循环。
- 源入口：[apps/electron/default-skills/game-localization/SKILL.md](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/default-skills/game-localization/SKILL.md:1)
- 目标入口：[packages/dsh-linguist/resources/skills/game-localization/SKILL.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/skills/game-localization/SKILL.md:1)；[packages/dsh-linguist/resources/skills/game-localization/references/en-zh.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/skills/game-localization/references/en-zh.md:1)；[packages/dsh-linguist/resources/skills/game-localization/references/game-texts.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/skills/game-localization/references/game-texts.md:1)；[packages/dsh-linguist/resources/skills/game-localization/references/quality-evidence.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/skills/game-localization/references/quality-evidence.md:1)；[packages/dsh-linguist/resources/skills/game-localization/references/zh-en.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/skills/game-localization/references/zh-en.md:1)；[packages/dsh-linguist/src/index.ts · bundledLinguistSkills](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:7)；[packages/dsh-linguist/src/index.ts · ctx.skills.registerProvider](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:60)
- 状态：本轮实现/合成检查通过，待rc.2安装验收。宿主负责：DSH拥有Skills发现与触发能力，但不自动携带原LA具体技能内容。
- 当前实现：原Skill正文及必要references已分发到产品resources/skills；通过官方SkillRegistry registerProvider按bundled rank注册，用户自定义优先级由宿主决定，插件卸载随生命周期移除。正文保留原领域方法。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；证据：E-SKILL-INVENTORY、E-RC2-HOST。
- 待验：新包tarball资源、官方Desktop实际Skill catalog/get及references可读；核对用户已有同名Skill的胜出来源，不覆盖用户自定义。

### D061 文化与语用审查技能

- 原行为：完整源译及必要场景下判断称谓、幽默、典故、人物关系和图文适配，不用普通语法问题冒充文化审计。
- 源入口：[apps/electron/default-skills/cultural-lqa/SKILL.md](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/default-skills/cultural-lqa/SKILL.md:1)
- 目标入口：[packages/dsh-linguist/resources/skills/cultural-lqa/SKILL.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/skills/cultural-lqa/SKILL.md:1)；[packages/dsh-linguist/src/index.ts · bundledLinguistSkills](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:7)；[packages/dsh-linguist/src/index.ts · ctx.skills.registerProvider](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:60)
- 状态：本轮实现/合成检查通过，待rc.2安装验收。宿主负责：DSH拥有Skills发现与触发能力，但不自动携带原LA具体技能内容。
- 当前实现：原Skill正文及必要references已分发到产品resources/skills；通过官方SkillRegistry registerProvider按bundled rank注册，用户自定义优先级由宿主决定，插件卸载随生命周期移除。正文保留原领域方法。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；证据：E-SKILL-INVENTORY、E-RC2-HOST。
- 待验：新包tarball资源、官方Desktop实际Skill catalog/get及references可读；核对用户已有同名Skill的胜出来源，不覆盖用户自定义。

### D062 本地化开工准备度技能

- 原行为：仅准备度请求时识别影响开工的输入/资料缺口；取样不充全量，不自动创建Stage或强制导入CAT。
- 源入口：[apps/electron/default-skills/localization-readiness/SKILL.md](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/default-skills/localization-readiness/SKILL.md:1)
- 目标入口：[packages/dsh-linguist/resources/skills/localization-readiness/SKILL.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/skills/localization-readiness/SKILL.md:1)；[packages/dsh-linguist/src/index.ts · bundledLinguistSkills](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:7)；[packages/dsh-linguist/src/index.ts · ctx.skills.registerProvider](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:60)
- 状态：本轮实现/合成检查通过，待rc.2安装验收。宿主负责：DSH拥有Skills发现与触发能力，但不自动携带原LA具体技能内容。
- 当前实现：原Skill正文及必要references已分发到产品resources/skills；通过官方SkillRegistry registerProvider按bundled rank注册，用户自定义优先级由宿主决定，插件卸载随生命周期移除。正文保留原领域方法。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；证据：E-SKILL-INVENTORY、E-RC2-HOST。
- 待验：新包tarball资源、官方Desktop实际Skill catalog/get及references可读；核对用户已有同名Skill的胜出来源，不覆盖用户自定义。

### D063 交付前LQA检查技能

- 原行为：按授权检查当前成果、版本、必要语言责任和QA；文本QA不等于游戏内LQA，不自动导出/交付。
- 源入口：[apps/electron/default-skills/release-lqa/SKILL.md](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/default-skills/release-lqa/SKILL.md:1)
- 目标入口：[packages/dsh-linguist/resources/skills/release-lqa/SKILL.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/skills/release-lqa/SKILL.md:1)；[packages/dsh-linguist/src/index.ts · bundledLinguistSkills](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:7)；[packages/dsh-linguist/src/index.ts · ctx.skills.registerProvider](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:60)
- 状态：本轮实现/合成检查通过，待rc.2安装验收。宿主负责：DSH拥有Skills发现与触发能力，但不自动携带原LA具体技能内容。
- 当前实现：原Skill正文及必要references已分发到产品resources/skills；通过官方SkillRegistry registerProvider按bundled rank注册，用户自定义优先级由宿主决定，插件卸载随生命周期移除。正文保留原领域方法。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；证据：E-SKILL-INVENTORY、E-RC2-HOST。
- 待验：新包tarball资源、官方Desktop实际Skill catalog/get及references可读；核对用户已有同名Skill的胜出来源，不覆盖用户自定义。

### D064 术语候选挖掘技能

- 原行为：从声明完整语料或明确样本找概念/命名差异，复用scope evaluator；候选不自动批准入TB。
- 源入口：[apps/electron/default-skills/terminology-candidate-mining/SKILL.md](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/default-skills/terminology-candidate-mining/SKILL.md:1)
- 目标入口：[packages/dsh-linguist/resources/skills/terminology-candidate-mining/SKILL.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/skills/terminology-candidate-mining/SKILL.md:1)；[packages/dsh-linguist/src/index.ts · bundledLinguistSkills](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:7)；[packages/dsh-linguist/src/index.ts · ctx.skills.registerProvider](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:60)
- 状态：本轮实现/合成检查通过，待rc.2安装验收。宿主负责：DSH拥有Skills发现与触发能力，但不自动携带原LA具体技能内容。
- 当前实现：原Skill正文及必要references已分发到产品resources/skills；通过官方SkillRegistry registerProvider按bundled rank注册，用户自定义优先级由宿主决定，插件卸载随生命周期移除。正文保留原领域方法。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；证据：E-SKILL-INVENTORY、E-RC2-HOST。
- 待验：新包tarball资源、官方Desktop实际Skill catalog/get及references可读；核对用户已有同名Skill的胜出来源，不覆盖用户自定义。

### D065 译者简报与专业交接技能

- 原行为：按任务整理用途、受众、有效要求、来源版本、参考路由与未决责任；简报不替代原件和审校。
- 源入口：[apps/electron/default-skills/translator-brief/SKILL.md](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/default-skills/translator-brief/SKILL.md:1)
- 目标入口：[packages/dsh-linguist/resources/skills/translator-brief/SKILL.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/skills/translator-brief/SKILL.md:1)；[packages/dsh-linguist/resources/skills/translator-brief/references/project-brief.md](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/resources/skills/translator-brief/references/project-brief.md:1)；[packages/dsh-linguist/src/index.ts · bundledLinguistSkills](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:7)；[packages/dsh-linguist/src/index.ts · ctx.skills.registerProvider](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:60)
- 状态：本轮实现/合成检查通过，待rc.2安装验收。宿主负责：DSH拥有Skills发现与触发能力，但不自动携带原LA具体技能内容。
- 当前实现：原Skill正文及必要references已分发到产品resources/skills；通过官方SkillRegistry registerProvider按bundled rank注册，用户自定义优先级由宿主决定，插件卸载随生命周期移除。旧宿主协作参数已改为真实DSH/linguist_delegate入口。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；证据：E-SKILL-INVENTORY、E-RC2-HOST。
- 待验：新包tarball资源、官方Desktop实际Skill catalog/get及references可读；核对用户已有同名Skill的胜出来源，不覆盖用户自定义。

### D066 宿主通用能力接管边界

- 原行为：原LA还提供Agent/Chat、模型/Provider、权限、Skills/MCP、附件、Workspace instructions/Memory/Files、Planning/queue/steer、终端、Preview和远程桥；不运行原Proma/Pi。
- 源入口：[apps/electron/src/main/lib/linguist/agent-execution-scope.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/agent-execution-scope.ts:1)；[apps/electron/src/main/lib/agent-service.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/agent-service.ts:1)；[apps/electron/src/main/lib/chat-service.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/chat-service.ts:1)
- 目标入口：[packages/dsh-linguist/src/index.ts · inject](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:37)；[packages/dsh-linguist/src/client/ProjectCapabilities.tsx](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/ProjectCapabilities.tsx:1)
- 状态：宿主接管，等价性待核。宿主负责：DSH应拥有通用Agent/Session/Workspace/模型/权限/queue/steer/subagents/schedule/附件/原生shell；LA只是追加领域能力。
- 回归定义：`tests/required/project-capabilities.nodetest.mjs`、`tests/required/session-capabilities.nodetest.mjs`；既有证据：E-REQUIRED。
- 具体差异：不能从DSH拥有扩展点推导原LA所有具体Provider登录、语音、远程桥、默认技能、Planning等都逐项等价；这些需宿主专项清单核对。
- 待验：与宿主专项审计合并：每项标明原生等价入口、差异/不支持、外部凭据及升级后验收。

### D067 解绑项目并保留普通原生对话

- 原行为：显式解除LA绑定，历史保留；运行中不切换；旧专业证据不删，相关旧任务按当前绑定规则处理。
- 源入口：[apps/electron/src/main/lib/linguist/session-ipc.ts · detachBinding](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/session-ipc.ts:13)
- 目标入口：[packages/dsh-linguist/src/index.ts · detachSessionBinding](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/index.ts:258)；[packages/dsh-linguist/src/host/operations.ts · linguistSessionsDetachBinding](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:251)
- 状态：实现存在，待安装验收。宿主负责：DSH原生Session仍继续存在。
- 回归定义：`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED。
- 待验：实际已执行会话停止后解绑，历史/附件保留、LA工具解绑、任务停止规则明确。

### D068 UI后端调用、项目变更事件与错误反馈

- 原行为：源Electron IPC包含全部UI专属读写，不仅32公开工具；变更事件/重连补齐，错误代码与安全细节保留。
- 源入口：[apps/electron/src/main/lib/linguist/register-ipc.ts · registerLinguistIpc](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/register-ipc.ts:41)；[apps/electron/src/main/lib/linguist/ipc-envelope.ts](/Users/wangyu/Desktop/linguist-agent-next/apps/electron/src/main/lib/linguist/ipc-envelope.ts:1)
- 目标入口：[packages/dsh-linguist/src/host/http.ts · registerHttpRoutes](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/http.ts:31)；[packages/dsh-linguist/src/host/operations.ts · dispatchOperation](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/operations.ts:227)；[packages/dsh-linguist/src/host/mutations.ts · MutationBus](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/host/mutations.ts:8)；[packages/dsh-linguist/src/client/api.ts](/Users/wangyu/Desktop/Linguist-Agent-DSH/packages/dsh-linguist/src/client/api.ts:1)
- 状态：实现存在，待安装验收。宿主负责：DSH webServer HTTP/SSE；非静态api-remotes补丁。
- 回归定义：`tests/copied-renderer/client-api.nodetest.ts`、`tests/required/acceptance.nodetest.mjs`；既有证据：E-REQUIRED。
- 待验：升级后实际origin/webServer路由、同源文件token、断连重连/事件ACK和所有UI操作错误；自动漏项表只检入口不证明行为。

## 证据身份

- **E-REQUIRED**：[artifacts/evidence/required-synthetic.json](/Users/wangyu/Desktop/Linguist-Agent-DSH/artifacts/evidence/required-synthetic.json)；SHA-256 `619f37cb3411b7304f14a598456989de10042b3271bf2a710a53f9e2cd7a5c0c`；既有合成回归与类型检查；不是升级后的实际安装/模型操作。
- **E-DOMAIN**：[artifacts/evidence/copied-domain-tests.json](/Users/wangyu/Desktop/Linguist-Agent-DSH/artifacts/evidence/copied-domain-tests.json)；SHA-256 `9cc00cd572e913369736efc2a2b1369f8bad2c783130b64f0ed856475581ce1a`；源隔离基线与目标各151断言通过的既有记录；不把测试数量当产品验收。
- **E-PROVIDER-43**：[artifacts/evidence/provider-43f143-coldstart-observation.json](/Users/wangyu/Desktop/Linguist-Agent-DSH/artifacts/evidence/provider-43f143-coldstart-observation.json)；SHA-256 `faaa42ae7528fa2a9203ada0bc83b29826acbe2f8fd78b75364574558965a150`；安装 `la-43f143cb3529-b4f81677`；43历史真实模型观察，仅代表记录的有限请求；不复用为新包验收。
- **E-ROLES-E4**：[artifacts/evidence/roles-e4-observation.json](/Users/wangyu/Desktop/Linguist-Agent-DSH/artifacts/evidence/roles-e4-observation.json)；SHA-256 `355114ed1e89b337f5ad1a2c8475a120afae4ac786da8a73486021ff8da45127`；安装 `la-e4c2c189ff96-b4f81677`；e4历史岗位观察，不能重标9e或升级后产品完整专业流程。
- **E-BROWSER-43**：[artifacts/evidence/browser-skill-localhost.json](/Users/wangyu/Desktop/Linguist-Agent-DSH/artifacts/evidence/browser-skill-localhost.json)；SHA-256 `8f3cc2676e7ad9b77cab8d9a212e789de5ff5f2b909b1f5f25d925f607852d04`；安装 `la-43f143cb3529-b4f81677`；43身份的CLI/daemon/extension localhost链，非新版DSH模型工具全链。
- **E-SKILL-INVENTORY**：初审目标仅Phrase Skill，本轮已补齐六领域Skill；只核对仓库bundle，用户外部Skill/凭据未读取。

- **E-RC2-HOST**：[artifacts/evidence/rc2-host-domain-checks.json](/Users/wangyu/Desktop/Linguist-Agent-DSH/artifacts/evidence/rc2-host-domain-checks.json)；SHA-256 `941f8280961460e4af320aba6378852039faa7ccbcbcd14e77d00e375e0b5cd1`；本轮rc.2工作树Host类型检查与42项合成回归；实际日志有原始命令与输出，未安装、未运行真实模型。

- **E-COMPOSER-RC2**：[artifacts/evidence/native-composer-rc2-public-api-audit.json](/Users/wangyu/Desktop/Linguist-Agent-DSH/artifacts/evidence/native-composer-rc2-public-api-audit.json)；SHA-256 `e70e68557601937ad5cc292ab4bc9d7f4224c369be4afc6d15112c299ec2a9ed`；固定rc.2公开API只读审计；源实际capture无QA/Proposal焦点，不据此授予自动发送能力。

## 实际扫描覆盖与漏项检查

| 源目录 | 非测试命名文件 | 已归属功能 | 已找到同路径目标 | 字节相同（含同名domain适配位置） |
|---|---:|---:|---:|---:|
| packages/linguist-cat-core/src | 28 | 28 | 28 | 27 |
| packages/linguist-cat-formats/src | 22 | 22 | 22 | 20 |
| packages/linguist-cat-store/src | 40 | 40 | 40 | 38 |
| packages/linguist-cat-tools/src | 20 | 20 | 20 | 13 |
| packages/linguist-legacy-migration/src | 13 | 13 | 13 | 9 |
| apps/electron/src/main/lib/linguist | 58 | 58 | 0 | 11 |
| resources/linguist-roles | 4 | 4 | 0 | 3 |

- 源CAT工具提取：31；未归属工具：0。工作副本另计 D053。
- 源IPC通道引用：90；初审目标operation case：91（本轮新增精确Job查询入口；初审计数不重标）。数量不同因Session/文件/SSE等走独立路由，不能用数量判平齐。
- 未归属枚举文件：0。完整文件/摘要/目标映射及入口检查见 [SOURCE-DOMAIN.json](/Users/wangyu/Desktop/Linguist-Agent-DSH/docs/migration/audit-2026-09-29/SOURCE-DOMAIN.json)。
- 统计包含类型、barrel、CLI及testing helper，**不是用户功能完成比例**；同字节文件不保证宿主接线正确。
- 本轮不宣称逐行审过每一文件：以实际入口/关键边界/变更差异为语义审查，其余做字节及功能族归属。

1. 重新以rg --files读取本报告列明源目录，剔除*.test/*.nodetest/*.spec后与coverage.files比对新增/删除；source HEAD+完整git status变化时重扫有效工作树。
2. 从源factory及每个*-tools.ts提取name，与sourceCatTools/每行tools双向比较；工作副本工具单列D053。
3. 从register-ipc.ts的LINGUIST_*通道和各IPC工厂公开方法，逐一对照targetOperationCases、/la/v1/session-bind/files/events及功能行；字符串同名仅是入口证据，不是语义通过。
4. 对字节不同文件按diff审查，继续检查目标接线而非仅找到同名helper（D056初审发现此类问题，本轮已接线）。
5. 将该领域清单与UI专项、宿主专项、资源Skills专项合并；每一项分别记录实现、已安装包身份、实际验证和外部阻塞。
6. DSH升级后固定新SDK/官方App/当前插件身份，原e4/43/9e历史证据保留原身份；重新执行实际安装与完整用户流程，不通过修改旧收据升级状态。

通用宿主功能和完整视觉/交互必须合并其他专项审计；本表不把被宿主接管的能力自动标完成，也不以禁止访问真实客户数据制造功能缺失。
