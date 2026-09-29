# 源 Host 测试接续审计（合成数据）

本目录只运行目标 DSH Host/domain 代码。`.migration/source-snapshot` 只用于核对原测试断言；未在真实源仓库安装、构建或写入。下列 2026-09-29 记录为此前 copied-host 单独运行快照：

```sh
node --experimental-transform-types --import ./packages/linguist-cat-store/test/register-ts-loader.mjs --test tests/copied-host/*.nodetest.ts
```

原始输出见 `../../artifacts/evidence/copied-host-last-run.tap`：15 pass、0 fail、0 skip。该历史结果是目标源码的本机合成测试，不是本轮全量测试数，也不是已安装 Desktop、真实 Provider 或 BrowserSkill 的验收。

下表中的“完整迁入”表示原测试主体与断言基本原样运行，只替换 Proma/Electron 耦合的导入或已删除字段；“部分验证”明确列出尚未覆盖的边界。

## 逐项对应

| 原测试文件与用例 | 目标证据 | 结论与剩余边界 |
|---|---|---|
| `agent-collaboration-linguist-context.test.ts`：委派继承可信 Context、目标渠道/推理档 | `tests/required/acceptance.nodetest.mjs` 的 Turn Context 与 native delegation；`host/turn-context.ts`、`host/delegation-tool.ts` | 部分验证：冻结 CAT 项目/范围及 native `subagents.startContinuable` 已测；本轮 `tests/required/turn-reference.nodetest.mjs` 还验证实际 user RPC 引用准入与 QA finding/句段不得越出委派范围。实际子请求的 Provider/模型/effort 身份仍需安装态验证。 |
| 同文件：父轮次无 UI 快照仍冻结自身 CAT 范围 | `tests/required/acceptance.nodetest.mjs` 的 `native delegation freezes CAT range` | 目标行为已测：Host 从绑定项目和显式 ID 冻结，不依赖临时 UI 快照。 |
| 同文件：追加后续指令保持冻结范围 | `delegation-inputs.nodetest.ts` 的持久 binding；`host/delegation-control.ts` 的 `sendMessage`/`prompt` | 合成验证通过：固定版原生 continuable 后续消息接口已接通，发送前重验父子 Session、Workspace、项目与冻结范围；真实子 Agent 续跑仍需安装态验证。 |
| 同文件：续跑从持久化子会话绑定重建 Context | `delegation-inputs.nodetest.ts` 的 `BindingStore` 重开 | 部分验证：落盘身份与范围一致；冷重开后的 DSH Agent 重绑及模型请求尚需安装态验证。 |
| 同文件：等待超时/取消仅释放等待，子会话需显式停止 | `host/delegation-tool.ts`、`host/delegation-control.ts` | 原生 `startContinuable` 初始受理即返回；`sendMessage` 的等待取消与显式 `interruptByParent` 当前轮中断分开，合成断言已覆盖。整棵子树取消与真实安装态生命周期仍未验证。 |
| 同文件：缺必需文件返回 `blocked-input` 且不启动 runner | `delegation-inputs.nodetest.ts` | 已测：生产 `linguist_delegate` 返回 `blocked-input`，没有预留 intent 或启动 native child。 |
| `automation-scheduler-linguist.test.ts`：来源删除、new/reuse/daily、跨日与到期执行 | `tests/required/acceptance.nodetest.mjs` 的 native Schedule 创建、冻结范围、due occurrence、手动 followup 和修改后拒绝；`host/schedule-context.ts` | 源码已有独立原生任务 owner、new/reuse/daily 执行会话、真实 turn/end 计数、maxRuns/失败暂停及 opt-in 通知。本轮 `tests/required/schedule-session-independence.nodetest.mjs` 覆盖来源删除后按冻结项目/模型/权限执行、冷重建和停止 owner 不复活；`schedule-manager.nodetest.mjs` 覆盖 runNow owner 回执和旧 source-owned 任务需重建。后两项尚未打包，真实安装态到期/Provider/取消/通知及专业完成仍待验证。 |
| `evidence-workflow-v1.nodetest.ts`：CAT 正文与合法图片进入最终模型内容 | `host/tool-adapter.ts`、`evidence-observer.nodetest.ts`、`tests/required/acceptance.nodetest.mjs` 的 raw Stage Evidence | 部分验证：目标内容一致性/响应门槛已测；图片 attachment 经 DSH 最终 Provider 序列化未测。 |
| 同文件：旧 CAT 会话备份迁移后保留 Pi 树身份 | `tests/required/acceptance.nodetest.mjs` 的历史 CAT metadata/备份与独立导入 | 旧 Pi Session 不是 DSH 可续跑 Session；按目标宿主边界排除原 Pi 树身份断言。CAT 项目原件、ID 与备份验证为独立目标行为。 |
| 同文件：工具说明经 Agent/Provider 序列化进入最终请求 | `evidence-observer.nodetest.ts` 验证 `host/tool-adapter.ts` 保留源工具 description/parameters | 未完成请求级验证：尚无真实 DSH Provider request capture 证明这些字段最终可见。 |
| 同文件：Context 缺页不完成、连续区间、无 anchor 文本及有界输出 | `packages/linguist-cat-store/src/stage-evidence.nodetest.ts` 的分片覆盖；`packages/linguist-cat-tools/src/tools.nodetest.ts` 的 Context 分页/预算测试 | 组件层已测；目标 Host 的跨页 DSH 工具结果→模型请求→Stage receipt 全链尚未重复跑。 |
| 同文件：T→R→P 分别完成 Full Review | `tests/required/acceptance.nodetest.mjs` 四岗位工具/绑定、`evidence-observer.nodetest.ts` 当前响应门槛、`stage-evidence-host.nodetest.ts` 岗位 Plan | 部分验证：历史 e4 有三专业岗位三句段的真实模型证据；最终安装版的逐岗位 Full Review、完整内容和响应身份全链仍未完成。 |
| `linguist-prompt-builder.test.ts`：专业岗位资源缺失稳定拒绝且不泄露路径 | `prompt-and-session-http.nodetest.ts` 驱动 `host/role-resources.ts` | 目标边界已测：缺失时固定错误消息，不在消息中泄露路径；目标错误码与旧 Electron `INVALID_INPUT` 信封不同。 |
| 同文件：通用岗位资源不可用时降级警告/诊断状态 | `host/role-resources.ts`、`host/diagnostics.ts` | 行为差异：目标对缺失的任一随包岗位文件固定报错并停止装载，未提供旧 general fallback；这是新宿主的 fail-fast 选择，不能标作旧降级行为等价。 |
| 同文件：岗位 Prompt 超 6000 字符拒绝 | `prompt-and-session-http.nodetest.ts` 驱动 `host/role-resources.ts` | 目标边界已测：超过 6000 字符或空白均固定拒绝；当前四份随包文件也符合限制。 |
| 同文件：Digest 只按完整条目裁剪并标注未展开范围 | `prompt-and-session-http.nodetest.ts` | 已测：目标 18k 上限、完整规则行、岗位文本和未展开提示。 |
| `project-delivery-evidence.nodetest.ts`：异步导出快照 revision | `project-delivery-evidence.nodetest.ts` | 完整迁入并通过。 |
| 同文件：按句段选择任务，小范围不掩盖旧缺口 | 同上 | 完整迁入并通过。 |
| 同文件：仅 blocking Gap 阻断，warning 随清单提示 | 同上 | 完整迁入并通过。 |
| 同文件：verified/as-is Export Manifest 区分 | 同上 | 完整迁入并通过。 |
| 同文件：QA 批次隔离 | 同上 | 完整迁入并通过。 |
| `project-import-preview.nodetest.ts`：真实解析、Phrase master/标签恢复不随扩展名改变 | `project-import-preview.nodetest.ts` | 完整迁入并通过；这是 domain service dry-run/commit 路径，另需安装态 Client 文件 token 流程。 |
| `session-availability.nodetest.ts`：定时范围与来源删除后只读执行 | `tests/required/acceptance.nodetest.mjs` 的 native Schedule 范围；`host/schedule-context.ts` | 本轮独立任务 owner 合成回归已覆盖来源删除后的冻结项目/模型/权限、冷重建与旧 source-owned 任务拒绝执行；执行权限取创建时冻结授权，不宣称统一只读。最终安装态来源删除、到期执行及专业结果仍待验证。 |
| 同文件：CAT 缺失/损坏/归档/恢复时保留宿主能力 | `prompt-and-session-http.nodetest.ts` 缺 DB 不重建、Prompt 降级；`tests/required/acceptance.nodetest.mjs` 归档只读 | 部分验证：缺 DB 与归档已测；真实 DSH Agent 通用工具在损坏/恢复期间的可用性未测。 |
| 同文件：旧格式项目/Pi Session 备份、恢复、verified 导出重导 | `tests/required/acceptance.nodetest.mjs` 历史 metadata、外部备份导入；目标 domain-service 交付测试 | CAT 数据路径部分验证；Pi 会话树续跑按新宿主边界排除，完整 verified 导出重导可复用 domain 测试但不是旧 Pi Session 等价。 |
| `session-ipc.test.ts`：已用岗位身份拒绝并返回 typed `INVALID_INPUT` | `prompt-and-session-http.nodetest.ts` 驱动目标 `registerHttpRoutes` handler | 目标岗位冻结已测：首次用户消息后改岗返回 HTTP 409 且旧绑定不变。协议从 Electron typed IPC 改为 HTTP 409，不宣称旧信封等价；本沙箱禁止监听 127.0.0.1，故此项未做 socket 测试。 |
| `stage-evidence-host.nodetest.ts`：独立 Plan/恢复、Context warning、current actor、revision | `stage-evidence-host.nodetest.ts` | 完整迁入并通过。 |
| 同文件：130k anchors 与 865 句恢复身份/范围 | 同上 | 完整迁入并通过。 |

## 当前接线与安装边界（2026-09-29）

固定宿主为官方 `0.2.0-rc.1`。其公开 `session/event` 是提交后事件，`Session.ownEvents()` 与 `SessionPersistence.open(id, read)` 可读取真实 `turn/end`。原生 Schedule 的投递历史不等于模型完成；当前实现从原生日志派生执行历史并区分受理、真实结束与专业完成，冷读排除 fork 继承前缀，不保存模型错误原文。早期 `0.1.7-rc.2` 的“无运行结果接缝、只能向来源 Session 投递”结论已被后续实现取代。

- 2026-09-29T10:25:20Z 已安装文件独立核对为 `df66a1292d06`（`1b86fb0`），21/21 文件匹配、两插件启用；其中包含 `5eca1e9` 的任务执行 Session/lifecycle 与 `a7d4c75` 的通知实现。旧动作确认待办已失效；操作者及准确安装时间未观察，登记仍需核对。证据为 `installed-df66-reconciliation.json`，ba 仅为历史安装。
- 本轮未提交、未打包源码将调度 owner 与来源 Session 分开：创建时冻结项目、模型、权限；来源删除后仍可执行；旧 source-owned 记录必须取消重建，保留历史与取消；手动运行按 owner 核对回执。合成证据见 `tests/required/schedule-session-independence.nodetest.mjs`、`artifacts/evidence/schedule-manager-green.log`。
- 普通 Composer 显式 CAT 原生引用已有同步/slash 冻结，Host 以实际 user message/rpcId 校验并存冻结 receipt，QA finding 与句段不得越出委派范围。专用 CAT 操作仍走真实 requestId 的 prepare→prompt。**每次普通发送默认自动附带仍未实现**：固定版本没有组合同步捕获、真实 requestId 和 await 准入的公开扩展；自动塞 chip 已移除，以保持 leading slash/IME。证据见 `native-composer-public-api-audit.json`、`native-composer-reference.log` 和 `turn-reference-qa-green.log`。
- 项目能力摘要已接原生 Skills、SKILL.md、默认指令候选路径和 Plugins/Files 导航；无 Session 不创建会话。默认候选不等于实际加载状态，未声称 MCP 精确启用数或 Memory 管理已迁完。此实现尚未打包、未安装。

### 自动任务通知来源与现状

有效源文件 `automation-notification-format.ts` / `automation-notification-service.ts` 已补入 inventory（333→335），两项仍 pending。源行为包含已有飞书 bot/chat 绑定、always/success/error 过滤和 assistant 正文卡片。目标 `a7d4c75` 已实现必要薄通知适配，复用 DSH 原生 settings 的 secret/volatile 配置、冻结收件目标和发送回执，已进入当前 df66 安装；原生 secret 脱敏与发送行为使用合成数据验证。真实配置与消息投递未验收，未发送外部通知。来源摘要见 `automation-notification-source-audit.json`，实现证据见 `schedule-notification-required.log`。

### 尚需最终安装版验收

真实 Provider 最终请求中的 CAT 文字/图片/完整参考/工具描述与响应身份、四岗位全范围及逐岗位 Full Review、工作副本、原生子 Session 冷恢复与取消、Schedule 真正到期/来源删除/重开/取消、通知配置与授权投递，以及完整 BrowserSkill localhost 链。通用岗位资源缺失当前是明确 fail-fast，与旧 fallback 不等价；不得把该行为差异写作旧断言已通过。

本轮源码汇总见 `artifacts/evidence/integration-parity-required.log`（204 Node、21 Bun、8 项类型检查）和 `integration-parity-build.log`；源隔离与目标 copied-domain 各 151 通过。多dock补充回归及重复订阅清理后的最终构建已通过。以上均不替代当前安装产物的 `verify:ready`。
