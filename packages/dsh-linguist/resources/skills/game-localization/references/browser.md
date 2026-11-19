# 在线平台作业

导出文件中的notes/context不保证包含线上Comments。开始时确认资料覆盖；优先在现有术语/TM核对中读取拟改项的备注。在线写回前须选中对应稳定ID，等待Comments面板刷新完成，核对当前Source/Target和实际备注；空图标或上一行面板不能证明无备注。未能读到时仅暂缓该项写回，不把全批每行都追加浏览器请求。纯文件任务使用实际交付的备注，平台资料缺失如实交接，不凭空创建线上检查。

客户指定译文须保留备注原文、作者、引用来源和适用字段/范围的依据；有实质冲突先列疑问，取得新的明确授权后才覆盖。普通建议不等于定稿，备注存在不等于锁定。同源其他字段是否适用，以真实关联ID和批准范围判断，不因中文相同就传播结论。

网页查证使用官方 BrowserSkill CLI／MCP，先读已安装的 browser-skill 指引及本次所需参考。MCP 工具带宿主的服务器名前缀，以实际 schema 为准。共享 MCP 服务时为当前任务设置独立 scope，后续调用沿用该 scope 和返回的 session，避免跨会话复用浏览器。首次 `bsk_session open` 可合并开窗、导航和读取。参数和目标已知的连续操作用 `bsk_plan`（CLI `bsk plan`，最多20步），需要中途判断时分开执行；停止后查看 completed/stopped/not_run，只续未执行部分。

普通导航快照先用 `max_tokens: 2000`（CLI `--max-tokens 2000`），在 open／sync／plan 和 interact 的 sync_after 中保持相同预算；省略预算会恢复无限返回，不能认为工具会继承。当前需要的源译文、TM、TB或状态优先用 `bsk_inspect action: read`（CLI `bsk read`）定点读取，复用有效 context；不为每个动作重复整页 sync／observe。必要材料超预算就定点补齐或扩大预算，不能把截断当作已读全量。预算约束页面导航噪音，不缩减独立审校和 TM／TB 的应查范围。

上传下载使用官方 interact 的 upload／download，待处理对话框按 operation_await 继续；截图用官方 inspect screenshot，由 DSH 原生显示图片。完整结果已有本地文件时优先读取该文件必要部分，不重新采集。同版本、同义项、同来源证据可复用，关联全部应查ID；TM与TB分别核对，不能用TB或本批自匹配冒充历史TM。

在 `linguist_prepare_project` 声明 `online: true`，沿用平台 Job、文件与稳定 ID。用完整双语导出或带稳定 ID、总数、读取时间的快照交接给 `linguist_delegate`。需要原图时按位置补查。仅做报告时保留现译及阶段状态；写回、上传与提交分别按用户实际授权和平台结果处理。公开术语与事实使用宿主搜索，打开原始网页核实适用性。
