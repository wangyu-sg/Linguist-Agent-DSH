# 当前进度与接续（2026-09-30）

## 已核实

- 官方 `/Applications/DeepSeek Harness.app` 为 **0.2.0-rc.2**；固定包、签名和 Gatekeeper 已核验。
- 本地只读源清单含 **68 项领域能力、137 项界面动作**，两份清单有交叉，不能相加作完成率。入口 `audit-2026-09-29/功能迁移总览.html`。
- 整合 diff 经完整 Ponytail 审查 `Lean already. Ship.` 后，本地提交 **895ab8f**（完整41文件精确diff）；未推送。
- **LA b9c16b6d1905 + BrowserSkill a61fd813** 已通过官方 DSH 插件管理器安装启用，两项均不再显示“异常”。`current.json` 已登记 `la-b9c16b6d1905-a61fd813`，`smoke-installed` 九项字节/身份检查全过。
- 安装后实际视觉检查未通过：CSS Modules loader 丢失 `composes` 组合类和依赖 CSS，Workspace/select 等出现浏览器默认样式。已改用 Lightning CSS 原生 `bundleAsync`，新增真实 loader 回归 2/2；b9 包实际界面已确认组合样式生效。
- 用户进一步指出 UI 整体不成熟。已实现项目页紧凑岗位/方式选择、两行项目元数据、统一主次按钮，以及 CAT 工具栏/句段次操作收敛。构建与233项Node、21项Bun、8项类型检查通过；b9c16b6d1905 包已通过官方原生插件管理器更新，字节 smoke 9/9 及官方 Host 实时状态身份核对通过。不能仅以构建通过替代视觉验收。

## 下一步直接执行

1. 收口真实源遗漏：项目拖拽、归档确认、报告复制、调度主动暂停/恢复与执行会话导航已实现；monthly 短月及 every 运行时段/星期薄适配已实现。整包构建、248 项 Node、21 项 Bun、8 项类型检查全过。保留后续控件修正。先构建，再顺序执行 required 检查，避免并发 build 清理 lib。
2. 核对真实 tarball 的动态资源：PDF worker 缺资源与 OfficeParser nested file-type API 冲突已修正，六项实际资源解析通过；接入永久整包资源守卫。隔离 BrowserSkill 自动升级已恢复固定0.3.1；生产 runner 禁止自动升级的 .4 薄适配已通过383测试和两次可复现构建；项目名点击复用原生CAT会话的遗漏已修正并通过实际production callback回归。最终 LA **9b0275459a72**＋BrowserSkill **7a6cfa1d** 整包资源检查通过，接下来对精确整合 diff 完整 Ponytail 审查、提交并原生更新这两个候选。用户确认过 e20，但该包因已发现资源缺陷而未安装。
3. 当前安装完整 UI、四岗位、三路径、真实模型、BrowserSkill localhost、桌面双击/停止/重开及逐能力验收。G13 每个必需能力需要真实安装态观察，不能用源码存在代替。
4. 更新证据和状态后 `verify:ready`；仅全部必需门禁通过才通知完整完成。`deliver-local` 会重新打包，不能在当前验收中间运行。

## 已纠正的接口判断

- D005：DSH 公开 `workspaceRegistry.archiveSession(id,{stopActivity:true})` 可使失败副本退出活动流程并可恢复，无需私有 delete。已实现且回归通过，安装验收待完成；不能称物理删除，归档失败应显式报告残留 ID。
- D046：现有显式“附带 CAT 选区”引用在发送时冻结快照，Host 能绑定真实 RPC 并在模型运行前准入。真正差异仅是普通无引用消息缺少公开自动 snapshot producer。参见 `artifacts/evidence/native-composer-rc2-public-api-reaudit.json`，旧审计保留原样。不添加会干扰 IME、光标和 slash 的常驻自动 chip，不冒称自动携带等价。用户已明确接受按需点击附带，发送时冻结的交互（2026-09-29）；需要验收显式引用在当前安装包的真实行为。

## 其他约束与证据

- 当前原生安装证据：`artifacts/evidence/native-install-b9c16b6d1905.json`，操作链 `native-install-b9c16b6d1905-trace.json`。旧 9e 原始记录不补写。
- 桌面窗口一度出现 AX 状态与画面失步，经官方菜单退出、重新打开后恢复。Finder 已实际定位并双击官方应用，但这是中间候选过程，不能直接作为最终候选冷启动验收。
- 截图可由 CUA 显示；其文档没有落盘接口。系统 Screenshot.app 原生访问超时，用户已明确授权仅对 DSH 窗口使用 macOS `screencapture`，已成功保存修改前实际窗口；动作仍用CUA，截图来源单独记录。
- 用户接受 CAT 上下文开销，本轮不改内容策略；见 `docs/CONTEXT_COST.md`。
- 用户新增授权建 GitHub 私有仓库 `https://github.com/wangyu-sg/Linguist-Agent-DSH`，已创建；本轮完成后再推送供网页 Pro 分析。不得公开发布。
- 源仓库只读，不触碰真实 Phrase/客户数据库，不改 DSH 核心，不覆盖旧应用或用户数据。旧 READY 为 FAILED 且过时，当前没有完成证明。

## 当前外部前置

- D059 / LA-UI-127：实际安装的 ScheduleList 返回零通知目标。用户于2026-09-30决定先不配置飞书；真实投递保持 BLOCKED_ENV，完成其他不受阻工作，不降低门禁、不伪造通知成功。

- LA-UI-136：固定rc.2没有公开Workspace行内徽标Slot；项目页关联和会话顶部已有真实身份提示。已请用户决定接受这两处提示还是保留原行内徽标要求；未默认豁免，见 `artifacts/evidence/native-workspace-badge-public-api.json`。
