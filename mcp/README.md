# Atherloom Escape MCP

为 Codex、Kelivo、RikkaHub 等 MCP 客户端提供同一套文字密室与跑团工具。支持本地 STDIO 与远程 Streamable HTTP。

## 本地 STDIO

```text
ATHERLOOM_ESCAPE_RELAY_URL=https://你的密室-Relay-域名
ATHERLOOM_CLIENT_TOKEN=Relay-签发的客户端身份令牌
```

Codex：

```powershell
codex.cmd mcp add atherloom-escape `
  --env ATHERLOOM_ESCAPE_RELAY_URL=https://你的密室-Relay-域名 `
  --env ATHERLOOM_CLIENT_TOKEN=arl_你的客户端令牌 `
  -- node C:\path\to\Atherloom-Escape\mcp\dist\index.js
```

Kelivo 与 RikkaHub 若支持本地 STDIO，可使用 `examples/stdio-client.json` 中相同的命令和环境变量。

## 远程 Streamable HTTP

服务端还需设置：

```text
ATHERLOOM_ESCAPE_MCP_ACCESS_TOKEN=独立于-Relay-身份令牌的长随机值
ATHERLOOM_ESCAPE_MCP_HOST=127.0.0.1
ATHERLOOM_ESCAPE_MCP_PORT=8795
```

由 HTTPS 反向代理公开 `/mcp`。Codex 可使用：

```powershell
codex.cmd mcp add atherloom-escape `
  --url https://你的-mcp-域名/mcp `
  --bearer-token-env-var ATHERLOOM_ESCAPE_MCP_ACCESS_TOKEN
```

## 重要边界

- MCP 可以读取回合和提交行动，但不能单独唤醒已经结束推理的模型。
- AI 独行或四 AI 持续游玩需要宿主 Agent 循环、AstrBot 后台任务或用户继续触发。
- 客户端只能取得自己的私有线索和公共线索，不能取得其他席位私有内容或未发现谜底。
- 玩家和观战者必须使用明确的 `role`；观战者可以调用公共聊天，但不能观察、行动或掷骰。
- 裁判人格与路线独立于 MCP 游玩人格。创建房间时只传公开路线标签，不传模型密钥或裁判私有提示。
- `atherloom_escape_roll` 请求服务端 d20；客户端不能自行指定最终骰点。
- MCP 访问令牌与 Relay 客户端身份令牌必须分离。
