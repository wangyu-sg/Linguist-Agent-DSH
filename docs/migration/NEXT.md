# 当前进度与接续（2026-09-30）

## 实际安装与边界

- 官方 DSH：`/Applications/DeepSeek Harness.app`，固定 `0.2.0-rc.2`，默认 desktop profile 只通过官方 UI 管理插件。
- 实际安装：Linguist `06190cb843e0` + BrowserSkill `.4 / 7a6cfa1d`，installationId `la-06190cb843e0-7a6cfa1d`。源码最新提交 `376b841`；当前工作树另有导航及两处设计修正，未安装。
- `29bf7358aab2` 候选已失效：审查复现确认后筛选收缩、迟到响应及焦点问题，随后又修改了 QA 动作组和中性选中样式。不可安装或登记为当前最终产物。
- 源仓库只读；仅合成数据。BrowserSkill 唯一浏览器链。不开第二宿主，不访问真实 Phrase、OSgame 或客户数据库。

## 已有真实证据

- 0619：实际安装字节核对、9/9 smoke、官方退出后 Finder 双击重开；连续上下、首尾、翻页、锁、编辑内光标、Esc、保存后焦点均实测通过。见 `cat-arrow-native-0619.json` 和 `native-install-la-06190cb843e0-7a6cfa1d.json`。
- 冷启动领域验收：23/23，274 HTTP，8 格式原件 SHA、编辑、导出及严格回读；`installed-domain-0619-cold/domain-acceptance-summary.json`。
- 备份恢复：6 项、41 HTTP，含原件字节及 preRestore 安全快照；`maintenance-0619/domain-acceptance-summary.json`。
- 维护界面底层 API：6 组、101 HTTP、18 SSE；真实完整性 worker、取消、诊断、7 类 Context、Voice/技术资料/Tag。`maintenance-surfaces-0619/domain-acceptance-summary.json`。
- 上述证明属于 0619，不能修改身份、时间后充当新安装证据。热启用曾保留旧 Host 行为；每次新包安装后必须官方完整退出并重开。

## 本轮继续执行

1. 收口 `CatWorkbench.tsx` 的外部跳转焦点、确认后权威筛选索引、跨页跳锁、后续筛选取消及迟到响应处理。已有定向 RED→GREEN，独立 correctness review 正进行；不要边验收边重打包。
2. 使用 `awesome-claude-design` 与 `UI-DESIGN.md` 的既定方案；QA 主动作和刷新成组，中性选中态，统一 primary/outline/ghost 层级。完成检查与唯一冻结包后，通过官方管理器更新，再冷启动。
3. 当前包原生验收：8 类 UI 视图、明暗及窄短窗口、三处分隔条、CAT 编辑/CAS/IME/虚拟行/统计、项目会话身份及管理；真实四岗位、完整 required Context 正文和图像、长 Context 分页；非 CAT working-copy T→R→P；委派/queue/steer/中断及独立调度；BrowserSkill `.4` localhost 扩展链和取消/借还/peer 边界。
4. 专业合成项目 `prj-1770cc7bf2eff0d7` 已备好 XLSX required anchors 和 childImage；长分页项目 `prj-20c7a0b7f6873beb` 18,938 字符；working-copy 原件已放 synthetic Workspace。准确 ID/分页参数在 `context-0619/`。四岗位绑定在 `roles-0619/native-bindings.json`，目前仅准备，无真实专业模型回合。
5. 汇总真实 capability evidence，更新 STATE/FEATURE_MAP/HTML，运行 `verify:ready`。旧 READY 和 acceptance 均过时，不能当作当前判定。全部必需门禁通过才能发完成通知。

## 用户已决定

- CAT 选区按需点击附带，实际发送时冻结；不自动携带。
- 项目身份由项目列表和原生会话顶部承载，接受官方 SDK 无侧栏行内徽标接口。
- 暂不配置飞书，真实通知投递仍 `BLOCKED_ENV`；完成其余工作，不伪造通过。
- 私有 GitHub `wangyu-sg/Linguist-Agent-DSH` 已创建，尚未推送；完成工作后按授权推送。每次提交或推送的精确 diff 必须 Ponytail 返回 `Lean already. Ship.`。
