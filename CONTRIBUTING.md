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

打包输出 `artifacts/linguist-dsh-plugin-1.0.1.tgz`，会核对岗位、七个业务技能、Worker 和 PDF/Office 资源，并运行实际 tarball 的资源检查。维护技能 la-doc-sync 不进入产品包。插件版本以 `packages/dsh-linguist/package.json` 为准，运行时与文件名读取同一版本。

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

## 本机安装与升级

通过官方 DSH 原生插件管理安装实际 tgz；CLI 不修改保留的 desktop profile。首次插件配置自动初始化存储，已有设置保持不变。按 [README](README.md#安装) 启用官方自动化组件，BrowserSkill 依 [固定集成说明](integrations/browser-skill/README.md) 配置。

更新先完成相关回归、构建和打包资源检查，再从原生界面安装，核对加载与项目数据。用用户常用的非客户样本手测，复现具体问题后做最小修复；源码测试不宣称真实桌面体验已完成。

prepare:local、install:local、launch、stop 是作者已有固定环境的辅助命令，需要本机官方 App、固定工具/包与自己的运行记录；不是普通译者的安装前置。install:local 不修改 desktop profile；检测尚未初始化会提示先启动 DSH，检测已安装包不要求人工回执，保留已有 home patch。

没有安装包公开发布授权时只交付本地包，不建立市场、npm 或自动更新发布。仓库源码推送与插件包发布分开处理。

## 说明同步

用户行为、安装、版本、格式、体积或数据行为变化后，使用 `.agents/skills/la-doc-sync/SKILL.md`，更新受影响的现有说明。README 面向译者，常用操作放 QUICK_START，开发命令维护在本文。

保留许可证、归属、业务技能、真实回归和旧数据导入。历史施工资料从 Git 历史查阅，不新建完成率或长期状态表。提交/推送前按 AGENTS 对实际 diff 运行 ponytail-review。
