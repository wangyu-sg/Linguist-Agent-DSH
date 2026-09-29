# 当前进度与接续（2026-09-29）

**当前包已安装启用，完整交付仍未完成。** 正式入口为 `/Applications/DeepSeek Harness.app`；Linguist 和 BrowserSkill 是其中的原生插件。

## 当前版本与证据

| 项目 | 已核实状态 |
| --- | --- |
| 当前安装 | `43f143cb3529`，源码 `d645fea`。用户动作时确认后，官方管理器 Install → 立即启用成功；回执记录于 2026-09-29T10:38:35Z。 |
| 登记与安装检查 | `install-local` 已登记 `la-43f143cb3529-b4f81677`；`smoke-installed` **9/9 PASS**，Linguist 21/21、BrowserSkill 14/14 包文件匹配。当前没有旧安装确认或 e4 登记待办。 |
| 源码检查 | 205 Node、21 Bun、8 项类型检查及构建/打包通过；源隔离与目标 copied-domain 各 151 通过。 |
| 真实模型 | 完整退出并由 Finder 双击重开后，显式 CAT 引用已通过真实 RPC Host 准入；DeepSeek-V41-Flash（`deepseek-account/deepseek-flash`）Max 读到项目 XML 并返回正确 projectId。该项目无选中句段，不能据此认定专业审校完成。 |

当前包包含：语言下拉/自定义及冻结、创建 QA 场景/创建后进入、目录选择/备份详情、空项目导入入口、项目能力与 Workspace 标识、独立自动任务 owner/冻结授权/旧任务需重建/owner 回执，以及显式 CAT 原生引用。

## 宿主接管边界

按实施规范 §16（第584行），Skills、MCP、项目指令、文件和终端保持 DSH 原生方式。当前能力区提供真实 Skills、SKILL.md、默认指令候选及 Plugins/Files 入口；默认候选不代表会话实际全部加载。

旧 Proma 的 Memory 按钮打开工作区 `memory/` Markdown 编辑窗口，是通用宿主能力，不是 LA 领域数据库；按宿主接管处理，不另建 Memory 后端或编辑器。固定 DSH Files/文档面板只读，这不能证明旧手工编辑等价。MCP 管理由原生 Plugins 接管；profile 插件清单不等于当前 Workspace 的有效服务器集合，不显示猜测的项目 MCP 数量。

## 继续执行

1. 本轮两处根因修复待新包安装：Host 补充 `sessions` 注入，修复自动任务列表与执行的原生服务错误；CAT 草稿与 Undo/Redo 改由 Session/project 内存状态保留，关闭重开工作台不丢失，插件卸载时清理。本轮211 Node、21 Bun、8类型检查已通过；统一打包，安装后必须冷重启再验收。
   - 当前43包冷启动、显式CAT Host准入已通过；60秒合成任务实际触发但报 `cannot get property "sessions" without inject`，保留真实失败记录。
   - 当前 BrowserSkill localhost CLI 扩展链与文件边界各10项通过；DSH Agent 工具调用及取消/重载仍需最终安装态验证。
2. **默认每次普通发送自动附带CAT上下文仍未实现。** 固定 `0.2.0-rc.1` 缺同步捕获、真实requestId及等待Host准入的公开发送扩展；边界已核对于 `native-composer-public-api-audit.json`。不能把显式引用或自动塞chip称为默认发送等价。
3. 对同一最终安装版完成全部工作台、四岗位、CAT/工作副本/浏览器三方式、复制/子任务/自动任务/取消、浅深色/窄窗/键盘/IME、真实Provider文字/图片/长上下文/工具说明、BrowserSkill localhost及生命周期验证。DSH原生Workspace行内徽章未找到公开Slot，项目列表Workspace标识不冒充该Slot。
4. 归并隐私范围证据并运行 `verify:ready`；只有当前安装产物全部必需门禁通过，才能发完整完成通知。

## 历史与验收限度

2026-09-29T10:25:20Z核对的df66及更早ba/e4均为历史安装。df66曾实际检查30语言/自定义、日语切换还原、语言冻结提示、单输入框边框及outline按钮；e4有真实模型与BrowserSkill证据。它们不自动计作43完整验收。台前调度关闭后-3811已解除；此前Finder双击、停止重开和CAT恢复也须按最终安装身份归并。

`READY.json`仍为早于当前安装的旧FAILED；32工具标complete、20功能面pending，不据此计算完成百分比。源只读、不操作真实Phrase/客户数据、不远端发布；缺失历史隐私基线按实际可核范围记录。

证据：`artifacts/evidence/native-install-43f143cb3529.json`、`installed-smoke.json`、`provider-43f143-coldstart-observation.json`、`desktop-43f143-coldstart.json`。历史记录保留于 `docs/migration/history/2026-09-29-before-status-reconciliation.json`。
