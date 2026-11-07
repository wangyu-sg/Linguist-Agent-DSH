# Third-Party Notices

本文件说明当前 DSH 插件及配套集成中的重点第三方组件。版本以各包
`package.json` 和 `pnpm-lock.yaml` 为准；各依赖的完整许可与版权以其包内
LICENSE／NOTICE 为准。本页不是完整的依赖 SBOM。

## 宿主与浏览器集成

- **DeepSeek Harness**：提供原生 Host、Client、会话、模型、工具与界面接口。
  LA 原生预设的改编归属及 MIT 许可全文见 [NOTICE.md](NOTICE.md)。
- **BrowserSkill**：配套浏览器插件基于 Tencent 的 MIT 项目；固定基线、
  补丁及说明见 [集成目录](integrations/browser-skill/README.md)。

## 文件与文档处理

| 组件 | 许可 | 用途 |
| --- | --- | --- |
| @xmldom/xmldom | MIT | XML／XLIFF 解析 |
| jszip | MIT OR GPL-3.0-or-later；本项目选择 MIT | ZIP 与文档容器读写 |
| mammoth | BSD-2-Clause | Word 参考正文和 HTML 抽取 |
| officeparser | MIT | Office 参考正文抽取 |
| pdfjs-dist | Apache-2.0 | PDF 正文和预览 |
| file-type | MIT | 文件类型识别 |

PDF.js 的许可全文随插件保存在
`resources/third-party/pdfjs-dist-LICENSE`；源文件位于
[插件资源目录](packages/dsh-linguist/resources/third-party/pdfjs-dist-LICENSE)。

## 编辑器与离线拼写

| 组件 | 许可 | 用途 |
| --- | --- | --- |
| React / React DOM | MIT | 宿主原生界面组件 |
| Jotai | MIT | 客户端状态 |
| @tanstack/react-virtual | MIT | CAT 网格虚拟化 |
| TypeBox | MIT | 工具和数据边界 schema |
| @formatjs/icu-messageformat-parser | MIT | ICU 变量结构解析 |
| nspell | MIT | 英文离线拼写检查 |
| dictionary-en | MIT AND BSD | en-US Hunspell 字典 |

离线拼写组件为已声明的运行依赖，保留其包内许可文件；项目自定义词典
属于用户项目数据，与随依赖提供的字典分别管理。

当前直接依赖声明见 [插件清单](packages/dsh-linguist/package.json)、
[格式清单](packages/linguist-cat-formats/package.json)、
[核心清单](packages/linguist-cat-core/package.json) 和
[领域服务清单](packages/linguist-domain-service/package.json)。
