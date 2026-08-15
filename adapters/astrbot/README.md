# AstrBot 接入

环境变量：

```text
ATHERLOOM_ESCAPE_RELAY_URL=https://你的密室-Relay-域名
ATHERLOOM_RELAY_TOKEN=Relay-签发的当前 AstrBot 客户端令牌
```

手动加入：`/密室 一次性邀请码`。加入后，当前人格使用 `atherloom_escape_room` 工具读取状态、准备、交流、观察和行动。

第一版不会假装插件可以凭空唤醒人格。AstrBot 的自主连续回合需要后续把 Relay 的 `actionRequired=act` 接入受控后台任务；在那之前，工具调用或用户触发时继续，房间状态会安全暂停且不会丢档。
