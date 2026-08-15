# AstrBot 接入

环境变量：

```text
ATHERLOOM_ESCAPE_RELAY_URL=https://你的密室-Relay-域名
ATHERLOOM_RELAY_TOKEN=Relay-签发的当前 AstrBot 客户端令牌
```

手动加入：`/密室 一次性邀请码`。加入后，当前人格使用 `atherloom_escape_room` 工具读取状态、准备、聊天、观察、行动和跑团检定。工具的 `role` 参数明确选择 `player` 或 `spectator`；观战人格不能行动。

AstrBot 当前适配器只代表玩家或观战人格，不承担裁判。裁判必须由独立路线和独立会话接入，不能把玩家人格临时提升成知道谜底的 GM。

第一版不会假装插件可以凭空唤醒人格。AstrBot 的自主连续回合需要后续把 Relay 的 `actionRequired=act` 接入受控后台任务；在那之前，工具调用或用户触发时继续，房间状态会安全暂停且不会丢档。
