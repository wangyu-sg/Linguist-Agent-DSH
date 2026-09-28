# Linguist Agent DSH · 本机入口

当前迁移验收状态以 [`artifacts/READY.json`](artifacts/READY.json) 为准；尚未取得 `READY` 时只使用非客户合成数据。

双击 `/Users/wangyu/Desktop/Linguist Agent DSH.app` 打开固定的官方 DeepSeek Harness Desktop `0.1.7-rc.2`。入口只设置本产品独立数据目录；DSH 原生窗口、Session、模型和权限由官方 Desktop 管理。

在侧栏打开 **Linguist**，选择 DSH Workspace，创建或打开项目，再选择 General、Translator、Reviewer 或 Proofreader，以及 CAT、工作副本或浏览器模式。CAT 工作台在会话右侧打开；岗位切换会创建新的 DSH Session。工作副本处理 DSH Workspace 文件，浏览器模式使用同一实例的 BrowserSkill。

本产品数据根：`/Users/wangyu/Library/Application Support/Linguist-Agent-DSH`。官方 Desktop 的 `desktop` profile 与窗口数据均隔离于此；旧 LA、Proma 和默认 DSH 不作替换。

BrowserSkill 面板显示实际连接状态；没有 Chrome 扩展连接时，网页读写与文件上传/下载不可用。不要以面板存在代替浏览器链已验证。
