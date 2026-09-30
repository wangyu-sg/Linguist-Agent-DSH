# 当前进度与接续（2026-09-30）

## 当前事实

- 目标：完整 LA 原生 DSH Host+Client 插件；源仓库只读。官方应用 `/Applications/DeepSeek Harness.app` 为固定 **0.2.0-rc.2**。
- 最近本地提交 **331c117fb5d77fa7b52a8ff886c2acf7fd86a93a**，整份精确 diff 已通过 Ponytail。GitHub 私有仓库 `wangyu-sg/Linguist-Agent-DSH` 已建，尚未推送；用户授权完成工作后推送。
- **实际安装已是 LA eb8b31ac99ff + BrowserSkill .3 a61fd813**。2026-09-30 从官方 desktop manifest、Host/Client 字节及 CUA 界面核实。安装登记 `current.json` 仍是 b9，不能继续拿该旧登记和 smoke 声称当前安装已验收。观察记录：`artifacts/evidence/ui-contract-native-observations.json`。此次安装由外部操作完成，代理未点击安装；已实际验证紧凑项目页、33/18字符与3/3底栏、三分隔条拖动/键盘/Enter复位和比例菜单移除。最终候选仍待更新。
- 当前用户指出的界面问题是真实缺陷。统一方案见 `UI-DESIGN.md`：紧凑项目/会话布局、统一 primary/outline/ghost 分类、可见且可键盘操作的面板边界、底部统计、中性选中态、主题继承。
- 已从源确认：旧 LA 底栏有 Unicode 字符数、草稿、真实阶段决策覆盖；导航与 dock 有边界拖动/键盘/复位。旧 LA 源文译文等分，没有比例菜单。参考检查器是目标布局重组，其可调宽度属于本轮用户要求。
- 总览不是完成证明：68 项领域能力和137项 UI 动作有交叉，sourceInventory 的文件数不是功能完成率。已重新打开漏迁的界面项；代码补齐与真实安装验收分别记录。

## 当前代码与直接下一步

1. 本轮代码已完成并整合：`ProjectsPage/ProjectSessions` 紧凑排布、统一各面板命令按钮；`CatWorkbench/Splitter/workbench-location` 三边界尺寸交互与保存，删除额外比例菜单；`CatStatusBar` 用现有完整 summary 与真实 stage coverage API 显示统计，不从可见行推算。
2. 新候选 **0fde55ac885b + BrowserSkill .4 7a6cfa1d** 已构建并暂存；256 项 Node、21 项 Bun、8 组类型检查和6项实际 tarball 资源检查通过。日志 `artifacts/evidence/ui-contract-{build,required,pack}.log`。对**整个将提交 diff**运行 Ponytail，仅 `Lean already. Ship.` 可提交；不要拿旧 review 覆盖新变更。
3. 已在官方插件管理器停在安装按钮；已发出整组更新确认，仍待回复。最终统一13处按钮尺寸后候选哈希已更新，安装时使用本页记录的最终包。确认后通过官方插件管理器更新 LA + BrowserSkill .4。真实安装后记录实际动作/字节再运行 `install:local` 完成自有登记；不直接改保留的 desktop profile，不伪造 receipt。
4. 原生验收本轮界面：项目页/会话布局、所有命令按钮、长名、三边界拖动/键盘/复位/缩窗/重开、字符数/草稿/确认和决策口径、明暗/窄短窗口。用户已授权只截取 DSH 窗口，操作用 CUA，保存用 `screencapture`；先核对官方应用当前 PID 和窗口编号。
5. 完成原待办：当前安装的全部 UI/领域路径、General/Translator/Reviewer/Proofreader 真实模型、BrowserSkill .4 原生工具经扩展操作 localhost、桌面 Finder 双击/停止/重开、逐能力真实证据。清单 `artifacts/evidence/installed-acceptance-checklist.json` 只是待执行项目。
6. 更新 STATE/FEATURE_MAP/HTML。`verify:ready` 全必需门禁通过才能发送“完整迁移完成，可以直接使用”；不能把本轮修复或测试通过当成整个迁移完成。不要在验收中运行会重新打包的 `deliver-local`。

## 已接受的差异与真实外部前置

- CAT 选区按用户要求改为显式“附带 CAT 选区”，发送时冻结；不自动注入每条消息，不改模型/岗位内容策略。
- D059 / LA-UI-127：用户选择暂不配置飞书，真实投递仍 `BLOCKED_ENV`，继续其余工作。
- LA-UI-136：固定 rc.2 没有公开 Workspace 行内徽标 Slot；项目页与 Session 顶部有身份提示，是否接受代替行内徽标的产品调整尚无用户决定。不能默认为通过。
- 当前旧 `artifacts/READY.json` 为 FAILED 且过时；未发送完成通知。

## 不可破坏的边界

保留完整领域逻辑、四岗位/三路径、原文/Tag/换行/锁/稳定 ID/CAS 和专业证据语义。不给真实 Phrase、客户数据库或 OSgame 写入。所有验证用合成数据；不提取认证信息，不改 Provider/模型/effort 凑通过。BrowserSkill 是唯一正式浏览器链；UI 使用官方 DSH 槽位与主题，不另建宿主。
