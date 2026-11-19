# 开发说明

## 当前依赖与命令

准备普通 **Node 24.21.0**、**pnpm 11.7.0**、**Bun 1.3.14**，在 PATH 中可调用。DSH SDK 在开发依赖中固定为 **0.2.2-rc.3**；运行时 peer 与 `engines.dsh` 范围为 `>=0.2.2-rc.3 <0.2.3-0`。兼容范围不是未来接口兼容的验证结论，升级需检查实际用到的接口；本机检查平台为 macOS ARM64。

不要用 DSH App 内受签名限制的 Node 运行 checkout 的第三方原生模块。普通 Node 可以加载声明依赖的预编译本机模块；SDK 间接依赖 koffi 已带平台二进制，维护配置不执行其额外源码构建。

从仓库根运行：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:required
pnpm build
pnpm pack:plugin
```

可用 `pnpm pack:plugin artifacts/<目录名>` 将安装包和打包清单写入独立目录，保留已有产物。

检查使用当前源码、已声明的官方 SDK、Node 回归、Bun 格式回归和合成样本。失败立即报错；不读取旧源码快照、功能清单或人工安装回执。

CAT、线上材料和工作副本共用的语义检索复用已安装的 MemSearch Python 环境及本地 `gpahal/bge-m3-onnx-int8`，通过离线子进程执行包内 `semantic-review.py`。正常回归使用合成进程／模型替身，不要求下载权重；使用安装了 `memsearch[onnx]` 且已有模型缓存的 Python 运行 `tests/semantic-review.integration.py`，可验证真实召回、缓存复用、模型变更失效和长原文覆盖。该集成检查不读取客户资料或调用付费模型。推理缓存独立于 CAT 正式库，不触发 CAT schema 变更；检索阈值只控制候选召回，不是语言质量或 TM 分数。全局开关保存于 LA 管理的 `review-preferences.json`，不改 DSH reserved profile；设置页复用官方 `settings.section` 插槽和现有项目设置面板。按组清理会取消该组的材料任务，删除该组的派生结果并保留共享向量。按项目清理会删除该项目的语义缓存文件和日志。

打包输出 `artifacts/linguist-dsh-plugin-1.6.2.tgz`，会核对岗位、专业标准与案例、七个业务技能、Worker、本地语义检索脚本和 PDF/Office 资源，并运行实际 tarball 的资源检查。插件展示资源通过 `scripts/check-plugin-display.mjs <tarball>` 核对中英文 `meta.title`／`meta.description`、原生资源导出和实际 PNG 数据。Linguist 详情通过 `scripts/check-plugin-detail.mjs <tarball>` 使用已声明的官方 `@deepseek-ai/dsh-plugin-detail` SDK 实际读取，核对中文、英文和语言回退；物理 `locale/*.json` 中的 `meta.detail` 指向包内 Markdown，并保留根 README 回退。维护技能 la-doc-sync 不进入产品包。插件版本以 `packages/dsh-linguist/package.json` 为准，运行时与文件名读取同一版本。

LA 独立打包。BrowserSkill 使用官方正式发行的 CLI／MCP 和商店扩展，保留官方更新能力；LA 安装不覆盖 BrowserSkill。安装、原生 MCP 配置和合成检查见 [BrowserSkill 集成说明](integrations/browser-skill/README.md)。

## 内部热更新

Linguist 与 DSH 创造模式均挂载官方 `plugin_manager`，沿用宿主权限检查与审批。使用 `action: "install_bundle"`、新包的 `file:` 绝对路径及 `enabled: true` 自动更新并热应用插件，无需用户手工导包。检查返回的 `application` 和 `warnings`，再核对 Host 组件、Client 界面及本次修复；`applied` 不代替实际功能验证。普通插件代码热更新无需退出 DSH。

宿主保留已开工 Agent 的预设组件和工具组合；更改预设后需新建 Agent，或在任务保存停稳后重启 DSH，原会话随后会按最新预设创建 Agent。`applied` 不表示旧 Agent 已重组，也不能只凭没有 `restart-required` 判断。1.3.5 删除额外的 tool-result-pruner，保留原生 compaction；升级后应重启一次 DSH，才能让已有会话使用这一组合。

官方工具的所有操作均经过完全权限检查；当前权限不足时使用宿主单次审批，不自动更改会话访问模式。工具出现在列表中不等于已获准安装；拒绝或取消审批后停止该操作。

这条现有路径已用于 LA 更新。仓库构建与内部热应用是两个动作，不把单独修改源码误报为运行中插件已更新；通过原生工具管理 Desktop 安装，不用 CLI 改写其保留 profile。涉及正在执行的写入时，先停在已保存状态，再更新并读取当前版本继续。

`cat_get_translation_context` 和 `cat_read_context_doc` 的完整 JSON 文本响应默认及最大预算均为 32,000 UTF-8 字节；较大的内容按真实 cursor 分页或分片。读取版本、成功写入后的版本与分片范围写入原生工具结果的私有 `meta.readSnapshots`；待确认的证据使用并列 `meta.evidence`，恢复后仍需完整正文进入真实模型请求并获得成功响应才落账。同一会话仅恢复自己的结果，排除分叉继承事件；不新建数据库结构，也不把当前 CAT 版本补成旧读取版本。

自动上下文在 `allowedTerms` 呈现普通 TB 参考正文及原状态，`preferredTerms` 保留建议证据；两者共同沿用 `termLimitPerSegment` 可选限额。已选中的术语不在预算压缩时丢弃，超过预算走既有 JSON 分片。`requiredTerms`／`forbiddenTerms`、冲突保护和 QA／写入强制级别保持各自语义，不增加术语级回执。

## 代码入口

| 位置 | 职责 |
| --- | --- |
| packages/dsh-linguist/src/index.ts | 原生 Host 注册、岗位和生命周期 |
| packages/dsh-linguist/src/host | HTTP、文件暂存、工具、会话、调度和证据 |
| packages/dsh-linguist/src/client | DSH Slots 中的项目和 CAT 界面 |
| packages/linguist-cat-*、linguist-domain-service | 领域逻辑、格式、数据、QA 和工作副本 |
| packages/linguist-legacy-migration | 旧项目数据导入，继续保留 |
| integrations/browser-skill | 官方 CLI／MCP 接入说明与合成检查 |

文件上限只维护 `LINGUIST_FILE_MAX_BYTES`。单文件、HTTP 预算、逻辑批次、解压安全与预览采样分开；分请求不得改变 Phrase 配对。

会话复制和自动任务通过 `sessionQuery.observeSession` 读取历史与模型等投影，并释放观察句柄。原生调度创建使用明确的 `target` 与 `timing`，修改、暂停和取消使用 `schedule.edit`；岗位子任务使用 `subagents.startActivation` 并将结果交回父会话。这些适配保留项目绑定、独立执行会话和原有工作范围检查。

暂存完成/取消/过期的回收保护在途使用。IO 清理错误记录诊断并重试，不能掩盖入库写入失败或将已提交业务变成失败。

### 专业判断资源

`packages/dsh-linguist/resources/professional-judgment/standard.v1.json` 是共享标准源，四岗位方法只保留分工。Host 启动加载并计算内容 hash，每次原生 system prompt 组装读取当前项目摘要；插件更新后重新加载，新旧资源不混用。标准变化使尚未完成的 CAT 上下文 cursor 失效，需重新读取。

`examples.v1.json` 只收录经人工批准公开的合成案例。当前六组 DEV-02–07 已由仓库所有者于 2026-10-02 审定。`review.contentHash` 绑定实际内容；修改内容或撤销批准后不会作为已审定案例送出，重新审定后才能更新 hash。模型没有批准接口；历史 Voice exemplar 的阶段状态不等于人工批准。

`cat_get_translation_context` 按语言对、元数据中的功能及 `judgmentFocus` 选择案例；功能缺失可显式提供 `functionHints`，结果保留其来源。案例最多两组并计入整体 UTF-8 预算，空间不足优先移除案例。普通句段零案例正常。分页、子岗位和接续依旧读取实际正文与当前项目要求，hash 不能替代内容。

共享标准为项目自己的简短表述，参考 O’Hagan、Mangiron《Game Localization: Translating for the Global Digital Entertainment Industry》（2013）关于本地化功能、创意边界、语境和专业带教的讨论，尤其第 4 章 pp.190–195、第 6 章 pp.249–270；书籍正文不随包分发。合成对照能发现回归，不能替代未见样本的人工盲评。

### 原生预览配置

DSH 0.2.0-rc.2 的公开宿主配置支持以下限额。在 DSH 设置中打开用户配置文件，将这些字段合并到已有同名组件，保留其他设置，重开 DSH。不修改 `profiles/desktop`。下面是接收上限为 1 GiB 的预览配置示例，适用于有足够内存的本机；默认普通安装不会自动提高限额。

```yaml
- id: office-to-pdf
  config:
    maxInputBytes: 1073741824
    maxSourceBytes: 1073741824
    maxUncompressedBytes: 1073741824
    maxConcurrentConversions: 1
    timeoutMs: 120000
- id: workspace-files
  config:
    maxFileBytes: 1073741824
- id: ui-sidebar-documentpreview
  config:
    excel:
      maxBytes: 1073741824
      maxCells: 1000000
      timeoutMs: 60000
```

Excel 限额按各工作表使用区域的行数×列数合计，稀疏表也占预算。Word/PPT 仍有 100 MiB 输出 PDF 和 10,000 个压缩成员的宿主限制。超限或转换失败会显示错误；Agent 正文抽取与 CAT 列映射保持各自职责。预览暂存使用 LA 现有一小时回收机制，采用独立只读副本，不把原稿 inode 交给可编辑入口。

此前复现的宿主缺陷：0.2.0-rc.2 的 Excel Worker 对缺少 `sheetFormatPr.defaultRowHeight` 的工作表直接计算 `undefined * 96 / 72`，返回 `NaN` 行高；数据与公式栏可读，网格为空。3×3 合成工作簿在实际 Desktop 和官方 Worker 均复现，仅补充 `defaultRowHeight="15"` 的同内容副本返回 20 像素行高并正常显示。当前宿主版本尚未复测此项；CAT 列映射与句段导入不受此显示缺陷影响。

预览限额可恢复上述组件的默认配置。CAT schema 21 在项目数据库中保存任务组、批次归属和资料引用。术语来源关联自 schema 20 起保留。项目列表摘要使用独立只读句柄，不触发升级或替换工作中的句柄。以可写方式打开旧项目并升级前会先生成备份，旧插件不能直接打开升级后的数据库。不要用恢复整个旧项目备份来回退提示或预览功能。

## 本机安装与升级

通过官方 DSH 原生插件管理安装实际 tgz；CLI 不修改保留的 desktop profile。首次插件配置自动初始化存储，已有设置保持不变。按 [README](README.md#安装) 启用官方自动化组件，BrowserSkill 依 [集成说明](integrations/browser-skill/README.md) 配置。

更新先完成相关回归、构建和打包资源检查，再从原生界面安装，核对加载与项目数据。用用户常用的非客户样本手测，复现具体问题后做最小修复；源码测试不宣称真实桌面体验已完成。

prepare:local、install:local、launch、stop 是作者已有固定环境的辅助命令，需要本机官方 App、固定工具/包与自己的运行记录；不是普通译者的安装前置。install:local 不修改 desktop profile；检测尚未初始化会提示先启动 DSH，检测已安装包不要求人工回执，保留已有 home patch。

没有安装包公开发布授权时只交付本地包，不建立市场、npm 或自动更新发布。仓库源码推送与插件包发布分开处理。

## 说明同步

用户行为、安装、版本、格式、体积或数据行为变化后，使用 `.agents/skills/la-doc-sync/SKILL.md`，更新受影响的现有说明。README 面向译者，常用操作放 QUICK_START，开发命令维护在本文。

保留许可证、归属、业务技能、真实回归和旧数据导入。历史施工资料从 Git 历史查阅，不新建完成率或长期状态表。提交/推送前按 AGENTS 对实际 diff 运行 ponytail-review。
