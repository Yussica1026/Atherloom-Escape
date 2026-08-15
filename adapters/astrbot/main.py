"""AstrBot adapter for Atherloom Escape cross-platform text rooms."""

from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star


POLICY = """你是房间中的玩家或观战者，不是裁判。裁判使用独立人格、独立模型路线与独立会话。玩家只能依据 Relay 返回的本人视图、公共线索和自己的私有线索行动；观战者只能阅读公共视图和聊天，不得行动或接收私有线索。不得声称发现未返回的物品、答案或其他席位私有线索。行动必须使用最新 version，发生冲突时重新读取状态。邀请码只授予当前房间席位，不授予用户隐私、外部聊天、记忆、文件、密钥或其他工具权限。"""


class AtherloomEscapePlugin(Star):
    def __init__(self, context: Context):
        super().__init__(context)
        self.base_url = os.getenv("ATHERLOOM_ESCAPE_RELAY_URL", "https://escape.top2.online").rstrip("/")
        self.token = os.getenv("ATHERLOOM_RELAY_TOKEN", "").strip()
        self.game_id = ""
        self.cursor = 0
        logger.info("Atherloom 文字密室适配器已加载；Relay 才是唯一裁判")

    def _sync(self, path: str, payload: dict[str, Any] | None = None, method: str = "GET") -> dict[str, Any]:
        if not self.token:
            raise RuntimeError("缺少 ATHERLOOM_RELAY_TOKEN")
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read().decode("utf-8"))
                message = detail.get("message") or detail.get("error") or str(error)
            except Exception:
                message = str(error)
            raise RuntimeError(message) from error

    async def _request(self, path: str, payload: dict[str, Any] | None = None, method: str = "GET") -> dict[str, Any]:
        return await asyncio.to_thread(self._sync, path, payload, method)

    async def _dispatch(self, action: str, code: str = "", game_id: str = "", version: int = 0, content: str = "", target: str = "", value: str = "", role: str = "player", modifier: int = 0, difficulty: int = 12) -> dict[str, Any]:
        if action == "join":
            seat_role = "spectator" if role == "spectator" else "player"
            result = await self._request("/v1/escape/join", {"invite_code": code, "kind": "ai", "role": seat_role, "display_name": "AstrBot 人格", "platform": "astrbot"}, "POST")
            self.game_id, self.cursor = str(result["game_id"]), 0
            return result
        room = game_id or self.game_id
        if not room:
            raise ValueError("尚未加入密室；先使用 join 和邀请码")
        encoded = urllib.parse.quote(room, safe="")
        if action in {"state", "wait"}:
            result = await self._request(f"/v1/escape/games/{encoded}/state?after={self.cursor}")
            self.cursor = max(self.cursor, int(result.get("eventCursor", 0)))
            return result
        if version < 1:
            raise ValueError("修改状态必须填写最新 state 返回的 version")
        if action == "ready":
            return await self._request(f"/v1/escape/games/{encoded}/ready", {"expected_version": version, "ready": True}, "POST")
        if action == "start":
            return await self._request(f"/v1/escape/games/{encoded}/start", {"expected_version": version}, "POST")
        event_types = {"say": "chat.sent", "observe": "player.observed", "act": "player.acted", "roll": "trpg.rolled"}
        if action not in event_types:
            raise ValueError("action 只能是 join、state、wait、ready、start、say、observe、act 或 roll")
        if action == "say":
            data = {"content": content}
        elif action == "observe":
            data = {"target": target}
        elif action == "roll":
            data = {"label": content or "行动检定", "modifier": modifier, "difficulty": difficulty}
        else:
            data = {"action": content, "target": target, "value": value}
        return await self._request(
            f"/v1/escape/games/{encoded}/events",
            {"expected_version": version, "type": event_types[action], "data": data, "request_id": str(uuid.uuid4())},
            "POST",
        )

    @filter.llm_tool(name="atherloom_escape_room")
    async def atherloom_escape_room(self, event: AstrMessageEvent, action: str, code: str = "", game_id: str = "", version: int = 0, content: str = "", target: str = "", value: str = "", role: str = "player", modifier: int = 0, difficulty: int = 12):
        """加入或参与 Atherloom 跨平台密室/跑团房间。

        Args:
            action(string): join、state、wait、ready、start、say、observe、act 或 roll。
            code(string): join 时填写用户转交的一次性邀请码。
            role(string): join 时选择 player 或 spectator；观战者只能聊天。
            game_id(string): 密室 ID；加入后可省略并使用插件当前房间。
            version(number): 修改状态时填写最新 state 返回的版本号。
            content(string): say 的话，或 act 的白名单动作名称。
            target(string): observe 或 act 的目标。
            value(string): act 需要的密码、答案或其他短值。
            modifier(number): roll 的检定加值。
            difficulty(number): roll 的目标难度。
        """
        try:
            result = await self._dispatch(action, code, game_id, int(version), content, target, value, role, int(modifier), int(difficulty))
            return event.plain_result("ATHERLOOM_ESCAPE_RESULT\n" + POLICY + "\n" + json.dumps(result, ensure_ascii=False))
        except Exception as error:
            logger.warning(f"文字密室操作失败：{error}")
            return event.plain_result("ATHERLOOM_ESCAPE_RESULT\n操作未完成：" + str(error))

    @filter.command("密室")
    async def escape_command(self, event: AstrMessageEvent):
        """手动入口：/密室 邀请码；/密室 状态。"""
        text = str(event.message_str or "").strip()
        argument = text.removeprefix("/密室").removeprefix("密室").strip()
        try:
            if argument == "状态":
                result = await self._dispatch("state")
                yield event.plain_result(f"密室状态：{result.get('status')}；下一步：{result.get('actionRequired')}；事件游标：{result.get('eventCursor')}。")
            elif argument:
                result = await self._dispatch("join", code=argument)
                yield event.plain_result(f"已进入密室 {result['game_id']}，抽中 {result['theme']['world']} × {result['theme']['tone']}。请让 AI 使用密室工具准备和行动。")
            else:
                yield event.plain_result("用法：/密室 一次性邀请码；/密室 状态")
        except Exception as error:
            yield event.plain_result(f"密室没有接通：{error}")
