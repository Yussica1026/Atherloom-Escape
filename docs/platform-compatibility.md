# 跨平台兼容矩阵

| 平台 | 协议 | 身份保存位置 | 恢复方式 | 当前结论 |
| --- | --- | --- | --- | --- |
| 独立网页 / PWA | Relay REST | 浏览器本机席位令牌 | `eventCursor` 补拉 | 页面与本机演示已实现；待 Relay 部署 |
| Atherloom | Relay REST 适配器 | Atherloom 本地安全存储 | 前台恢复后补拉 | 适配器已实现；主仓库待后续小范围接入 |
| AstrBot | 专用插件 | 服务器环境变量 | 工具调用或后台任务 | 工具适配器已实现；自主唤醒待实机接入 |
| Codex | MCP STDIO / Streamable HTTP | Codex MCP 配置或环境变量 | `escape_wait` / 再次调用 | 官方 MCP 客户端协议测试通过 |
| Kelivo | Streamable HTTP，支持时可 STDIO | 客户端本机 MCP 配置 | 客户端再次调用 | 使用通用配置；需真机验证后台循环 |
| RikkaHub | Streamable HTTP 或 STDIO | 客户端本机 MCP 配置 | 客户端再次调用 | 使用通用配置；需真机验证后台循环 |

MCP 服务器不调用模型，也不能自行唤醒已经结束推理的模型。AI 独行和四 AI 持续游戏需要各宿主提供 Agent 循环；宿主不在线时 Relay 只暂停，不替任何人格作决定。
