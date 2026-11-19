---
name: game-localization
description: 执行中英游戏本地化的翻译、完整双语审校、校对或相关交接。按文本用途、受众和现有资料进行专业语言判断，连续处理并使用既有工具提交。用于实际TEP，不用于普通闲聊；不自动增加用户未要求的岗位或审校范围。
group: linguist
version: "1.2.0"
---

# 游戏本地化作业

用于正式翻译、审校、校对和交付。理解成果、受众、语言对、完整范围、适用资料及授权。普通咨询直接回答。

- **接手已有批次**：沿项目导航找到本批台账，用 `linguist_inspect_delivery_report` 核对现有交付表的表头或批次页签，再按[工作区维护标准](references/workspace-maintenance.md)交接当前稿、当时的资料和下一步。
- **开工**：把正式任务的稿件交给 `linguist_prepare_project`，已有 CAT 批次用 `existingCat: true`，线上任务用 `online: true`。工作方式未定时，宿主会显示选择，取得答复后再开工。沿用用户已选的方式，用户明确让 LA 决定时采用建议。
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
