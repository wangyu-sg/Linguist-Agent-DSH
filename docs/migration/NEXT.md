# 当前进度与接续（2026-09-29）

## 已核实

- 官方 `/Applications/DeepSeek Harness.app` 已更新 **0.2.0-rc.2**，签名/Gatekeeper/固定DMG验证通过。证据 `artifacts/evidence/dsh-rc2-official-desktop.json`。
- 按本地只读源仓库列出 **68项领域能力、137项界面动作**，分别记录来源、目标入口、实现差异与安装状态。两个清单有交叉，不能相加冒称功能数或完成率。用户可读入口 `audit-2026-09-29/功能迁移总览.html`。
- 本轮整合代码已完成构建，**8组类型检查、228项Node、21项Bun**通过。BrowserSkill rc.2薄适配 `.3` 的382项检查通过、重复构建hash一致。全部为源/合成检查，尚非新安装验收。
- 统一控件与容器布局、项目Modal、分类设置、术语插入、QA对照、任务进度/停止、调度冷恢复、复制失败恢复反馈、模型来源、委派结果与七项内置Skills已进入候选。

## 当前安装状态

上次安装为rc.1的LA `9e362081d5d9`；宿主升级后插件未加载。`current.json`仍登记旧安装，不代表rc.2已安装。整合候选 `0461faede705` 已打包暂存，尚未原生安装；旧READY为FAILED且已过时。

## 下一步直接执行

1. 对完整待提交diff执行Ponytail最终审查，只有 `Lean already. Ship.` 才本地提交。两个分范围预审已通过，不代替最终完整审查。
2. 打包并暂存一组LA+BrowserSkill rc.2候选，官方Desktop原生插件管理更新。不能通过CLI修改reserved desktop profile。
3. 冷停止/官方图标双击，完整UI、四岗位、三路径、真实模型、BrowserSkill localhost及逐能力验收。G13要求完整来源清单每个必需能力均有当前安装观察，不能用源码存在代替。
4. 更新证据/状态后运行verify:ready。仅全部必需门禁通过才可通知完整完成。

## 尚未闭合的宿主接口边界

- 普通原生Composer每次发送自动冻结CAT显式引用/选区：rc.2公开API没有同步capture+实际requestId+await准入的提交扩展；显式@CAT与LA主动发起任务路径可用，不能当作默认行为等价。
- 复制失败后的原生Session删除事务：公开API缺失；LA绑定/工具会清理，并准确报告残留Session ID，不能声称已删除。

继续完成不受阻的安装和验收。源仓库只读，不触碰真实Phrase/客户数据库，不修改官方DSH核心，不公开发布。用户于2026-09-29新增授权：已建私有仓库 https://github.com/wangyu-sg/Linguist-Agent-DSH ，本轮完成后推送供网页Pro分析；尚未推送。旧9e安装原始记录不补写；历史截图、旧版本模型证据不冒充新包。

## 最新补充

- 首候选 c05335d56c18 已暂存但从未安装。完整Ponytail审查发现可直接复用官方 FileSystemSkillProvider，已删除自写加载器；新候选 `0461faede705` 已重建，8组类型检查、228项Node、21项Bun全过；仍须重新完整审查，旧hash未获放行。
- 用户接受当前CAT上下文开销，本轮不做上下文内容优化；核对结果见 `docs/CONTEXT_COST.md`。
