# Linguist Agent for DSH

DeepSeek Harness 原生 Host + Client 插件，迁移 Linguist Agent 的 CAT、非 CAT 工作副本、专业岗位与 BrowserSkill 工作流程。

## 当前状态

官方宿主基线为 **DSH 0.2.0-rc.2**。本轮统一前端与功能补齐处于集成验收阶段；源码检查通过不代表当前安装产物已完成验收。以 [迁移状态](docs/migration/STATE.json) 和 [接续记录](docs/migration/NEXT.md) 为准。

## 分析入口

- [完整功能总览](docs/migration/audit-2026-09-29/功能迁移总览.html)：可下载后在浏览器搜索和筛选。
- [68 项领域能力](docs/migration/audit-2026-09-29/SOURCE-DOMAIN.md)及[结构化清单](docs/migration/audit-2026-09-29/SOURCE-DOMAIN.json)。
- [137 项界面操作](docs/migration/audit-2026-09-29/SOURCE-UI.md)及[结构化清单](docs/migration/audit-2026-09-29/SOURCE-UI.json)。
- [前端问题审计](docs/migration/audit-2026-09-29/TARGET-UI-ISSUES.md)：施工前问题、统一标准与验收要求。
- [上下文开销核对](docs/CONTEXT_COST.md)：CAT 选区、常驻提示与工具正文的区别。
- [实施规范](handoff/01-完整实施规范.md)、[架构决策](docs/migration/DECISIONS.md)。

领域能力与界面操作清单相互交叉，不能把两者相加作为功能总数或完成率。每项实现状态与安装验收状态分别记录。

## 代码边界

| 路径 | 职责 |
|---|---|
| `packages/dsh-linguist/src/host` | 原生工具、会话绑定、证据、HTTP/SSE、任务适配 |
| `packages/dsh-linguist/src/client` | DSH Slots 中的项目与 CAT 工作台 |
| `packages/linguist-cat-*` | 格式、存储、编辑约束、QA 与工具领域逻辑 |
| `packages/linguist-domain-service` | 项目、资源、工作副本和专业工作流 |
| `integrations/browser-skill` | 固定上游版本及文件传输薄适配 |

DSH 管理模型、权限、会话与 Agent 循环；BrowserSkill 承担正式浏览器控制。开发命令见根 `package.json`。本机实际安装通过官方 DSH 插件管理器完成。

## 验收与数据

`test:required` 检查类型和合成行为；`verify:ready` 核验当前包的实际安装、桌面重开、完整 UI、四岗位、模型与浏览器证据。缺失门禁时不能称为完整完成。

运行时 profile、凭据、本机安装包、客户数据不进入此仓库。文档中的 `artifacts/` 是本机证据位置，未随 Git 分发；没有证据的项目不能因为链接存在就视为通过。

许可证与来源见 [LICENSE](LICENSE)、[NOTICE](NOTICE.md) 和 [第三方声明](THIRD_PARTY_NOTICES.md)。
