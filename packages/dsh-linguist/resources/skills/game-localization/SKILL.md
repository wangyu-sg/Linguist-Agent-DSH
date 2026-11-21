---
name: game-localization
description: 执行中英游戏本地化的翻译、完整双语审校、校对或相关交接。按文本用途、受众和现有资料进行专业语言判断，连续处理并使用既有工具提交。用于实际TEP，不用于普通闲聊；不自动增加用户未要求的岗位或审校范围。
group: linguist
version: "1.3.0"
---

# 游戏本地化作业

用于正式翻译、审校、校对和交付。理解成果、受众、语言对、完整范围、适用资料及授权。普通咨询、查词与只读网页资料采集直接处理。

- **接手已有批次**：沿项目导航找到本批台账，用 `linguist_inspect_delivery_report` 核对现有交付表的表头或批次页签，再按[工作区维护标准](references/workspace-maintenance.md)交接当前稿、当时的资料和下一步。
- **开工与批次登记**：需要项目资料或批次身份时，调用 `linguist_prepare_project` 传原稿、已有 `batchId` 或平台的稳定 `batch` 标识，线上传 `online: true`，仅采集传 `reportOnly: true`。新正式本地批次未明说方式时省略 `useCat`，系统按该批既有选择或项目“新本地批次默认”设置决定；仅用户明确指定切换方式时再传 `useCat`。续接沿用同一 `batchId`；CAT 可与网页及本地文件配合，平台动作仍须已有批准。
- **分工**：General 用 `linguist_delegate` 从开工委派正式翻译。现译审校直接交独立 Reviewer；只有明确校对、目标语润色或实际需要的精修才使用 Proofreader，正式成品的精修在最终 Reviewer 前。
- **材料与责任**：提供最新全文、适用原始依据和稳定标识。按连贯内容阅读；内联首组直接读，沿 `continuationPaths` 续读。各岗位完成自己的实际职责，同一范围由一人写入。完整审校覆盖声明范围内的所有原文、当前译文及必要上下文。
- **收尾**：沿用当前有效成果，只复核变更和影响范围。按[交付表](references/delivery.md)填写本阶段 Excel，再交付实际成果与未决项。只报告的任务保留现译与确认状态，并交审校表。

## 按当前需要读参考

- [CAT](references/cat.md)
- [文件工作副本](references/working-copy.md)
- [在线平台](references/browser.md)
- [项目资料和查证](references/project-evidence.md)
- [中译英](references/zh-en.md) · [英译中](references/en-zh.md)
- [游戏文本与表达](references/game-texts.md) · [依据与质量判断](references/quality-evidence.md)
