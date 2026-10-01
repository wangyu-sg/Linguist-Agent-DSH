# 目标仓库工作规则

## 用户提供的项目规则

- 不默认认同用户判断；先检查前提、逻辑、缺失信息和未经证实判断，区分事实、推测、观点和未知。
- 不保留内部旧实现的向后兼容层；删除废弃路径。只写满足当前要求的最小实现，复用已有依赖，避免推测性抽象。
- 保持模块边界清楚；必须先形成端到端可用版本，再逐层增加能力。
- 不修改无关文件。成功条件须明确，并在验证通过前持续修复。
- 提交或推送前必须对待提交 diff 运行 `/ponytail-review`，仅当结果为 `Lean already. Ship.` 才能继续。
- 仅在系统边界校验；不为不可能场景增加防御式分支，不吞错误；一次性操作不建抽象。

## 产品与维护边界

LA 是 DSH 原生 Host + Client 的游戏本地化插件。DSH 管理会话、模型、权限、通用工具、子任务与调度；LA 管理 CAT、格式、项目资源、专业决策与必要界面。BrowserSkill 是唯一正式浏览器控制链。使用公开 SDK、原生 Slots 与主题，不重做宿主或 Agent 运行时。

- 源仓库 /Users/wangyu/Desktop/linguist-agent-next 只读；目标已有文件、用户未提交修改及配置保留。
- 保留 General、Translator、Reviewer、Proofreader 和 CAT、工作副本、浏览器三种工作方式。岗位不限制宿主通用工具或用户权限。
- 审校覆盖已确定的 Source／当前 Target／必要上下文范围；保留标签、锁定、稳定 ID、修订冲突、撤销、恢复与当前修订的真实执行者证据。提案不等于审校完成，导出不等于平台提交。
- LA 控制的单文件接收上限为 512 MiB，普通批次与参考资源一致；共享常量是事实来源。HTTP 请求预算与逻辑批次分开，分请求上传须保留同批 Phrase 配对。接收上限不保证所有格式的解析性能。
- 暂存完成或取消后释放；待确认与在途输入受到保护；过期和重启孤儿回收仅操作 LA 自有 staging。保护原稿、正式数据、备份与交付物。
- 正常构建、测试与打包只依赖当前源码、声明的依赖和合成样本，不依赖旧源码镜像、历史功能清单或作者手制回执。保留有用回归，只验证相关改动；已知代码断点须修复或准确报告。
- 主要入口：packages/dsh-linguist/src/index.ts、src/host、src/client；packages/linguist-cat-*、packages/linguist-domain-service；integrations/browser-skill。linguist-legacy-migration 是旧数据导入能力，保留。
- 正常命令：pnpm install --frozen-lockfile、pnpm typecheck、pnpm test:required、pnpm build、pnpm pack:plugin；工具版本见 CONTRIBUTING.md。

## 文档与交付

涉及安装、兼容版本、格式、体积／批量限制、用户操作、外部依赖、默认写入、暂存或恢复行为的修改后，使用 $la-doc-sync 同步受影响说明。该技能位于 .agents/skills/la-doc-sync，不能进入产品运行时资源或插件包。

README 写给译者，开发命令放 CONTRIBUTING。说明以实际代码、产物和检查为准；不维护迁移完成率、多份状态账本或永久证据索引。明确修复、相关检查和真实打包完成后交用户手测，进入复现问题后最小修复的维护循环，不扩展为全面迁移验收工程。此维护规则依用户 2026-10-01 的明确选择取代此前迁移合同。

## 授权与数据保护

- 允许目标代码、固定必要依赖、非客户合成检查、本地插件包及原生安装、自己服务的启停和本地提交。官方 Desktop 管理其 desktop profile；CLI 不得修改该保留 profile。安装标识和已有设置保持稳定。
- 允许向 https://github.com/wangyu-sg/Linguist-Agent-DSH 推送公开源码；凭据、运行时 profile、客户数据和个人日志不提交。安装包公开发布须另有明确授权。
- 不访问真实 Phrase 任务，不修改真实 OSgame／客户库，不覆盖旧 LA／Proma／DSH 用户数据，不提取 Cookie／密钥，不绕过登录或系统授权，不静默更换模型、Provider 或 effort。
- 提交和推送前须对精确 diff 运行 /ponytail-review，只有 Lean already. Ship. 才可继续。报告使用中文，未执行的检查与真实缺口如实交代。
