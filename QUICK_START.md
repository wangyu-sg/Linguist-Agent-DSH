# Linguist Agent DSH · 本机入口

当前迁移验收状态以 [`artifacts/READY.json`](artifacts/READY.json) 为准；尚未取得 `READY` 时只使用非客户合成数据。

打开 `/Applications/DeepSeek Harness.app`，使用官方 DeepSeek Harness Desktop `0.2.0-rc.1`。LA 和 BrowserSkill 安装在其默认 `desktop` profile；窗口、Session、模型和权限由 DSH 管理。

在侧栏打开 **Linguist**，选择 DSH Workspace，创建或打开项目，再选择 General、Translator、Reviewer 或 Proofreader，以及 CAT、工作副本或浏览器模式。CAT 工作台在会话右侧打开；岗位切换会创建新的 DSH Session。工作副本处理 DSH Workspace 文件，浏览器模式使用同一实例的 BrowserSkill。

本产品数据根：`/Users/wangyu/Library/Application Support/Linguist-Agent-DSH`。官方 Desktop 使用 `~/.dsh/profiles/desktop`；保留已有模型、凭据和会话。

BrowserSkill 面板显示实际连接状态；没有 Chrome 扩展连接时，网页读写与文件上传/下载不可用。不要以面板存在代替浏览器链已验证。
