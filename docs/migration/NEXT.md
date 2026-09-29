# 接续状态（2026-09-29）

## 当前执行点

- 用户最终选择普通官方 `/Applications/DeepSeek Harness.app`（0.2.0-rc.1）与默认 `~/.dsh/profiles/desktop`。普通路径签名、公证已通过；原桌面 LA 品牌薄入口已移入废纸篓，可恢复。两个插件新包尚未通过原生管理器安装。
- 当前候选安装身份 `la-478ea64aa103-b4f81677`：LA `478ea64aa103`、BrowserSkill `b4f81677`。实际 tgz 已暂存到产品 `runtime/packages`。BrowserSkill 已按真实 0.2 SDK 与冻结适配锁文件构建，382/382 测试通过，两次构建 SHA256 一致。
- 主插件最终包构建通过；打包后 8/8 typecheck、173 Node、21 Bun、隔离源与目标 CAT 各 151/151 通过；安装回执测试 3/3 通过。日志在 `artifacts/evidence/dsh-020-*.log`，工具链核验通过。
- `install:local` 返回 NATIVE_INSTALL_PENDING。已写 `~/.dsh/cordis.patch.yml` 配置 LA 数据根、BrowserSkill 私有 daemon home 与默认日志关闭。未改 desktop profile 依赖清单、凭据或会话；`current.json` 仍代表先前安装，不得据新包伪造安装完成。
- 待通过官方原生管理器安装两 tgz，并启用 `@deepseek-ai/dsh-experimental-schedule-bundle@0.2.0-rc.1`。本地包 UI 安装受 CUA 工具“动作时确认”规则约束；须在能执行该动作时请求一次具体确认。
- CUA 对 DSH/Finder 均报 ScreenCaptureKit -3811；用户未见授权弹窗，系统报告显示器在线，原因未确定。`artifacts/evidence/desktop-control-blocker.json` 记录 BLOCKED_ENV；已异步询问 Codex 屏幕录制权限当前状态。恢复 CUA 后进行正式安装、双击、退出重开及完整 UI/Provider/BrowserSkill localhost 链验证。不要继续盲试相同失败。
- 实施规范、AGENTS、快速说明、离线 HTML、manifest 已统一官方 App/default profile 方案。BrowserSkill `bskHome` 由插件 runner 传给子进程；不依赖启动器注入环境。源仓库未修改。
- `verify:ready` 当前仍 FAILED：安装仍旧身份，功能/验收矩阵未全通过；普通 Composer 提交绑定、跨 Workspace 历史 fork 和自动任务执行结果等缺口保持真实 pending。旧 0.1.7 验收不能用于新包。下方是先前历史记录。

## 先前记录

状态：IMPLEMENTING，未达到 READY。只读源 `/Users/wangyu/Desktop/linguist-agent-next` 未改动；目标代码和独立产品数据根在 `/Users/wangyu/Desktop/Linguist-Agent-DSH` 与 `/Users/wangyu/Library/Application Support/Linguist-Agent-DSH`。

- 正式载体已改为固定官方 DSH Desktop `0.1.7-rc.2` ARM64 成品。DMG 来源、SHA-256、签名、公证、内嵌运行时均核对；两插件实际 tgz 已通过官方原生管理器装入独立 `desktop` profile，并排入口 `/Users/wangyu/Desktop/Linguist Agent DSH.app` 经 Finder 双击、退出、重开，两个插件仍启用。旧 `a3260da726fe` 安装实例曾通过 9/9 静态身份检查；当前 `8ca040bebfa6` 包尚未更新到原生管理器，G04 失败。
- 官方桌面已创建合成 Workspace 与项目，导入 3 段 JSON，编辑并确认 1 段，QA 找到 2 个空译文，交付只读预检如实阻断；四岗位 DSH Session 已创建。真实已配置 Provider 曾返回指定合成响应；`artifacts/evidence/provider-observation.json` 对应更早的 `la-773ddbf48d07-ba6d99c6` 安装身份，并非当前包的 G07 证据。旧截图在 `artifacts/evidence/ui-*.png`，不能用于新包验收。
- BrowserSkill 固定 CLI/私有 daemon/localhost fixture 已通过，但 Chrome 扩展连接数为零，真实 AgentWindow 与上传/下载链为 `BLOCKED_ENV`。不得用 CLI doctor 或原生面板空状态冒充完整浏览器验证。
- `docs/migration/FEATURE_MAP.json` 目前 333 源文件中 25 pending（16 个实现/资源、9 个测试），20 个必需功能面 pending；32 个工具映射 complete。Renderer/Host 接续审计分别见 `tests/copied-renderer/AUDIT.md`、`tests/copied-host/AUDIT.md`。新 LA 包 `8ca040bebfa6` 已构建并暂存，BrowserSkill 包仍为 `ba6d99c6`；打包后 8/8 typecheck、173 Node、21 Bun、隔离源与目标 CAT 各 151/151 通过。正式 Desktop 当前仍安装旧 `a3260da726fe` 包，须经原生管理器更新到 `8ca040bebfa6`、重开并重新采集证据。
- 隐私只读审计回执 `artifacts/evidence/privacy-readonly.json` 为 `PARTIAL`：源和快照清单、产品路径隔离及合成 fixture 通过局部检查，旧目录施工前后全量写入史和全局日志/远端发布史无法由事后扫描证明；不得用它给 G09 写入全真通过。
- 新包已接原生 continuable 委派、后续消息/列表/当前轮中断，以及定时任务手动投递；Client 修复 CAT 聚焦横向滚动，补原生 Composer 范围提示和 Files 入口。Host 还修正了列映射 JSON 的批次误识别、HTTP 各路由未分类异常泄露，以及专用 CAT 任务 requestId 到实际 toolCall 的选区来源绑定。它们只有源码/合成检查通过，均待新安装包实际验证。固定 RC 无普通 Composer 提交前 hook、跨 Workspace 历史 fork 目标参数，也无自动任务到期完成回调与独立新 Session 策略；对应原功能仍 pending。旧包 CUA 观察过 7+160 段导入、锁行、Emoji/组合字符、撤销/重做、换行和 Tag 防护，IME 尚未实证。
- 当前 `artifacts/READY.json` 为 `FAILED`；G01/G02 是矩阵未完，G04 是安装身份不同，G03/G05–G12 首先被旧 `acceptance.json` 身份挡住，不能视为各项已独立验收失败。后续须先完成新包原生更新与重开，再补当前实例的 Provider、四岗位、CAT/项目/UI、浅深色、窄窗、编辑器和冲突场景证据；在独立浏览器授权可用时执行 BrowserSkill localhost 扩展链；继续消除矩阵真实缺口并复测。仅 `verify:ready` 对当前实例全部通过才发送成功通知，否则报告 `FAILED`/`BLOCKED_ENV`。
