# MemSearch 设置

DSH 独立插件，为已安装的官方 `@zilliz/memsearch-dsh` 增加设置入口与窄窗布局适配。它不替换或改写官方插件，官方插件可照常更新；外观适配依赖当前官方面板的 CSS 类，上游改变界面后可能需要更新本插件。

在 DSH 的「设置 → MemSearch」中，可以查看本地检索配置、调整项目摘要及技能候选的后台整理开关，并设置 DSH headless 的默认模型。下拉列表来自当前 DSH 提供方，后台是否具备相同模型仍需验证。后者会影响所有使用该默认值的 headless 任务，不改变前台会话的模型；MemSearch 使用自定义 API 摘要模式时不受它控制。保存会检查最终配置，不会自动测试模型调用，也不配置凭据。

本插件使用 MemSearch 自带的 `memsearch config` 命令管理整理选项。官方插件的记录与召回开关仍由官方插件管理，不会被本插件替换。保存模型只更新 headless profile 中的 `agent-default-model`，保留其他条目；如果文件在页面打开后被修改，需要刷新后再保存。

依赖 DSH 0.2.2-rc.2、官方 MemSearch DSH 插件、`memsearch` 和 `dsh` 命令。退出或关闭 LA Studio 不会影响本插件。首次安装后请在 DSH 桌面端确认设置页可见，并验证浅色、深色和窄窗显示。
