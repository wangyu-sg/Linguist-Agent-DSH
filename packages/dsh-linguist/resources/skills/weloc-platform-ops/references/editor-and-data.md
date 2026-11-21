# WeLoc 编辑器结构、字段与分页导出

> **观察范围说明**：以下技术细节源于对现网某一版 WeLoc 前端（Vue 3、Quasar、Pinia、Tiptap / ProseMirror）的技术参考观察（不含任何后续重构设计假设），不保证所有 WeLoc 部署或升级后完全一致。实际作业以当前页面观察为准，且不利用字段细节绕过界面锁定、权限或调用私有写接口。

## 1. 渠道入口与文件获取差异

- **CMSRnd / CMSOps / TMS 入口不同**：虽然共享相似的表格和编辑器外观，但这三种渠道的状态模型、文件入口和保存方式存在本质差异。开始作业前先确认当前任务处于哪类渠道，不要把 TMS 的失焦保存行为套用到 CMS。
- **订单原稿 vs 研发配表**：
  - 普通订单或任务详情页通常在「文件」页签提供原稿及「下载原稿」（Download Source File）按钮；在授权和账号权限允许时，优先取回原表并核对工作表、行与 Key（原表可能含上下文图片或额外列）。
  - 研发配表使用单独的文件界面，下载受项目管理权限限制，部分批次仅能看到文件名或空文件历史。
- **前端 CAT XLIFF 1.2 导出**：
  - 平台提供前端生成的 XLIFF 1.2 导出（「Export .xliff → Export」），支持全量、筛选与选中等不同导出范围。
  - 导出 XLIFF 时必须注明实际导出范围并保留 `key`、语言对与上下文映射；能成功导出 XLIFF 不代表可以从本地无损导回平台。

## 2. 静态显示节点与真实编辑态

- 原文和未激活译文主要由 `v-highlight` 渲染为静态 `div.text.parent`；只有激活 `TargetText` 单元格时，才会在该行挂载 Tiptap / ProseMirror 的 `EditorView`。
- **静态节点易失性**：在异步高亮、筛选切换或分页重渲染后，静态显示节点可能整体重建。
- **作业约束**：先识别当前面对的是真正可交互的 `EditorView` 还是只读静态节点；绝不可修改静态 HTML 文本或属性来冒充译文写入。

## 3. 50 / 100 行硬分页与范围隔离

- 在该观察版本中，主双语表格 `QTable` **关闭了虚拟滚动**，采用 **50 / 100 行硬分页**。
- **与 Phrase 的区别**：切勿把 Phrase 的连续虚拟列表滚动机制套用到 WeLoc；跨页读取或核查时，必须按实际分页逐页翻阅、核对页码与条数并连续收集。
- **五类范围分开处理**：侧栏显示范围、表格筛选条件、当前页范围、勾选选中项与全量文件各自独立；报告覆盖与导出数据时须写清实际所处范围。

## 4. 句段身份、当前译文与可编辑性

- **稳定身份与可见行号**：
  - 行身份使用 `id`、`file_uuid`、`local_index`、`key`；界面显示的序号仅用于当前页导航，不能代替全局或跨分页 ID。
  - 源文与上下文相关字段包括：`source_lang`、`source_text`、`source_text_updated_at`、`context`、`original_context`、`context_chs` / `context_en`、`desc`、`max_length`、`media.image` / `media.video`。采集和交接时应保留这些字段的对应关系，不要把不同来源的字段混成一条。
- **当前译文 `targets[0]` 与重复句**：
  - 当前界面绑定 `targets[0]`，其中 `lang`、`text`、`version`、`text_updated_at` 用于识别当前在编版本；`translate_status` / `cms_status` / `operate_status` 与 `quality_status` / `issue_info` 分别承担不同阶段和质量语义。
  - `match_rate` / `translate_from` 解释候选来源；`repeated_key_md5` / `repeated_type` 解释重复句关联。高 `match_rate` 只是匹配线索，不等于已审定质量。
- **不可仅凭单个锁图标判断可写性**：行本身和 `targets[0]` 都可能带 `readonly` 或 `dnt`，且另有 `disable_edit_reason`。写前必须在现场确认整行与当前目标态均允许编辑。

## 5. 观察版本内部状态枚举参考（只读解释用）

以页面可见文案与状态为主，以下该版枚举仅用于理解接口或页面暴露出的状态含义，**禁止直接写入内部状态码来绕过操作或宣称完成**：

| 字段 | 该观察版本记录值 | 对作业的含义 |
| --- | --- | --- |
| `local_status` | `0` Normal、`1` Saving、`2` Save_Conflict、`3` Save_Failer、`4` Modify_Status_Failer、`5` Refresh_Failer | 出现 2–5 时表明保存/改状态/刷新失败或冲突，需先核查当前稿和错误提示再决定重试 |
| `translate_status` | `2` InDraft、`3` Confirmed、`4` ReviewConfirmed、`100` DNT、`200` ReadOnly | 仅对应 TMS 视角；**CMS 阶段另有自己的状态枚举，不可直接套用此数字表** |
| QA 状态值 | `0` None；`1/2` 旧失败/成功；`3/4` 当前失败/成功 | 区分无检查、历史结果与当前 QA 结果，结合实际 QA 报告判断 |
