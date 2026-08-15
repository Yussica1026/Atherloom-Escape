# Atherloom 文字密室

一套让人类与 AI 以平等玩家身份共同解谜的跨平台文字密室。

> **专有软件 · 不开源 · 禁止商用**
> 本仓库未采用开放源代码许可证。未经版权所有者书面许可，不得复制、修改、再发布、镜像、二次打包、商业托管、出售或用于任何商业服务。仓库或部署文件可见不代表获得使用授权。完整条款见 [`LICENSE`](LICENSE)。

## 当前目标

- 独立网页版 / PWA 是密室本体。
- Atherloom 是拥有本地人格、记忆与共同日记能力的完整入口。
- Codex、Kelivo、RikkaHub 通过 MCP 接入。
- AstrBot 通过专用插件接入并负责后台唤醒人格。
- Relay 保存唯一真实状态；模型不能看到未发现答案，也不能用自然语言绕过裁判。

## 随机组合

建局时分别抽取一项世界观与一项故事气质，并把随机种子写入存档：

- 世界观：古代、现代、科幻、近现代、中世纪、西幻。
- 故事气质：甜宠、日常、正剧、BE、恐怖。

同一局在任何设备恢复时都得到完全相同的组合。

## 席位

协议允许 1–4 个席位，席位类型为 `human` 或 `ai`。预设模式包括 AI 独行、AI 与用户双人协作、AI 小队和混合小队。

## 目录

- `shared/`：平台无关的随机、事件与状态规则。
- `worker/`：Cloudflare Worker / D1 Relay。
- `web/`：独立 PWA。
- `mcp/`：Codex、Kelivo、RikkaHub 共用 MCP 桥。
- `adapters/`：Atherloom 与 AstrBot 适配说明及代码。
- `tests/`：协议与状态机测试。

跨平台能力与尚需真机确认的边界见 [`docs/platform-compatibility.md`](docs/platform-compatibility.md)。

## 本地验证

```powershell
npm.cmd run check
npm.cmd run dev
```

本地预览默认在 `http://127.0.0.1:8794`。本地演示数据保存在浏览器 `localStorage`，正式联机数据以 Relay 为准。

## 发布边界

- 推荐把开发仓库设为私有，通过 GitHub Pages 公开游戏页面。
- 若账户方案不支持私有仓库 Pages，则开发源码保持私有，另用公开部署仓库只保存自动生成的网页产物。
- GitHub Pages 和浏览器包不得包含 Relay 身份令牌、MCP 令牌、模型 API Key、未公开谜底或服务端裁判逻辑。
