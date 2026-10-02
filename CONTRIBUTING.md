# 开发说明

## 当前依赖与命令

准备普通 **Node 24.21.0**、**pnpm 11.7.0**、**Bun 1.3.14**，在 PATH 中可调用。DSH SDK 固定为 **0.2.0-rc.2**；本机检查平台为 macOS ARM64。

不要用 DSH App 内受签名限制的 Node 运行 checkout 的第三方原生模块。普通 Node 可以加载声明依赖的预编译本机模块；SDK 间接依赖 koffi 已带平台二进制，维护配置不执行其额外源码构建。

从仓库根运行：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:required
pnpm build
pnpm pack:plugin
```

检查使用当前源码、已声明的官方 SDK、Node 回归、Bun 格式回归和合成样本。失败立即报错；不读取旧源码快照、功能清单或人工安装回执。

打包输出 `artifacts/linguist-dsh-plugin-1.1.3.tgz`，会核对岗位、专业标准与案例、七个业务技能、Worker 和 PDF/Office 资源，并运行实际 tarball 的资源检查。维护技能 la-doc-sync 不进入产品包。插件版本以 `packages/dsh-linguist/package.json` 为准，运行时与文件名读取同一版本。

LA 可以独立打包；本机若已有校验过的 BrowserSkill 适配包，额外复制到 artifacts，缺少它不会阻断 CAT 插件打包。浏览器模式仍需要安装 BrowserSkill。

## 代码入口

| 位置 | 职责 |
| --- | --- |
| packages/dsh-linguist/src/index.ts | 原生 Host 注册、岗位和生命周期 |
| packages/dsh-linguist/src/host | HTTP、文件暂存、工具、会话、调度和证据 |
| packages/dsh-linguist/src/client | DSH Slots 中的项目和 CAT 界面 |
| packages/linguist-cat-*、linguist-domain-service | 领域逻辑、格式、数据、QA 和工作副本 |
| packages/linguist-legacy-migration | 旧项目数据导入，继续保留 |
| integrations/browser-skill | 固定上游与文件动作适配 |

文件上限只维护 `LINGUIST_FILE_MAX_BYTES`。单文件、HTTP 预算、逻辑批次、解压安全与预览采样分开；分请求不得改变 Phrase 配对。

暂存完成/取消/过期的回收保护在途使用。IO 清理错误记录诊断并重试，不能掩盖入库写入失败或将已提交业务变成失败。

### 专业判断资源

`packages/dsh-linguist/resources/professional-judgment/standard.v1.json` 是共享标准源，四岗位方法只保留分工。Host 启动加载并计算内容 hash，每次原生 system prompt 组装读取当前项目摘要；插件更新后重新加载，新旧资源不混用。标准变化使尚未完成的 CAT 上下文 cursor 失效，需重新读取。

`examples.v1.json` 只收录经人工批准公开的合成案例。当前六组 DEV-02–07 已由仓库所有者于 2026-10-02 审定。`review.contentHash` 绑定实际内容；修改内容或撤销批准后不会作为已审定案例送出，重新审定后才能更新 hash。模型没有批准接口；历史 Voice exemplar 的阶段状态不等于人工批准。

`cat_get_translation_context` 按语言对、元数据中的功能及 `judgmentFocus` 选择案例；功能缺失可显式提供 `functionHints`，结果保留其来源。案例最多两组并计入整体 UTF-8 预算，空间不足优先移除案例。普通句段零案例正常。分页、子岗位和接续依旧读取实际正文与当前项目要求，hash 不能替代内容。

共享标准为项目自己的简短表述，参考 O’Hagan、Mangiron《Game Localization: Translating for the Global Digital Entertainment Industry》（2013）关于本地化功能、创意边界、语境和专业带教的讨论，尤其第 4 章 pp.190–195、第 6 章 pp.249–270；书籍正文不随包分发。合成对照能发现回归，不能替代未见样本的人工盲评。

### 原生预览配置

DSH 0.2.0-rc.2 的公开宿主配置支持以下限额。在 DSH 设置中打开用户配置文件，将这些字段合并到已有同名组件，保留其他设置，重开 DSH。不修改 `profiles/desktop`。下面是本轮大文件配置，适用于有足够内存的本机；默认普通安装不会自动提高限额。

```yaml
- id: office-to-pdf
  config:
    maxInputBytes: 536870912
    maxSourceBytes: 536870912
    maxUncompressedBytes: 1073741824
    maxConcurrentConversions: 1
    timeoutMs: 120000
- id: workspace-files
  config:
    maxFileBytes: 536870912
- id: ui-sidebar-documentpreview
  config:
    excel:
      maxBytes: 536870912
      maxCells: 1000000
      timeoutMs: 60000
```

Excel 限额按各工作表使用区域的行数×列数合计，稀疏表也占预算。Word/PPT 仍有 100 MiB 输出 PDF 和 10,000 个压缩成员的宿主限制。超限或转换失败会显示错误；Agent 正文抽取与 CAT 列映射保持各自职责。预览暂存使用 LA 现有一小时回收机制，采用独立只读副本，不把原稿 inode 交给可编辑入口。

2026-10-02 在本机独立进程调用官方 0.2.0-rc.2 转换器：约 60 MiB 的合成 Word、PPT 各成功输出 5 页 PDF，用时约 5.3 秒、1.4 秒，进程峰值约 1.1 GiB。官方 Excel 解析 Worker 处理约 36 MiB、40 万单元格样本用时约 1.5 秒，峰值约 1.4 GiB。上述时间与内存不含 Desktop 绘制和表格矩阵。随后从已安装 Linguist 的资料入口导入相同样本，三个原生预览均实际显示，Excel 选格和方向键跨首屏移动通过；没有测量完整桌面峰值，不能外推为所有 512 MiB 文件可流畅预览。

已复现宿主缺陷：0.2.0-rc.2 的 Excel Worker 对缺少 `sheetFormatPr.defaultRowHeight` 的工作表直接计算 `undefined * 96 / 72`，返回 `NaN` 行高；数据与公式栏可读，网格为空。3×3 合成工作簿在实际 Desktop 和官方 Worker 均复现，仅补充 `defaultRowHeight="15"` 的同内容副本返回 20 像素行高并正常显示。该项尚未修复；CAT 列映射与句段导入不受此显示缺陷影响。

回退时在原生插件管理安装先前保存的包；本轮不改变 CAT 数据库结构。预览限额可恢复上述组件的默认配置。不要用恢复整个旧项目备份来回退提示或预览功能。

## 本机安装与升级

通过官方 DSH 原生插件管理安装实际 tgz；CLI 不修改保留的 desktop profile。首次插件配置自动初始化存储，已有设置保持不变。按 [README](README.md#安装) 启用官方自动化组件，BrowserSkill 依 [固定集成说明](integrations/browser-skill/README.md) 配置。

更新先完成相关回归、构建和打包资源检查，再从原生界面安装，核对加载与项目数据。用用户常用的非客户样本手测，复现具体问题后做最小修复；源码测试不宣称真实桌面体验已完成。

prepare:local、install:local、launch、stop 是作者已有固定环境的辅助命令，需要本机官方 App、固定工具/包与自己的运行记录；不是普通译者的安装前置。install:local 不修改 desktop profile；检测尚未初始化会提示先启动 DSH，检测已安装包不要求人工回执，保留已有 home patch。

没有安装包公开发布授权时只交付本地包，不建立市场、npm 或自动更新发布。仓库源码推送与插件包发布分开处理。

## 说明同步

用户行为、安装、版本、格式、体积或数据行为变化后，使用 `.agents/skills/la-doc-sync/SKILL.md`，更新受影响的现有说明。README 面向译者，常用操作放 QUICK_START，开发命令维护在本文。

保留许可证、归属、业务技能、真实回归和旧数据导入。历史施工资料从 Git 历史查阅，不新建完成率或长期状态表。提交/推送前按 AGENTS 对实际 diff 运行 ponytail-review。
