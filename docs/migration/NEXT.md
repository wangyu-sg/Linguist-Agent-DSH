# 当前进度与接续（2026-09-30）

## 当前事实

- 目标：完整 LA 原生 DSH Host+Client 插件；源仓库只读。官方应用 `/Applications/DeepSeek Harness.app` 为固定 **0.2.0-rc.2**。
- 本轮修复代码提交 **9868c94**（上一界面提交为72a1fe5），整份精确 diff 已通过 Ponytail。GitHub 私有仓库 `wangyu-sg/Linguist-Agent-DSH` 已建，尚未推送；用户授权完成工作后推送。
- **实际安装为 LA 06190cb843e0 + BrowserSkill .4 7a6cfa1d**。用户明确确认后，官方管理器Install/立即启用完成，安装lib逐字节匹配；真实Host与自有登记一致。9项安装smoke通过；退出官方应用后Finder双击重开，方向键仍实测通过。证据 `native-install-la-06190cb843e0-7a6cfa1d.json`、`cat-arrow-native-0619.json`、`installed-smoke.json`。
- 当前用户指出的界面问题是真实缺陷。统一方案见 `UI-DESIGN.md`：紧凑项目/会话布局、统一 primary/outline/ghost 分类、可见且可键盘操作的面板边界、底部统计、中性选中态、主题继承。
- 已从源确认：旧 LA 底栏有 Unicode 字符数、草稿、真实阶段决策覆盖；导航与 dock 有边界拖动/键盘/复位。旧 LA 源文译文等分，没有比例菜单。参考检查器是目标布局重组，其可调宽度属于本轮用户要求。
- 总览不是完成证明：68 项领域能力和137项 UI 动作有交叉，sourceInventory 的文件数不是功能完成率。已重新打开漏迁的界面项；代码补齐与真实安装验收分别记录。

## 当前代码与直接下一步

- 新报告的CAT方向键问题已在安装4f2e复现：第9段Down选中第10段，但DOM焦点仍第9段，后续Down无变化。修复已在源码：虚拟行挂载时转移真实焦点，恢复子按钮/复选框导航，编辑内保留光标/IME，取消或保存后回到网格。定向回归先失败后8/8通过；候选包 `06190cb843e0` 通过258项Node、21项Bun、8组类型与6项tarball资源检查，已安装并在真实窗口及冷重开后验证连续上下、首尾、翻页、锁、编辑内光标、Esc和保存后恢复焦点。相邻的QA/外部跳转焦点和跨未加载页确认推进仍待补齐，未声称本轮一起通过。

1. 本轮代码已完成并整合：`ProjectsPage/ProjectSessions` 紧凑排布、统一各面板命令按钮；`CatWorkbench/Splitter/workbench-location` 三边界尺寸交互与保存，删除额外比例菜单；`CatStatusBar` 用现有完整 summary 与真实 stage coverage API 显示统计，不从可见行推算。
2. 当前安装包已通过256项 Node、21项 Bun、8组类型检查和6项 tarball 资源检查；整个代码提交经过精确 staged diff Ponytail `Lean already. Ship.`。实际安装验收与代码检查分开记录，不重新打包制造哈希变化。
3. 历史0fde领域验收执行162＋109条真实HTTP请求：22项通过，MQXLIFF编辑后as-is导出失败。已修正适配器误写确认状态，真实 Store 回归 RED→GREEN；严格回读未放宽，原失败证据保留。冻结修复包 **4f2e16f1e65a** 同时去掉术语重复文字和建议长 ID，已暂存到官方安装按钮前，257项Node、21项Bun、8组类型及6项实际包资源检查通过，打包后完整检查已重跑；用户已手动安装并核对启用、全部包字节与实际Host身份。新建合成项目隔离于客户数据。当前UI已观察底栏、全屏/并排、三处分隔条键盘调整与复位；鼠标拖动结果尚不稳定，正在核对，不标记通过。
4. 已在 0fde 实际完成明暗主题切换并恢复跟随系统、Unicode/换行保存读回、Tag与锁保护、虚拟网格至第240行、备份创建及恢复预览、QA与陈旧建议冲突。鼠标工具移动事件buttons=0，部分拖动结论不可靠；已询问用户手动观察，键盘调整正常。原生验收继续：项目页/会话布局、所有命令按钮、长名、三边界拖动/键盘/复位/缩窗/重开、字符数/草稿/确认和决策口径、明暗/窄短窗口。用户已授权只截取 DSH 窗口，操作用 CUA，保存用 `screencapture`；先核对官方应用当前 PID 和窗口编号。
5. 0fde 的真实模型 BrowserSkill 链已完成 localhost读取/修改LA-001/保存/上传/下载/停止：原生Session及server证据见 `artifacts/evidence/browser-native-0fde/`，不能据此跳过新包或边界场景。完成原待办：当前安装的全部 UI/领域路径、General/Translator/Reviewer/Proofreader 真实模型、BrowserSkill .4 原生工具经扩展操作 localhost、桌面 Finder 双击/停止/重开、逐能力真实证据。清单 `artifacts/evidence/installed-acceptance-checklist.json` 只是待执行项目。
6. 更新 STATE/FEATURE_MAP/HTML。`verify:ready` 全必需门禁通过才能发送“完整迁移完成，可以直接使用”；不能把本轮修复或测试通过当成整个迁移完成。不要在验收中运行会重新打包的 `deliver-local`。

- 0619热启用后领域测试15通过/1MQ失败，原记录保留；官方完整退出并Finder重开后，完全相同的MQ导出请求已通过4/4严格回读。推断旧Host模块热缓存影响，验收以冷启动后的运行态为准；后续整套cold复验在独立目录，不能覆写原失败。

## 已接受的差异与真实外部前置

- CAT 选区按用户要求改为显式“附带 CAT 选区”，发送时冻结；不自动注入每条消息，不改模型/岗位内容策略。
- D059 / LA-UI-127：用户选择暂不配置飞书，真实投递仍 `BLOCKED_ENV`，继续其余工作。
- LA-UI-136：用户已明确接受项目列表和会话顶部承载项目身份提示；此位置调整已定案，当前安装的身份关联/隔离验收仍需完成。
- 当前旧 `artifacts/READY.json` 为 FAILED 且过时；未发送完成通知。

## 不可破坏的边界

保留完整领域逻辑、四岗位/三路径、原文/Tag/换行/锁/稳定 ID/CAS 和专业证据语义。不给真实 Phrase、客户数据库或 OSgame 写入。所有验证用合成数据；不提取认证信息，不改 Provider/模型/effort 凑通过。BrowserSkill 是唯一正式浏览器链；UI 使用官方 DSH 槽位与主题，不另建宿主。
