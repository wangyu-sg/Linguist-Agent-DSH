# 当前进度与接续（2026-09-29 核对）

**完整交付未完成。正式入口为 `/Applications/DeepSeek Harness.app`；Linguist 和 BrowserSkill 是官方 DSH 中的插件。**

## 安装、候选和源码

| 层次 | 已核实状态 |
| --- | --- |
| 实际安装 | `df66a1292d06`（源码 `1b86fb0`），2026-09-29T10:25:20Z 只读核对默认 desktop 的 21/21 文件与 tgz 一致，安装对话框已关闭，两插件启用。ba 是此前安装。 |
| 安装登记 / 历史验收 | `current.json` 和旧安装动作回执仍为 e4，登记需对齐；e4 的真实模型、BrowserSkill 证据只能作为历史证据，不能改写成 ba 或 df66。 |
| 当前包内容 | df66 含语言下拉、创建 QA 场景、创建后进入、原生目录选择、备份详情，以及任务执行会话和通知的前轮实现。旧动作确认待办已失效，无需重装；操作者和准确安装时间未观察，不虚构动作回执。 |
| 本轮源码 | HEAD 仍为 `1b86fb0`，以下新增修改未提交、未打包、未安装。205 Node、21 Bun、8 项类型检查通过，多dock补充回归及清理后的最终构建通过。源隔离与目标 copied-domain 各 151 通过。 |

本轮源码已实现：

- 新建空项目直接提供导入入口，打开已有资料面板；项目设置阶段标签跟随界面语言。

- 项目设置的可调用 Skills 真值、打开 SKILL.md、DSH 默认指令文件候选路径、原生 Plugins/Files 入口；无会话时提示进入项目会话。默认候选不等于实际载入，MCP 精确启用摘要和 Memory 入口仍未闭环。
- LA 项目列表的 Workspace 标题/路径与不可用状态；DSH 原生 Workspace 行内徽章仍无已核实公开 Slot。
- 自动任务独立原生 owner，来源删除后保留冻结的项目、模型和权限；旧 source-owned 任务提示取消重建，保留历史/取消；手动运行校验任务 owner 回执。
- 普通 Composer **显式 CAT 原生引用**：同步冻结、slash 裁决前冻结、Host 按实际 user message/rpcId 校验及 QA 委派范围检查。

df66 已实际检查30语言选项与自定义、切换日语后还原、已有批次的语言冻结提示，以及单输入框边框和备份操作的 outline 按钮。证据为 `artifacts/evidence/df66-ui-scope-check.json`；这是局部安装态检查，截图仅工具内观察，完整 UI 验收仍待完成。

## 剩余交付工作

1. **普通 Composer 每次发送默认自动附带仍未实现。** 固定官方 `0.2.0-rc.1` 缺同步捕获、真实 requestId 和等待 Host 准入的公开发送扩展。公开接口核对已收口于 `artifacts/evidence/native-composer-public-api-audit.json`；显式引用可用，自动塞引用已移除，避免改变 leading slash/IME。此缺口不能标完成。
2. 收口本轮源码、最终构建及明确的新候选身份。df66 已安装，无需等待旧确认或重装；后续新包通过官方管理器更新后，按实际文件核对并对齐登记，不虚构历史安装时间。
3. 对同一最终安装版完成全工作台、四岗位、CAT/工作副本/浏览器三方式、复制/子任务/自动任务/取消、浅深色/窄窗/键盘/IME、真实 Provider 文字/图片/长上下文/工具描述、BrowserSkill localhost 完整链与异常生命周期验收；保留 MCP/Memory 和原生 Workspace 徽章的准确边界。
4. 归并隐私范围证据并运行 `verify:ready`。只有当前安装产物全部必需门禁通过，才允许完整完成通知。

## 证据限度

台前调度关闭后 -3811 已解除；Finder 双击冷启动、停止重开与 CAT 会话恢复已观察，不能再把截图错误当当前阻断。完整安装态验收尚未完成，普通聊天自动上下文也仍有实现缺口。

`READY.json` 是早于当前状态的旧 FAILED；32 工具标 complete、20 功能面 pending，不代表20项都未实现，也不据此计算完成百分比。隐私审计缺部分历史基线，仅记录可验证范围；源只读、不操作真实 Phrase/客户数据、不远端发布的约束继续有效。

实际安装证据：`artifacts/evidence/installed-df66-reconciliation.json`。本轮源码检查：`artifacts/evidence/integration-parity-required.log`、`integration-parity-build.log`。历史记录：`docs/migration/history/2026-09-29-before-status-reconciliation.json`。
