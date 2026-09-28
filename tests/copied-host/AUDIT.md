# 源 Host 测试接续审计（合成数据）

本目录只运行目标 DSH Host/domain 代码。`.migration/source-snapshot` 只用于核对原测试断言；未在真实源仓库安装、构建或写入。2026-09-29 执行：

```sh
node --experimental-transform-types --import ./packages/linguist-cat-store/test/register-ts-loader.mjs --test tests/copied-host/*.nodetest.ts
```

原始输出见 `../../artifacts/evidence/copied-host-last-run.tap`：15 pass、0 fail、0 skip。该结果是目标源码的本机合成测试，不是已安装 Desktop、真实 Provider 或 BrowserSkill 的验收。

下表中的“完整迁入”表示原测试主体与断言基本原样运行，只替换 Proma/Electron 耦合的导入或已删除字段；“部分验证”明确列出尚未覆盖的边界。

## 逐项对应

| 原测试文件与用例 | 目标证据 | 结论与剩余边界 |
|---|---|---|
| `agent-collaboration-linguist-context.test.ts`：委派继承可信 Context、目标渠道/推理档 | `tests/required/acceptance.nodetest.mjs` 的 Turn Context 与 native delegation；`host/turn-context.ts`、`host/delegation-tool.ts` | 部分验证：冻结 CAT 项目/范围及 native `subagents.startContinuable` 已测；实际子请求的 Provider/模型/effort 身份仍需安装态验证。 |
| 同文件：父轮次无 UI 快照仍冻结自身 CAT 范围 | `tests/required/acceptance.nodetest.mjs` 的 `native delegation freezes CAT range` | 目标行为已测：Host 从绑定项目和显式 ID 冻结，不依赖临时 UI 快照。 |
| 同文件：追加后续指令保持冻结范围 | `delegation-inputs.nodetest.ts` 的持久 binding；`host/delegation-control.ts` 的 `sendMessage`/`prompt` | 合成验证通过：固定版原生 continuable 后续消息接口已接通，发送前重验父子 Session、Workspace、项目与冻结范围；真实子 Agent 续跑仍需安装态验证。 |
| 同文件：续跑从持久化子会话绑定重建 Context | `delegation-inputs.nodetest.ts` 的 `BindingStore` 重开 | 部分验证：落盘身份与范围一致；冷重开后的 DSH Agent 重绑及模型请求尚需安装态验证。 |
| 同文件：等待超时/取消仅释放等待，子会话需显式停止 | `host/delegation-tool.ts`、`host/delegation-control.ts` | 原生 `startContinuable` 初始受理即返回；`sendMessage` 的等待取消与显式 `interruptByParent` 当前轮中断分开，合成断言已覆盖。整棵子树取消与真实安装态生命周期仍未验证。 |
| 同文件：缺必需文件返回 `blocked-input` 且不启动 runner | `delegation-inputs.nodetest.ts` | 已测：生产 `linguist_delegate` 返回 `blocked-input`，没有预留 intent 或启动 native child。 |
| `automation-scheduler-linguist.test.ts`：来源删除、new/reuse/daily、跨日与到期执行 | `tests/required/acceptance.nodetest.mjs` 的 native Schedule 创建、冻结范围、due occurrence、手动 followup 和修改后拒绝；`host/schedule-context.ts` | 部分验证：固定 RC 的到期路径向原 Session `agent.followup` 并在 `sessions.flush` 后记录投递，LA 的 `agent/pre-step` 再验授权。手动运行已用相同原生 Agent inbox 投递且不改原排程；返回受理不代表模型完成。旧 new/reuse/daily 子 Session 策略、来源删除后到期、真实 Provider 运行、maxRuns/失败暂停/业务完成通知仍未覆盖。 |
| `evidence-workflow-v1.nodetest.ts`：CAT 正文与合法图片进入最终模型内容 | `host/tool-adapter.ts`、`evidence-observer.nodetest.ts`、`tests/required/acceptance.nodetest.mjs` 的 raw Stage Evidence | 部分验证：目标内容一致性/响应门槛已测；图片 attachment 经 DSH 最终 Provider 序列化未测。 |
| 同文件：旧 CAT 会话备份迁移后保留 Pi 树身份 | `tests/required/acceptance.nodetest.mjs` 的历史 CAT metadata/备份与独立导入 | 旧 Pi Session 不是 DSH 可续跑 Session；按目标宿主边界排除原 Pi 树身份断言。CAT 项目原件、ID 与备份验证为独立目标行为。 |
| 同文件：工具说明经 Agent/Provider 序列化进入最终请求 | `evidence-observer.nodetest.ts` 验证 `host/tool-adapter.ts` 保留源工具 description/parameters | 未完成请求级验证：尚无真实 DSH Provider request capture 证明这些字段最终可见。 |
| 同文件：Context 缺页不完成、连续区间、无 anchor 文本及有界输出 | `packages/linguist-cat-store/src/stage-evidence.nodetest.ts` 的分片覆盖；`packages/linguist-cat-tools/src/tools.nodetest.ts` 的 Context 分页/预算测试 | 组件层已测；目标 Host 的跨页 DSH 工具结果→模型请求→Stage receipt 全链尚未重复跑。 |
| 同文件：T→R→P 分别完成 Full Review | `tests/required/acceptance.nodetest.mjs` 四岗位工具/绑定、`evidence-observer.nodetest.ts` 当前响应门槛、`stage-evidence-host.nodetest.ts` 岗位 Plan | 部分验证：三个岗位的真实 DSH 模型请求和逐岗位 Full Review 全链未完成。 |
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
| `session-availability.nodetest.ts`：定时范围与来源删除后只读执行 | `tests/required/acceptance.nodetest.mjs` 的 native Schedule 范围；`host/schedule-context.ts` | 部分验证：范围冻结/变更拒绝已测；来源 Session 删除及到期后只读执行未测。 |
| 同文件：CAT 缺失/损坏/归档/恢复时保留宿主能力 | `prompt-and-session-http.nodetest.ts` 缺 DB 不重建、Prompt 降级；`tests/required/acceptance.nodetest.mjs` 归档只读 | 部分验证：缺 DB 与归档已测；真实 DSH Agent 通用工具在损坏/恢复期间的可用性未测。 |
| 同文件：旧格式项目/Pi Session 备份、恢复、verified 导出重导 | `tests/required/acceptance.nodetest.mjs` 历史 metadata、外部备份导入；目标 domain-service 交付测试 | CAT 数据路径部分验证；Pi 会话树续跑按新宿主边界排除，完整 verified 导出重导可复用 domain 测试但不是旧 Pi Session 等价。 |
| `session-ipc.test.ts`：已用岗位身份拒绝并返回 typed `INVALID_INPUT` | `prompt-and-session-http.nodetest.ts` 驱动目标 `registerHttpRoutes` handler | 目标岗位冻结已测：首次用户消息后改岗返回 HTTP 409 且旧绑定不变。协议从 Electron typed IPC 改为 HTTP 409，不宣称旧信封等价；本沙箱禁止监听 127.0.0.1，故此项未做 socket 测试。 |
| `stage-evidence-host.nodetest.ts`：独立 Plan/恢复、Context warning、current actor、revision | `stage-evidence-host.nodetest.ts` | 完整迁入并通过。 |
| 同文件：130k anchors 与 865 句恢复身份/范围 | 同上 | 完整迁入并通过。 |

固定 Desktop 0.1.7-rc.2 内嵌 `@deepseek-ai/dsh-schedule/lib/index.js` 与目标 pinned npm 文件逐字节一致。其公开服务仅有 `create/list/catalog/history/delete/update`；`history` 类型明确是 inbox delivery，不是模型或业务执行结果。原生 daily/every 规则可用；旧自动任务的子 Session 轮换、runCount/maxRuns、连续失败暂停、完成通知没有对应的公开运行结果回调。手动运行借公开 `SessionController.resolveAgent`、`Agent.followup`、`sessions.flush` 接通原 Session，不能据此宣称旧子会话执行模式等价。

下一步验收应集中在上述请求级与安装态空缺：真实 DSH Provider 请求中的 CAT 文字/图片/工具描述、三岗位 Full Review、原生子 Session 冷恢复与取消、Schedule 真正到期执行，以及通用岗位资源缺失时是否允许旧式降级的产品决定。合成测试通过不代替这些门禁。
