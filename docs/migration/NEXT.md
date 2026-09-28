# 接续状态（2026-09-29）

状态：IMPLEMENTING，未达到 READY。只读源 `/Users/wangyu/Desktop/linguist-agent-next` 未改动；目标代码和独立产品数据根在 `/Users/wangyu/Desktop/Linguist-Agent-DSH` 与 `/Users/wangyu/Library/Application Support/Linguist-Agent-DSH`。

- 正式载体已改为固定官方 DSH Desktop `0.1.7-rc.2` ARM64 成品。DMG 来源、SHA-256、签名、公证、内嵌运行时均核对；两插件实际 tgz 已通过官方原生管理器装入独立 `desktop` profile，并排入口 `/Users/wangyu/Desktop/Linguist Agent DSH.app` 经 Finder 双击、退出、重开，两个插件仍启用。`node scripts/smoke-installed.mjs` 对当前安装实例通过 9/9 静态身份检查。
- 官方桌面已创建合成 Workspace 与项目，导入 3 段 JSON，编辑并确认 1 段，QA 找到 2 个空译文，交付只读预检如实阻断；四岗位 DSH Session 已创建。真实已配置 Provider 返回指定合成响应；持久日志的请求事件和应答消息身份在 `artifacts/evidence/provider-observation.json`，并非服务端 HTTP ID。截图在 `artifacts/evidence/ui-*.png`。
- BrowserSkill 固定 CLI/私有 daemon/localhost fixture 已通过，但 Chrome 扩展连接数为零，真实 AgentWindow 与上传/下载链为 `BLOCKED_ENV`。不得用 CLI doctor 或原生面板空状态冒充完整浏览器验证。
- `docs/migration/FEATURE_MAP.json` 目前 333 源文件中 25 pending，20 个必需功能面 pending。Renderer/Host 接续审计分别见 `tests/copied-renderer/AUDIT.md`、`tests/copied-host/AUDIT.md`。新 LA 包 `ed21c0a83ae6` 已构建并暂存，BrowserSkill 包仍为 `ba6d99c6`；打包后 8/8 typecheck、169 Node、11 Bun、隔离源与目标 CAT 各 151/151 通过。正式 Desktop 当前仍安装旧 `a3260da726fe` 包，须经原生管理器更新到 `ed21c0a83ae6`、重开并重新采集证据；此前 Web profile 或旧包截图不能替代。
- 隐私只读审计回执 `artifacts/evidence/privacy-readonly.json` 为 `PARTIAL`：源和快照清单、产品路径隔离及合成 fixture 通过局部检查，旧目录施工前后全量写入史和全局日志/远端发布史无法由事后扫描证明；不得用它给 G09 写入全真通过。
- 新包已接原生 continuable 委派、后续消息/列表/当前轮中断，以及定时任务手动投递；Client 修复 CAT 聚焦横向滚动，补原生 Composer 范围提示和 Files 入口。它们只有源码/合成检查通过，均待新安装包实际验证。固定 RC 无普通 Composer 提交前 hook、跨 Workspace 历史 fork 目标参数，也无自动任务到期完成回调与独立新 Session 策略；对应原功能仍 pending。旧包 CUA 观察过 7+160 段导入、锁行、Emoji/组合字符、撤销/重做、换行和 Tag 防护，IME 尚未实证。
- 后续：对当前已安装包补齐真实 Provider、四岗位、CAT/项目/UI、浅深色、窄窗、编辑器和冲突场景的 CUA 证据；在独立浏览器授权可用时执行 BrowserSkill localhost 扩展链；继续消除 FEATURE_MAP 所列真实缺口并复测；执行 `verify:ready`，仅其对当前安装实例全部通过才发送成功通知。缺失时准确报告 `FAILED`/`BLOCKED_ENV`。
