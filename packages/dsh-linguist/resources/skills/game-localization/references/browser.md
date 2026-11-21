# 网页和在线作业

用 DSH Shell 加载官方 `ego-browser` 技能，执行 `ego-browser skill` 获取与本机安装版本匹配的操作说明。网页浏览、资料查证与登录态平台操作按当前项目规则、批次目标和用户授权执行；需登录时由用户在浏览器中完成。

普通网页咨询与只读资料采集可直接进行，无需先选择 CAT。涉及正式本地化批次时，通过 `linguist_prepare_project` 登记或接续批次身份（传 `batchId`、平台稳定 `batch` 标识或本地 `sources`），按已有选择或用户明确方式（`useCat`）配合 CAT、工作副本与浏览器。

- [Phrase 网页作业指引](../../phrase-platform-review-ops/SKILL.md) — Phrase / Memsource 编辑器定位、TM/TB/评论异步刷新、QA 差异、标签保存队列与确认边界
- [WeLoc 网页作业指引](../../weloc-platform-ops/SKILL.md) — WeLoc CMS/TMS 渠道差异、50/100 行分页、静态/编辑态区分、批注引用与 40 秒轮询保存边界
