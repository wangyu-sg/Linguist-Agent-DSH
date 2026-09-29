# 接续状态（2026-09-29）

## 当前执行点

- 目标模式已启用，持续完成全部迁移与验收。新候选 `la-543d8b64cce4-b4f81677` 已构建暂存：Linguist 侧栏采用 DSH 原生单色地球图标；格式扩展名去除重复点；跨 Workspace 历史复制改用 DSH 公共持久化与显式 ID 接管接口。定向测试通过并验证真实 DSH 存储格式与 Session 继承边界；尚待新包安装态实测，原安装身份暂不代表这些改动。

- 官方 `/Applications/DeepSeek Harness.app` 0.2.0-rc.1，默认 `~/.dsh/profiles/desktop`。LA `478ea64aa103` 和 BrowserSkill `b4f81677` 已经官方原生管理器安装并启用，官方自动化任务启用。
- 当前安装身份 `la-478ea64aa103-b4f81677` 已由 `install:local` 写入 current.json；真实安装 trace/回执在产品 receipts。当时 `smoke:installed` 9/9 PASS；生成543候选后 verifier 已将当前 smoke 证据更新为 FAILED（安装包身份仍478），不可将历史通过当作当前候选通过。
- 桌面控件失效恢复方式：通过 DSH 原生应用菜单点击“退出 DeepSeek Harness”，再 `cua.getApp('/Applications/DeepSeek Harness.app')` 重开。单纯重绑、Raise、reset 无效；正常退出重开后连续导航、输入、安装和启用均响应。无需用户代点安装。根因未确定，不宣称修复上游控制工具。
- 已观察 Linguist 原生主面板的项目表单、四岗位、三工作方式。两插件启用后再次 Cmd-Q 正常退出并 getApp 重开，插件开关仍 on。Finder getApp 仍报 ScreenCaptureKit -3811，因此尚未完成真正 Finder 双击验证；不可把 getApp 启动冒充双击。
- 新候选更新时桌面捕捉再次 -3811，发生于窗口绑定前；重置 CUA、正常退出快捷键、重启已核实的控制辅助服务均未恢复。既有 DSH 进程存在。此问题与先前已恢复的 stale-window 错误分别记录，不伪称恢复。
- 修复扩展安装空目录：installer 总是复制固定扩展资源，23 文件逐一摘要匹配；浏览器测试现读取产品实际扩展 manifest。CLI、daemon、localhost fixture 通过，扩展尚未连接。浏览器工具明确拒绝 chrome://extensions 并禁止其他表面绕过；已向用户请求一次手动安装/连接，其他工作继续。
- 下一步继续当前安装态完整 UI、Provider、BrowserSkill localhost 扩展链，以及功能矩阵缺口。主插件 8/8 typecheck、173 Node、21 Bun、源/目标 CAT 各151、安装回执3项和 BrowserSkill382项先前通过；它们不代替实际功能验收。
- `verify:ready` 尚未全通过，不能发送成功通知。普通 Composer 提交绑定、自动任务业务完成等缺口，以及跨 Workspace 新实现的安装态验证及旧证据保持真实状态。源仓库只读，未访问真实 Phrase 或客户数据库。

- 本轮修正 installer：仅在原生 profile 已装候选且安装回执存在时更新运行配置身份。实际运行暂存回归通过：退出码2、NATIVE_INSTALL_PENDING，当前配置和 current.json 字节不变；此前提前写入543的配置已按真实478安装 manifest 恢复。桌面绑定重试仍 -3811，未伪填 UI 证据。

- 最新 BrowserSkill：用户已安装启用0.3.1，真实扩展链 CLI_CHAIN_PASS，10项全部通过，含 AgentWindow、localhost读写、上传、下载摘要和关闭。回执 `artifacts/evidence/browser-skill-localhost.json` 及 action trace 对应安装478。下一步是当前候选原生安装后的 DSH Agent browser_* 实际调用与Skill发现；扩展连接阻塞已解除。

- 最新候选 `la-1739a774a38a-b4f81677` 已重建：原生 layout navigation 取消旧工作台等待及迟到的会话创建导航，回归直接执行实际 Client apply 注册，必需检查已纳入并通过；Host/Client类型检查和构建通过。当前原生安装仍478，须更新后重新采集最终验收。

- 最新候选 `la-628578201bb3-b4f81677` 已构建暂存：项目新建/重命名/语言设置采用共享Host限制与原生表单校验；批次SHA显示末4位并可复制完整值，拒绝复制会明确提示失败；列表补归档时间。175 Node、21 Bun、8类型检查及构建通过。原生安装仍478，最终UI/Provider/BrowserSkill Agent工具证据仍须新包更新后采集。

- 最新候选 `la-e4c2c189ff96-b4f81677` 已构建暂存：恢复源V1选区快照的对象/数组冻结语义；原请求级测试新增拒绝修改及固定序列化顺序断言。175 Node、21 Bun、8类型检查和构建通过。桌面重试仍-3811；已请求用户正常退出/重开官方DSH，等待实际恢复后更新插件和验证。

## 先前记录

状态：IMPLEMENTING，未达到 READY。只读源 `/Users/wangyu/Desktop/linguist-agent-next` 未改动；目标代码和独立产品数据根在 `/Users/wangyu/Desktop/Linguist-Agent-DSH` 与 `/Users/wangyu/Library/Application Support/Linguist-Agent-DSH`。

- 正式载体已改为固定官方 DSH Desktop `0.1.7-rc.2` ARM64 成品。DMG 来源、SHA-256、签名、公证、内嵌运行时均核对；两插件实际 tgz 已通过官方原生管理器装入独立 `desktop` profile，并排入口 `/Users/wangyu/Desktop/Linguist Agent DSH.app` 经 Finder 双击、退出、重开，两个插件仍启用。旧 `a3260da726fe` 安装实例曾通过 9/9 静态身份检查；当前 `8ca040bebfa6` 包尚未更新到原生管理器，G04 失败。
- 官方桌面已创建合成 Workspace 与项目，导入 3 段 JSON，编辑并确认 1 段，QA 找到 2 个空译文，交付只读预检如实阻断；四岗位 DSH Session 已创建。真实已配置 Provider 曾返回指定合成响应；`artifacts/evidence/provider-observation.json` 对应更早的 `la-773ddbf48d07-ba6d99c6` 安装身份，并非当前包的 G07 证据。旧截图在 `artifacts/evidence/ui-*.png`，不能用于新包验收。
- BrowserSkill 固定 CLI/私有 daemon/localhost fixture 已通过，但 Chrome 扩展连接数为零，真实 AgentWindow 与上传/下载链为 `BLOCKED_ENV`。不得用 CLI doctor 或原生面板空状态冒充完整浏览器验证。
- `docs/migration/FEATURE_MAP.json` 目前 333 源文件中 25 pending（16 个实现/资源、9 个测试），20 个必需功能面 pending；32 个工具映射 complete。Renderer/Host 接续审计分别见 `tests/copied-renderer/AUDIT.md`、`tests/copied-host/AUDIT.md`。新 LA 包 `8ca040bebfa6` 已构建并暂存，BrowserSkill 包仍为 `ba6d99c6`；打包后 8/8 typecheck、173 Node、21 Bun、隔离源与目标 CAT 各 151/151 通过。正式 Desktop 当前仍安装旧 `a3260da726fe` 包，须经原生管理器更新到 `8ca040bebfa6`、重开并重新采集证据。
- 隐私只读审计回执 `artifacts/evidence/privacy-readonly.json` 为 `PARTIAL`：源和快照清单、产品路径隔离及合成 fixture 通过局部检查，旧目录施工前后全量写入史和全局日志/远端发布史无法由事后扫描证明；不得用它给 G09 写入全真通过。
- 新包已接原生 continuable 委派、后续消息/列表/当前轮中断，以及定时任务手动投递；Client 修复 CAT 聚焦横向滚动，补原生 Composer 范围提示和 Files 入口。Host 还修正了列映射 JSON 的批次误识别、HTTP 各路由未分类异常泄露，以及专用 CAT 任务 requestId 到实际 toolCall 的选区来源绑定。它们只有源码/合成检查通过，均待新安装包实际验证。固定 RC 无普通 Composer 提交前 hook、跨 Workspace 历史 fork 目标参数，也无自动任务到期完成回调与独立新 Session 策略；对应原功能仍 pending。旧包 CUA 观察过 7+160 段导入、锁行、Emoji/组合字符、撤销/重做、换行和 Tag 防护，IME 尚未实证。
- 当前 `artifacts/READY.json` 为 `FAILED`；G01/G02 是矩阵未完，G04 是安装身份不同，G03/G05–G12 首先被旧 `acceptance.json` 身份挡住，不能视为各项已独立验收失败。后续须先完成新包原生更新与重开，再补当前实例的 Provider、四岗位、CAT/项目/UI、浅深色、窄窗、编辑器和冲突场景证据；在独立浏览器授权可用时执行 BrowserSkill localhost 扩展链；继续消除矩阵真实缺口并复测。仅 `verify:ready` 对当前实例全部通过才发送成功通知，否则报告 `FAILED`/`BLOCKED_ENV`。
