# 文件工作副本

用 `linguist_working_copy` 的 `prepare` 保存双语稿；传准确语言对和原件路径。用 `references` 指向当前双语稿，一次准备实际范围材料。首组内联便直接阅读，其余按 `continuationPaths` 连续读取。核对适用的规则、备注、TM／TB 和必要原图。

`assemble` 保存私有草稿；完整审阅且无阻断后，`deliver` 按已读版本生成并重新验证原格式交付副本。实际沿用 TM 原译或适配候选时，可在对应 edit 中提供 `tmUnitId`；只有最终译文保留该采用且写入成功才计复用。交接到下一岗位时，`sourcePath` 始终指原件，`previousResultPath` 指实际审读的工作稿，`previousResultSha256` 使用该稿返回的 `artifactSha256`；Reviewer 独立审读 Translator 最后保存的完整稿。保留原件 `sourceSha256` 与稳定 ID，版本由软件关联。`unchanged` 保留当前工作译文，未列 ID 仍未裁定。各会话交接使用工具返回的实际路径；`changes` 是本阶段差异，`finalChanges` 是对原件的累计差异，专业审校和平台提交以实际执行结果为准。

格式不兼容时，先检查具体文件与报错，选择现有工具或库；允许编写任务脚本或修复适配器，在原稿副本上核对内容对应、标签、锁定、未修改部分和输出可打开性，通过后继续已授权任务。可复用修复进入对应适配器，验证缺口明确说明。独立 Reviewer 的语言审校仍须完整完成。

普通 Word 等尚无双语适配的文件，用现有文档工具处理副本。保留稳定段落标识、最新双语、源稿和译稿版本，以及未改项的对应关系，以便独立 Reviewer 按完整范围审读。仅做报告时不执行 `assemble` 或 `deliver`。
